import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createJob,findJob,advanceJob,publicJob,cleanup} from '../server/store.mjs';
import {digest,unseal} from '../server/security.mjs';
import {createApplication} from '../server/app.mjs';

const SECRET='test-only-service-secret-with-at-least-48-characters';
const SOURCE='신청을 접수하고 검토한 뒤 결과를 안내한다.';
async function database(t,overrides={}){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-20',d1Databases:{DB:'test-db'}}));
  t.after(()=>mf.dispose());
  const DB=await mf.getD1Database('DB');
  for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
    const sql=await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8');
    for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await DB.prepare(statement).run();
  }
  return {DB,SERVICE_SECRET:SECRET,LLM_API_KEY:'AIza'+'test-only-key'.repeat(3),...overrides};
}
const request=(ip='198.41.220.1')=>new Request('https://hannoon.example/api/jobs',{headers:{'CF-Connecting-IP':ip}});
const user=async(name='owner')=>({owner:await digest(SECRET,'test-owner:'+name)});
async function apiCount(env){return (await env.DB.prepare("SELECT used FROM quotas WHERE scope='api'").first())?.used||0;}
function ir(){return {diagram_type:'flowchart',selection_reason:'원문 관계',document_kind:'process_flow',title:'신청 처리',one_sentence:'신청을 접수하고 검토한 뒤 결과를 안내합니다.',nodes:[1,2,3].map(i=>({id:'n'+i,label:['접수','검토','안내'][i-1],kind:'process',evidence_ids:['s1'],uncertain:false,detail:'',group:'',order_label:''})),edges:[1,2].map(i=>({id:'e'+i,source:'n'+i,target:'n'+(i+1),label:'',evidence_ids:['s1'],uncertain:false})),ambiguities:[],assumptions:[]};}
function providerResponse(value){return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]});}
function audit(){const value=ir();return {summary:'원문과 일치',unit_checks:[{source_id:'s1',status:'covered',mapped_ids:['n1','n2','n3'],rationale:'원문의 모든 단계를 표현합니다.'}],element_checks:[...value.nodes,...value.edges].map(e=>({target_id:e.id,supported:true,evidence_ids:['s1'],rationale:'직접 명시된 관계입니다.'})),sentence_check:{supported:true,evidence_ids:['s1'],rationale:'원문과 요약의 의미가 같습니다.'},findings:[]};}

test('actual D1 trigger makes shared API reservations atomic under concurrent users',async t=>{
  const env=await database(t,{API_DAILY_LIMIT:'6'});
  const results=await Promise.allSettled(Array.from({length:5},async(_,i)=>createJob(request('198.41.220.'+(i+1)),env,await user('u'+i),SOURCE,'request-'+i)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===429));
  assert.equal(await apiCount(env),6);assert.equal((await env.DB.prepare("SELECT used FROM quotas WHERE scope='global'").first()).used,1);
});
test('concurrent idempotent requests return one job without duplicate quota charges',async t=>{
  const env=await database(t),owner=await user();
  const jobs=await Promise.all(Array.from({length:4},()=>createJob(request(),env,owner,SOURCE,'same-request')));
  assert.equal(new Set(jobs.map(j=>j.job_id)).size,1);assert.equal(await apiCount(env),6);
  await assert.rejects(createJob(request(),env,owner,'다른 원문','same-request'),e=>e.status===409);
});
test('encrypted state, ownership and independent capability access protect private documents',async t=>{
  const env=await database(t),owner=await user();
  const created=await createJob(request(),env,owner,SOURCE,'private-request');
  const row=await findJob(env,created.job_id,owner);
  assert.ok(!row.private_state.includes(SOURCE));assert.equal((await unseal(SECRET,row.private_state)).source_text,SOURCE);
  assert.ok(!JSON.stringify(publicJob(row)).includes(SOURCE));assert.ok(!row.cap_hash.includes(created.access_token));
  await assert.rejects(findJob(env,created.job_id,await user('other')),e=>e.status===404);
  await assert.rejects(findJob(env,created.job_id,null,'wrong-token'),e=>e.status===404);
  assert.equal((await findJob(env,created.job_id,null,created.access_token)).id,row.id);
});
test('fresh post-lease snapshot prevents stale polls from repeating an inference stage',async t=>{
  const env=await database(t),owner=await user(),created=await createJob(request(),env,owner,SOURCE);
  const stale=await findJob(env,created.job_id,owner);
  const afterExtract=await advanceJob(env,stale,{fetchImpl:async()=>providerResponse(ir())});
  assert.equal((await unseal(SECRET,afterExtract.private_state)).stage,'verify');
  const completed=await advanceJob(env,stale,{fetchImpl:async(url,options)=>{const payload=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);assert.ok(payload.ir);return providerResponse(audit());}});
  assert.equal(completed.state,'completed');assert.equal(completed.attempts,2);assert.equal(completed.private_state,null);assert.equal(await apiCount(env),2);
  assert.ok(!JSON.stringify(publicJob(completed)).includes(SOURCE));assert.ok(JSON.parse(completed.result_json).svg.includes('<svg'));
});
test('lost leases cannot refund another live worker reservation',async t=>{
  const env=await database(t),owner=await user(),created=await createJob(request(),env,owner,SOURCE);
  let row=await findJob(env,created.job_id,owner);row=await advanceJob(env,row,{fetchImpl:async()=>providerResponse(ir())});
  const result=await advanceJob(env,row,{fetchImpl:async()=>{
    await env.DB.prepare("UPDATE jobs SET lease_token='new-worker-lease',attempts=3,lease_until=? WHERE id=?").bind(Date.now()+90000,row.id).run();
    return providerResponse(audit());
  }});
  assert.equal(result.state,'running');assert.equal(result.lease_token,'new-worker-lease');assert.equal(await apiCount(env),6);
});
test('attempt caps stop paid calls and stale exhausted snapshots preserve completed jobs',async t=>{
  const env=await database(t),owner=await user(),created=await createJob(request(),env,owner,SOURCE);
  await env.DB.prepare('UPDATE jobs SET attempts=6 WHERE id=?').bind(created.job_id).run();
  let calls=0,row=await findJob(env,created.job_id,owner);
  const failed=await advanceJob(env,row,{fetchImpl:async()=>{calls++;return providerResponse(ir());}});
  assert.equal(calls,0);assert.equal(failed.state,'failed');assert.equal(failed.private_state,null);
  await env.DB.prepare("UPDATE jobs SET state='completed',result_json='{}',lease_until=0 WHERE id=?").bind(created.job_id).run();
  const preserved=await advanceJob(env,{...row,state:'running'},{fetchImpl:async()=>{calls++;return providerResponse(ir());}});
  assert.equal(preserved.state,'completed');assert.equal(calls,0);
});
test('session and IP daily limits persist across sessions while TTL removes expired state',async t=>{
  const env=await database(t,{IP_DAILY_LIMIT:'1'}),owner=await user();
  const created=await createJob(request(),env,owner,SOURCE);
  await assert.rejects(createJob(request(),env,await user('another'),SOURCE),e=>e.status===429);
  await env.DB.prepare('UPDATE jobs SET expires_at=? WHERE id=?').bind(Date.now()-1,created.job_id).run();
  await assert.rejects(findJob(env,created.job_id,owner),e=>e.status===404);
  await cleanup(env);assert.equal(await env.DB.prepare('SELECT id FROM jobs WHERE id=?').bind(created.job_id).first(),null);
});
test('application integration issues secure anonymous sessions and enforces CSRF and owner-only reads',async t=>{
  const env=await database(t),app=createApplication({}),pending=[],ctx={waitUntil:p=>pending.push(p)};
  const session=await app.fetch(new Request('https://hannoon.example/api/session'),env,ctx),sessionData=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0];
  assert.match(session.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.match(session.headers.get('set-cookie'),/; Secure/);
  const input=()=>({method:'POST',headers:{cookie,'Content-Type':'application/json','CF-Connecting-IP':'198.41.220.1',Origin:'https://hannoon.example','X-CSRF-Token':sessionData.csrf_token},body:JSON.stringify({source_text:SOURCE,request_id:'integration'})});
  let options=input();delete options.headers['X-CSRF-Token'];assert.equal((await app.fetch(new Request('https://hannoon.example/api/jobs',options),env,ctx)).status,403);
  options=input();options.headers.Origin='https://attacker.invalid';assert.equal((await app.fetch(new Request('https://hannoon.example/api/jobs',options),env,ctx)).status,403);
  const made=await app.fetch(new Request('https://hannoon.example/api/jobs',input()),env,ctx);assert.equal(made.status,202);const job=await made.json();
  assert.equal((await app.fetch(new Request('https://hannoon.example/api/jobs/'+job.job_id),env,ctx)).status,401);
  const stranger=await app.fetch(new Request('https://hannoon.example/api/session'),env,ctx);
  assert.equal((await app.fetch(new Request('https://hannoon.example/api/jobs/'+job.job_id,{headers:{cookie:stranger.headers.get('set-cookie').split(';')[0]}}),env,ctx)).status,404);
  assert.ok(!JSON.stringify(await (await app.fetch(new Request('https://hannoon.example/api/config'),env,ctx)).json()).includes(env.LLM_API_KEY));
  await Promise.all(pending);
});
