const origin = location.origin;
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const mcp = origin + '/mcp';
const localNotice = document.getElementById('local-notice');
if (localNotice) localNotice.hidden = !local;
const mcpUrl = document.getElementById('mcp-url');
if (mcpUrl) mcpUrl.textContent = mcp;
const codex = document.getElementById('codex-command');
const claude = document.getElementById('claude-command');
if (claude) claude.textContent = `claude mcp add --transport http hannoon ${mcp}`;
function updateMcpGuide(mode) {
  const oauth = ['oauth', 'none'].includes(mode) ? mode === 'oauth' : location.hostname.endsWith('.chatgpt.site');
  const choice = document.getElementById('mcp-auth-choice');
  if (choice) choice.textContent = oauth ? 'OAuth' : '인증 없음';
  const explanation = document.getElementById('mcp-auth-help');
  if (explanation) explanation.textContent = oauth
    ? '이 주소의 MCP는 연결 플랫폼의 OAuth 인증을 사용합니다. 기존 플랫폼 계정으로 로그인하고 권한을 승인하세요. 별도의 한눈AI 회원가입이나 AI API 키 입력은 없습니다.'
    : '이 주소의 MCP는 인증 없음으로 연결합니다. 별도의 한눈AI 로그인이나 AI API 키 입력은 없으며, AI 채팅의 연결·도구 실행 승인은 사용자가 진행합니다.';
  const chatStep = document.getElementById('mcp-approval-help');
  if (chatStep) chatStep.textContent = oauth
    ? '열린 플랫폼 인증 화면에서 기존 계정으로 로그인하고 연결 권한을 승인하세요. 도구 검색과 앱 추가를 마친 뒤 새 채팅의 앱 메뉴 또는 @한눈AI로 선택하세요.'
    : '도구 검색과 앱 추가를 마친 뒤 새 채팅의 앱 메뉴 또는 @한눈AI로 선택하세요. 화면에 도구 실행 승인이 나타나면 내용을 확인하고 승인하세요.';
  if (codex) codex.textContent = `codex mcp add hannoon --url ${mcp}` + (oauth ? '\ncodex mcp login hannoon' : '');
  const codexHelp = document.getElementById('codex-auth-help');
  if (codexHelp) codexHelp.textContent = oauth
    ? '두 번째 명령이 여는 플랫폼 로그인 창에서 기존 계정으로 인증하고 권한을 승인하세요. 한눈AI API 키는 입력하지 않습니다.'
    : '이 주소는 별도의 로그인 명령 없이 연결합니다.';
  const claudeHelp = document.getElementById('claude-auth-help');
  if (claudeHelp) claudeHelp.textContent = oauth
    ? 'Claude Code 채팅에서 /mcp를 입력하고 한눈AI의 인증 항목을 선택하세요. 열린 브라우저에서 기존 플랫폼 계정으로 로그인하고 연결 권한을 승인하세요.'
    : 'Claude Code 채팅에서 /mcp를 입력해 한눈AI 연결 상태를 확인하고 필요한 도구 실행 승인을 완료하세요.';
}
updateMcpGuide();
const copy = document.getElementById('copy-mcp');
if (copy) {
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    const status = document.getElementById('mcp-copy-status');
    try {await navigator.clipboard.writeText(mcp); status.textContent = 'MCP 주소를 복사했어요.';}
    catch {status.textContent = '위 주소를 선택해 직접 복사해 주세요.';}
  });
}
fetch('/api/config', {credentials: 'same-origin', redirect: 'error'})
  .then(response => response.ok ? response.json() : null)
  .then(config => {
    if (config?.mcp?.auth_mode) updateMcpGuide(config.mcp.auth_mode);
    const values = {chars: config?.limits?.max_input_chars, ttl: config?.limits?.job_ttl_hours, daily: config?.limits?.daily_jobs};
    for (const [key, value] of Object.entries(values)) {
      if (Number.isInteger(value) && value > 0) document.querySelectorAll(`[data-limit="${key}"]`).forEach(element => {element.textContent = value.toLocaleString('ko-KR');});
    }
  })
  .catch(() => {});
