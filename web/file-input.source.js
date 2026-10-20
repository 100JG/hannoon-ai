import {Unzip, UnzipInflate} from 'fflate';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED = 24 * 1024 * 1024;
const MAX_ENTRIES = 3000;
const MAX_EXTRACTED = 200000;
const MAX_PDF_PAGES = 80;
const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

function normalize(value) {return String(value).replace(/\0/g, '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n\s*\n(?:\s*\n)+/g, '\n\n').trim();}
function decode(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try {return new TextDecoder('utf-8', {fatal: true}).decode(bytes);}
  catch {return new TextDecoder('euc-kr').decode(bytes);}
}

export function scanZip(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50 && index + 22 + view.getUint16(index + 20, true) === data.length) {end = index; break;}
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('지원하지 않는 문서 압축 형식입니다.');
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  const size = view.getUint32(end + 12, true);
  if (!count || count > MAX_ENTRIES || start + size > end || view.getUint16(end + 8, true) !== count) throw new Error('문서 내부 파일이 너무 많거나 손상되었습니다.');
  let offset = start;
  let total = 0;
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) throw new Error('문서 내부 구조를 읽지 못했습니다.');
    const flag = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > start + size || !nameLength || nameLength > 1024 || expanded === 0xffffffff || local >= start || flag & 1 || ![0, 8].includes(method)) throw new Error('암호화되었거나 지원하지 않는 문서입니다.');
    const name = new TextDecoder('utf-8').decode(data.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
    if (name.startsWith('/') || name.includes('\0') || name.split('/').some(part => part === '..') || entries.has(name)) throw new Error('안전하게 읽을 수 없는 문서 구조입니다.');
    total += expanded;
    if (total > MAX_EXPANDED) throw new Error('압축을 푼 문서 크기가 너무 큽니다. 문서를 나누어 주세요.');
    entries.set(name, {expanded, local, crc: view.getUint32(offset + 16, true)});
    offset = next;
  }
  if (offset !== start + size) throw new Error('문서 내부 구조를 읽지 못했습니다.');
  return entries;
}

function unzipText(data, extension) {
  const entries = scanZip(data);
  const wanted = extension === 'docx'
    ? ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'].filter(name => entries.has(name))
    : [...entries.keys()].filter(name => /^Contents\/section\d+\.xml$/i.test(name)).sort((a, b) => Number(a.match(/section(\d+)/i)[1]) - Number(b.match(/section(\d+)/i)[1]));
  if (!wanted.length || (extension === 'docx' && !entries.has('word/document.xml'))) throw new Error('문서의 본문을 찾지 못했습니다.');
  const selected = new Set(wanted);
  const parts = new Map();
  let actual = 0;
  let failure;
  let seen = 0;
  const unzip = new Unzip(file => {
    if (++seen > MAX_ENTRIES || !entries.has(file.name)) {failure = new Error('문서 내부 구조를 읽지 못했습니다.'); return;}
    if (!selected.has(file.name)) return;
    let length = 0;
    let crc = -1;
    const chunks = [];
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {failure = new Error('문서 압축을 풀지 못했습니다.'); file.terminate(); return;}
      length += chunk.length; actual += chunk.length;
      if (length > entries.get(file.name).expanded || actual > MAX_EXPANDED) {failure = new Error('압축을 푼 문서 크기가 너무 큽니다.'); file.terminate(); return;}
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
      chunks.push(chunk);
      if (final) {
        if (length !== entries.get(file.name).expanded || (crc ^ -1) >>> 0 !== entries.get(file.name).crc) {failure = new Error('손상된 문서입니다.'); return;}
        const result = new Uint8Array(length); let offset = 0;
        for (const piece of chunks) {result.set(piece, offset); offset += piece.length;}
        parts.set(file.name, decode(result));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < data.length; offset += 1024) {
      unzip.push(data.subarray(offset, Math.min(data.length, offset + 1024)), offset + 1024 >= data.length);
      if (failure) throw failure;
    }
  } catch (error) {throw failure || new Error('문서 압축을 풀지 못했습니다.');}
  if (wanted.some(name => !parts.has(name))) throw new Error('문서의 전체 본문을 읽지 못했습니다.');
  return wanted.map(name => parts.get(name));
}

function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('안전하게 읽을 수 없는 문서입니다.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('문서의 본문 형식이 손상되었습니다.');
  const paragraphs = [...doc.getElementsByTagNameNS('*', 'p')];
  const pieces = [];
  const collect = (element, root) => {
    if (element.nodeType !== 1 || element !== root && element.localName === 'p') return '';
    if (element.localName === 't') return element.textContent || '';
    if (element.localName === 'tab') return ' ';
    if (['br', 'lineBreak'].includes(element.localName)) return '\n';
    return [...element.children].map(child => collect(child, root)).join('');
  };
  for (const p of paragraphs) {const value = collect(p, p).trim(); if (value) pieces.push(value);}
  return pieces.join('\n');
}

function htmlText(text) {
  const template = document.createElement('template');
  template.innerHTML = text;
  const doc = template.content;
  doc.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,form,input,textarea,button,select,svg,canvas,iframe,img,video,audio,source,track,object,embed,link,meta,[hidden],[aria-hidden="true"]').forEach(element => element.remove());
  const root = doc.querySelector('article') || doc.querySelector('main') || doc;
  root.querySelectorAll('br,p,div,section,article,h1,h2,h3,h4,li,tr,td,blockquote,pre').forEach(element => {element.append('\n');});
  return root.textContent || '';
}

async function pdfText(data) {
  const {getDocument, GlobalWorkerOptions} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const loading = getDocument({data, isEvalSupported: false, useWasm: false, disableFontFace: true, enableXfa: false, stopAtErrors: true, verbosity: 0,
    cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true,
    standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href});
  let timedOut = false;
  let timer;
  const deadline = new Promise((_, reject) => {timer = setTimeout(() => {timedOut = true; loading.destroy().catch(() => {}); reject(new Error('PDF를 읽는 데 시간이 오래 걸립니다. 문서를 나누거나 텍스트로 입력해 주세요.'));}, 30000);});
  const work = (async () => {
    const pdf = await loading.promise;
    const pages = [];
    const warnings = [];
    let total = 0;
    let empty = 0;
    let truncated = pdf.numPages > MAX_PDF_PAGES;
    if (truncated) warnings.push('PDF 앞 80페이지만 읽었습니다. 전체 내용을 정리하려면 파일을 나누어 주세요.');
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES); number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const value = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
      if (!value) empty++;
      pages.push(value); total += value.length;
      page.cleanup();
      if (total > MAX_EXTRACTED) {truncated = true; warnings.push('PDF의 추출 분량을 제한했습니다. 필요한 부분만 나누어 주세요.'); break;}
    }
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('텍스트를 읽을 수 없는 PDF입니다. 이미지형·스캔 PDF는 지원하지 않습니다.');
    if (empty) {truncated = true; warnings.push('텍스트가 확인되지 않은 페이지가 있습니다. 빈 페이지 또는 이미지형 페이지인지 확인해 주세요.');}
    return {text, warnings, truncated};
  })();
  try {return await Promise.race([work, deadline]);}
  catch (error) {
    if (timedOut || error.message?.startsWith('텍스트를') || error.message?.startsWith('PDF를')) throw error;
    if (error.name === 'PasswordException') throw new Error('암호가 설정된 PDF는 지원하지 않습니다. 암호를 해제한 사본을 선택해 주세요.');
    throw new Error('PDF를 읽지 못했습니다. 텍스트를 선택할 수 있는 정상 PDF인지 확인해 주세요.');
  } finally {clearTimeout(timer); await loading.destroy().catch(() => {});}
}

export async function readDocument(file, {maxChars = 12000, maxBytes = MAX_BYTES} = {}) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') throw new Error('파일을 선택해 주세요.');
  const byteLimit = Math.min(MAX_BYTES, maxBytes);
  const charLimit = Math.min(12000, Math.max(1, maxChars));
  if (!file.size || file.size > byteLimit) throw new Error('파일은 비어 있지 않은 10MB 이하의 파일을 선택해 주세요.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['txt', 'html', 'htm', 'docx', 'hwpx', 'pdf'].includes(extension)) throw new Error('txt, docx, html, hwpx, pdf 파일을 선택해 주세요.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length > byteLimit) throw new Error('파일 크기가 한도를 초과했습니다.');
  let value;
  if (extension === 'pdf') value = await pdfText(data);
  else if (extension === 'docx' || extension === 'hwpx') value = {text: unzipText(data, extension).map(parseXml).join('\n\n'), warnings: ['문서의 텍스트를 읽었습니다. 표·그림·수식의 배치 의미는 원문과 함께 확인해 주세요.']};
  else if (extension === 'html' || extension === 'htm') value = {text: htmlText(decode(data))};
  else value = {text: decode(data)};
  const text = normalize(value.text);
  if (!text) throw new Error('읽을 수 있는 본문이 없습니다. 파일 내용을 확인해 주세요.');
  let totalChars = 0;
  const characters = [];
  for (const character of text) {totalChars++; if (totalChars <= charLimit) characters.push(character);}
  const warnings = value.warnings || [];
  const truncated = !!value.truncated || totalChars > charLimit;
  if (totalChars > charLimit) warnings.push(`총 ${totalChars.toLocaleString()}자 중 앞 ${charLimit.toLocaleString()}자만 읽었습니다. 필요한 부분을 선택하거나 파일을 나누어 주세요.`);
  return {text: characters.join(''), warnings, total_chars: totalChars, truncated, title: file.name};
}
