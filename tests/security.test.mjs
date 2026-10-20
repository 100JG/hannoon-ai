import test from 'node:test';
import assert from 'node:assert/strict';
import {issueSession,readSession,seal,unseal,digest,identity,authorizeWrite} from '../server/security.mjs';
import {checkPublicUrl,publicAddress,importUrl,htmlText} from '../server/urls.mjs';

const SECRET='test-only-service-secret-with-strong-length-000000';
const ENV={SERVICE_SECRET:SECRET};
test('signed anonymous sessions expire and resist signature/body tampering',async()=>{
  const now=Date.now(),token=await issueSession(SECRET,now);
  assert.ok(await readSession(SECRET,token,now));
  assert.equal(await readSession(SECRET,token,now+86400001),null);
  const [body,signature]=token.split('.');
  assert.equal(await readSession(SECRET,body+'.'+signature.slice(1)+'x',now),null);
  assert.equal(await readSession(SECRET,body+'a.'+signature,now),null);
  assert.equal(await readSession('different-secret-which-is-also-long-enough',token,now),null);
  assert.equal(await readSession(SECRET,token+'.extra',now),null);
});
test('AES-GCM private state is randomized, confidential and authenticated',async()=>{
  const input={source_text:'PRIVATE_SOURCE_DOCUMENT',stage:'verify'};
  const first=await seal(SECRET,input),second=await seal(SECRET,input);
  assert.notEqual(first,second);assert.ok(!first.includes(input.source_text));assert.deepEqual(await unseal(SECRET,first),input);
  const [iv,data]=first.split('.');await assert.rejects(unseal(SECRET,iv+'.'+data.slice(0,8)+'A'+data.slice(9)));
  await assert.rejects(unseal('another-secret-with-at-least-thirty-two-characters',first));
});
test('cookies require same origin and CSRF while bearer access remains explicit',async()=>{
  const token=await issueSession(SECRET),csrf=await digest(SECRET,'csrf:'+token);
  const request=headers=>new Request('https://hannoon.example/api/jobs',{method:'POST',headers});
  await assert.rejects(authorizeWrite(request({cookie:'__Host-hannoon='+token,origin:'https://attacker.invalid','x-csrf-token':csrf}),ENV),e=>e.status===403);
  await assert.rejects(authorizeWrite(request({cookie:'__Host-hannoon='+token,origin:'https://hannoon.example'}),ENV),e=>e.status===403);
  const cookie=await authorizeWrite(request({cookie:'__Host-hannoon='+token,origin:'https://hannoon.example','x-csrf-token':csrf}),ENV);
  const bearer=await authorizeWrite(request({authorization:'Bearer '+token}),ENV);
  assert.equal(cookie.owner,bearer.owner);assert.equal(bearer.bearer,true);
  await assert.rejects(identity(request({authorization:'Bearer invalid'}),ENV),e=>e.status===401);
});
test('SSRF guard rejects canonical IP aliases, credentials, private IPv6 and private DNS answers',async()=>{
  const noFetch=async()=>{throw new Error('network must not be called');};
  for(const url of ['http://127.0.0.1','http://2130706433','http://0x7f000001','http://169.254.169.254','http://[::1]','http://[::ffff:127.0.0.1]','http://10.0.0.1','http://example.internal','file:///etc/passwd','https://user:pass@example.com','https://example.com:8443'])await assert.rejects(checkPublicUrl(url,noFetch));
  const dns=async()=>Response.json({Answer:[{type:1,data:'127.0.0.1'}]});
  await assert.rejects(checkPublicUrl('https://public-looking.example',dns),e=>e.status===400);
  const mixed=async()=>Response.json({Answer:[{type:1,data:'93.184.216.34'},{type:28,data:'fd00::1'}]});
  await assert.rejects(checkPublicUrl('https://mixed.example',mixed));
  assert.equal(publicAddress('93.184.216.34'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('URL imports recheck every redirect before fetching and bound streamed responses',async()=>{
  const visited=[];
  const redirectFetch=async(url)=>{
    visited.push(String(url));
    if(String(url).startsWith('https://cloudflare-dns.com'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});
    return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});
  };
  await assert.rejects(importUrl('https://public.example',{fetchImpl:redirectFetch}));
  assert.ok(!visited.some(url=>url.startsWith('http://127.0.0.1')));
  const largeFetch=async(url)=>String(url).startsWith('https://cloudflare-dns.com')?Response.json({Answer:[{type:1,data:'93.184.216.34'}]}):new Response(new Uint8Array(1024*1024+1),{headers:{'Content-Type':'text/plain'}});
  await assert.rejects(importUrl('https://large.example',{fetchImpl:largeFetch}),/웹페이지가 큽니다/);
});
test('HTML extraction prefers article text and bounded malformed markup fails safely',()=>{
  const html='<nav>메뉴</nav><main>다른 내용<article><h1>제목</h1><p>본문 &amp; 안내.</p><script>비밀</script><form>개인 입력</form></article>끝</main><footer>꼬리말</footer>';
  const result=htmlText(html);assert.ok(result.includes('제목')&&result.includes('본문 & 안내.'));
  assert.ok(!['메뉴','다른 내용','비밀','개인 입력','꼬리말'].some(v=>result.includes(v)));
  assert.equal(htmlText('<script>'.repeat(10000)),'');
  assert.equal(htmlText('<'.repeat(100000)).length,100000);
  assert.throws(()=>htmlText('<span>x</span>'.repeat(5001)),/페이지 구성이 복잡/);
});
