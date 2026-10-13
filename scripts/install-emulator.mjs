// Optional Windows test device; packages and hashes come from Google's stable channel.
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.tools'), sdk = join(root,'android-sdk');
async function hash(path,algorithm) {
  const h = createHash(algorithm); for await(const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex');
}
for(const [repository,packagePath,targetPath] of [
  ['https://dl.google.com/android/repository/repository2-3.xml','emulator','emulator'],
  ['https://dl.google.com/android/repository/sys-img/android/sys-img2-3.xml','system-images;android-35;default;x86_64','system-images/android-35/default/x86_64'],
]) {
  const target = join(sdk,targetPath);
  const installed = existsSync(join(target,'source.properties'));
  if(installed && existsSync(join(target,'package.xml'))) { console.log('Installed:',packagePath); continue; }
  const response = await fetch(repository); if(!response.ok) throw Error('Manifest HTTP ' + response.status);
  const xml = new JSDOM(await response.text(),{contentType:'text/xml'});
  const pkg = [...xml.window.document.getElementsByTagName('remotePackage')].find(p => p.getAttribute('path') === packagePath && p.getElementsByTagName('channelRef')[0]?.getAttribute('ref') === 'channel-0');
  const archive = [...(pkg?.getElementsByTagName('archive') || [])].find(a => !a.getElementsByTagName('host-os').length || a.getElementsByTagName('host-os')[0].textContent === 'windows');
  const complete = archive?.getElementsByTagName('complete')[0];
  const relative = complete?.getElementsByTagName('url')[0]?.textContent?.trim();
  const check = complete?.getElementsByTagName('checksum')[0];
  if(!relative || !check) throw Error('Stable archive missing: ' + packagePath);
  const filename = join(root,'downloads',relative), expected = check.textContent.trim(), algorithm = check.getAttribute('type') || 'sha1';
  if(!installed && (!existsSync(filename) || await hash(filename,algorithm) !== expected)) {
    console.log('Downloading:',packagePath);
    const response = await fetch(new URL(relative,repository),{signal:AbortSignal.timeout(600000)});
    if(!response.ok || !response.body) throw Error('Archive HTTP ' + response.status);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(filename + '.partial'));
    if(await hash(filename + '.partial',algorithm) !== expected) throw Error('Archive checksum mismatch');
    renameSync(filename + '.partial',filename);
  }
  if(!installed) {
  const extract = join(root,'extract',relative.replace(/\.zip$/,'')); mkdirSync(extract,{recursive:true});
  const unpack = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:TASK_ARCHIVE -DestinationPath $env:TASK_EXTRACT -Force'],
    {env:{...process.env,TASK_ARCHIVE:filename,TASK_EXTRACT:extract},stdio:'inherit',windowsHide:true});
  if(unpack.status !== 0) throw Error('Archive extraction failed');
  const folder = readdirSync(extract,{withFileTypes:true}).filter(p => p.isDirectory());
  if(folder.length !== 1) throw Error('Unexpected archive layout');
  const source = join(extract,folder[0].name);
  if(!source.startsWith(root + '\\') || !target.startsWith(root + '\\')) throw Error('Target outside .tools');
  mkdirSync(resolve(target,'..'),{recursive:true}); renameSync(source,target);
  }
  mkdirSync(join(sdk,'licenses'),{recursive:true});
  for(const license of xml.window.document.getElementsByTagName('license')) {
    const id = license.getAttribute('id'); if(!id || !/^[a-zA-Z0-9-]+$/.test(id)) continue;
    const path = join(sdk,'licenses',id), prior = existsSync(path) ? readFileSync(path,'utf8') : '';
    const digest = createHash('sha1').update(license.textContent.trim()).digest('hex');
    if(!prior.includes(digest)) writeFileSync(path,prior + '\n' + digest + '\n');
  }
  const document = xml.window.document;
  const local = document.createElement('localPackage'); local.setAttribute('path',packagePath);
  for(const node of pkg.children) if(!['archives','channelRef'].includes(node.tagName)) local.append(node.cloneNode(true));
  const licenses = [...document.getElementsByTagName('license')].map(node => node.cloneNode(true));
  document.documentElement.replaceChildren(...licenses,local);
  writeFileSync(join(target,'package.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n' + document.documentElement.outerHTML);
  xml.window.close(); console.log('Installed and verified:',packagePath);
}
