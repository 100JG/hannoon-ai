import test from 'node:test';
import assert from 'node:assert/strict';
import {advance,initialState,sourceUnits,validateIR,validateAudit} from '../server/agent.mjs';
import {renderDiagram,DIAGRAM_TYPES} from '../server/layout.mjs';

const SOURCE='신청서를 접수한다. 담당자가 내용을 검토한다. 검토 후 결과를 안내한다.';
const ENV={LLM_API_KEY:'AIza'+'a'.repeat(32)};
function fixture(type='flowchart') {
  const nodes=['접수','검토','안내'].map((label,i)=>({id:'n'+(i+1),label,kind:'process',evidence_ids:['s1'],uncertain:false,detail:'',group:'',order_label:''}));
  const edges=[1,2].map(i=>({id:'e'+i,source:'n'+i,target:'n'+(i+1),label:'',evidence_ids:['s1'],uncertain:false}));
  if(type==='cycle')edges.push({id:'e3',source:'n3',target:'n1',label:'반복',evidence_ids:['s1'],uncertain:false});
  if(['timeline','comparison'].includes(type))edges.length=0;
  if(type==='mindmap'){edges[1].source='n1';}
  return {diagram_type:type,selection_reason:'원문 관계에 따른 구성',document_kind:'process_flow',title:'신청 처리',one_sentence:'신청서를 접수하고 검토한 뒤 결과를 안내합니다.',nodes,edges,ambiguities:[],assumptions:[]};
}
function audit(ir,units=sourceUnits(SOURCE)) {
  return {summary:'원문과 일치합니다.',unit_checks:units.map(u=>({source_id:u.id,status:'covered',mapped_ids:ir.nodes.map(n=>n.id),rationale:'제시된 원문의 모든 동작을 표현합니다.'})),element_checks:[...ir.nodes,...ir.edges].map(e=>({target_id:e.id,supported:true,evidence_ids:['s1'],rationale:'원문에서 직접 확인할 수 있습니다.'})),sentence_check:{supported:true,evidence_ids:['s1'],rationale:'요약의 조건과 시제가 원문과 일치합니다.'},findings:[]};
}
function scripted(responses,seen=[]) {
  return async (url,options)=>{
    const request=JSON.parse(options.body);seen.push({url,options,request});
    const next=responses.shift();if(next instanceof Error)throw next;
    if(next?.httpStatus)return new Response('PRIVATE_PROVIDER_RESPONSE',{status:next.httpStatus});
    const value=typeof next==='function'?next(request):next;
    const data=url.includes('anthropic')?{content:[{type:'tool_use',name:'return_json',input:value}]}:url.includes('openai')?{choices:[{message:{content:JSON.stringify(value)}}]}:{candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]};
    return new Response(JSON.stringify(data),{status:200});
  };
}

test('one network call per advance and source-free terminal result',async()=>{
  const ir=fixture(),seen=[],fetchImpl=scripted([ir,audit(ir)],seen);
  const initial=initialState(SOURCE),extracted=await advance(initial,ENV,{fetchImpl});
  assert.equal(initial.api_calls,0);assert.equal(extracted.api_calls,1);assert.equal(extracted.stage,'verify');
  const result=await advance(extracted,ENV,{fetchImpl});
  assert.equal(result.stage,'final');assert.equal(result.api_calls,2);assert.equal(result.result.status,'PASS');
  assert.ok(result.result.svg.includes('data-node-id="n3"'));
  for(const key of ['source_text','source_units','ir','audit','issues'])assert.ok(!(key in result));
  assert.ok(!JSON.stringify(result).includes(ENV.LLM_API_KEY));
  assert.ok(seen.every(x=>!x.url.includes(ENV.LLM_API_KEY)&&!x.options.body.includes(ENV.LLM_API_KEY)));
  assert.equal(await advance(result,ENV,{fetchImpl}),result);
});

test('semantic mismatch triggers bounded repair and fresh verification',async()=>{
  const ir=fixture(),bad=audit(ir);bad.element_checks[0].supported=false;
  const fetchImpl=scripted([ir,bad,ir,audit(ir)]);let state=initialState(SOURCE);
  state=await advance(state,ENV,{fetchImpl});state=await advance(state,ENV,{fetchImpl});
  assert.equal(state.stage,'repair');
  state=await advance(state,ENV,{fetchImpl});assert.equal(state.stage,'verify');
  state=await advance(state,ENV,{fetchImpl});assert.equal(state.result.status,'PASS');assert.equal(state.api_calls,4);assert.equal(state.repair_count,1);
});

test('six calls and two repairs cap semantic work without claiming correctness',async()=>{
  const ir=fixture(),bad=audit(ir);bad.sentence_check.supported=false;
  const fetchImpl=scripted([ir,bad,ir,bad,ir,bad]);let state=initialState(SOURCE);
  for(let i=0;i<6;i++)state=await advance(state,ENV,{fetchImpl});
  assert.equal(state.stage,'final');assert.equal(state.api_calls,6);assert.equal(state.repair_count,2);assert.equal(state.result.status,'REVIEW_REQUIRED');assert.ok(state.result.svg);
});

test('schema failure is bounded, while oversized faithful input asks to split',async()=>{
  let state=initialState(SOURCE),fetchImpl=scripted([{}, {}, {}]);
  for(let i=0;i<3;i++)state=await advance(state,ENV,{fetchImpl});
  assert.equal(state.stage,'final');assert.equal(state.result.status,'FAIL');assert.equal(state.api_calls,3);
  const big=fixture();for(let i=4;i<32;i++)big.nodes.push({...big.nodes[0],id:'n'+i});
  state=await advance(initialState(SOURCE),ENV,{fetchImpl:scripted([big])});
  assert.equal(state.result.status,'FAIL');assert.match(state.error,/나누어/);assert.equal(state.result.svg,'');
});

test('provider failures never expose provider bodies, keys or internal exceptions',async()=>{
  let state=await advance(initialState(SOURCE),ENV,{fetchImpl:scripted([{httpStatus:401}])});
  assert.equal(state.result.status,'FAIL');assert.equal(state.api_calls,1);assert.ok(!JSON.stringify(state).includes('PRIVATE_PROVIDER_RESPONSE'));
  const ir=fixture(),fetchImpl=scripted([ir,new Error('PRIVATE_KEY '+ENV.LLM_API_KEY)]);
  state=await advance(initialState(SOURCE),ENV,{fetchImpl});state=await advance(state,ENV,{fetchImpl});
  assert.equal(state.result.status,'REVIEW_REQUIRED');assert.ok(!JSON.stringify(state).includes(ENV.LLM_API_KEY));
});

test('model-echoed credentials including modern Gemini AQ keys are removed before state storage and SVG rendering',async()=>{
  for(const key of [ENV.LLM_API_KEY,'AQ.'+'modern-private-test'.repeat(2)]){
    const env={LLM_API_KEY:key},ir=fixture();ir.nodes[0].detail=key;ir.one_sentence=key+'를 설명합니다.';
    const seen=[],fetchImpl=scripted([ir,request=>{const payload=JSON.parse(request.contents[0].parts[0].text);return audit(payload.ir);}],seen);
    let state=await advance(initialState(SOURCE),env,{fetchImpl});
    assert.ok(!JSON.stringify(state).includes(key));
    state=await advance(state,env,{fetchImpl});
    assert.equal(state.stage,'final');assert.ok(!JSON.stringify(state).includes(key));assert.ok(state.result.svg.includes('[보호됨]'));
  }
});

test('key-only provider selection supports Gemini, OpenAI and Anthropic adapters',async()=>{
  for(const key of ['AIza'+'a'.repeat(32),'AQ.'+'modern-private-test'.repeat(2),'sk-openai-private-test','sk-ant-private-test']){
    const ir=fixture(),seen=[];const state=await advance(initialState(SOURCE),{LLM_API_KEY:key},{fetchImpl:scripted([ir],seen)});
    assert.equal(state.stage,'verify');assert.equal(seen.length,1);
    assert.ok(!seen[0].url.includes(key));assert.ok(!seen[0].options.body.includes(key));
    if(key.startsWith('AQ.'))assert.match(seen[0].url,/generativelanguage\.googleapis\.com/);
    assert.ok(Object.values(seen[0].options.headers).some(v=>v.includes(key)));
  }
});

test('source units preserve exact UTF-16 offsets including emoji and long inputs',()=>{
  const text='  '+('원문 😀 문장. '.repeat(600))+'  ';
  for(const u of sourceUnits(text))assert.equal(text.slice(u.offset_start,u.offset_end),u.text);
  assert.ok(sourceUnits(text).length<40);
  assert.throws(()=>initialState(' '),/입력/);assert.throws(()=>initialState('a'.repeat(12001)),/12,000/);
});

test('evidence, duplicate IDs, type topology and full audit coverage are mandatory',()=>{
  const units=sourceUnits(SOURCE);const ir=fixture();assert.deepEqual(validateIR(ir,units),[]);
  const missing=structuredClone(ir);missing.nodes[0].evidence_ids=['unknown'];assert.ok(validateIR(missing,units).some(e=>e.code==='EVIDENCE'));
  const duplicate=structuredClone(ir);duplicate.edges[0].id='n1';assert.ok(validateIR(duplicate,units).some(e=>e.code==='ID'));
  for(const type of ['timeline','comparison']){const bad=fixture();bad.diagram_type=type;assert.ok(validateIR(bad,units).some(e=>e.code==='TYPE_RELATION'));}
  const cycle=fixture('cycle');cycle.edges.pop();assert.ok(validateIR(cycle,units).some(e=>e.code==='CYCLE'));
  const tree=fixture('hierarchy');tree.edges.push({id:'loop',source:'n3',target:'n1',label:'',evidence_ids:['s1'],uncertain:false});assert.ok(validateIR(tree,units).some(e=>e.code==='TREE'));
  const review=audit(ir);review.element_checks.pop();assert.ok(validateAudit(review,ir,units).some(e=>e.code==='AUDIT_COVERAGE'));
  const summary=fixture();summary.one_sentence='a'.repeat(61);assert.ok(validateIR(summary,units).some(e=>e.code==='SUMMARY'));
});

test('all eight SVG layouts preserve node/edge IDs and safely escape hostile labels',()=>{
  for(const type of DIAGRAM_TYPES){const ir=fixture(type);ir.nodes[0].label='<script>bad()</script>';ir.nodes[0].detail='A & B "안내"';
    const svg=renderDiagram(ir);assert.ok(svg.includes('#2E49D3'));assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;'));
    assert.equal((svg.match(/data-node-id=/g)||[]).length,ir.nodes.length);assert.equal((svg.match(/data-edge-id=/g)||[]).length,ir.edges.length);
    assert.ok(!svg.includes('undefined')&&!svg.includes('NaN')&&!svg.includes('Infinity'));
  }
});

test('layout keeps all cards within bounds and nonoverlapping under dense content',()=>{
  for(const type of DIAGRAM_TYPES){const ir=fixture(type);
    for(const n of ir.nodes){n.detail='상세 사실을 모두 보존합니다. '.repeat(20);n.order_label='2026년 10월 20일 이후에 진행할 예정입니다.';}
    ir.title='긴 제목도 잘리지 않고 모두 표시되어야 합니다. '.repeat(2);
    const svg=renderDiagram(ir),w=+svg.match(/<svg[^>]+width="([\d.]+)"/)[1],h=+svg.match(/<svg[^>]+height="([\d.]+)"/)[1];
    const cards=[...svg.matchAll(/data-node-id="[^"]+"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m=>({x:+m[1],y:+m[2],w:+m[3],h:+m[4]}));
    assert.equal(cards.length,ir.nodes.length);
    for(const c of cards)assert.ok(c.x>=0&&c.y>=0&&c.x+c.w<=w+1&&c.y+c.h<=h+1,`${type}: out of bounds`);
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i],b=cards[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`${type}: overlapping cards`);}
  }
});
