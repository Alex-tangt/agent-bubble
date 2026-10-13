import {mkdir} from 'node:fs/promises';
import {chromium,type BrowserContext} from 'playwright';
import type {Config} from './config.js';
import {publicUrl} from './network.js';
import {articleSelectors,type ArticlePage} from './articles.js';
import {SourceUnavailable} from './types.js';
import {ElectronArticleBrowser} from './article-electron-browser.js';

export type ArticleLoginSite='zhihu'|'wechat';
export type ArticleLoginStatus={enabled:boolean;state:'idle'|'opening'|'waiting'|'closing';site:ArticleLoginSite|null;lastClosedAt:string|null};
const loginUrls:Record<ArticleLoginSite,string>={zhihu:'https://www.zhihu.com/signin',wechat:'https://mp.weixin.qq.com/s/bb5MPl205ZMWu41v0nc63Q'};

export function browserEnvironment():NodeJS.ProcessEnv {
 const env={...process.env};delete env.DEEPSEEK_API_KEY;delete env.AGENT_BUBBLE_TOKEN;delete env.DASHSCOPE_API_KEY;delete env.MEMORY_BASE_TOKEN;return env;
}
export class ArticleBrowser {
 private context?:Promise<BrowserContext>;
 private closed=false;
 private login:ArticleLoginStatus={enabled:true,state:'idle',site:null,lastClosedAt:null};
 private loginContext?:BrowserContext;
 private loginOpening?:Promise<void>;
 private loginClosing?:Promise<void>;
 private electron?:ElectronArticleBrowser;
 constructor(private config:NonNullable<Config['articleBrowser']>){
  if(config.zhihuEngine==='electron')this.electron=new ElectronArticleBrowser({profileDir:config.electronProfileDir??config.profileDir+'-electron',timeoutMs:config.timeoutMs,executable:config.electronExecutable});
 }
 loginStatus():ArticleLoginStatus{
  const status=this.electron?.loginStatus();
  if(status&&status.state!=='idle')return status;
  const lastClosedAt=[this.login.lastClosedAt,status?.lastClosedAt].filter((v):v is string=>!!v).sort().at(-1)??null;
  return {...this.login,lastClosedAt};
 }
 private async release():Promise<void>{const pending=this.context;this.context=undefined;if(pending)await pending.then(c=>c.close()).catch(()=>{});}
 async openLogin(site:ArticleLoginSite,onClosed:()=>void):Promise<ArticleLoginStatus>{
  if(this.closed)throw new SourceUnavailable('文章浏览器已关闭','READER_UNAVAILABLE');
  if(this.loginStatus().state!=='idle'){await this.loginOpening;return this.loginStatus();}
  if(site==='zhihu'&&this.electron){await this.release();return this.electron.openLogin(onClosed);}
  if(this.login.state!=='idle'){await this.loginOpening;return this.loginStatus();}
  this.login={...this.login,state:'opening',site};
  this.loginOpening=(async()=>{
   await this.release();await mkdir(this.config.profileDir,{recursive:true});
   const context=await chromium.launchPersistentContext(this.config.profileDir,{headless:false,channel:this.config.channel==='chromium'?undefined:this.config.channel,locale:'zh-CN',env:browserEnvironment()});
   this.loginContext=context;
   context.once('close',()=>{
    this.loginClosing=(async()=>{
     await context.browser()?.close().catch(()=>{});
     if(this.loginContext!==context)return;
     this.loginContext=undefined;this.login={...this.login,state:'idle',lastClosedAt:new Date().toISOString()};onClosed();
    })();
   });
   if(this.closed){await context.close();throw new SourceUnavailable('文章浏览器已关闭','READER_UNAVAILABLE');}
   const page=context.pages()[0]??await context.newPage();
   this.login.state='waiting';
   void page.goto(loginUrls[site],{waitUntil:'domcontentloaded',timeout:this.config.timeoutMs}).catch(()=>{});
   await page.bringToFront().catch(()=>{});
  })();
  try {await this.loginOpening;return this.loginStatus();}
  catch(error){await this.loginContext?.close().catch(()=>{});await this.loginClosing;this.login.state='idle';onClosed();if(error instanceof SourceUnavailable)throw error;throw new SourceUnavailable('无法打开登录窗口，请检查浏览器安装，或关闭已占用专用浏览器的窗口后重试','READER_UNAVAILABLE');}
  finally {this.loginOpening=undefined;}
 }
 async finishLogin():Promise<ArticleLoginStatus>{
  if(this.electron&&this.electron.loginStatus().state!=='idle')await this.electron.finishLogin();
  await this.loginOpening?.catch(()=>{});
  if(this.loginContext){this.login.state='closing';await this.loginContext.close();await this.loginClosing;}
  return this.loginStatus();
 }
 private async open():Promise<BrowserContext> {
  if(this.closed) throw new SourceUnavailable('文章浏览器已关闭','READER_UNAVAILABLE');
  if(this.login.state!=='idle')throw new SourceUnavailable('正在等待网站登录，请完成后关闭登录窗口再重试','LOGIN_IN_PROGRESS');
  if(!this.context) this.context=(async()=>{
   await mkdir(this.config.profileDir,{recursive:true});
   const context=await chromium.launchPersistentContext(this.config.profileDir,{headless:this.config.headless,
    channel:this.config.channel==='chromium'?undefined:this.config.channel,locale:'zh-CN',serviceWorkers:'block',env:browserEnvironment()});
   const hosts=new Map<string,Promise<void>>();
   await context.route('**/*',async route=>{
    const request=route.request();
    if(['image','media','font'].includes(request.resourceType())) return route.abort();
    try {
     const url=new URL(request.url());
     const key=url.origin;
     let allowed=hosts.get(key);if(!allowed){allowed=publicUrl(url.href).then(()=>{});hosts.set(key,allowed);}
     await allowed;await route.continue();
    } catch {await route.abort().catch(()=>{});}
   });
   return context;
  })().catch(error=>{this.context=undefined;throw new SourceUnavailable(/in use|ProcessSingleton|SingletonLock|profile.*use/i.test(String(error))?'专用浏览器正在使用，请关闭配置窗口后重试':'无法启动文章浏览器，请检查浏览器安装与服务配置','READER_UNAVAILABLE');});
  return this.context;
 }
 async read(url:string,signal?:AbortSignal):Promise<ArticlePage> {
  await publicUrl(url);signal?.throwIfAborted();
  if(this.loginStatus().state!=='idle')throw new SourceUnavailable('正在等待网站登录，请关闭登录窗口后重试','LOGIN_IN_PROGRESS');
  if(this.electron&&(new URL(url).hostname==='zhihu.com'||new URL(url).hostname.endsWith('.zhihu.com')))return this.electron.read(url,signal);
  const context=await this.open();signal?.throwIfAborted();
  const page=await context.newPage();
  const abort=()=>{void page.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try {
   let response;
   try {response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:this.config.timeoutMs});}
   catch(error){signal?.throwIfAborted();if(page.url()==='about:blank') throw new SourceUnavailable('文章页面加载超时，请稍后重试','FETCH_TIMEOUT');}
   // A login suggestion may cover an otherwise public article. Never click verification controls.
   const close=page.locator('.Modal-wrapper .Modal-closeButton');
   if(await close.count()) await close.first().click({timeout:1500}).catch(()=>{});
   if((response?.status()??200)<400) {
    await page.waitForFunction(selectors=>Array.from(document.querySelectorAll(selectors)).some(n=>(n.textContent?.trim().length??0)>=120),articleSelectors,{timeout:10000}).catch(()=>{});
    // Article components can expose a partial DOM before their remaining data arrives.
    await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
    await page.waitForFunction(selectors=>{
     const root=window as Window&{__agentArticleStability?:{length:number;since:number}};
     const length=Math.max(0,...Array.from(document.querySelectorAll(selectors)).map(n=>n.textContent?.length??0));
     const now=Date.now();const previous=root.__agentArticleStability;
     if(!previous||previous.length!==length){root.__agentArticleStability={length,since:now};return false;}
     return length>=120&&now-previous.since>=1200;
    },articleSelectors,{timeout:12000,polling:150}).catch(()=>{});
   }
   signal?.throwIfAborted();
   await publicUrl(page.url());
   const html=await page.content();
   if(Buffer.byteLength(html)>5000000) throw new SourceUnavailable('页面超过文章读取范围','CONTENT_TOO_LARGE');
   return {text:html,url:page.url(),contentType:'text/html'};
  } finally {signal?.removeEventListener('abort',abort);await page.close().catch(()=>{});}
 }
 async close():Promise<void>{this.closed=true;await this.finishLogin();await this.release();await this.electron?.close();}
}
