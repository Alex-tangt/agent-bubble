import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {loadConfig} from '../server/config.js';
import {browserEnvironment} from '../server/article-browser.js';
import {authenticatedBilibiliCookies,bilibiliCookiePath,netscapeBilibiliCookies} from '../server/bilibili-session.js';
import {safeError} from '../server/runner.js';

const config=loadConfig();
const statusPath=join(config.dataDir,'bilibili-login.json'),finishPath=join(config.dataDir,'bilibili-login.finish');
const readStatus=async()=>JSON.parse(await readFile(statusPath,'utf8').catch(()=>'{"state":"idle"}'));
async function main(){
  await mkdir(config.dataDir,{recursive:true});
  if(process.argv.includes('--status')){console.log(JSON.stringify(await readStatus()));return;}
  if(process.argv.includes('--finish')){await writeFile(finishPath,'finish','utf8');console.log('已请求关闭 B 站登录窗口');return;}
  const previous=await readStatus();
  if(previous.state==='waiting'&&typeof previous.pid==='number'){
    try{process.kill(previous.pid,0);console.log(JSON.stringify(previous));return;}catch{/* Previous helper has stopped. */}
  }
  await rm(finishPath,{force:true});
  const deadlineMs=300000,deadlineAt=new Date(Date.now()+deadlineMs).toISOString();
  const profile=join(config.dataDir,'bilibili-browser');await mkdir(profile,{recursive:true});
  const status={state:'opening',pid:process.pid,deadlineAt,authenticated:false,reason:''};
  const saveStatus=()=>writeFile(statusPath,JSON.stringify(status),'utf8');await saveStatus();
  const context=await chromium.launchPersistentContext(profile,{headless:false,channel:config.articleBrowser?.channel==='chromium'?undefined:config.articleBrowser?.channel??'chrome',locale:'zh-CN',env:browserEnvironment()});
  let ending=false;
  let resolveClosed!:()=>void;const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
  context.once('close',()=>{resolveClosed();});
  const finish=async(reason:string)=>{
    if(ending)return;ending=true;
    status.reason=reason;await context.close().catch(()=>{});resolveClosed();
  };
  const deadline=setTimeout(()=>{void finish('deadline');},deadlineMs);
  let checking=false;
  const poll=setInterval(()=>{void (async()=>{
    if(checking||ending)return;checking=true;
    try{
      if(await readFile(finishPath,'utf8').catch(()=>'')){await finish('cancelled');return;}
      const cookies=await context.cookies();
      if(authenticatedBilibiliCookies(cookies)){
        const path=bilibiliCookiePath(config);await mkdir(join(path,'..'),{recursive:true});
        await writeFile(path+'.tmp',netscapeBilibiliCookies(cookies),{encoding:'utf8',mode:0o600});await rename(path+'.tmp',path);
        status.authenticated=true;await finish('authenticated');
      }
    }catch{/* Closing a window while polling is an ordinary exit. */}finally{checking=false;}
  })();},1000);
  try{
    const page=context.pages()[0]??await context.newPage();
    status.state='waiting';await saveStatus();
    console.log(JSON.stringify({state:status.state,deadlineAt,exit:'Close the window or run npm run bilibili:login -- --finish'}));
    void page.goto('https://passport.bilibili.com/login',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
    await page.bringToFront();await closed;
  }finally{
    clearInterval(poll);clearTimeout(deadline);await context.close().catch(()=>{});
    status.state='idle';status.reason||='window_closed';await saveStatus();await rm(finishPath,{force:true});
    console.log(JSON.stringify({state:'idle',authenticated:status.authenticated,reason:status.reason}));
  }
}
main().catch(async error=>{
  await writeFile(statusPath,JSON.stringify({state:'idle',authenticated:false,reason:'launch_failed'})).catch(()=>{});
  console.error(safeError(error,[config.apiKey,config.token]));process.exitCode=1;
});
