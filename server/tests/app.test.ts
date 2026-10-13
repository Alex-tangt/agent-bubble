import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AgentBackend,AgentRunInput } from '../agent.js';
import { SourceUnavailable, type Task, type TaskInput } from '../types.js';
import { SourceRepository } from '../sources.js';
import type {ArticleLoginSite,ArticleLoginStatus} from '../article-browser.js';

class LoginSource extends SourceRepository {
  launches=0;
  protected login:ArticleLoginStatus={enabled:true,state:'idle',site:null,lastClosedAt:null};
  private afterClose?:()=>void;
  override loginStatus():ArticleLoginStatus{return {...this.login};}
  override async openLogin(site:ArticleLoginSite,onClosed:()=>void):Promise<ArticleLoginStatus>{
    if(this.login.state==='idle'){this.launches++;this.login={...this.login,state:'waiting',site};this.afterClose=onClosed;}
    return this.loginStatus();
  }
  userClosesWindow():void{this.login={...this.login,state:'idle',lastClosedAt:new Date().toISOString()};const callback=this.afterClose;this.afterClose=undefined;callback?.();}
  override async finishLogin():Promise<ArticleLoginStatus>{this.userClosesWindow();return this.loginStatus();}
  override async close():Promise<void>{this.userClosesWindow();await super.close();}
}

const config = (dataDir: string): Config => ({ dataDir,host:'127.0.0.1',port:0,token:'test-token-for-local-tests-only-12345',apiKey:'test-provider-key',
  model:'deepseek-flash',baseUrl:'https://api.deepseek.com/v1',ytDlpCommand:'yt-dlp',maxRunMs:30000 });
const headers = {authorization:'Bearer test-token-for-local-tests-only-12345'};
const payload = (value = '正文说明第一阶段研究，第二阶段实现，第三阶段验证。'): TaskInput => ({clientRequestId:randomUUID(),message:'请总结',source:{kind:'text',value}});
const instant: AgentBackend = {run:async input => ({text:'来自真实输入：' + input.source.text,usage:{input:1,output:1,total:2}})};
async function fixture(agent = instant,sourcesFactory?: (cfg:Config) => SourceRepository) {
  const directory = await mkdtemp(join(tmpdir(),'agent-bubble-test-'));
  const cfg = config(directory);
  const instance = createApp(cfg,agent,sourcesFactory?.(cfg));
  return {...instance,cfg,async cleanup(){ await instance.app.close(); assert.ok(directory.startsWith(join(tmpdir(),'agent-bubble-test-'))); await rm(directory,{recursive:true,force:true}); }};
}
async function terminal(app:ReturnType<typeof createApp>['app'],id:string): Promise<Task> {
  for(let i=0;i<200;i++) {
    const task = (await app.inject({url:'/api/tasks/' + id,headers})).json<Task>();
    if(!['queued','running'].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve,10));
  }
  throw new Error('Task did not settle');
}

test('API requires connection token, validates input, and never returns provider credentials',async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject('/api/conversations')).statusCode,401);
    assert.equal((await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:'short',message:'x'}})).statusCode,400);
    const health = await f.app.inject({url:'/api/health',headers});
    assert.equal(health.statusCode,200);
    assert.ok(!health.body.includes(f.cfg.apiKey));
    assert.ok(!health.body.includes('apiKey'));
  } finally { await f.cleanup(); }
});

test('durable receipt and retry deduplication survive a service restart',async () => {
  const f = await fixture();
  let second:ReturnType<typeof createApp> | undefined;
  try {
    const input = payload();
    const response = await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:input});
    assert.equal(response.statusCode,202);
    const task = await terminal(f.app,response.json<Task>().id);
    assert.equal(task.status,'completed');
    await f.app.close();
    second = createApp(f.cfg,instant);
    const retry = await second.app.inject({method:'POST',url:'/api/tasks',headers,payload:input});
    assert.equal(retry.statusCode,200);
    assert.equal(retry.json<Task>().id,task.id);
    assert.equal(retry.json<Task>().result,task.result);
    assert.equal((await second.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...input,message:'changed'}})).statusCode,409);
    const conversations = (await second.app.inject({url:'/api/conversations',headers})).json();
    assert.equal(conversations.length,1);
    assert.equal(conversations[0].sessionFile,undefined);
    assert.equal(conversations[0].sourceInput,undefined);
  } finally {
    await second?.app.close();
    assert.ok(f.cfg.dataDir.startsWith(join(tmpdir(),'agent-bubble-test-')));
    await rm(f.cfg.dataDir,{recursive:true,force:true});
  }
});

test('accepted task runs independently after the HTTP client disconnects',async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const agent:AgentBackend = {run:async () => { await gate; return {text:'后台完成',usage:{input:1,output:1,total:2}}; }};
  const f = await fixture(agent);
  try {
    const address = await f.app.listen({host:'127.0.0.1',port:0});
    const response = await fetch(address + '/api/tasks',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(payload())});
    assert.equal(response.status,202);
    const accepted = await response.json() as Task;
    const controller = new AbortController();
    const stream = await fetch(address + '/api/tasks/' + accepted.id + '/events',{headers,signal:controller.signal});
    await stream.body!.getReader().read();
    controller.abort();
    assert.equal(f.store.getTask(accepted.id)?.status,'running');
    release();
    assert.equal((await terminal(f.app,accepted.id)).result,'后台完成');
  } finally { release(); await f.cleanup(); }
});

test('same conversation follow-ups run in order and reuse cached content',async () => {
  let active = 0, maxActive = 0;
  const calls:string[] = [];
  const agent:AgentBackend = {run:async input => {
    active++; maxActive = Math.max(maxActive,active); calls.push(input.message);
    await new Promise(resolve => setTimeout(resolve,20)); active--;
    return {text:input.message,usage:{input:1,output:1,total:2}};
  }};
  const f = await fixture(agent);
  try {
    const first = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),message:'first'}})).json<Task>();
    const second = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'second'}})).json<Task>();
    await terminal(f.app,second.id);
    assert.deepEqual(calls,['first','second']); assert.equal(maxActive,1);
    const thread = (await f.app.inject({url:'/api/conversations/' + first.conversationId,headers})).json();
    assert.equal(thread.tasks.length,2); assert.equal(thread.source.method,'shared_text');
  } finally { await f.cleanup(); }
});

test('a video awaiting transcription does not block an independent reading task',async()=>{
  let started!:()=>void,release!:()=>void;
  const videoStarted=new Promise<void>(resolve=>{started=resolve;});
  const videoGate=new Promise<void>(resolve=>{release=resolve;});
  class SlowVideoSource extends SourceRepository {
    override async acquire(input:Parameters<SourceRepository['acquire']>[0],signal?:AbortSignal){
      if(input.kind==='url'){
        started();await videoGate;signal?.throwIfAborted();
        return super.acquire({kind:'transcript',value:'视频已经完整转写。'},signal);
      }
      return super.acquire(input,signal);
    }
  }
  const f=await fixture(instant,cfg=>new SlowVideoSource(cfg));
  try{
    const video=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),source:{kind:'url',value:'https://www.bilibili.com/video/BV1t2HQ6EEaD'}}})).json<Task>();
    await videoStarted;
    const article=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload('另一篇文章应在视频完成前总结。')})).json<Task>();
    // This must finish while the ASR gate remains closed, rather than after video release.
    assert.equal((await terminal(f.app,article.id)).status,'completed');
    assert.equal(f.store.getTask(video.id)?.status,'running');
  }finally{release();await f.cleanup();}
});

test('only one video acquisition runs at a time, and a queued video does not hold up other conversations',async()=>{
  let release!:()=>void,started!:()=>void,videoCalls=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const firstStarted=new Promise<void>(resolve=>{started=resolve;});
  class VideoQueueSource extends SourceRepository {
    override async acquire(input:Parameters<SourceRepository['acquire']>[0],signal?:AbortSignal){
      if(input.kind==='url'){
        videoCalls++;started();await gate;signal?.throwIfAborted();
        return super.acquire({kind:'transcript',value:input.value},signal);
      }
      return super.acquire(input,signal);
    }
  }
  const f=await fixture(instant,cfg=>new VideoQueueSource(cfg));
  try{
    await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),source:{kind:'url',value:'https://www.bilibili.com/video/BV1t2HQ6EEaD'}}});
    await firstStarted;
    const second=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),source:{kind:'url',value:'https://www.bilibili.com/video/BV1jXHC6GEke'}}})).json<Task>();
    const article=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload('排在第二个视频后面的文章。')})).json<Task>();
    assert.equal((await terminal(f.app,article.id)).status,'completed');
    assert.equal(videoCalls,1);assert.equal(f.store.getTask(second.id)?.status,'queued');
    release();assert.equal((await terminal(f.app,second.id)).status,'completed');assert.equal(videoCalls,2);
  }finally{release();await f.cleanup();}
});

test('cancelling one concurrent task does not cancel another, and shutdown aborts all remaining runs',async()=>{
  const started=new Set<string>();
  const f=await fixture({run:async input=>{
    started.add(input.message);
    await new Promise<void>((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    return {text:'unreachable',usage:{input:0,output:0,total:0}};
  }});
  try{
    const tasks:Task[]=[];
    for(const message of ['one','two','three'])tasks.push((await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),message}})).json<Task>());
    for(let i=0;i<100&&started.size<3;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(started.size,3);
    await f.app.inject({method:'POST',url:'/api/tasks/'+tasks[0]!.id+'/cancel',headers,payload:{}});
    assert.equal((await terminal(f.app,tasks[0]!.id)).status,'cancelled');
    assert.equal(f.store.getTask(tasks[1]!.id)?.status,'running');
    await f.runner.close();
    assert.equal(f.store.getTask(tasks[1]!.id)?.status,'interrupted');assert.equal(f.store.getTask(tasks[2]!.id)?.status,'interrupted');
  }finally{await f.cleanup();}
});

test('cancel stops the active run, preserves old results, and cancelled queued tasks never run',async () => {
  const seen:string[] = [];
  const agent:AgentBackend = {run:async input => {
    seen.push(input.message);
    if(input.message !== 'initial') await new Promise<void>((_resolve,reject) => {
      input.signal.addEventListener('abort',() => reject(new Error('aborted')),{once:true});
    });
    return {text:'原结果',usage:{input:1,output:1,total:2}};
  }};
  const f = await fixture(agent);
  try {
    const first = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),message:'initial'}})).json<Task>();
    await terminal(f.app,first.id);
    const active = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'active'}})).json<Task>();
    while(!seen.includes('active')) await new Promise(resolve => setTimeout(resolve,5));
    const queued = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'queued'}})).json<Task>();
    await f.app.inject({method:'POST',url:'/api/tasks/' + queued.id + '/cancel',headers,payload:{}});
    await f.app.inject({method:'POST',url:'/api/tasks/' + active.id + '/cancel',headers,payload:{}});
    assert.equal((await terminal(f.app,active.id)).status,'cancelled');
    assert.equal(f.store.getTask(first.id)?.result,'原结果');
    assert.equal(f.store.getTask(queued.id)?.status,'cancelled'); assert.deepEqual(seen,['initial','active']);
  } finally { await f.cleanup(); }
});

test('missing subtitles request more input before LLM calls; supplement continues the same conversation',async () => {
  class MissingSource extends SourceRepository {
    override async acquire(input:Parameters<SourceRepository['acquire']>[0],signal?:AbortSignal) {
      if(input.kind === 'url') throw new SourceUnavailable('需要字幕或登录');
      return super.acquire(input,signal);
    }
  }
  let calls = 0;
  const agent:AgentBackend = {run:async input => { calls++; return instant.run(input); }};
  const f = await fixture(agent,cfg => new MissingSource(cfg));
  try {
    const first = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),source:{kind:'url',value:'https://www.bilibili.com/video/BV1example/'}}})).json<Task>();
    assert.equal((await terminal(f.app,first.id)).status,'needs_input'); assert.equal(calls,0);
    const second = (await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'总结补充字幕',source:{kind:'transcript',value:'1\n00:00:03,000 --> 00:00:06,000\n今天讨论后台任务。'}}})).json<Task>();
    assert.equal((await terminal(f.app,second.id)).status,'completed'); assert.equal(calls,1);
    assert.equal(second.conversationId,first.conversationId);
    assert.ok(f.store.getTask(second.id)?.result?.includes('[0:03]'));
    const thread = (await f.app.inject({url:'/api/conversations/' + second.conversationId,headers})).json();
    assert.equal(thread.source.url,'https://www.bilibili.com/video/BV1example/');
  } finally { await f.cleanup(); }
});

test('queued receipts resume and running work becomes interrupted on restart',async () => {
  const f = await fixture();
  let next:ReturnType<typeof createApp> | undefined;
  try {
    const queued = f.store.submit(payload()).task;
    const active = f.store.submit(payload('other')).task;
    f.store.updateTask(active.id,{status:'running'});
    await f.app.close();
    next = createApp(f.cfg,instant);
    assert.equal(next.store.getTask(active.id)?.status,'interrupted');
    await next.app.ready();
    assert.equal((await terminal(next.app,queued.id)).status,'completed');
  } finally {
    await next?.app.close();
    assert.ok(f.cfg.dataDir.startsWith(join(tmpdir(),'agent-bubble-test-')));
    await rm(f.cfg.dataDir,{recursive:true,force:true});
  }
});

test('access verification stops before the model and its error code survives restart',async()=>{
  class VerificationSource extends SourceRepository {
    override async acquire():Promise<never>{throw new SourceUnavailable('请完成来源访问验证','VERIFICATION_REQUIRED');}
  }
  let calls=0;
  const f=await fixture({run:async input=>{calls++;return instant.run(input);}},cfg=>new VerificationSource(cfg));
  let next:ReturnType<typeof createApp>|undefined;
  try {
    const receipt=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),source:{kind:'url',value:'https://mp.weixin.qq.com/s/example'}}})).json<Task>();
    const failed=await terminal(f.app,receipt.id);
    assert.equal(failed.status,'needs_input');assert.equal(failed.errorCode,'VERIFICATION_REQUIRED');assert.equal(calls,0);
    await f.app.close();next=createApp(f.cfg,instant);
    assert.equal(next.store.getTask(receipt.id)?.errorCode,'VERIFICATION_REQUIRED');
    const retry=(await next.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:receipt.conversationId,message:'完成验证后重试',source:{kind:'text',value:'正文已经取得，完整工作流可以继续总结。'}}})).json<Task>();
    assert.equal((await terminal(next.app,retry.id)).status,'completed');assert.equal(retry.conversationId,receipt.conversationId);
  } finally {await next?.app.close();assert.ok(f.cfg.dataDir.startsWith(join(tmpdir(),'agent-bubble-test-')));await rm(f.cfg.dataDir,{recursive:true,force:true});}
});
test('temporary source failure remains retryable in its conversation without calling the model',async()=>{
 class TemporarySource extends SourceRepository {
  attempts=0;
  override async acquire(input:Parameters<SourceRepository['acquire']>[0],signal?:AbortSignal) {
   if(++this.attempts===1) throw new SourceUnavailable('来源连接暂时失败','HTTP_TRANSIENT');
   return super.acquire(input,signal);
  }
 }
 let calls=0;
 const f=await fixture({run:async input=>{calls++;return instant.run(input);}},cfg=>new TemporarySource(cfg));
 try {
  const receipt=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload()})).json<Task>();
  const failed=await terminal(f.app,receipt.id);
  assert.equal(failed.status,'failed');assert.equal(failed.errorCode,'HTTP_TRANSIENT');assert.equal(calls,0);
  const retry=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:receipt.conversationId,message:'重试'}})).json<Task>();
  assert.equal((await terminal(f.app,retry.id)).status,'completed');assert.equal(calls,1);assert.equal(retry.conversationId,receipt.conversationId);
 } finally {await f.cleanup();}
});
test('website login controls require authorization and accept only supported sites',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.app.inject('/api/article-browser/login')).statusCode,401);
    assert.equal((await f.app.inject({method:'POST',url:'/api/article-browser/login',payload:{site:'zhihu'}})).statusCode,401);
    assert.equal((await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'https://arbitrary.example'}})).statusCode,400);
    assert.equal((await f.app.inject({url:'/api/article-browser/login',headers})).json().enabled,false);
    assert.equal(f.runner.waitingForLogin,false);
  } finally {await f.cleanup();}
});
test('login pauses accepted work, repeated open is idempotent, and finish resumes the queue',async()=>{
  let calls=0;let reader!:LoginSource;
  const f=await fixture({run:async input=>{calls++;return instant.run(input);}},cfg=>(reader=new LoginSource(cfg)));
  try {
    const opened=await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'zhihu'}});
    assert.equal(opened.statusCode,200);assert.equal(opened.json().state,'waiting');assert.equal(opened.json().tasksPaused,true);
    await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'zhihu'}});assert.equal(reader.launches,1);
    const receipt=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload()})).json<Task>();
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.store.getTask(receipt.id)?.status,'queued');assert.equal(calls,0);
    const closed=(await f.app.inject({method:'POST',url:'/api/article-browser/login/finish',headers,payload:{}})).json();
    assert.equal(closed.state,'idle');assert.equal(closed.tasksPaused,false);assert.ok(closed.lastClosedAt);
    assert.equal((await terminal(f.app,receipt.id)).status,'completed');assert.equal(calls,1);
  } finally {await f.cleanup();}
});
test('closing the native login window resumes work without a finish request',async()=>{
  let reader!:LoginSource;
  const f=await fixture(instant,cfg=>(reader=new LoginSource(cfg)));
  try {
    await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'wechat'}});
    const receipt=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload()})).json<Task>();
    reader.userClosesWindow();assert.equal((await terminal(f.app,receipt.id)).status,'completed');assert.equal(f.runner.waitingForLogin,false);
  } finally {await f.cleanup();}
});
test('website login cannot interrupt active work and launch failure cannot leave the queue paused',async()=>{
  let release!:()=>void;let started=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const f=await fixture({run:async input=>{started=true;await gate;return instant.run(input);}});
  try {
    const receipt=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload()})).json<Task>();
    while(!started)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal((await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'zhihu'}})).statusCode,409);
    assert.equal(f.store.getTask(receipt.id)?.status,'running');release();assert.equal((await terminal(f.app,receipt.id)).status,'completed');
    const failed=await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'zhihu'}});
    assert.equal(failed.statusCode,422);assert.equal(f.runner.waitingForLogin,false);
    const next=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:payload()})).json<Task>();
    assert.equal((await terminal(f.app,next.id)).status,'completed');
  } finally {release();await f.cleanup();}
});
test('expired access stops before the model, and renewed login retries the original conversation',async()=>{
  class ExpiredSource extends LoginSource {
    valid=false;
    override userClosesWindow():void{this.valid=true;super.userClosesWindow();}
    override async acquire(input:Parameters<SourceRepository['acquire']>[0],signal?:AbortSignal){
      if(input.kind==='url'&&!this.valid)throw new SourceUnavailable('来源要求重新登录','AUTH_REQUIRED');
      return super.acquire(input.kind==='url'?{kind:'text',title:'登录后取得的正文',value:'已登录来源的完整正文，用于验证会话恢复与模型调用边界。',originalUrl:input.value}:input,signal);
    }
  }
  let calls=0;
  const f=await fixture({run:async input=>{calls++;return instant.run(input);}},cfg=>new ExpiredSource(cfg));
  try {
    const receipt=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{...payload(),source:{kind:'url',value:'https://zhuanlan.zhihu.com/p/example'}}})).json<Task>();
    const first=await terminal(f.app,receipt.id);assert.equal(first.errorCode,'AUTH_REQUIRED');assert.equal(first.status,'needs_input');assert.equal(calls,0);
    assert.equal((await f.app.inject({url:'/api/conversations/'+receipt.conversationId,headers})).json().loginSite,'zhihu');
    await f.app.inject({method:'POST',url:'/api/article-browser/login',headers,payload:{site:'zhihu'}});
    const retry=(await f.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:receipt.conversationId,message:'登录后重试原链接'}})).json<Task>();
    assert.equal(retry.status,'queued');await f.app.inject({method:'POST',url:'/api/article-browser/login/finish',headers,payload:{}});
    assert.equal((await terminal(f.app,retry.id)).status,'completed');assert.equal(retry.conversationId,receipt.conversationId);assert.equal(calls,1);
    assert.equal(f.store.getTask(receipt.id)?.errorCode,'AUTH_REQUIRED');
  } finally {await f.cleanup();}
});
