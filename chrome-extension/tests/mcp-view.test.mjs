import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';
import {displayPayload, cleanSvg} from '../../mcp-view/result.mjs';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><marker id="arrow"><path d="M0 0L5 5"/></marker></defs><text x="10" y="20">한눈에 정리</text><path d="M1 1L5 5" marker-end="url(#arrow)"/></svg>';

test('MCP view accepts standard structured data and private SVG metadata', () => {
  const result = displayPayload({structuredContent: {state: 'completed', one_sentence: '신청을 검토하고 결과를 안내합니다.', status: 'REVIEW_REQUIRED'}, _meta: {svg}});
  assert.equal(result.sentence, '신청을 검토하고 결과를 안내합니다.'); assert.equal(result.review, true); assert.match(result.svg, /한눈에 정리/);
  assert.equal(displayPayload({structuredContent: {state: 'running'}}).pending, true);
});

test('MCP view rejects active SVG and external resource references', () => {
  for (const bad of [svg.replace('<text ', '<script>alert(1)</script><text '), svg.replace('width="800"', 'onload="alert(1)" width="800"'), svg.replace('url(#arrow)', 'url(https://attacker.example/x)'), svg.replace('<text ', '<image href="https://attacker.example/x"/><text '), svg.replace('<text ', '<style>@import "https://attacker.example/x";</style><text ')]) assert.throws(() => cleanSvg(bad));
});

test('MCP view limits summary length and image size', () => {
  assert.throws(() => displayPayload({structuredContent: {one_sentence: '가'.repeat(61)}, _meta: {svg}}));
  assert.throws(() => cleanSvg(svg.replace('width="800"', 'width="99999"')));
  assert.throws(() => cleanSvg('<!DOCTYPE svg><svg/>'));
});
