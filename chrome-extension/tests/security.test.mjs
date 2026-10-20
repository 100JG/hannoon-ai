import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceOrigin, hostPermissionPattern, sameOriginImage, validFile, validText, importedText, MAX_FILE} from '../common.mjs';
test('service connection allows HTTPS and loopback development only', () => {
  assert.equal(serviceOrigin('https://service.example/'), 'https://service.example');
  assert.equal(serviceOrigin('http://127.0.0.1:8780'), 'http://127.0.0.1:8780');
  for (const value of ['http://service.example', 'https://user:password@service.example', 'https://service.example/path', 'https://service.example/?key=private', 'javascript:alert(1)']) assert.throws(() => serviceOrigin(value));
});
test('host permission patterns omit ports and stay on the configured hostname', () => {
  assert.equal(hostPermissionPattern('http://127.0.0.1:8780'), 'http://127.0.0.1/*');
  assert.equal(hostPermissionPattern('https://service.example:8443'), 'https://service.example/*');
});
test('partial input cannot proceed automatically and extraction warnings remain visible', () => {
  assert.throws(() => importedText({text: '앞부분', truncated: true}));
  assert.throws(() => importedText({text: '앞부분', warnings: ['PDF 앞 80페이지만 읽었습니다.']}));
  assert.deepEqual(importedText({text: '전체 본문', warnings: ['표의 배치는 원본과 확인하세요.']}).warnings, ['표의 배치는 원본과 확인하세요.']);
});
test('result image must stay on the service jobs path', () => {
  assert.equal(sameOriginImage('/api/jobs/id/image.svg', 'https://service.example'), 'https://service.example/api/jobs/id/image.svg');
  for (const value of ['https://attacker.example/api/jobs/id/image.svg', '//attacker.example/api/jobs/id/image.svg', 'data:image/svg+xml,test', '/private', '/api/jobs/../../private']) assert.throws(() => sameOriginImage(value, 'https://service.example'));
});
test('unsupported, empty or oversized files are rejected before sending', () => {
  assert.equal(validFile({name: 'report.PDF', size: MAX_FILE}).name, 'report.PDF');
  assert.throws(() => validFile({name: 'report.pdf', size: MAX_FILE + 1}));
  assert.throws(() => validFile({name: 'report.exe', size: 100}));
  assert.throws(() => validFile({name: 'report.txt', size: 0}));
  assert.equal(validText('  내용  '), '내용'); assert.throws(() => validText(' ')); assert.throws(() => validText('가'.repeat(12001)));
});
