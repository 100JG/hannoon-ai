const encoder = new TextEncoder();
export function base64url(value) { const bytes=new Uint8Array(value);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
export function unbase64(value) { return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0)); }
export function randomToken(size=24) { return base64url(crypto.getRandomValues(new Uint8Array(size))); }
async function key(secret,purpose,algorithm,usages) {
  if (!secret || secret.length<32) throw new Error('SERVICE_NOT_CONFIGURED');
  const raw=await crypto.subtle.digest('SHA-256',encoder.encode(purpose+':'+secret));
  return crypto.subtle.importKey('raw',raw,algorithm,false,usages);
}
export async function digest(secret,value) {
  const k=await key(secret,'signature',{name:'HMAC',hash:'SHA-256'},['sign']);
  return base64url(await crypto.subtle.sign('HMAC',k,encoder.encode(value)));
}
export async function verify(secret,value,signature) {
  try { const k=await key(secret,'signature',{name:'HMAC',hash:'SHA-256'},['verify']);
    return await crypto.subtle.verify('HMAC',k,unbase64(signature),encoder.encode(value)); } catch {return false;}
}
export async function issueSession(secret,now=Date.now()) {
  const body=base64url(encoder.encode(JSON.stringify({n:randomToken(),exp:Math.floor(now/1000)+86400})));
  return body+'.'+await digest(secret,'session:'+body);
}
export async function readSession(secret,token,now=Date.now()) {
  if(typeof token!=='string'||token.length>400)return null;
  const [body,signature,extra]=token.split('.');
  if(extra||!body||!signature||!await verify(secret,'session:'+body,signature))return null;
  try {const value=JSON.parse(new TextDecoder().decode(unbase64(body)));
    return typeof value.n==='string'&&value.n.length>=24&&value.exp>now/1000?value:null;
  }catch{return null;}
}
export async function seal(secret,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const k=await key(secret,'state','AES-GCM',['encrypt']);
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,encoder.encode(JSON.stringify(value)));
  return base64url(iv)+'.'+base64url(data);
}
export async function unseal(secret,value) {
  const [iv,data]=value.split('.');
  const k=await key(secret,'state','AES-GCM',['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv)},k,unbase64(data))));
}
export function cookieValue(request,name) {
  const item=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));
  return item?item.slice(name.length+1):'';
}
export function cookieName(request){return new URL(request.url).protocol==='https:'?'__Host-hannoon':'hannoon';}
export async function identity(request,env,{required=true}={}) {
  const authorization=request.headers.get('authorization')||'';
  const bearer=authorization.startsWith('Bearer ');
  const token=bearer?authorization.slice(7):cookieValue(request,cookieName(request));
  const session=await readSession(env.SERVICE_SECRET,token);
  if(!session) {if(required)throw Object.assign(new Error('화면을 새로고침한 뒤 다시 시도해 주세요.'),{status:401});return null;}
  return {owner:await digest(env.SERVICE_SECRET,'owner:'+session.n),token,bearer,
          csrf:await digest(env.SERVICE_SECRET,'csrf:'+token)};
}
export async function authorizeWrite(request,env) {
  const user=await identity(request,env);
  if(!user.bearer&&(request.headers.get('origin')!==new URL(request.url).origin||
      request.headers.get('x-csrf-token')!==user.csrf))throw Object.assign(new Error('현재 서비스 화면에서 다시 실행해 주세요.'),{status:403});
  return user;
}
export async function ipKey(request,env) {
  const ip=request.headers.get('cf-connecting-ip')||'local';
  return digest(env.SERVICE_SECRET,'ip:'+ip);
}
export function safeOrigin(value){const u=new URL(value);if(u.username||u.password||!['https:','http:'].includes(u.protocol))throw new Error('Invalid origin');return u.origin;}
