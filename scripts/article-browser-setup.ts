import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {loadConfig} from '../server/config.js';
import {ArticleBrowser,browserEnvironment} from '../server/article-browser.js';
const config=loadConfig().articleBrowser!;
if(process.argv.includes('--zhihu')){
 const browser=new ArticleBrowser(config);let closed!:()=>void;
 const finished=new Promise<void>(resolve=>{closed=resolve;});
 try{
  await browser.openLogin('zhihu',closed);
  console.log('Project Zhihu browser opened. Complete login yourself, then close its window. Closing without login also exits.');
  process.once('SIGINT',()=>{void browser.close();});
  await finished;
 }finally{await browser.close();}
 console.log('Project browser closed; access will be checked on the next article request.');
}else{
await mkdir(config.profileDir,{recursive:true});
const context=await chromium.launchPersistentContext(config.profileDir,{headless:false,channel:config.channel==='chromium'?undefined:config.channel,locale:'zh-CN',env:browserEnvironment()});
console.log('Project browser opened. Read the supplied articles; complete any site verification yourself. Close this browser to let the backend reuse its session.');
const urls=['https://mp.weixin.qq.com/s/bb5MPl205ZMWu41v0nc63Q'];
for(const url of urls) {
 const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
}
await new Promise<void>(resolve=>context.once('close',()=>resolve()));
console.log('Project browser closed. Its session is ready for the backend.');
}
