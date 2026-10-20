import {App, applyDocumentTheme, applyHostStyleVariables} from '@modelcontextprotocol/ext-apps';
import {displayPayload} from './result.mjs';

const sentence = document.getElementById('sentence');
const picture = document.getElementById('diagram');
const review = document.getElementById('review');
const state = document.getElementById('state');
const results = document.getElementById('results');
let objectUrl;
let hasResult = false;

function clearImage() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  picture.removeAttribute('src');
}

function show(result) {
  try {
    const value = displayPayload(result);
    if (value.pending) {
      if (!hasResult) {state.textContent = '핵심을 정리하고 원문과 확인하고 있어요.'; state.hidden = false; results.hidden = true;}
      return;
    }
    clearImage();
    sentence.textContent = value.sentence;
    objectUrl = URL.createObjectURL(new Blob([value.svg], {type: 'image/svg+xml'}));
    picture.src = objectUrl;
    review.hidden = !value.review;
    state.hidden = true;
    results.hidden = false;
    hasResult = true;
  } catch (error) {
    clearImage(); hasResult = false;
    results.hidden = true;
    state.textContent = error.message || '결과를 불러오지 못했습니다.';
    state.hidden = false;
  }
}

function theme(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

const app = new App({name: 'Han-Noon AI', version: '2.0.0'}, {}, {autoResize: true});
app.ontoolresult = show;
app.onhostcontextchanged = theme;
app.connect().then(() => theme(app.getHostContext())).catch(() => {
  if (!hasResult) {state.textContent = '채팅에서 한눈AI 결과를 다시 열어 주세요.'; state.hidden = false;}
});

function fromGlobals(globals = window.openai) {
  if (!globals?.toolOutput) return;
  const metadata = globals.toolResponseMetadata || {};
  show({...globals.toolOutput, _meta: metadata._meta || metadata});
}
window.addEventListener('openai:set_globals', event => fromGlobals(event.detail?.globals));
window.addEventListener('pagehide', clearImage);
fromGlobals();
