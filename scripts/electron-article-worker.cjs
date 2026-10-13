// App-owned reading browser. Remote pages have no Node access or application IPC.
const {app,BrowserWindow}=require('electron');
const {createInterface}=require('node:readline');
const {createConnection}=require('node:net');
const path=require('node:path');
const profile=process.argv[2];
if(!profile||!path.isAbsolute(profile))process.exit(1);
app.setPath('userData',profile);
const port=Number(process.argv[3]);const nonce=process.argv[4];
if(!Number.isInteger(port)||port<1||port>65535||!nonce)process.exit(1);
const channel=createConnection({host:'127.0.0.1',port});
const send=value=>channel.write(JSON.stringify(value)+'\n');
const windows=new Map();const checks=new Map();let loginWindow;let checkId=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function destroyAll(){for(const win of windows.values())if(!win.isDestroyed())win.destroy();if(loginWindow&&!loginWindow.isDestroyed())loginWindow.destroy();}
app.on('window-all-closed',()=>{});
channel.once('error',()=>{destroyAll();app.exit(1);});
channel.once('close',()=>{destroyAll();app.exit(0);});
function makeWindow(show){
 const win=new BrowserWindow({show,width:1100,height:800,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));return win;
}
// Only title, article container, and error text cross the process boundary.
const articleScript=`(()=>{
 const node=document.querySelector('.Post-RichTextContainer .RichText,.RichText.ztext');
 const title=document.querySelector('h1')?.textContent||document.title;
 const escape=value=>value.replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
 const bodyText=(document.body?.innerText||'').slice(0,6000);
 return {url:location.href,length:node?.textContent?.trim().length||0,
 html:'<!doctype html><html><head><title>'+escape(title)+'</title></head><body><h1>'+escape(title)+'</h1>'+(node?node.outerHTML:'<p>'+escape(bodyText)+'</p>')+'</body></html>',
 unavailable:!node&&(/40362|您当前请求存在异常|暂时限制本次访问|完成验证后|安全验证|验证码|请先登录|登录后.*(?:查看|阅读)/.test(bodyText)||/\\/(?:signin|login)/.test(location.pathname))};
})()`;
async function read(message){
 const win=makeWindow(false);windows.set(message.id,win);
 const deadline=Date.now()+Math.min(Math.max(message.timeoutMs||60000,1000),120000);
 let latest,lastLength=-1,stableSince=Date.now();
 const remaining=()=>Math.max(1,deadline-Date.now());
 async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{reason:'FETCH_TIMEOUT'})),remaining());})]);}finally{clearTimeout(timer);}}
 try{
  const url=new URL(message.url);
  if(url.protocol!=='https:'||!(url.hostname==='zhihu.com'||url.hostname.endsWith('.zhihu.com')))throw Object.assign(new Error('unsupported'),{reason:'UNSUPPORTED_CONTENT'});
  // Loading and JS execution share one deadline. Ads cannot keep the worker alive forever.
  await bounded(win.loadURL(url.href).catch(()=>{}));
  while(Date.now()<deadline&&!win.isDestroyed()){
   latest=await bounded(win.webContents.executeJavaScript(articleScript));
   if(Buffer.byteLength(latest.html)>5000000)throw Object.assign(new Error('large'),{reason:'CONTENT_TOO_LARGE'});
   if(latest.unavailable)break;
   if(latest.length!==lastLength){lastLength=latest.length;stableSince=Date.now();}
   if(latest.length>=120&&Date.now()-stableSince>=1200)break;
   await sleep(Math.min(350,remaining()));
  }
  if(!latest)throw Object.assign(new Error('timeout'),{reason:'FETCH_TIMEOUT'});
  if(latest.length<120&&!latest.unavailable)throw Object.assign(new Error('missing'),{reason:'CONTENT_UNAVAILABLE'});
  send({id:message.id,ok:true,page:{url:latest.url,text:latest.html,contentType:'text/html'}});
 }finally{windows.delete(message.id);if(!win.isDestroyed())win.destroy();}
}
async function command(message){
 if(message.command==='allow_url'){
  const check=checks.get(message.checkId);if(check){checks.delete(message.checkId);clearTimeout(check.timer);check.callback({cancel:!message.allowed});}return;
 }
 if(message.command==='cancel'){const win=windows.get(message.targetId);if(win&&!win.isDestroyed())win.destroy();return;}
 try{
  if(message.command==='read')return await read(message);
  if(message.command==='login'){
   if(!loginWindow||loginWindow.isDestroyed()){
    loginWindow=makeWindow(true);
    loginWindow.once('closed',()=>{loginWindow=undefined;send({event:'login_closed'});});
    void loginWindow.loadURL('https://www.zhihu.com/signin').catch(()=>{});
   }
   loginWindow.show();loginWindow.focus();send({id:message.id,ok:true});return;
  }
  if(message.command==='finish_login'){if(loginWindow&&!loginWindow.isDestroyed())loginWindow.destroy();send({id:message.id,ok:true});return;}
  if(message.command==='close'){destroyAll();send({id:message.id,ok:true});setImmediate(()=>app.exit(0));return;}
  throw Object.assign(new Error('unsupported'),{reason:'READER_UNAVAILABLE'});
 }catch(error){send({id:message.id,ok:false,reason:error.reason||'READER_UNAVAILABLE'});}
}
app.whenReady().then(()=>{
 if(!app.requestSingleInstanceLock()){send({event:'fatal',nonce,reason:'PROFILE_IN_USE'});setImmediate(()=>app.exit(1));return;}
 const session=require('electron').session.defaultSession;
 session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 session.setPermissionCheckHandler(()=>false);
 session.webRequest.onBeforeRequest((details,callback)=>{
  if(!/^https?:\/\//i.test(details.url)){callback({cancel:true});return;}
  const id=++checkId;
  const timer=setTimeout(()=>{const check=checks.get(id);if(check){checks.delete(id);check.callback({cancel:true});}},10000);
  checks.set(id,{callback,timer});send({event:'check_url',checkId:id,url:details.url});
 });
 session.on('will-download',event=>event.preventDefault());
 const input=createInterface({input:channel});
 input.on('line',line=>{try{const message=JSON.parse(line);void command(message);}catch{}});
 send({event:'ready',nonce,electron:process.versions.electron,chromium:process.versions.chrome});
});
