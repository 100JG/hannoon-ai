function error(message){throw Object.assign(new Error(message),{status:400});}
export function publicAddress(ip){
  ip=ip.toLowerCase().replace(/^\[|\]$/g,'');
  if(ip.includes(':'))return !/^(::|::1$|fc|fd|fe[89ab]|ff|2001:db8|::ffff:)/.test(ip);
  const p=ip.split('.').map(Number);
  if(p.length!==4||p.some(v=>!Number.isInteger(v)||v<0||v>255))return false;
  return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&[18,19,51].includes(p[1])||p[0]===203&&p[1]===0||p[0]===192&&p[1]===0);
}
export async function checkPublicUrl(value,fetchImpl=fetch){
  let u;try{u=new URL(value);}catch{error('공개 웹페이지 주소를 입력해 주세요.');}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port)||u.href.length>2048)error('로그인 정보가 없는 공개 웹페이지 주소를 입력해 주세요.');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(host==='localhost'||/\.(localhost|local|internal|lan)$/.test(host)||!host.includes('.')&&!host.includes(':'))error('내부 네트워크 주소는 읽을 수 없습니다.');
  if(/^[0-9.]+$/.test(host)||host.includes(':')){if(!publicAddress(host))error('내부 네트워크 주소는 읽을 수 없습니다.');return u;}
  const answers=await Promise.all(['A','AAAA'].map(async type=>{
    const res=await fetchImpl('https://cloudflare-dns.com/dns-query?'+new URLSearchParams({name:host,type}),{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(8000)});
    if(!res.ok)error('웹페이지 주소를 확인하지 못했습니다.');
    const data=await res.json();return (data.Answer||[]).filter(v=>[1,28].includes(v.type)).map(v=>v.data);
  }));
  const addresses=answers.flat();
  if(!addresses.length||addresses.some(v=>!publicAddress(v)))error('가져올 수 없는 웹페이지 주소입니다. 필요한 본문을 붙여넣어 주세요.');
  return u;
}
function entities(text){return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,v)=>{
  if(v[0]==='#'){const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[v.toLowerCase()]||' ';
});}
export function htmlText(html){
  // Advance once through the input; unclosed repeated tags must not cause regex backtracking.
  const lower=html.toLowerCase(),all=[],article=[],main=[],ignored=new Set(['script','style','noscript','nav','header','footer','aside','form','svg','canvas','iframe','template']);
  let at=0,inArticle=0,inMain=0,tags=0;
  const append=value=>{all.push(value);if(inArticle)article.push(value);if(inMain)main.push(value);};
  while(at<html.length){
    const begin=html.indexOf('<',at);
    if(begin<0){append(html.slice(at));break;}
    append(html.slice(at,begin));
    if(lower.startsWith('<!--',begin)){const close=lower.indexOf('-->',begin+4);if(close<0)break;at=close+3;continue;}
    const end=html.indexOf('>',begin+1);if(end<0){append(html.slice(begin));break;}
    if(++tags>5000)error('페이지 구성이 복잡합니다. 필요한 본문을 복사해 입력해 주세요.');
    const raw=html.slice(begin+1,end),match=raw.slice(0,100).match(/^\s*(\/?)\s*([a-z][a-z0-9:-]*)/i);at=end+1;
    if(!match){append(' ');continue;}
    const closing=!!match[1],tag=match[2].toLowerCase();
    if(!closing&&ignored.has(tag)){
      let close=lower.indexOf('</'+tag,at);
      while(close>=0&&!/[\s>]/.test(lower[close+tag.length+2]||''))close=lower.indexOf('</'+tag,close+tag.length+2);
      if(close<0)break;
      const closeEnd=html.indexOf('>',close+tag.length+2);if(closeEnd<0)break;at=closeEnd+1;append(' ');continue;
    }
    if(tag==='article')inArticle=Math.max(0,inArticle+(closing?-1:1));
    if(tag==='main')inMain=Math.max(0,inMain+(closing?-1:1));
    if(/^(?:p|div|section|h[1-6]|br|li|tr|blockquote|article|main)$/.test(tag))append('\n');else append(' ');
  }
  const clean=parts=>entities(parts.join('')).replace(/[^\S\n]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
  return clean(article)||clean(main)||clean(all);
}
export async function importUrl(value,{fetchImpl=fetch}={}){
  let url=await checkPublicUrl(value,fetchImpl),response;
  for(let n=0;n<4;n++){
    response=await fetchImpl(url.href,{redirect:'manual',headers:{'User-Agent':'HanNoonAI/2.0','Accept':'text/html,text/plain'},signal:AbortSignal.timeout(15000)});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();
      if(n===3)error('주소 이동이 많은 페이지입니다. 본문을 붙여넣어 주세요.');
      url=await checkPublicUrl(new URL(response.headers.get('location')||'',url).href,fetchImpl);continue;
    }break;
  }
  if(!response.ok)error('페이지를 읽지 못했습니다. 로그인 페이지는 Chrome 확장에서 현재 페이지로 읽어 주세요.');
  const type=response.headers.get('content-type')||'';
  if(!/text\/(html|plain)|application\/xhtml/i.test(type)){await response.body?.cancel();error('이 주소는 웹 본문으로 읽을 수 없습니다. 문서는 내려받은 뒤 파일로 선택해 주세요.');}
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();error('웹페이지가 큽니다. 필요한 본문을 복사해 입력해 주세요.');}parts.push(value);}
  const raw=new Uint8Array(size);let at=0;for(const p of parts){raw.set(p,at);at+=p.length;}
  const charset=type.match(/charset=([\w-]+)/i)?.[1]||'utf-8';
  let text;try{text=new TextDecoder(charset).decode(raw);}catch{text=new TextDecoder().decode(raw);}
  if(/html/i.test(type))text=htmlText(text);
  if(!text.trim())error('읽을 수 있는 본문이 없습니다. Chrome 확장 또는 텍스트 입력을 사용해 주세요.');
  const chars=[...text],truncated=chars.length>12000;
  return {text:chars.slice(0,12000).join(''),title:url.hostname,total_chars:chars.length,truncated,warnings:truncated?['본문이 길어 앞 12,000자만 가져왔습니다. 분석할 범위를 확인해 주세요.']:[]};
}
