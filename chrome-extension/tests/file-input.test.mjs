import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync, strToU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {readDocument, scanZip} from '../../web/file-input.source.js';
globalThis.DOMParser = DOMParser;

function pdfDocument({imageOnly = false, pages = 1} = {}) {
  const objects = [];
  const stream = imageOnly ? 'q 100 0 0 100 50 600 cm /Im0 Do Q' : 'BT /F1 16 Tf 50 700 Td (Application review then notification.) Tj ET';
  const pageIds = Array.from({length: pages}, (_, index) => index + 3);
  const contentId = pages + 3, fontId = pages + 4, imageId = pages + 5;
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages} >>`);
  for (const id of pageIds) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\n000000>\nendstream');
  let value = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => {offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`;});
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) value += `${String(offset).padStart(10, '0')} 00000 n \n`;
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([value], 'source.pdf', {type: 'application/pdf'});
}

test('UTF-8 text preserves Korean and counts emoji as a single character', async () => {
  const value = await readDocument(new File(['한눈😀AI'], 'source.txt'), {maxChars: 3});
  assert.equal(value.text, '한눈😀'); assert.equal(value.total_chars, 5); assert.equal(value.truncated, true);
});

test('CP949 Korean text is decoded without replacement characters', async () => {
  const value = await readDocument(new File([Uint8Array.from([0xc7, 0xd1, 0xb4, 0xab, 0x41, 0x49])], 'source.txt'));
  assert.equal(value.text, '한눈AI'); assert.equal(value.truncated, false);
});

test('ZIP entries are bounded and path traversal is rejected', () => {
  const valid = zipSync({'word/document.xml': strToU8('<document/>')});
  assert.equal(scanZip(valid).get('word/document.xml').expanded, 11);
  assert.throws(() => scanZip(zipSync({'../outside.xml': strToU8('bad')})));
  const forged = valid.slice();
  for (let i = 0; i < forged.length - 46; i++) if (new DataView(forged.buffer).getUint32(i, true) === 0x02014b50) {new DataView(forged.buffer).setUint32(i + 24, 25 * 1024 * 1024, true); break;}
  assert.throws(() => scanZip(forged));
});

test('actual decompression cannot exceed a forged ZIP declared size', async () => {
  const forged = zipSync({'word/document.xml': strToU8('x'.repeat(100000))});
  for (let i = 0; i < forged.length - 46; i++) if (new DataView(forged.buffer).getUint32(i, true) === 0x02014b50) {new DataView(forged.buffer).setUint32(i + 24, 1, true); break;}
  await assert.rejects(() => readDocument(new File([forged], 'source.docx')), /압축을 푼 문서 크기|손상된 문서/);
});

test('DOCX includes all body paragraphs, table text and footnotes in sequence', async () => {
  const zipped = zipSync({
    'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>신청서를 </w:t></w:r><w:r><w:t>접수한다.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>담당자가 검토한다.</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>결과를 안내한다.</w:t></w:r></w:p></w:body></w:document>'),
    'word/footnotes.xml': strToU8('<w:footnotes xmlns:w="urn:word"><w:footnote><w:p><w:r><w:t>영업일 기준이다.</w:t></w:r></w:p></w:footnote></w:footnotes>'),
  });
  const value = await readDocument(new File([zipped], 'source.docx'));
  assert.equal(value.text, '신청서를 접수한다.\n담당자가 검토한다.\n결과를 안내한다.\n\n영업일 기준이다.');
  assert.equal(value.truncated, false); assert.ok(value.warnings.length);
});

test('HWPX reads every section in numeric order and does not duplicate nested paragraphs', async () => {
  const section = text => `<hs:sec xmlns:hs="urn:section" xmlns:hp="urn:paragraph"><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hs:sec>`;
  const zipped = zipSync({'Contents/section10.xml': strToU8(section('마지막 내용')), 'Contents/section2.xml': strToU8(section('두 번째 내용')), 'Contents/section0.xml': strToU8(section('첫 번째 내용'))});
  const value = await readDocument(new File([zipped], 'source.hwpx'));
  assert.equal(value.text, '첫 번째 내용\n\n두 번째 내용\n\n마지막 내용');
});

test('external entity declarations and ZIP checksum corruption are rejected', async () => {
  const xml = '<!DOCTYPE data [<!ENTITY ext SYSTEM "https://attacker.example/private">]><w:document xmlns:w="urn:word"><w:p><w:t>&ext;</w:t></w:p></w:document>';
  await assert.rejects(() => readDocument(new File([zipSync({'word/document.xml': strToU8(xml)})], 'source.docx')), /안전하게/);
  const corrupt = zipSync({'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:p><w:t>본문</w:t></w:p></w:document>')});
  for (let i = 0; i < corrupt.length - 46; i++) if (new DataView(corrupt.buffer).getUint32(i, true) === 0x02014b50) {new DataView(corrupt.buffer).setUint32(i + 16, 1, true); break;}
  await assert.rejects(() => readDocument(new File([corrupt], 'source.docx')), /손상된 문서/);
});

test('PDF.js reads actual PDF text without sending the original file', async () => {
  const result = await readDocument(pdfDocument());
  assert.match(result.text, /Application review then notification/); assert.equal(result.truncated, false);
});

test('an image-only PDF receives an explicit unsupported message', async () => {
  await assert.rejects(() => readDocument(pdfDocument({imageOnly: true})), /이미지형·스캔 PDF는 지원하지 않습니다/);
});

test('more than 80 PDF pages are explicitly marked partial', async () => {
  const result = await readDocument(pdfDocument({pages: 81}));
  assert.equal(result.truncated, true); assert.ok(result.warnings.some(value => value.includes('80페이지')));
});
