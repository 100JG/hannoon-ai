/* Han-Noon AI web client. Anonymous sessions protect same-origin requests. */
"use strict";
  const countCharacters = value => Array.from(String(value)).length;
  const isWebUrl = value => {
    try {
      if (/\s/.test(value)) return false;
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  };
  const safeImageUrl = (value, origin) => {
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value, origin);
      return url.origin === origin && /^\/api\/jobs\/[A-Za-z0-9_-]+\/image\.(?:svg|png)$/.test(url.pathname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const formatBytes = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const jobState = job => String(job?.state || job?.status || "").toUpperCase();
  async function settleWithin(promise, milliseconds) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Operation timed out")), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }
  function rasterSize(width, height, maxWidth = 1800, maxHeight = 2400) {
    if (![width, height, maxWidth, maxHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid image dimensions");
    const scale = Math.min(2, maxWidth / width, maxHeight / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }
  async function svgToPng(svgBlob) {
    if (!svgBlob.type.startsWith("image/svg+xml")) throw new Error("Unsupported image format");
    const objectUrl = URL.createObjectURL(svgBlob);
    try {
      await document.fonts?.ready;
      const image = new Image();
      image.decoding = "async";
      await settleWithin(new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Image conversion failed"));
        image.src = objectUrl;
      }), 8000);
      const size = rasterSize(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image conversion unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(image, 0, 0, size.width, size.height);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image conversion failed")), "image/png"));
    } finally { URL.revokeObjectURL(objectUrl); }
  }
(() => {
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries(["source", "source-file", "source-kind", "counter", "clear-button", "choose-file", "selected-file", "file-name", "file-status", "remove-file", "input-warning", "generate", "generate-label", "progress", "progress-text", "notice", "session-hint", "empty", "outputs", "one-sentence", "diagram", "regenerate", "verification-note", "result-footer", "copy-image", "download-image", "result-message"].map(id => [id, $(id)]));
  const state = { connected: false, csrf: "", config: null, maxChars: 12000, maxBytes: 10 * 1024 * 1024, busy: false, revision: 0, controller: null, file: null, result: null, pngBlob: null, retryTimer: null };
  const stageLabels = { validate_input: "입력 내용을 확인하고 있습니다.", extract: "핵심 정보와 관계를 정리하고 있습니다.", validate_structure: "정보의 관계를 확인하고 있습니다.", generate: "내용에 맞는 다이어그램을 만들고 있습니다.", render: "다이어그램 이미지로 정리하고 있습니다.", verify: "원문과 결과가 잘 맞는지 확인하고 있습니다.", repair: "더 정확한 결과로 다듬고 있습니다.", finalize: "결과를 마무리하고 있습니다.", queued: "앞선 요청이 끝나면 바로 시작합니다.", running: "내용을 읽고 다이어그램을 정리하고 있습니다." };

  class ApiError extends Error {
    constructor(message, status = 0, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter; }
  }
  function setMessage(element, message, tone) {
    element.textContent = message || "";
    element.hidden = !message;
    if (tone) element.dataset.tone = tone;
  }
  function notify(message, tone = "error") {
    clearInterval(state.retryTimer);
    state.retryTimer = null;
    setMessage(ui.notice, message, tone);
  }
  function showError(error, target = ui.notice) {
    if (error?.name === "AbortError") return;
    let message = error instanceof ApiError ? error.message : "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";
    if (error?.status === 401 || error?.status === 403) {
      state.csrf = ""; state.connected = false; updateSession();
      message = "연결 정보가 만료되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
    }
    setMessage(target, message, "error");
    if (error?.status === 429 && target === ui.notice && error.retryAfter > 0) {
      clearInterval(state.retryTimer);
      const until = Date.now() + Math.min(error.retryAfter, 3600) * 1000;
      const show = () => {
        const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        setMessage(target, remaining ? `${message} 약 ${remaining}초 후 다시 시도해 주세요.` : "이제 다시 시도할 수 있습니다.", "info");
        if (!remaining) { clearInterval(state.retryTimer); state.retryTimer = null; }
      };
      show(); state.retryTimer = setInterval(show, 1000);
    }
  }
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const method = options.method || "GET";
    if (method !== "GET" && state.csrf) headers.set("X-CSRF-Token", state.csrf);
    let response;
    try { response = await fetch(path, { ...options, method, headers, credentials: "same-origin", cache: "no-store" }); }
    catch (error) { if (error.name === "AbortError") throw error; throw new ApiError("서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요."); }
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError("서비스 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", response.status); }
    if (!response.ok) {
      const raw = typeof data.detail === "string" ? data.detail : typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "";
      const fallback = { 401: "페이지를 새로고침한 뒤 다시 시도해 주세요.", 403: "연결 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요.", 413: "파일이 너무 큽니다. 10 MB 이하 파일을 선택해 주세요.", 422: "입력 내용을 확인해 주세요.", 429: "사용 요청이 많습니다.", 503: "서비스가 준비 중입니다. 잠시 후 다시 시도해 주세요." };
      // The service returns curated public messages. Limit their size defensively.
      throw new ApiError(raw.slice(0, 300) || fallback[response.status] || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", response.status, Number(response.headers.get("Retry-After")) || 0);
    }
    return data;
  }
  const post = (path, body, options = {}) => api(path, { ...options, method: "POST", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify(body) });
  function hasInput() { return Boolean(ui.source.value.trim()); }
  function updateInput() {
    const chars = countCharacters(ui.source.value);
    ui.counter.textContent = `${chars.toLocaleString("ko-KR")} / ${state.maxChars.toLocaleString("ko-KR")}`;
    ui.source.parentElement.classList.toggle("over-limit", chars > state.maxChars);
    ui.source.setAttribute("aria-invalid", String(chars > state.maxChars));
    ui["source-kind"].textContent = state.file ? "파일에서 읽은 내용" : isWebUrl(ui.source.value.trim()) ? "웹페이지 URL" : "텍스트 · URL";
    ui["clear-button"].disabled = !hasInput() && !state.file && !state.busy;
    ui.generate.disabled = !state.connected || state.busy || !hasInput() || chars > state.maxChars;
    ui["choose-file"].disabled = state.busy || !state.connected;
    ui["source-file"].disabled = state.busy || !state.connected;
    ui["remove-file"].disabled = state.busy;
    ui.source.disabled = state.busy;
    ui.regenerate.disabled = state.busy || !hasInput() || chars > state.maxChars;
    ui["copy-image"].disabled = state.busy || !state.result;
    ui["download-image"].disabled = state.busy || !state.result;
    if (chars > state.maxChars) setMessage(ui["input-warning"], `내용이 ${state.maxChars.toLocaleString("ko-KR")}자를 넘었습니다. 분석할 부분을 줄여주세요. 입력 내용은 임의로 잘리지 않습니다.`);
    else if (ui["input-warning"].dataset.lengthWarning === "true") setMessage(ui["input-warning"], "");
    ui["input-warning"].dataset.lengthWarning = String(chars > state.maxChars);
  }
  function updateSession() {
    ui["session-hint"].textContent = !state.connected ? "현재 서비스에 연결할 수 없습니다. 페이지를 새로고침해 주세요." : "내용에 맞는 다이어그램을 자동으로 선택합니다.";
    updateInput();
  }
  function setBusy(busy, message = "") {
    state.busy = busy;
    ui.progress.hidden = !busy;
    ui["progress-text"].textContent = message;
    ui["generate-label"].textContent = busy ? "내용을 정리하고 있습니다" : "다이어그램 만들기";
    document.querySelector(".result-panel").setAttribute("aria-busy", String(busy));
    updateInput();
  }
  function invalidate() {
    state.revision += 1;
    state.controller?.abort();
    state.controller = null;
    setBusy(false);
  }
  function resetResult() {
    state.result = null; state.pngBlob = null;
    ui.outputs.hidden = true;
    ui.empty.hidden = false;
    ui["result-footer"].hidden = true;
    ui.regenerate.hidden = true;
    ui.diagram.removeAttribute("src");
    ui["one-sentence"].textContent = "";
    setMessage(ui["result-message"], "");
  }
  function clearInput() {
    invalidate();
    ui.source.value = ""; ui["source-file"].value = "";
    state.file = null;
    ui["selected-file"].hidden = true;
    setMessage(ui["input-warning"], "");
    notify(""); resetResult(); updateInput(); ui.source.focus();
  }
  async function loadSession() {
    const session = await api("/api/session");
    state.csrf = session.csrf_token || "";
    if (!state.csrf) throw new ApiError("연결 정보를 준비하지 못했습니다. 페이지를 새로고침해 주세요.");
    updateSession();
  }
  async function readFile(file) {
    if (!file) { ui["source-file"].value = ""; return; }
    if (!/\.(txt|docx|html?|hwpx|pdf)$/i.test(file.name)) { notify("txt, docx, html, hwpx, pdf 파일을 선택해 주세요."); ui["source-file"].value = ""; return; }
    if (file.size > state.maxBytes) { notify(`파일은 ${Math.round(state.maxBytes / 1024 / 1024)} MB까지 업로드할 수 있습니다.`); ui["source-file"].value = ""; return; }
    if (!file.size) { notify("비어 있는 파일입니다. 다른 파일을 선택해 주세요."); ui["source-file"].value = ""; return; }
    invalidate(); const revision = state.revision; const controller = new AbortController(); state.controller = controller;
    state.file = file;
    ui["file-name"].textContent = file.name;
    ui["file-status"].textContent = `${formatBytes(file.size)} · 내용을 읽고 있습니다`;
    ui["selected-file"].hidden = false;
    notify(""); setMessage(ui["input-warning"], "");
    setBusy(true, "브라우저에서 파일 내용을 읽고 있습니다.");
    try {
      const { readDocument } = await import("/assets/file-input.js");
      const data = await readDocument(file, { maxChars: state.maxChars, maxBytes: state.maxBytes });
      if (revision !== state.revision) return;
      if (typeof data.text !== "string" || !data.text.trim()) throw new ApiError("파일에서 텍스트를 찾지 못했습니다. 이미지형 PDF는 지원하지 않습니다.");
      ui.source.value = data.text;
      ui["file-status"].textContent = `${formatBytes(file.size)} · 파일 준비 완료 · ${countCharacters(data.text).toLocaleString("ko-KR")}자`;
      if (Array.isArray(data.warnings) && data.warnings.length) setMessage(ui["input-warning"], data.warnings.filter(x => typeof x === "string").join(" ").slice(0, 500));
      resetResult();
    } catch (error) {
      if (revision !== state.revision) return;
      ui["file-status"].textContent = `${formatBytes(file.size)} · 내용을 읽지 못했습니다`;
      ui.source.value = "";
      showError(error instanceof ApiError ? error : new ApiError(typeof error?.message === "string" ? error.message.slice(0, 240) : "파일 내용을 읽지 못했습니다. 다른 파일을 선택해 주세요."));
    } finally { if (revision === state.revision) { state.controller = null; setBusy(false); } }
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  function showResult(result) {
    const imageUrl = safeImageUrl(result?.image_url, location.origin);
    const summary = result?.one_sentence;
    if (!imageUrl || typeof summary !== "string" || !summary.trim() || countCharacters(summary) > 60 || result.status === "FAIL") throw new ApiError("충분히 정확한 결과를 만들지 못했습니다. 내용을 나누거나 구체적으로 입력해 다시 시도해 주세요.");
    state.result = { ...result, image_url: imageUrl }; state.pngBlob = null;
    ui["one-sentence"].textContent = summary;
    ui.diagram.src = imageUrl;
    ui.outputs.hidden = false; ui.empty.hidden = true; ui.regenerate.hidden = false; ui["result-footer"].hidden = false;
    ui["verification-note"].hidden = result.status === "PASS";
  }
  async function generate() {
    if (state.busy || !hasInput() || !state.connected) return;
    if (countCharacters(ui.source.value) > state.maxChars) { updateInput(); return; }
    invalidate(); const revision = state.revision; const controller = new AbortController(); state.controller = controller;
    notify(""); setMessage(ui["result-message"], ""); resetResult();
    setBusy(true, "입력 내용을 확인하고 있습니다.");
    try {
      let text = ui.source.value.trim();
      if (isWebUrl(text)) {
        ui["progress-text"].textContent = "웹페이지에서 내용을 읽고 있습니다.";
        const input = await post("/api/inputs/url", { url: text }, { signal: controller.signal });
        if (revision !== state.revision) return;
        if (typeof input.text !== "string" || !input.text.trim()) throw new ApiError("웹페이지에서 내용을 읽지 못했습니다. 필요한 텍스트를 직접 붙여넣어 주세요.");
        text = input.text;
        ui.source.value = text;
        if (Array.isArray(input.warnings) && input.warnings.length) setMessage(ui["input-warning"], input.warnings.filter(x => typeof x === "string").join(" ").slice(0, 500));
        if (input.truncated) throw new ApiError("웹페이지가 길어 앞부분만 가져왔습니다. 입력창에서 가져온 범위를 확인한 뒤 다이어그램 만들기를 눌러주세요.");
        if (countCharacters(text) > state.maxChars) throw new ApiError(`웹페이지 내용이 ${state.maxChars.toLocaleString("ko-KR")}자를 넘었습니다. 입력창에서 분석할 부분을 골라 줄여주세요.`);
      }
      const created = await post("/api/jobs", { source_text: text, request_id: crypto.randomUUID() }, { signal: controller.signal });
      if (revision !== state.revision) return;
      if (!created.job_id || !/^[A-Za-z0-9_-]+$/.test(created.job_id)) throw new ApiError("요청을 확인하지 못했습니다. 다시 시도해 주세요.");
      const deadline = Date.now() + 8 * 60 * 1000;
      while (revision === state.revision && Date.now() < deadline) {
        const job = await api(`/api/jobs/${encodeURIComponent(created.job_id)}`, { signal: controller.signal });
        if (revision !== state.revision) return;
        const status = jobState(job);
        if (status === "COMPLETED") { showResult(job.result); return; }
        if (status === "FAILED") throw new ApiError(typeof job.error === "string" ? job.error.slice(0, 300) : "결과를 만들지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.");
        const event = Array.isArray(job.events) ? job.events.at(-1) : null;
        const stage = typeof event === "string" ? event : event?.stage || event?.node || event?.name;
        ui["progress-text"].textContent = stageLabels[stage] || stageLabels[status.toLowerCase()] || stageLabels.running;
        await wait(status === "QUEUED" ? 1800 : 1200, controller.signal);
      }
      throw new ApiError("처리가 예상보다 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.");
    } catch (error) { if (revision === state.revision) showError(error); }
    finally { if (revision === state.revision) { state.controller = null; setBusy(false); } }
  }
  async function getPng() {
    if (state.pngBlob) return state.pngBlob;
    if (!state.result) throw new ApiError("먼저 다이어그램을 만들어 주세요.");
    const revision = state.revision;
    const response = await settleWithin(fetch(state.result.image_url, { credentials: "same-origin", cache: "no-store" }), 12000);
    if (!response.ok) throw new ApiError(response.status === 401 ? "페이지를 새로고침한 뒤 다시 시도해 주세요." : "이미지를 불러오지 못했습니다. 다시 시도해 주세요.", response.status);
    const imageBlob = await response.blob();
    const blob = imageBlob.type === "image/png" ? imageBlob : await svgToPng(imageBlob);
    if (revision !== state.revision) throw new DOMException("Aborted", "AbortError");
    if (blob.type !== "image/png") throw new ApiError("이미지를 준비하지 못했습니다. 다시 생성해 주세요.");
    state.pngBlob = blob; return blob;
  }
  async function copyImage() {
    if (!state.result || state.busy) return;
    setMessage(ui["result-message"], "");
    if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined" || (ClipboardItem.supports && !ClipboardItem.supports("image/png"))) {
      setMessage(ui["result-message"], "이 브라우저에서는 이미지 복사를 지원하지 않습니다. PNG 다운로드를 이용해 주세요."); return;
    }
    ui["copy-image"].disabled = true;
    try {
      // Start clipboard.write inside the click, before waiting for image conversion.
      await settleWithin(navigator.clipboard.write([new ClipboardItem({ "image/png": getPng() })]), 10000);
      setMessage(ui["result-message"], "이미지를 복사했습니다. 원하는 곳에 붙여넣으세요.");
    } catch (error) { if (error.name !== "AbortError") setMessage(ui["result-message"], "이미지를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하거나 PNG 다운로드를 이용해 주세요."); }
    finally { updateInput(); }
  }
  async function downloadImage() {
    if (!state.result || state.busy) return;
    ui["download-image"].disabled = true;
    try {
      const blob = await getPng(); const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = "hannoon-diagram.png"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage(ui["result-message"], "PNG 이미지를 다운로드했습니다.");
    } catch (error) { if (error.name !== "AbortError") setMessage(ui["result-message"], error instanceof ApiError ? error.message : "다운로드하지 못했습니다. 다시 시도해 주세요."); }
    finally { updateInput(); }
  }

  ui.source.addEventListener("input", () => { setMessage(ui["input-warning"], ""); updateInput(); });
  ui["clear-button"].addEventListener("click", clearInput);
  ui["remove-file"].addEventListener("click", clearInput);
  ui["choose-file"].addEventListener("click", () => ui["source-file"].click());
  ui["source-file"].addEventListener("change", () => readFile(ui["source-file"].files[0]));
  ui.generate.addEventListener("click", generate); ui.regenerate.addEventListener("click", generate);
  ui["copy-image"].addEventListener("click", copyImage); ui["download-image"].addEventListener("click", downloadImage);
  ui.diagram.addEventListener("error", () => setMessage(ui["result-message"], "이미지를 불러오지 못했습니다. 페이지를 새로고침하고 다시 생성해 주세요."));
  (async () => {
    try {
      state.config = await api("/api/config");
      state.maxChars = Math.min(12000, Number(state.config.limits?.max_input_chars) || 12000);
      state.maxBytes = Math.min(10 * 1024 * 1024, Number(state.config.limits?.max_file_bytes) || 10 * 1024 * 1024);
      await loadSession();
      state.connected = true; updateSession();
    } catch (error) { state.connected = false; updateSession(); showError(error); }
  })();
})();

export { countCharacters, isWebUrl, safeImageUrl, formatBytes, jobState, settleWithin, rasterSize };
