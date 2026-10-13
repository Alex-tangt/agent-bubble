import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import {createServer,type Socket} from 'node:net';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {publicUrl} from './network.js';
import {SourceUnavailable} from './types.js';
import type {ArticlePage} from './articles.js';
import type {ArticleLoginStatus} from './article-browser.js';

type Pending={resolve:(value:WorkerMessage)=>void;reject:(error:unknown)=>void;cleanup:()=>void};
type WorkerMessage={event?:string;id?:number;ok?:boolean;reason?:string;page?:ArticlePage;checkId?:number;url?:string;nonce?:string};
export class ElectronArticleBrowser {
 private child?:ChildProcessWithoutNullStreams;
 private channel?:Socket;
 private opening?:Promise<void>;
 private closed=false;
 private sequence=0;
 private pending=new Map<number,Pending>();
 private login:ArticleLoginStatus={enabled:true,state:'idle',site:null,lastClosedAt:null};
 private loginOpening?:Promise<void>;
 private onLoginClosed?:()=>void;
 constructor(private config:{profileDir:string;timeoutMs:number;executable?:string;workerScript?:string}){}
 loginStatus():ArticleLoginStatus{return {...this.login};}
 private finishState(){
  const callback=this.onLoginClosed;this.onLoginClosed=undefined;
  if(this.login.state!=='idle')this.login={...this.login,state:'idle',lastClosedAt:new Date().toISOString()};
  callback?.();
 }
 private write(message:unknown){if(this.channel?.writable)this.channel.write(JSON.stringify(message)+'\n');}
 private async open():Promise<void>{
  if(this.closed)throw new SourceUnavailable('文章浏览器已关闭','READER_UNAVAILABLE');
  if(this.opening)return this.opening;
  if(this.child)return;
  this.opening=(async()=>{
   await mkdir(this.config.profileDir,{recursive:true});
   let executable=this.config.executable;
   if(!executable){try{executable=createRequire(import.meta.url)('electron') as string;}catch{throw new SourceUnavailable('请运行 npm run browser:install-electron 安装文章浏览器','READER_UNAVAILABLE');}}
   const nonce=randomBytes(32).toString('hex');const server=createServer();
   const hosts=new Map<string,Promise<boolean>>();
   let child:ChildProcessWithoutNullStreams|undefined;
   let readyDone=false,stopped=false;let timer:NodeJS.Timeout|undefined;
   let resolveReady!:()=>void,rejectReady!:(error:unknown)=>void;
   const ready=new Promise<void>((resolveResult,reject)=>{resolveReady=resolveResult;rejectReady=reject;});
   const stop=(error:SourceUnavailable)=>{
    if(stopped)return;stopped=true;clearTimeout(timer);server.close();
    if(!readyDone)rejectReady(error);
    if(child&&this.child===child){this.child=undefined;this.channel?.destroy();this.channel=undefined;this.finishState();
     for(const [id,request] of this.pending){this.pending.delete(id);request.cleanup();request.reject(error);}
    }
   };
   server.on('connection',socket=>{
    let authenticated=false;const output=createInterface({input:socket});
    output.on('error',()=>{if(authenticated)stop(new SourceUnavailable('文章浏览器连接中断，请重试','READER_UNAVAILABLE'));});
    const handshake=setTimeout(()=>socket.destroy(),5000);
    socket.on('error',()=>{if(authenticated)stop(new SourceUnavailable('文章浏览器连接中断，请重试','READER_UNAVAILABLE'));});
    socket.once('close',()=>{clearTimeout(handshake);if(authenticated){stop(new SourceUnavailable('文章浏览器已退出，请重试','READER_UNAVAILABLE'));child?.kill();}});
    output.on('line',line=>{
     if(line.length>6000000){socket.destroy();return;}
     let message:WorkerMessage;try{message=JSON.parse(line) as WorkerMessage;}catch{socket.destroy();return;}
     if(!authenticated){
      const supplied=Buffer.from(message.nonce??''),expected=Buffer.from(nonce);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){socket.destroy();return;}
      authenticated=true;clearTimeout(handshake);this.channel=socket;server.close();
      if(message.event==='fatal'){stop(new SourceUnavailable('专用文章浏览器正在使用，请关闭其窗口后重试','READER_UNAVAILABLE'));return;}
      if(message.event!=='ready'){socket.destroy();return;}
      readyDone=true;clearTimeout(timer);resolveReady();return;
     }
     if(message.event==='login_closed'){this.finishState();return;}
     if(message.event==='check_url'&&message.url){
      let allowed:Promise<boolean>;
      try{const url=new URL(message.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw Error('unsupported');const origin=url.origin;allowed=hosts.get(origin)??publicUrl(origin).then(()=>true,()=>false);hosts.set(origin,allowed);}catch{allowed=Promise.resolve(false);}
      void allowed.then(value=>{if(this.child===child)this.write({command:'allow_url',checkId:message.checkId,allowed:value});});return;
     }
     if(message.id!==undefined){const request=this.pending.get(message.id);if(!request)return;this.pending.delete(message.id);request.cleanup();
      if(message.ok)request.resolve(message);else request.reject(new SourceUnavailable(message.reason==='FETCH_TIMEOUT'?'文章页面加载超时，请稍后重试':message.reason==='CONTENT_TOO_LARGE'?'页面超过文章读取范围':'文章浏览器读取失败，请稍后重试',message.reason??'READER_UNAVAILABLE'));
     }
    });
   });
   await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolveListen();});});
   server.on('error',()=>stop(new SourceUnavailable('文章浏览器连接失败','READER_UNAVAILABLE')));
   const port=(server.address() as {port:number}).port;
   const env={...process.env};delete env.DEEPSEEK_API_KEY;delete env.AGENT_BUBBLE_TOKEN;delete env.DASHSCOPE_API_KEY;delete env.MEMORY_BASE_TOKEN;delete env.ELECTRON_RUN_AS_NODE;
   child=spawn(executable,[this.config.workerScript??resolve('scripts/electron-article-worker.cjs'),this.config.profileDir,String(port),nonce],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
   this.child=child;child.stderr.resume();child.stdout.resume();
   child.once('error',()=>stop(new SourceUnavailable('无法启动文章浏览器，请检查运行时安装','READER_UNAVAILABLE')));
   child.once('exit',()=>stop(new SourceUnavailable('文章浏览器已退出，请重试','READER_UNAVAILABLE')));
   timer=setTimeout(()=>{stop(new SourceUnavailable('文章浏览器启动超时','READER_UNAVAILABLE'));child?.kill();},15000);
   await ready;
  })();
  try{await this.opening;}finally{this.opening=undefined;}
 }
 private async command(command:string,fields:Record<string,unknown>={},signal?:AbortSignal):Promise<WorkerMessage>{
  signal?.throwIfAborted();await this.open();signal?.throwIfAborted();
  const id=++this.sequence;
  return new Promise((resolveResult,reject)=>{
   const cancel=(error:unknown)=>{const request=this.pending.get(id);if(!request)return;this.pending.delete(id);request.cleanup();this.write({command:'cancel',targetId:id});reject(error);};
   const aborted=()=>cancel(signal!.reason);
   const timer=setTimeout(()=>cancel(new SourceUnavailable('文章页面加载超时，请稍后重试','FETCH_TIMEOUT')),command==='read'?this.config.timeoutMs+2000:10000);
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);};
   this.pending.set(id,{resolve:resolveResult,reject,cleanup});signal?.addEventListener('abort',aborted,{once:true});
   this.write({id,command,...fields});
  });
 }
 async read(url:string,signal?:AbortSignal):Promise<ArticlePage>{
  await publicUrl(url);signal?.throwIfAborted();
  if(this.login.state!=='idle')throw new SourceUnavailable('正在等待网站登录，请关闭登录窗口后重试','LOGIN_IN_PROGRESS');
  const result=await this.command('read',{url,timeoutMs:this.config.timeoutMs},signal);
  if(!result.page)throw new SourceUnavailable('文章浏览器没有返回页面','READER_UNAVAILABLE');
  await publicUrl(result.page.url);signal?.throwIfAborted();return result.page;
 }
 async openLogin(onClosed:()=>void):Promise<ArticleLoginStatus>{
  if(this.login.state!=='idle'){await this.loginOpening;return this.loginStatus();}
  this.login={...this.login,state:'opening',site:'zhihu'};this.onLoginClosed=onClosed;
  this.loginOpening=(async()=>{await this.command('login');if(this.login.state==='opening')this.login.state='waiting';})();
  try{await this.loginOpening;return this.loginStatus();}catch(error){this.finishState();throw error;}finally{this.loginOpening=undefined;}
 }
 async finishLogin():Promise<ArticleLoginStatus>{
  await this.loginOpening?.catch(()=>{});
  if(this.login.state!=='idle'){this.login.state='closing';await this.command('finish_login');this.finishState();}
  return this.loginStatus();
 }
 async close():Promise<void>{
  if(this.closed)return;
  await this.opening?.catch(()=>{});const child=this.child;
  if(child){await this.command('close').catch(()=>{});if(child.exitCode===null){await new Promise<void>(resolveDone=>{const timer=setTimeout(()=>{child.kill();resolveDone();},2000);child.once('exit',()=>{clearTimeout(timer);resolveDone();});});}}
  this.closed=true;this.finishState();
 }
}
