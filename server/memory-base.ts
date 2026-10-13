import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Config } from './config.js';

const exec = promisify(execFile);
const revisionSchema=z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema=z.object({project:z.string(),relative_path:z.string()});
const readFields={path:z.string().optional(),revision:revisionSchema.optional(),method:z.string().optional(),
  source:sourceSchema.optional(),freshness:z.string().optional(),observed_on:z.string().nullable().optional()};
const resultFields={effective_scope:z.array(z.string()).optional(),method:z.string().optional(),
  completeness:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).optional()};
const receiptSchema = z.object({status:z.enum(['created','exists']),uri:z.string().min(1),content_hash:revisionSchema,
  path:z.string().optional(),revision:revisionSchema.optional(),index:z.object({status:z.string()}).optional(),
  identity:z.object({principal:z.string(),role:z.string()}).optional()});
const itemSchema=z.object({uri:z.string(),title:z.string().optional(),abstract:z.string().optional(),score:z.number().optional(),
  ...readFields,revision:revisionSchema.nullable().optional(),kind:z.string().optional()});
const searchSchema = z.object({items:z.array(itemSchema),...resultFields});
const getSchema = z.object({uri:z.string(),content:z.string(),...readFields,...resultFields,
  content_hash:revisionSchema.optional(),bytes:z.number().int().nonnegative().optional()});
const listSchema=z.object({items:z.array(itemSchema),next_cursor:z.string().nullable(),...resultFields});
export type MemoryReceipt = z.infer<typeof receiptSchema>;
export interface MemoryAdd {
  request_id:string;content:string;title:string;kind:'article_summary'|'video_summary'|'note';
  source_url?:string;source_id?:string;conversation_id?:string;observed_on?:string;
}
export interface MemoryGetOptions {scope?:string;expected_revision?:string}
export interface MemoryListOptions {scope?:string;limit?:number;cursor?:string}

// Only known public codes are exposed; upstream text and arbitrary codes may contain credentials.
const errorFeedback:Record<string,string>={
  REVISION_MISMATCH:'知识库版本已变化，请重新 search/list 获取 revision，再读取正文',
  SOURCE_CHANGED_DURING_READ:'来源在读取时变化，请重新 search/list 后按新 revision 读取',
  LIST_CHANGED_RESTART:'列举期间目录已变化，请清空 cursor 从第一页重新列举',
  CURSOR_INVALID:'分页游标无效，请清空 cursor 从第一页重新列举',
  SOURCE_UNAVAILABLE:'项目来源暂时不可用，请检查登记路径或服务后重试；这不是空结果',
  SOURCE_SCAN_INCOMPLETE:'项目列举未完成，请检查来源后重新列举；不能视为完整结果',
  READ_SCOPE_FORBIDDEN:'没有权限读取该范围，请选择已授权 scope 或请用户调整接入授权',
  WRITE_SCOPE_FORBIDDEN:'没有权限写入该范围，请检查接入授权；项目来源只读',
  FORBIDDEN_SCOPE:'该范围未获授权，请选择已授权 scope 或请用户调整接入授权',
  WRITE_FORBIDDEN:'当前接入没有写入权限，请检查笔记保存授权',
  SOURCE_PATH_FORBIDDEN:'项目路径不可读取，请选择登记并授权的 Markdown 路径',
  SOURCE_LINK_FORBIDDEN:'来源链接路径不可读取，请选择登记范围内的普通 Markdown 文件',
  SOURCE_FILE_FORBIDDEN:'来源文件不可读取，请检查登记范围和文件类型',
  SOURCE_NOT_FOUND:'来源文件已不存在，请重新 search/list 后选择现存文件',
  SOURCE_NOT_REGISTERED:'该项目未登记，请检查项目登记和接入授权',
  SOURCE_REGISTRY_INVALID:'项目登记配置无效，请修复登记配置后重试',
  SOURCE_TOO_LARGE:'来源超出读取大小上限，请选择更小的 Markdown 文件',
  SOURCE_NOT_UTF8:'来源不是有效 UTF-8 文本，请修复来源编码后重试',
  CAPTURE_SCAN_INCOMPLETE:'知识库列举未完成，请检查服务后从第一页重试',
  CAPTURE_CONTENT_CORRUPT:'知识库正文校验失败，请检查服务后重试',
  CAPTURE_CONTENT_CONFLICT:'知识库保存内容冲突，请核对原始结果与保存请求',
  REQUEST_ID_CONFLICT:'知识库保存请求冲突，请核对原始结果与保存请求',
  UPSTREAM_UNAVAILABLE:'知识库上游暂时不可用，结果已保留，请检查服务后重试',
  UPSTREAM_INVALID_RESPONSE:'知识库上游响应无效，请检查服务后重试',
};

// An unavailable KB must be distinguishable from an empty successful search.
export class MemoryBaseError extends Error {
  constructor(message:string,readonly code='CLIENT_UNAVAILABLE'){super(message);this.name='MemoryBaseError';}
}
export class MemoryBaseClient {
  private credential?:Promise<string>;
  constructor(private config:NonNullable<Config['memoryBase']>) {}
  private token():Promise<string> {
    if(this.config.token)return Promise.resolve(this.config.token);
    return this.credential ??= this.loadCredential().catch(error=>{this.credential=undefined;throw error;});
  }
  private async loadCredential():Promise<string> {
    if(!this.config.pythonCommand)throw new MemoryBaseError('知识库未配置访问凭据，请检查本机知识库接入设置');
    try {
      const {stdout}=await exec(this.config.pythonCommand,['-m','memory_base','host-token','--profile','agent-bubble'],{
        env:{...process.env,...(this.config.home?{MEMORY_BASE_HOME:this.config.home}:{})},windowsHide:true,timeout:15000,maxBuffer:4096});
      const token=stdout.trim();
      if(!token || /\s/.test(token))throw new Error('Invalid token output');
      return token;
    } catch {throw new MemoryBaseError('无法读取本机知识库凭据，请重新完成 agent-bubble 接入配置');}
  }
  private async call(path:string,payload:unknown,signal?:AbortSignal):Promise<unknown> {
    const token=await this.token();
    try {
      const response=await fetch(new URL('api/memory/'+path,this.config.baseUrl.replace(/\/?$/,'/')),{
        method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(payload),
        signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(!response.ok){
        const error=await response.json().catch(()=>undefined);
        const code=typeof error?.error?.code==='string'?error.error.code:undefined;
        if(code && Object.hasOwn(errorFeedback,code))throw new MemoryBaseError(`${errorFeedback[code]}（${code}）`,code);
        if(response.status===401)throw new MemoryBaseError('知识库访问凭据无效，请重新完成本机接入配置','AUTH_REQUIRED');
        throw new MemoryBaseError(`知识库请求失败（HTTP ${response.status}），结果已保留，可重试`,'HTTP_ERROR');
      }
      return await response.json();
    } catch(error) {
      if(error instanceof MemoryBaseError)throw error;
      throw new MemoryBaseError('知识库暂时不可用，结果已保留，请检查服务后重试');
    }
  }
  async add(input:MemoryAdd,signal?:AbortSignal):Promise<MemoryReceipt> {
    const receipt=receiptSchema.safeParse(await this.call('add',input,signal));
    if(!receipt.success)throw new MemoryBaseError('知识库返回的保存凭证不完整，请检查服务后重试');
    const hash=createHash('sha256').update(input.content,'utf8').digest('hex');
    if(receipt.data.content_hash!==hash)throw new MemoryBaseError('知识库保存内容与本次结果不一致，请检查后重试');
    return receipt.data;
  }
  async search(query:string,limit=5,signal?:AbortSignal,scope?:string) {
    const result=searchSchema.safeParse(await this.call('search',{query,limit,...(scope!==undefined?{scope}:{})},signal));
    if(!result.success)throw new MemoryBaseError('知识库返回了无效检索结果');
    return result.data;
  }
  async get(uri:string,signal?:AbortSignal,options:MemoryGetOptions={}) {
    const result=getSchema.safeParse(await this.call('get',{uri,...options},signal));
    if(!result.success || (result.data.uri!==uri && result.data.path!==uri))throw new MemoryBaseError('知识库返回了无效正文','INVALID_RESPONSE');
    if(options.expected_revision!==undefined && result.data.revision!==options.expected_revision)
      throw new MemoryBaseError('知识库版本未匹配（REVISION_MISMATCH），请重新 search/list 获取 revision 后读取','REVISION_MISMATCH');
    const hash=createHash('sha256').update(result.data.content,'utf8').digest('hex');
    if((result.data.revision!==undefined && result.data.revision!==hash) || (result.data.content_hash!==undefined && result.data.content_hash!==hash))
      throw new MemoryBaseError('知识库正文哈希不一致，请重新 search/list 并检查服务后重试','CONTENT_HASH_MISMATCH');
    return result.data;
  }
  async list(options:MemoryListOptions={},signal?:AbortSignal) {
    const result=listSchema.safeParse(await this.call('list',{limit:100,...options},signal));
    if(!result.success)throw new MemoryBaseError('知识库返回了无效列举结果','INVALID_RESPONSE');
    return result.data;
  }
}
