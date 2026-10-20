import {SERVICE_URL} from './build-config.js';
import {serviceOrigin, hostPermissionPattern, sameOriginImage, validFile, validText, importedText, friendlyHttp, MAX_TEXT} from './common.mjs';

const origin = serviceOrigin(SERVICE_URL);
const $ = id => document.getElementById(id);
let busy = false;
let capability;
let resultBlob;
let resultObjectUrl;
let lastSource;
let pollRun = 0;

function notify(message) {$('notice').textContent = message; $('notice').hidden = !message;}
function progress(message) {$('progress').textContent = message; $('progress').hidden = !message;}
function setBusy(value) {
  busy = value;
  for (const id of ['generate', 'regenerate', 'clear', 'choose-file', 'input-mode', 'source']) $(id).disabled = value;
  $('generate').setAttribute('aria-busy', String(value));
}
function modeChanged() {
  const mode = $('input-mode').value;
  $('page-hint').hidden = mode !== 'page'; $('text-wrap').hidden = mode !== 'text'; $('file-wrap').hidden = mode !== 'file';
  $('generate').firstChild.textContent = mode === 'page' ? '현재 페이지 정리하기 ' : '다이어그램 만들기 ';
  notify('');
}

async function session(force = false) {
  if (!force) {
    const stored = await chrome.storage.session.get('capability');
    if (stored.capability?.origin === origin && stored.capability.accessToken) {capability = stored.capability.accessToken; return capability;}
  }
  const response = await fetch(origin + '/api/session', {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(friendlyHttp(response.status));
  const value = await response.json();
  if (typeof value.access_token !== 'string' || !value.access_token) throw new Error('서비스 연결을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  capability = value.access_token;
  await chrome.storage.session.set({capability: {origin, accessToken: capability}});
  return capability;
}

async function api(path, options = {}, asText = false) {
  if (!capability) await session();
  const response = await fetch(origin + path, {...options, headers: {...options.headers, Authorization: `Bearer ${capability}`}, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(90000)});
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {capability = null; await chrome.storage.session.remove(['capability', 'lastJob']);}
    throw new Error(friendlyHttp(response.status));
  }
  return asText ? response.text() : response.json();
}

// Reads visible article text only after an explicit action in the active tab.
function readVisibleArticle() {
  const root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  const excluded = 'script,style,noscript,nav,header,footer,aside,form,input,textarea,select,button,svg,canvas,iframe,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"],[role="complementary"]';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const parts = []; let length = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode; const parent = node.parentElement;
    if (!parent || parent.closest(excluded)) continue;
    const style = getComputedStyle(parent);
    if (['hidden', 'collapse'].includes(style.visibility) || style.display === 'none' || !parent.getClientRects().length) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim(); if (!text) continue;
    parts.push(text); length += text.length + 1; if (length > 14000) return {tooLong: true};
  }
  return {text: parts.join('\n')};
}

async function sourceText() {
  const mode = $('input-mode').value;
  if (mode === 'page') {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('이 페이지는 읽을 수 없습니다. 일반 웹페이지를 열거나 텍스트·파일 입력을 이용해 주세요.');
    let values;
    try {values = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: readVisibleArticle});}
    catch {throw new Error('이 페이지의 본문에 접근할 수 없습니다. 필요한 내용을 복사해 텍스트로 입력해 주세요.');}
    const value = values?.[0]?.result;
    if (value?.tooLong) throw new Error('페이지가 너무 깁니다. 필요한 부분을 복사해 12,000자 이내로 입력해 주세요.');
    if (!value?.text) throw new Error('읽을 수 있는 본문이 없습니다. 텍스트 또는 파일로 입력해 주세요.');
    return validText(value.text);
  }
  if (mode === 'file') {
    const file = validFile($('source-file').files[0]); progress('브라우저에서 파일의 본문을 읽고 있어요.');
    const {readDocument} = await import('./file-input.js');
    const imported = importedText(await readDocument(file, {maxChars: MAX_TEXT}));
    if (imported.warnings.length) notify(imported.warnings.join(' '));
    return imported.text;
  }
  const value = validText($('source').value);
  if (/^https?:\/\/\S+$/i.test(value)) {
    progress('웹페이지의 본문을 읽고 있어요.');
    const imported = importedText(await api('/api/inputs/url', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: value})}));
    if (imported.warnings.length) notify(imported.warnings.join(' '));
    return imported.text;
  }
  return value;
}

async function svgToPng(raw) {
  if (raw.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
  const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror,script,foreignObject,iframe,object,embed,image')) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
  const externalUrl = value => /url\(/i.test(value.replace(/url\(\s*(['"]?)#[A-Za-z0-9_-]+\1\s*\)/gi, ''));
  if ([...parsed.querySelectorAll('style')].some(element => /@import/i.test(element.textContent) || externalUrl(element.textContent))) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
  for (const element of parsed.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
    if (/^on/i.test(attribute.name) || /(?:href|src)$/i.test(attribute.name) && !attribute.value.startsWith('#') || externalUrl(attribute.value)) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
  }
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute('width')) || viewBox[2];
  const height = Number.parseFloat(root.getAttribute('height')) || viewBox[3];
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value < 100000)) throw new Error('이미지 크기를 확인하지 못했습니다.');
  const scale = Math.min(1, 4096 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  await document.fonts.ready;
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], {type: 'image/svg+xml'}));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {image.onload = resolve; image.onerror = () => reject(new Error('이미지를 표시하지 못했습니다.')); image.src = source;});
    const context = canvas.getContext('2d'); if (!context) throw new Error('이 환경에서는 이미지 저장을 지원하지 않습니다.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지를 저장하지 못했습니다.')), 'image/png'));
  } finally {URL.revokeObjectURL(source); canvas.width = 0; canvas.height = 0;}
}

async function showResult(job) {
  const value = job.result || job; const sentence = value.one_sentence || value.summary;
  if (typeof sentence !== 'string' || !sentence.trim() || [...sentence].length > 60) throw new Error('결과를 표시하지 못했습니다. 다시 생성해 주세요.');
  const image = new URL(sameOriginImage(value.image_url || job.image_url || '', origin));
  resultBlob = await svgToPng(await api(image.pathname + image.search, {}, true));
  if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl); resultObjectUrl = URL.createObjectURL(resultBlob);
  $('summary').textContent = sentence; $('diagram').src = resultObjectUrl;
  $('review-note').hidden = !['REVIEW_REQUIRED', 'FAIL'].includes(value.status || value.verification_status);
  $('results').hidden = false;
}

async function pollJob(id) {
  const run = ++pollRun; const started = Date.now();
  while (Date.now() - started < 460000 && run === pollRun) {
    const job = await api('/api/jobs/' + encodeURIComponent(id)); const state = String(job.state || job.status || '').toLowerCase();
    if (['failed', 'error', 'cancelled'].includes(state)) throw new Error('이번 결과를 완성하지 못했습니다. 내용을 조금 나누거나 다시 생성해 주세요.');
    if (['completed', 'complete', 'done', 'succeeded', 'success', 'pass', 'review_required'].includes(state) || job.result?.one_sentence || job.one_sentence) {await showResult(job); return;}
    progress(state === 'queued' ? '순서가 되면 바로 정리할게요.' : '핵심을 정리하고 원문과 확인하고 있어요.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('처리가 지연되고 있습니다. 확장 프로그램을 다시 열면 진행 상황을 확인할 수 있어요.');
}

async function generate(repeat = false) {
  if (busy) return; notify('');
  try {
    const granted = await chrome.permissions.request({origins: [hostPermissionPattern(origin)]});
    if (!granted) {notify('결과를 만들려면 한눈AI 서비스 연결 권한이 필요합니다. 다시 눌러 허용해 주세요.'); return;}
    setBusy(true); progress('내용을 확인하고 있어요.'); await session();
    const text = repeat && lastSource ? lastSource : await sourceText(); lastSource = text;
    const result = await api('/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source_text: text, request_id: crypto.randomUUID()})});
    if (typeof result.job_id !== 'string' || !result.job_id) throw new Error('요청을 시작하지 못했습니다. 다시 시도해 주세요.');
    await chrome.storage.session.set({lastJob: {id: result.job_id, text, origin}}); await pollJob(result.job_id); progress('');
  } catch (error) {progress(''); notify(['TimeoutError', 'TypeError'].includes(error.name) ? '서비스에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.' : error.message);}
  finally {setBusy(false);}
}

for (const [id, path] of [['open-web', '/'], ['brand', '/'], ['guide', '/guide'], ['privacy', '/privacy']]) {$(id).href = origin + path; $(id).addEventListener('click', event => {event.preventDefault(); chrome.tabs.create({url: origin + path});});}
$('input-mode').addEventListener('change', modeChanged);
$('source').addEventListener('input', () => {const count = [...$('source').value].length; $('counter').textContent = `${count.toLocaleString()} / ${MAX_TEXT.toLocaleString()}자`; $('counter').style.color = count > MAX_TEXT ? '#9d431c' : '';});
$('choose-file').addEventListener('click', () => $('source-file').click());
$('source-file').addEventListener('change', () => {
  notify('');
  try {const file = validFile($('source-file').files[0]); $('file-name').textContent = file.name; $('file-size').textContent = `${Math.max(1, Math.ceil(file.size / 1024)).toLocaleString()}KB · 선택 완료`; $('file-ready').hidden = false; $('choose-file').querySelector('span').textContent = '다른 파일 선택';}
  catch (error) {$('source-file').value = ''; $('file-ready').hidden = true; notify(error.message);}
});
$('clear').addEventListener('click', async () => {
  $('source').value = ''; $('source').dispatchEvent(new Event('input')); $('source-file').value = ''; $('file-ready').hidden = true; $('choose-file').querySelector('span').textContent = '파일 선택';
  $('results').hidden = true; $('diagram').removeAttribute('src'); resultBlob = null; lastSource = null; if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl); resultObjectUrl = null;
  await chrome.storage.session.remove('lastJob'); notify(''); progress('');
});
$('generate').addEventListener('click', () => generate()); $('regenerate').addEventListener('click', () => generate(true));
$('copy-image').addEventListener('click', async () => {if (!resultBlob) return; try {await navigator.clipboard.write([new ClipboardItem({'image/png': resultBlob})]); notify('이미지를 복사했어요. 원하는 곳에 붙여넣으세요.');} catch {notify('이 환경에서는 이미지 복사가 지원되지 않습니다. PNG 다운로드를 이용해 주세요.');}});
$('download-image').addEventListener('click', () => {if (!resultObjectUrl) return; const link = document.createElement('a'); link.href = resultObjectUrl; link.download = 'hannoon-diagram.png'; document.body.appendChild(link); link.click(); link.remove();});
window.addEventListener('pagehide', () => {pollRun++; if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);});

async function initialize() {
  modeChanged();
  try {
    const {lastJob, capability: saved} = await chrome.storage.session.get(['lastJob', 'capability']);
    if (lastJob?.id && lastJob.origin === origin && saved?.origin === origin && await chrome.permissions.contains({origins: [hostPermissionPattern(origin)]})) {
      capability = saved.accessToken; lastSource = lastJob.text; setBusy(true); progress('최근 결과를 불러오고 있어요.');
      try {await pollJob(lastJob.id); progress('');} catch (error) {notify(error.message); progress('');} finally {setBusy(false);}
    }
  } catch {notify('최근 결과를 불러오지 못했습니다. 새 자료를 입력해 주세요.');}
}
initialize();
