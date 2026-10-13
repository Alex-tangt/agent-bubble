import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.tools');
const sdk = join(root,'android-sdk');
mkdirSync(join(root,'downloads'),{recursive:true});
const response = await fetch('https://dl.google.com/android/repository/repository2-3.xml');
if(!response.ok) throw new Error('SDK manifest HTTP ' + response.status);
const xml = new JSDOM(await response.text(),{contentType:'text/xml'});
const packages = [...xml.window.document.getElementsByTagName('remotePackage')];
async function hashFile(path,algorithm) {
  const hash = createHash(algorithm);
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}
for(const [path,relativeTarget] of [['platform-tools','platform-tools'],['platforms;android-35','platforms/android-35'],['build-tools;35.0.0','build-tools/35.0.0']]) {
  const target = join(sdk,relativeTarget);
  if(existsSync(join(target,'source.properties'))) { console.log('Installed:',path); continue; }
  const pkg = packages.find(item => item.getAttribute('path') === path);
  if(!pkg) throw new Error('Package not found: ' + path);
  const archive = [...pkg.getElementsByTagName('archive')].find(item => !item.getElementsByTagName('host-os').length || item.getElementsByTagName('host-os')[0].textContent === 'windows');
  const complete = archive?.getElementsByTagName('complete')[0];
  const relative = complete?.getElementsByTagName('url')[0]?.textContent;
  const check = complete?.getElementsByTagName('checksum')[0];
  if(!relative || !check) throw new Error('Archive not found: ' + path);
  const filename = join(root,'downloads',relative);
  const algorithm = check.getAttribute('type') || 'sha1';
  const expected = check.textContent.trim().toLowerCase();
  if(!existsSync(filename) || await hashFile(filename,algorithm) !== expected) {
    const download = await fetch(new URL(relative,'https://dl.google.com/android/repository/'),{signal:AbortSignal.timeout(600000)});
    if(!download.ok || !download.body) throw new Error('Archive HTTP ' + download.status);
    await pipeline(Readable.fromWeb(download.body),createWriteStream(filename + '.partial'));
    if(await hashFile(filename + '.partial',algorithm) !== expected) throw new Error('Archive checksum mismatch');
    renameSync(filename + '.partial',filename);
  }
  const extract = join(root,'extract',relative.replace(/\.zip$/,''));
  mkdirSync(extract,{recursive:true});
  const unpack = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:TASK_ARCHIVE -DestinationPath $env:TASK_EXTRACT -Force'],
    {env:{...process.env,TASK_ARCHIVE:filename,TASK_EXTRACT:extract},stdio:'inherit',windowsHide:true});
  if(unpack.status !== 0) throw new Error('Archive extraction failed');
  const folders = readdirSync(extract,{withFileTypes:true}).filter(item => item.isDirectory());
  if(folders.length !== 1) throw new Error('Unexpected SDK archive layout');
  const source = join(extract,folders[0].name);
  if(!source.startsWith(root + '\\') || !target.startsWith(root + '\\')) throw new Error('SDK path escaped tool directory');
  mkdirSync(resolve(target,'..'),{recursive:true});
  renameSync(source,target);
  console.log('Installed and verified:',path);
}
mkdirSync(join(sdk,'licenses'),{recursive:true});
for(const license of [...xml.window.document.getElementsByTagName('license')]) {
  const text = license.textContent.trim();
  const id = license.getAttribute('id');
  if(!id || !/^[a-zA-Z0-9-]+$/.test(id)) continue;
  const path = join(sdk,'licenses',id);
  const previous = existsSync(path) ? readFileSync(path,'utf8') : '';
  const hash = createHash('sha1').update(text).digest('hex');
  if(!previous.includes(hash)) writeFileSync(path,previous + '\n' + hash + '\n');
}
xml.window.close();
mkdirSync('android',{recursive:true});
writeFileSync('android/local.properties','sdk.dir=' + sdk.replaceAll('\\','/') + '\n');
console.log('Android SDK installation complete.');
