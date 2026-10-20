const SVG_NS = 'http://www.w3.org/2000/svg';
const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'defs', 'marker', 'path', 'rect', 'text', 'tspan', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'title', 'desc', 'style', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop']);

function externalReference(value) {
  return /url\(/i.test(value.replace(/url\(\s*(['"]?)#[A-Za-z0-9_-]+\1\s*\)/gi, ''));
}

export function cleanSvg(raw) {
  if (typeof raw !== 'string' || raw.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('이미지를 표시하지 못했습니다. 다시 생성해 주세요.');
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS || doc.getElementsByTagName('parsererror').length) throw new Error('이미지를 표시하지 못했습니다.');
  for (const element of doc.getElementsByTagName('*')) {
    if (element.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS.has(element.localName.toLowerCase())) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
    if (element.localName === 'style' && (/@import/i.test(element.textContent) || externalReference(element.textContent))) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /(?:href|src)$/i.test(attribute.name) && !attribute.value.startsWith('#') || externalReference(attribute.value)) throw new Error('이미지를 안전하게 표시하지 못했습니다.');
    }
  }
  const box = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute('width')) || box[2];
  const height = Number.parseFloat(root.getAttribute('height')) || box[3];
  if (![width, height].every(value => Number.isFinite(value) && value > 0) || width > 8192 || height > 16384 || width * height > 32000000) throw new Error('이미지 크기를 확인하지 못했습니다.');
  return new XMLSerializer().serializeToString(root);
}

export function displayPayload(result = {}) {
  const structured = result.structuredContent || result;
  const data = structured.result || structured;
  const metadata = result._meta || {};
  const svg = metadata.svg || data.svg;
  if (result.isError || structured.state === 'failed') throw new Error('결과를 불러오지 못했습니다. 다시 생성해 주세요.');
  if (!svg) return {pending: true};
  const sentence = data.one_sentence || metadata.one_sentence;
  if (typeof sentence !== 'string' || !sentence.trim() || [...sentence].length > 60) throw new Error('요약을 표시하지 못했습니다. 다시 생성해 주세요.');
  return {sentence, svg: cleanSvg(svg), review: ['REVIEW_REQUIRED', 'FAIL'].includes(data.status || metadata.status)};
}
