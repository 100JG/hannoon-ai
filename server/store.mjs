import {digest,randomToken,seal,unseal,ipKey} from './security.mjs';
import {initialState,advance} from './agent.mjs';

const MAX_CALLS=6;
export const limits=env=>({session:Math.min(100,Math.max(1,Number(env.SESSION_DAILY_LIMIT)||5)),ip:Math.min(500,Math.max(1,Number(env.IP_DAILY_LIMIT)||15)),
  global:Math.min(1000,Math.max(1,Number(env.GLOBAL_DAILY_LIMIT)||30)),api:Math.min(5000,Math.max(MAX_CALLS,Number(env.API_DAILY_LIMIT)||60))});
function failure(message,status=400){throw Object.assign(new Error(message),{status});}
export async function cleanup(env) {
  const now=Date.now();
  // Bound cleanup work per invocation; expired jobs are unreadable immediately.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE expires_at<? LIMIT 10)').bind(now),
    env.DB.prepare('DELETE FROM quotas WHERE day<?').bind(new Date(now-3*86400000).toISOString().slice(0,10))
  ]);
}
export async function createJob(request,env,user,source,requestId=null) {
  if(typeof source!=='string'||!source.trim()||[...source].length>12000)failure('내용을 12,000자 이내로 입력해 주세요.');
  if(requestId!==null&&!/^[A-Za-z0-9_-]{1,120}$/.test(requestId))failure('요청을 확인할 수 없습니다. 새로 실행해 주세요.');
  if(!env.LLM_API_KEY)failure('서비스를 준비 중입니다. 잠시 후 다시 이용해 주세요.',503);
  source=source.trim();
  const sourceHash=await digest(env.SERVICE_SECRET,'source:'+source);
  if(requestId){const existing=await env.DB.prepare('SELECT id,source_hash,state FROM jobs WHERE owner=? AND request_id=? AND expires_at>?').bind(user.owner,requestId,Date.now()).first();
    if(existing){if(existing.source_hash!==sourceHash)failure('같은 요청 번호에 다른 내용이 들어왔습니다.',409);return {job_id:existing.id,state:existing.state};}}
  const active=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN owner=? THEN 1 ELSE 0 END) AS personal FROM jobs WHERE state NOT IN ('completed','failed') AND expires_at>?").bind(user.owner,Date.now()).first();
  if(active.total>=8||active.personal>=2)failure('진행 중인 작업이 있습니다. 잠시 후 다시 시도해 주세요.',429);
  const id=crypto.randomUUID().replaceAll('-',''),cap=randomToken(32),day=new Date().toISOString().slice(0,10),capHash=await digest(env.SERVICE_SECRET,'cap:'+cap);
  const state=await seal(env.SERVICE_SECRET,initialState(source));
  const l=limits(env),now=Date.now(),ip=await ipKey(request,env);
  try {
    await env.DB.prepare(`INSERT INTO jobs(id,owner,ip_hash,request_id,source_hash,cap_hash,state,private_state,quota_day,
      attempts,reserved_calls,lease_until,created_at,expires_at,session_limit,ip_limit,global_limit,api_limit)
      VALUES (?,?,?,?,?,?,'queued',?,?,0,?,0,?,?,?,?,?,?)`).bind(id,user.owner,ip,requestId,sourceHash,capHash,state,day,MAX_CALLS,now,now+86400000,l.session,l.ip,l.global,l.api).run();
  }catch{
    // A concurrent request with the same idempotency key may have won the insert.
    if(requestId){const existing=await env.DB.prepare('SELECT id,source_hash,state FROM jobs WHERE owner=? AND request_id=? AND expires_at>?').bind(user.owner,requestId,Date.now()).first();
      if(existing){if(existing.source_hash!==sourceHash)failure('같은 요청 번호에 다른 내용이 들어왔습니다.',409);return {job_id:existing.id,state:existing.state};}}
    failure('현재 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',429);
  }
  return {job_id:id,state:'queued',access_token:cap};
}
export async function findJob(env,id,user,cap=null) {
  if(!/^[a-f0-9]{32}$/.test(id))failure('결과를 찾을 수 없습니다.',404);
  const row=await env.DB.prepare('SELECT * FROM jobs WHERE id=? AND expires_at>?').bind(id,Date.now()).first();
  if(!row||!(user&&row.owner===user.owner||cap&&await digest(env.SERVICE_SECRET,'cap:'+cap)===row.cap_hash))failure('결과를 찾을 수 없습니다. 보관 기간이 지난 결과는 다시 생성해 주세요.',404);
  return row;
}
export function publicJob(row) {
  const data={job_id:row.id,state:row.state,events:row.last_stage?[{stage:row.last_stage}]:[],error:row.error||''};
  if(row.result_json){const result=JSON.parse(row.result_json);data.result={one_sentence:result.one_sentence,status:result.status,diagram_type:result.diagram_type,
    image_url:`/api/jobs/${row.id}/image.svg`,png_url:null};}
  return data;
}
export async function advanceJob(env,row,{fetchImpl}={}) {
  if(['completed','failed'].includes(row.state)||row.lease_until>Date.now())return row;
  const lease=randomToken(16),now=Date.now();
  const locked=await env.DB.prepare("UPDATE jobs SET lease_token=?,lease_until=?,attempts=attempts+1,state='running' WHERE id=? AND lease_until<=? AND state NOT IN ('completed','failed') AND attempts<?").bind(lease,now+90000,row.id,now,MAX_CALLS).run();
  if(!locked.meta.changes){
    if(row.attempts>=MAX_CALLS)await env.DB.prepare("UPDATE jobs SET state='failed',private_state=NULL,error=?,lease_until=0 WHERE id=? AND lease_until<=? AND state NOT IN ('completed','failed')").bind('안전한 처리 한도에 도달했습니다. 내용을 나누어 다시 시도해 주세요.',row.id,now).run();
    return env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(row.id).first();
  }
  // The caller's pre-lock snapshot may be stale after a different poll completed.
  const claimed=await env.DB.prepare('SELECT * FROM jobs WHERE id=? AND lease_token=?').bind(row.id,lease).first();
  if(!claimed)return env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(row.id).first();
  let next;
  try{next=await advance(await unseal(env.SERVICE_SECRET,claimed.private_state),env,{fetchImpl});}
  catch{next={stage:'final',api_calls:MAX_CALLS,result:{status:'FAIL'},error:'다이어그램을 완성하지 못했습니다. 잠시 후 다시 시도해 주세요.'};}
  if(next.stage==='final'){
    const result=next.result||{status:'FAIL'};
    for(const field of ['svg','one_sentence'])if(typeof result[field]==='string'&&env.LLM_API_KEY)result[field]=result[field].split(env.LLM_API_KEY).join('[보호됨]');
    const success=result.status!=='FAIL'&&result.svg&&result.one_sentence;
    const refreshed=await env.DB.prepare('SELECT attempts FROM jobs WHERE id=?').bind(row.id).first();
    const refund=Math.max(0,MAX_CALLS-refreshed.attempts);
    await env.DB.batch([
      env.DB.prepare("UPDATE jobs SET state=?,private_state=NULL,result_json=?,error=?,lease_until=0,last_stage='finalize',reserved_calls=attempts WHERE id=? AND lease_token=?").bind(success?'completed':'failed',success?JSON.stringify(result):null,success?'':next.error||'다이어그램을 완성하지 못했습니다. 내용을 나누어 다시 시도해 주세요.',row.id,lease),
      env.DB.prepare("UPDATE quotas SET used=MAX(0,used-?) WHERE day=? AND scope='api' AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND lease_token=? AND state IN ('completed','failed'))").bind(refund,row.quota_day,row.id,lease)
    ]);
  }else{
    await env.DB.prepare('UPDATE jobs SET private_state=?,lease_until=0,last_stage=? WHERE id=? AND lease_token=?').bind(await seal(env.SERVICE_SECRET,next),next.stage,row.id,lease).run();
  }
  return env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(row.id).first();
}
