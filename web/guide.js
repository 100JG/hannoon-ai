const origin = location.origin;
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const mcp = origin + '/mcp';
const localNotice = document.getElementById('local-notice');
if (localNotice) localNotice.hidden = !local;
const mcpUrl = document.getElementById('mcp-url');
if (mcpUrl) mcpUrl.textContent = mcp;
const codex = document.getElementById('codex-command');
if (codex) codex.textContent = `codex mcp add hannoon --url ${mcp}`;
const claude = document.getElementById('claude-command');
if (claude) claude.textContent = `claude mcp add --transport http hannoon ${mcp}`;
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
    const values = {chars: config?.limits?.max_input_chars, ttl: config?.limits?.job_ttl_hours, daily: config?.limits?.daily_jobs};
    for (const [key, value] of Object.entries(values)) {
      if (Number.isInteger(value) && value > 0) document.querySelectorAll(`[data-limit="${key}"]`).forEach(element => {element.textContent = value.toLocaleString('ko-KR');});
    }
  })
  .catch(() => {});
