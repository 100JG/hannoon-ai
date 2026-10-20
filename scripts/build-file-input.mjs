import {build} from 'esbuild';
import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const vendor = path.join(web, 'vendor');
await mkdir(vendor, {recursive: true});
await build({entryPoints: [path.join(web, 'file-input.source.js')], outfile: path.join(web, 'file-input.js'), bundle: true, format: 'esm', platform: 'browser', target: ['chrome116', 'firefox115', 'safari17'], minify: true, legalComments: 'linked'});
const pdf = path.join(root, 'node_modules', 'pdfjs-dist');
await cp(path.join(pdf, 'legacy', 'build', 'pdf.worker.min.mjs'), path.join(vendor, 'pdf.worker.min.mjs'));
await cp(path.join(pdf, 'cmaps'), path.join(vendor, 'cmaps'), {recursive: true});
await cp(path.join(pdf, 'standard_fonts'), path.join(vendor, 'standard_fonts'), {recursive: true});
const notices = [await readFile(path.join(pdf, 'LICENSE'), 'utf8'), await readFile(path.join(root, 'node_modules', 'fflate', 'LICENSE'), 'utf8')];
await writeFile(path.join(vendor, 'LICENSES.txt'), notices.join('\n\n---\n\n'));
const extension = path.join(root, 'chrome-extension');
await cp(path.join(web, 'file-input.js'), path.join(extension, 'file-input.js'));
await cp(vendor, path.join(extension, 'vendor'), {recursive: true});
try {await cp(path.join(web, 'file-input.js.LEGAL.txt'), path.join(extension, 'file-input.js.LEGAL.txt'));}
catch (error) {if (error.code !== 'ENOENT') throw error;}
console.log('Built local document reader for web and Chrome extension.');
