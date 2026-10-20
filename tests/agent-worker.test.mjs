import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';

const IR={diagram_type:'flowchart',selection_reason:'원문의 명시된 업무',document_kind:'process_flow',title:'자료 검토',one_sentence:'자료를 검토합니다.',nodes:[{id:'n1',label:'자료 검토',kind:'process',evidence_ids:['s1'],uncertain:false,detail:'',group:'',order_label:''}],edges:[],ambiguities:[],assumptions:[]};
const bundled=await build({stdin:{contents:`import {advance,initialState} from './server/agent.mjs';
  export default {async fetch(){return Response.json(await advance(initialState('자료를 검토한다.'),{LLM_API_KEY:'AIza'+'FAKE_TEST_KEY_WITH_NO_REAL_CREDENTIAL'}));}};`,
  resolveDir:fileURLToPath(new URL('../',import.meta.url)),sourcefile:'agent-worker-test.mjs'},bundle:true,format:'esm',platform:'neutral',target:'es2024',write:false});
async function runtime(t,outboundService){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-20',outboundService}));
  t.after(()=>mf.dispose());return mf;
}

test('actual workerd native fetch executes inference with the supported manual redirect mode',async t=>{
  let calls=0;
  const mf=await runtime(t,async request=>{
    calls++;assert.match(request.url,/generativelanguage\.googleapis\.com/);
    assert.equal(request.headers.get('x-goog-api-key'),'AIza'+'FAKE_TEST_KEY_WITH_NO_REAL_CREDENTIAL');
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(IR)}]}}]});
  });
  const response=await mf.dispatchFetch('https://hannoon.test/');
  assert.equal(response.status,200);const state=await response.json();
  assert.equal(state.stage,'verify');assert.equal(state.api_calls,1);assert.equal(calls,1);
});

test('actual workerd inference never follows a provider redirect carrying its credential header',async t=>{
  const visited=[];
  const mf=await runtime(t,async request=>{
    visited.push(new URL(request.url).hostname);
    return new Response(null,{status:302,headers:{Location:'https://untrusted-redirect.invalid/steal'}});
  });
  const state=await (await mf.dispatchFetch('https://hannoon.test/')).json();
  assert.equal(state.stage,'final');assert.equal(state.result.status,'FAIL');assert.equal(state.api_calls,1);
  assert.deepEqual(visited,['generativelanguage.googleapis.com']);
  assert.ok(!JSON.stringify(state).includes('FAKE_TEST_KEY'));
});
