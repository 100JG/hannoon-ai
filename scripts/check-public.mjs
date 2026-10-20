import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const known=[];
const at=process.argv.indexOf('--known-env');
if(at!==-1){
  const env=await readFile(process.argv[at+1],'utf8');
  for(const line of env.split(/\r?\n/)){const match=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(match&&/KEY|TOKEN|SECRET/.test(match[1])){
    const value=match[2].replace(/^(['"])(.*)\1$/,'$2');if(value.length>=20)known.push(value,Buffer.from(value).toString('base64'));
  }}
}
const errors=[];
function inspect(name,buffer){
  const text=buffer.toString('utf8');
  if(known.some(value=>text.includes(value)))errors.push(name+': saved credential detected');
  // Emscripten's standard /home/web_user placeholder is part of the PDF library.
  if(/(?:C:[\\/]+Users[\\/]+|\/Users\/|\/home\/)[A-Za-z][^\r\n"']{2,}/i.test(text.replaceAll('/home/web_user','')))errors.push(name+': personal filesystem path');
  // Tests use constructed dummy credentials; real literals must never be published.
  if(/(?:AIza[\w-]{30,}|AQ\.[\w.-]{35,}|sk-(?:ant-|proj-)[\w-]{30,})/.test(text))errors.push(name+': credential-shaped literal');
}
for(const name of paths){
  if(/(?:^|\/)\.dev\.vars$|(?:^|\/)\.env\/.*(?<!\.example)$|\.(?:pem|key|p12|pfx)$/.test(name))errors.push(name+': forbidden private file');
  try{inspect(name,await readFile(path.join(root,name)));}catch(error){if(error.code!=='ENOENT')throw error;}
}
for(const name of ['dist/server/index.js','dist/hannoon-chrome-extension.zip']){
  try{const data=await readFile(path.join(root,name));inspect(name,data);
    if(name.endsWith('.zip'))for(const [entry,bytes]of Object.entries(unzipSync(data)))inspect(name+':'+entry,Buffer.from(bytes));
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
if(errors.length){console.error([...new Set(errors)].join('\n'));process.exit(1);}
console.log('Public source and built artifacts passed credential and personal-path checks.');
