import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z,ZodError } from 'zod';
import type { Config } from './config.js';
import { PiAgent, type AgentBackend } from './agent.js';
import { Store } from './store.js';
import { SourceRepository, sourceSummary } from './sources.js';
import { TaskRunner, safeError } from './runner.js';
import { AppError, taskInputSchema, type TaskEvent } from './types.js';

function authorized(header: string | undefined, token: string): boolean {
  const supplied = Buffer.from(header ?? '');
  const expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && timingSafeEqual(supplied,expected);
}
export function createApp(config: Config,agent: AgentBackend = new PiAgent(config),sources = new SourceRepository(config)) {
  const app = Fastify({bodyLimit:1100000,logger:false,forceCloseConnections:true});
  const store = new Store(config.dataDir);
  const runner = new TaskRunner(store,sources,agent,config);
  app.addHook('onRequest',async (request,reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!authorized(request.headers.authorization,config.token)) return reply.code(401).send({code:'UNAUTHORIZED',message:'连接凭据无效，请检查设置'});
  });
  app.setErrorHandler((error,_request,reply) => {
    if (error instanceof ZodError) return reply.code(400).send({code:'INVALID_INPUT',message:error.issues.map(issue => issue.message).join('；')});
    if (error instanceof AppError) return reply.code(error.statusCode).send({code:error.code,message:error.message});
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({code:'REQUEST_FAILED',message:status === 500 ? '服务处理失败，请稍后重试' : safeError(error,[config.apiKey,config.token,config.qwenAsr?.apiKey??'',config.memoryBase?.token??''])});
  });
  app.get('/health',async () => ({status:'ok',version:'0.1.0'}));
  app.get('/api/health',async () => ({status:'ok',model:config.model,version:'0.1.0',
    memoryBase:{enabled:!!config.memoryBase},
    transcription:{enabled:config.video?.asrEnabled??false,provider:config.video?.asrProvider??'local',model:config.video?.asrProvider==='qwen'?config.qwenAsr?.model:'faster-whisper'}}));
  app.get('/api/article-browser/login',async()=>({...sources.loginStatus(),tasksPaused:runner.waitingForLogin}));
  app.post('/api/article-browser/login',async request=>{
    const {site}=z.object({site:z.enum(['zhihu','wechat'])}).parse(request.body);
    if(!runner.pauseForLogin())throw new AppError('TASKS_BUSY','正在执行任务，请完成后再打开网站登录窗口',409);
    try{return {...await sources.openLogin(site,()=>runner.resumeAfterLogin()),tasksPaused:runner.waitingForLogin};}
    catch(error){runner.resumeAfterLogin();throw error;}
  });
  app.post('/api/article-browser/login/finish',async()=>{
    const status=await sources.finishLogin();runner.resumeAfterLogin();return {...status,tasksPaused:runner.waitingForLogin};
  });
  app.post('/api/tasks',async (request,reply) => {
    const input = taskInputSchema.parse(request.body);
    const accepted = store.submit(input);
    if (accepted.created) runner.kick();
    return reply.code(accepted.created ? 202 : 200).send(accepted.task);
  });
  app.get<{Params:{id:string}}>('/api/tasks/:id',async request => {
    const task = store.getTask(request.params.id);
    if (!task) throw new AppError('NOT_FOUND','任务不存在',404);
    const conversation = store.getConversation(task.conversationId)!;
    const source = conversation.sourceId ? await sources.get(conversation.sourceId) : null;
    return {...task,source:source ? sourceSummary(source) : null,loginSite:sources.loginSite(conversation.sourceInput)};
  });
  app.post<{Params:{id:string}}>('/api/tasks/:id/cancel',async request => {
    const task = runner.cancel(request.params.id);
    if (!task) throw new AppError('NOT_FOUND','任务不存在',404);
    return task;
  });
  app.post<{Params:{id:string}}>('/api/tasks/:id/memory/retry',async request=>runner.retryMemory(request.params.id));
  app.get('/api/conversations',async () => store.listConversations().map(({sourceInput,sessionFile,...item}) => item));
  app.get<{Params:{id:string}}>('/api/conversations/:id',async request => {
    const conversation = store.getConversation(request.params.id);
    if (!conversation) throw new AppError('NOT_FOUND','会话不存在',404);
    const source = conversation.sourceId ? await sources.get(conversation.sourceId) : null;
    return {id:conversation.id,title:conversation.title,createdAt:conversation.createdAt,updatedAt:conversation.updatedAt,
      source:source ? sourceSummary(source) : null,loginSite:sources.loginSite(conversation.sourceInput),tasks:store.conversationTasks(conversation.id)};
  });
  app.get<{Params:{id:string}}>('/api/sources/:id',async request => {
    const source = await sources.get(request.params.id);
    if (!source) throw new AppError('NOT_FOUND','来源不存在',404);
    return source;
  });
  app.get<{Params:{id:string}}>('/api/tasks/:id/result.md',async (request,reply) => {
    const task = store.getTask(request.params.id);
    if (!task) throw new AppError('NOT_FOUND','任务不存在',404);
    if (!task.result) throw new AppError('NOT_READY','结果还未生成',409);
    return reply.header('content-disposition',`attachment; filename="${task.id}.md"`).type('text/markdown; charset=utf-8').send(task.result);
  });
  app.get<{Params:{id:string};Querystring:{after?:string}}>('/api/tasks/:id/events',async (request,reply) => {
    if (!store.getTask(request.params.id)) throw new AppError('NOT_FOUND','任务不存在',404);
    const requestedAfter = Number(request.headers['last-event-id'] ?? request.query.after ?? 0);
    const after = Number.isSafeInteger(requestedAfter) && requestedAfter >= 0 ? requestedAfter : 0;
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});
    let cursor = after;
    const send = (event: TaskEvent) => {
      if (event.id > 0 && event.id <= cursor) return;
      if (event.id > 0) cursor = event.id;
      response.write(`${event.id > 0 ? 'id: ' + event.id + '\n' : ''}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const replay = () => {
      let batch;
      do { batch = store.events(request.params.id,cursor); for (const event of batch) send(event); } while (batch.length === 500);
    };
    runner.events.on(request.params.id,send);
    replay();
    const heartbeat = setInterval(() => response.write(': keepalive\n\n'),15000);
    response.on('close',() => { clearInterval(heartbeat); runner.events.off(request.params.id,send); });
  });
  app.get('/',async (_request,reply) => reply.type('text/html; charset=utf-8').send(await readFile(resolve('web/index.html'),'utf8')));
  app.get('/app.js',async (_request,reply) => reply.type('text/javascript; charset=utf-8').send(await readFile(resolve('web/app.js'),'utf8')));
  app.get('/style.css',async (_request,reply) => reply.type('text/css; charset=utf-8').send(await readFile(resolve('web/style.css'),'utf8')));
  app.addHook('onReady',async () => runner.start());
  app.addHook('onClose',async () => { await runner.close(); await sources.close(); store.close(); });
  return {app,store,runner,sources};
}
