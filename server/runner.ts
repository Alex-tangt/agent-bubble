import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentBackend } from './agent.js';
import type { Config } from './config.js';
import { SourceRepository } from './sources.js';
import { Store } from './store.js';
import { AppError, SourceUnavailable, type Task, type TaskEvent, type SourceDocument, type MemorySave } from './types.js';
import { MemoryBaseClient } from './memory-base.js';

export function safeError(error: unknown, secrets: string[] = []): string {
  let text = error instanceof Error ? error.message : '处理失败，请稍后重试';
  for (const secret of secrets) if (secret) text = text.replaceAll(secret,'[已隐藏]');
  return text.replace(/sk-[a-zA-Z0-9_.-]+/g,'[已隐藏]').slice(0,800);
}
export class TaskRunner {
  readonly events = new EventEmitter();
  private stopped = false;
  private loginPaused = false;
  private active = new Map<string,{conversationId:string;controller:AbortController;acquiringVideo:boolean;promise:Promise<void>}>();
  private saving = new Map<string,Promise<Task>>();
  private memory:MemoryBaseClient|undefined;
  private memoryShutdown=new AbortController();
  constructor(readonly store: Store,readonly sources: SourceRepository,private agent: AgentBackend,private config: Config) {
    this.memory=config.memoryBase?new MemoryBaseClient(config.memoryBase):undefined;
    store.recover();
  }
  start(): void { this.kick(); }
  pauseForLogin():boolean{if(this.stopped||this.active.size)return false;this.loginPaused=true;return true;}
  resumeAfterLogin():void{this.loginPaused=false;this.kick();}
  get waitingForLogin():boolean{return this.loginPaused;}
  kick(): void {
    if (this.stopped || this.loginPaused) return;
    while(this.active.size<(this.config.taskConcurrency??3)){
      const running=[...this.active.values()];
      const task=this.store.queuedTasks().find(task=>{
        if(running.some(entry=>entry.conversationId===task.conversationId))return false;
        return !this.acquiresVideo(task)||!running.some(entry=>entry.acquiringVideo);
      });
      if(!task)return;
      const entry={conversationId:task.conversationId,controller:new AbortController(),acquiringVideo:this.acquiresVideo(task),promise:Promise.resolve()};
      this.active.set(task.id,entry);
      entry.promise=this.execute(task,entry.controller,entry.acquiringVideo).finally(()=>{this.active.delete(task.id);this.kick();});
    }
  }
  private acquiresVideo(task:Task):boolean{
    const conversation=this.store.getConversation(task.conversationId)!;
    return !conversation.sourceId&&conversation.sourceInput.kind==='url'
      &&/https?:\/\/(?:[\w-]+\.)*(?:bilibili\.com|b23\.tv)(?:\/|[?#]|$)/i.test(conversation.sourceInput.value);
  }
  private emit(taskId: string,type: string,data: unknown): void {
    const event = this.store.addEvent(taskId,type,data);
    this.events.emit(taskId,event);
  }
  private progress(taskId: string,text: string): void {
    this.store.updateTask(taskId,{progress:text});
    this.emit(taskId,'progress',{progress:text});
  }
  private async execute(task: Task,controller:AbortController,acquiringVideo:boolean): Promise<void> {
    const maxRunMs=acquiringVideo?(this.config.video?.maxRunMs??this.config.maxRunMs):this.config.maxRunMs;
    const timer = setTimeout(() => controller.abort('timeout'),maxRunMs);
    this.store.updateTask(task.id,{status:'running',progress:'正在获取来源'});
    this.emit(task.id,'status',{status:'running',progress:'正在获取来源'});
    try {
      const conversation = this.store.getConversation(task.conversationId)!;
      const firstSummary=!this.store.conversationTasks(conversation.id).some(previous=>previous.id!==task.id&&previous.result!==null);
      const source = (conversation.sourceId ? await this.sources.get(conversation.sourceId) : null)
        ?? await this.sources.acquire(conversation.sourceInput,controller.signal,text=>this.progress(task.id,text));
      controller.signal.throwIfAborted();
      this.store.updateConversation(conversation.id,{sourceId:source.id,title:source.title});
      const entry=this.active.get(task.id);if(entry){entry.acquiringVideo=false;this.kick();}
      let previousProgress = '';
      const response = await this.agent.run({ conversation:this.store.getConversation(conversation.id)!,source,message:task.message,signal:controller.signal,
        onSession:path => this.store.updateConversation(conversation.id,{sessionFile:path}),
        onTool:name=>this.emit(task.id,'memory_tool',{name}),
        onProgress:text => { if (text !== previousProgress) { previousProgress = text; this.progress(task.id,text); } },
        onDelta:text => { this.events.emit(task.id,{id:0,taskId:task.id,type:'delta',data:{text},createdAt:new Date().toISOString()} satisfies TaskEvent); },
      });
      controller.signal.throwIfAborted();
      await mkdir(join(this.config.dataDir,'results'),{recursive:true});
      await writeFile(join(this.config.dataDir,'results',task.id + '.md'),response.text,'utf8');
      // Save the answer locally before any KB call. KB outages must never lose generated work.
      this.store.updateTask(task.id,{result:response.text,error:null,errorCode:null,usage:response.usage});
      let progress='已完成';
      if(firstSummary&&this.memory){
        const saved=await this.saveSummary(task.id,source,controller.signal);
        progress=saved.memorySave?.status==='saved'?'已完成，已保存到知识库':'总结已完成，知识库保存失败，可重试';
      }
      this.store.updateTask(task.id,{status:'completed',progress});
      this.emit(task.id,'status',{status:'completed',progress});
    } catch (error) {
      const reason = controller.signal.reason;
      const status = reason === 'cancelled' ? 'cancelled' : reason === 'shutdown' ? 'interrupted'
        : error instanceof SourceUnavailable && !['HTTP_TRANSIENT','FETCH_TIMEOUT','READER_UNAVAILABLE','RATE_LIMITED','CONTENT_INCOMPLETE','ASR_FAILED','ASR_SUBMISSION_UNKNOWN','MEDIA_TOOL_FAILED'].includes(error.reason) ? 'needs_input' : 'failed';
      const message = reason === 'timeout' ? '处理超时，来源与已有结果已保留，请在原会话重试'
        : status === 'cancelled' ? '已停止本次处理，历史结果仍然保留'
        : status === 'interrupted' ? '服务停止，任务已中断；可在原会话重试'
        : safeError(error,[this.config.apiKey,this.config.token,this.config.qwenAsr?.apiKey??'',this.config.memoryBase?.token??'']);
      this.store.updateTask(task.id,{status,progress:message,error:message,errorCode:reason==='timeout'?'RUN_TIMEOUT':error instanceof SourceUnavailable?error.reason:status==='failed'?'EXECUTION_FAILED':null});
      this.emit(task.id,'status',{status,progress:message});
    } finally { clearTimeout(timer); }
  }
  private async saveSummary(id:string,source:SourceDocument,signal?:AbortSignal):Promise<Task> {
    const task=this.store.getTask(id)!;
    const requestId=task.memorySave?.requestId??'agent-bubble-summary-'+task.id;
    const pending:MemorySave={status:'saving',requestId};
    this.store.updateTask(id,{memorySave:pending});this.emit(id,'memory_save',pending);
    try{
      const receipt=await this.memory!.add({request_id:requestId,content:task.result!,title:source.title,
        kind:source.kind==='video'?'video_summary':'article_summary',source_id:source.id,conversation_id:task.conversationId,
        ...(source.url?{source_url:source.url}:{})},signal);
      const memorySave:MemorySave={status:'saved',requestId,uri:receipt.uri,contentHash:receipt.content_hash,savedAt:new Date().toISOString()};
      this.emit(id,'memory_save',memorySave);return this.store.updateTask(id,{memorySave});
    }catch(error){
      const memorySave:MemorySave={status:'failed',requestId,error:safeError(error,[this.config.memoryBase?.token??''])};
      this.emit(id,'memory_save',memorySave);return this.store.updateTask(id,{memorySave});
    }
  }
  async retryMemory(id:string):Promise<Task> {
    const task=this.store.getTask(id);
    if(!task)throw new AppError('NOT_FOUND','任务不存在',404);
    if(!this.memory)throw new AppError('MEMORY_DISABLED','未配置共享知识库',409);
    if(!task.result||!task.memorySave)throw new AppError('MEMORY_NOT_REQUESTED','此回复未安排自动保存',409);
    if(task.status==='running'||task.status==='queued')throw new AppError('BUSY','任务仍在处理，请稍后重试保存',409);
    if(task.memorySave.status==='saved')return task;
    const pending=this.saving.get(id);if(pending)return pending;
    const work=(async()=>{
      const conversation=this.store.getConversation(task.conversationId)!;
      const source=conversation.sourceId?await this.sources.get(conversation.sourceId):null;
      if(!source)throw new AppError('SOURCE_UNAVAILABLE','已缓存来源不可用，请检查本机数据',409);
      const saved=await this.saveSummary(id,source,this.memoryShutdown.signal);
      const progress=saved.memorySave?.status==='saved'?'已完成，已保存到知识库':'总结已完成，知识库保存失败，可重试';
      const next=this.store.updateTask(id,{progress});this.emit(id,'status',{status:next.status,progress});return next;
    })().finally(()=>this.saving.delete(id));
    this.saving.set(id,work);return work;
  }
  cancel(id: string): Task | null {
    const task = this.store.getTask(id);
    if (!task) return null;
    if (this.active.has(id)) this.active.get(id)!.controller.abort('cancelled');
    else if (task.status === 'queued') {
      this.store.updateTask(id,{status:'cancelled',progress:'已停止',error:'已停止本次处理'});
      this.emit(id,'status',{status:'cancelled'});
    }
    return this.store.getTask(id);
  }
  async close(): Promise<void> { this.stopped = true;this.memoryShutdown.abort('shutdown');for(const entry of this.active.values())entry.controller.abort('shutdown');await Promise.all([...this.active.values()].map(entry=>entry.promise));await Promise.allSettled(this.saving.values()); }
}
