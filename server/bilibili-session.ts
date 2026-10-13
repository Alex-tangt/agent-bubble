import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type {Config} from './config.js';
import type {Cookie} from 'playwright';

export function bilibiliCookiePath(config:Config):string{return config.cookiesFile??join(config.dataDir,'bilibili-cookies.txt');}
export function availableBilibiliCookies(config:Config):string|undefined{
  const path=bilibiliCookiePath(config);return config.cookiesFile||existsSync(path)?path:undefined;
}
export async function bilibiliSessionVersion(config:Config):Promise<string|null>{
  const path=availableBilibiliCookies(config);if(!path)return null;
  const content=await readFile(path,'utf8').catch(()=>'');
  const session=content.split(/\r?\n/).map(line=>line.split('\t')).find(fields=>fields.length>=7&&fields[5]==='SESSDATA');
  if(!session?.[6])return null;
  return createHash('sha256').update(session[6]).digest('hex');
}
export function bilibiliCookies(cookies:Cookie[]):Cookie[]{
  return cookies.filter(cookie=>cookie.domain.replace(/^\./,'')==='bilibili.com'||cookie.domain.endsWith('.bilibili.com'));
}
export function authenticatedBilibiliCookies(cookies:Cookie[]):boolean{
  const valid=bilibiliCookies(cookies).filter(c=>c.expires<=0||c.expires>Date.now()/1000);
  return ['SESSDATA','DedeUserID'].every(name=>valid.some(c=>c.name===name&&!!c.value));
}
export function netscapeBilibiliCookies(cookies:Cookie[]):string{
  return '# Netscape HTTP Cookie File\n# Project Bilibili session; keep private.\n'+bilibiliCookies(cookies).map(cookie=>{
    const domain=(cookie.httpOnly?'#HttpOnly_':'')+cookie.domain;
    return [domain,cookie.domain.startsWith('.')?'TRUE':'FALSE',cookie.path,cookie.secure?'TRUE':'FALSE',Math.max(0,Math.floor(cookie.expires)),cookie.name,cookie.value]
      .map(value=>String(value).replace(/[\r\n\t]/g,'')).join('\t');
  }).join('\n')+'\n';
}
