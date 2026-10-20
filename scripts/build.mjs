import {readFile,writeFile,mkdir,cp,readdir,stat} from 'node:fs/promises';
import {build} from 'esbuild';
import {zipSync,strToU8} from 'fflate';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin=process.env.SITE_ORIGIN||'https://hannoon-ai-diagram.jgbaek100.chatgpt.site';
const url=new URL(origin);
if(url.username||url.password||!['https:','http:'].includes(url.protocol)||url.pathname!=='/')throw new Error('SITE_ORIGIN must be a public origin');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.txt':'text/plain; charset=utf-8','.ttf':'font/ttf','.otf':'font/otf','.pfb':'application/octet-stream','.bcmap':'application/octet-stream','.zip':'application/zip'};
const textual=new Set(['.html','.js','.mjs','.css','.svg','.json','.txt']);
async function walk(folder){const output=[];for(const item of await readdir(folder,{withFileTypes:true})){if(item.isSymbolicLink())throw new Error('No symlinks in public assets');const p=path.join(folder,item.name);if(item.isDirectory()){if(!['tests','node_modules'].includes(item.name))output.push(...await walk(p));}else output.push(p);}return output;}
const assets={};
for(const p of await walk(path.join(root,'web'))){
  if(path.basename(p).includes('.source.'))continue;
  const content=await readFile(p),ext=path.extname(p);
  assets['/'+path.relative(path.join(root,'web'),p).replaceAll('\\','/')]={type:types[ext]||'application/octet-stream',...(textual.has(ext)?{text:content.toString('utf8')}:{base64:content.toString('base64')})};
}
const files={};
for(const p of await walk(path.join(root,'chrome-extension'))){
  const relative=path.relative(path.join(root,'chrome-extension'),p).replaceAll('\\','/');
  if(['package.json','package-lock.json'].includes(relative))continue;
  let bytes=new Uint8Array(await readFile(p));
  if(relative==='build-config.js')bytes=strToU8('export const SERVICE_URL = '+JSON.stringify(url.origin)+';\n');
  if(relative==='manifest.json'){const manifest=JSON.parse(Buffer.from(bytes));manifest.optional_host_permissions=[url.protocol+'//'+url.hostname+'/*'];bytes=strToU8(JSON.stringify(manifest,null,2));}
  files[relative]=bytes;
}
const extension=zipSync(files,{level:6});
assets['/downloads/chrome-extension.zip']={type:'application/zip',base64:Buffer.from(extension).toString('base64')};
await mkdir(path.join(root,'dist/server'),{recursive:true});
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
const entry='import {createApplication} from "./server/app.mjs";\nconst assets='+JSON.stringify(assets)+';\nexport default createApplication(assets);\n';
await build({stdin:{contents:entry,resolveDir:root,sourcefile:'worker-entry.mjs'},outfile:path.join(root,'worker/index.js'),bundle:true,format:'esm',platform:'neutral',target:'es2024',minify:true,legalComments:'eof'});
await cp(path.join(root,'worker/index.js'),path.join(root,'dist/server/index.js'));
await cp(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
await cp(path.join(root,'drizzle'),path.join(root,'dist/drizzle'),{recursive:true});
await writeFile(path.join(root,'dist/hannoon-chrome-extension.zip'),extension);
console.log(JSON.stringify({worker_bytes:(await stat(path.join(root,'worker/index.js'))).size,asset_count:Object.keys(assets).length,extension_zip_bytes:extension.length,service_origin:url.origin}));
