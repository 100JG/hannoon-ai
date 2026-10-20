import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countCharacters, isWebUrl, safeImageUrl, formatBytes, jobState, settleWithin, rasterSize } from '../web/app.js';

test('input limits count Unicode characters without cutting user text', () => {
  assert.equal(countCharacters('한눈AI😀'), 5);
  assert.equal(countCharacters('가'.repeat(12001)), 12001);
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.slice\(0,\s*(?:12000|state\.maxChars)\)/);
});
test('URL input accepts only standalone HTTP(S) URLs without embedded credentials', () => {
  assert.equal(isWebUrl('https://example.com/page?q=1'), true);
  for (const value of ['ftp://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com some text', '이것은 텍스트입니다.']) assert.equal(isWebUrl(value), false, value);
});
test('result images stay in the same origin and authenticated image route', () => {
  const origin = 'https://hannoon.example';
  assert.equal(safeImageUrl('/api/jobs/a-1/image.svg', origin), `${origin}/api/jobs/a-1/image.svg`);
  assert.equal(safeImageUrl('/api/jobs/a-1/image.png', origin), `${origin}/api/jobs/a-1/image.png`);
  for (const value of ['https://evil.example/api/jobs/a/image.svg', '//evil.example/api/jobs/a/image.svg', '/assets/logo.svg', 'data:image/svg+xml,evil', 'javascript:alert(1)', '/api/jobs/../../config', '/api/jobs/a']) assert.equal(safeImageUrl(value, origin), null, value);
});
test('file sizes are understandable', () => {
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(2560), '3 KB');
  assert.equal(formatBytes(1572864), '1.5 MB');
});
test('job polling recognizes service states', () => {
  for (const state of ['queued', 'running', 'completed', 'failed']) assert.equal(jobState({state}), state.toUpperCase());
  assert.equal(jobState({status:'COMPLETED'}), 'COMPLETED');
  assert.equal(jobState(null), '');
});
test('clipboard wait ends and handles errors arriving after timeout', async () => {
  let rejectLate;
  const pending = new Promise((_, reject) => { rejectLate = reject; });
  await assert.rejects(settleWithin(pending, 5), /timed out/);
  rejectLate(new Error('Permission denied later'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await settleWithin(Promise.resolve('copied'), 100), 'copied');
});
test('PNG conversion bounds memory while preserving the image aspect ratio', () => {
  assert.deepEqual(rasterSize(1000, 500), {width:1800, height:900});
  assert.deepEqual(rasterSize(300, 5000), {width:144, height:2400});
  assert.deepEqual(rasterSize(100, 100), {width:200, height:200});
  assert.throws(() => rasterSize(0, 300), /Invalid/);
  assert.throws(() => rasterSize(Infinity, 300), /Invalid/);
});
test('public UI contains requested actions without account or API key input', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  for (const id of ['clear-button', 'regenerate', 'copy-image', 'download-image', 'selected-file']) assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes('href="/guide"'));
  assert.ok(html.includes('txt, docx, html, hwpx, pdf(텍스트로 인식되지 않는 이미지형 PDF 파일은 제외)'));
  assert.doesNotMatch(html + js, /연결 KEY 복사|연결 설정|도식|innerHTML|localStorage|sessionStorage|회원가입|로그인|auth-dialog|account-button|api\/auth/);
  assert.ok(js.includes('X-CSRF-Token'));
  assert.ok(js.includes('crypto.randomUUID()'));
  assert.ok(js.includes('new ClipboardItem'));
  assert.ok(js.includes('readDocument(file'));
  assert.doesNotMatch(js, /\/api\/inputs\/file/);
});
