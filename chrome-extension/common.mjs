export const MAX_TEXT = 12000;
export const MAX_FILE = 10 * 1024 * 1024;
export const FILE_TYPES = new Set(['txt', 'docx', 'html', 'htm', 'hwpx', 'pdf']);

export function serviceOrigin(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('서비스 주소가 올바르지 않습니다. 서비스에서 확장 프로그램을 다시 내려받아 주세요.');
  }
  return url.origin;
}

export function sameOriginImage(value, origin) {
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.hash || !url.pathname.startsWith('/api/jobs/')) throw new Error('이미지 주소를 확인할 수 없습니다.');
  return url.href;
}

export function hostPermissionPattern(value) {
  const url = new URL(serviceOrigin(value));
  return `${url.protocol}//${url.hostname}/*`;
}

export function importedText(value) {
  const warnings = Array.isArray(value?.warnings) ? value.warnings.filter(item => typeof item === 'string').map(item => item.slice(0, 500)).slice(0, 5) : [];
  if (value?.truncated || warnings.some(item => /PDF 앞|추출 범위를 앞/.test(item))) throw new Error('자료의 앞부분만 읽을 수 있었습니다. 필요한 부분을 12,000자 이내의 텍스트로 입력하거나 파일을 나누어 주세요.');
  return {text: validText(value?.text), warnings};
}

export function validFile(file) {
  if (!file || !FILE_TYPES.has(file.name.split('.').pop().toLowerCase())) throw new Error('txt, docx, html, hwpx, pdf 파일을 선택해 주세요.');
  if (file.size < 1) throw new Error('비어 있는 파일입니다. 다른 파일을 선택해 주세요.');
  if (file.size > MAX_FILE) throw new Error('파일은 10MB 이하로 선택해 주세요.');
  return file;
}

export function validText(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('정리할 내용을 입력해 주세요.');
  if ([...text].length > MAX_TEXT) throw new Error('한 번에 12,000자까지 정리할 수 있습니다. 내용을 나누어 입력해 주세요.');
  return text;
}

export function friendlyHttp(status) {
  if (status === 401 || status === 403) return '연결 시간이 지났습니다. 확장 프로그램을 다시 열어 주세요.';
  if (status === 413) return '파일이 너무 큽니다. 10MB 이하의 파일을 선택해 주세요.';
  if (status === 422 || status === 400) return '입력 내용을 읽지 못했습니다. 파일 형식과 본문을 확인해 주세요. 이미지형 PDF는 지원하지 않습니다.';
  if (status === 429) return '현재 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 404) return '결과를 찾을 수 없거나 보관 기간이 지났습니다. 다시 생성해 주세요.';
  return '서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
