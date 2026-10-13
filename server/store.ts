import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, type Conversation, type Task, type TaskEvent, type TaskInput } from './types.js';
import { sharedUrl } from './sources.js';

export class Store {
  private db: DatabaseSync;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'bubble.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, source_input TEXT NOT NULL,
        source_id TEXT, session_file TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id), message TEXT NOT NULL,
        status TEXT NOT NULL, progress TEXT NOT NULL, result TEXT, error TEXT, usage TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id, id);`);
    if(!this.db.prepare('PRAGMA table_info(tasks)').all().some(column=>column.name==='error_code')) this.db.exec('ALTER TABLE tasks ADD COLUMN error_code TEXT');
    if(!this.db.prepare('PRAGMA table_info(tasks)').all().some(column=>column.name==='memory_save')) this.db.exec('ALTER TABLE tasks ADD COLUMN memory_save TEXT');
  }
  submit(input: TaskInput): { task: Task; created: boolean } {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = this.db.prepare('SELECT * FROM tasks WHERE client_request_id=?').get(input.clientRequestId);
    if (prior) {
      if (prior.request_hash !== hash) throw new AppError('REQUEST_CONFLICT', '相同提交 ID 的内容发生变化，请重新提交', 409);
      return { task: this.taskRow(prior), created: false };
    }
    if (input.conversationId && !this.getConversation(input.conversationId)) throw new AppError('NOT_FOUND', '会话不存在', 404);
    if (input.conversationId && input.source) {
      if (this.getConversation(input.conversationId)?.sourceId) throw new AppError('SOURCE_CONFLICT', '新来源请创建新会话', 409);
      if (this.conversationTasks(input.conversationId).some(task => ['queued','running'].includes(task.status))) {
        throw new AppError('BUSY', '正在获取来源，请停止当前任务后再补充内容', 409);
      }
    }
    const time = new Date().toISOString();
    const conversationId = input.conversationId ?? randomUUID();
    const taskId = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!input.conversationId) {
        const source = input.source!;
        const title = ('title' in source ? source.title : undefined) || (source.kind === 'url' ? '链接总结' : '阅读总结');
        this.db.prepare('INSERT INTO conversations(id,title,source_input,created_at,updated_at) VALUES(?,?,?,?,?)')
          .run(conversationId, title, JSON.stringify(source), time, time);
      } else if (input.source) {
        const previous = this.getConversation(conversationId)!.sourceInput;
        let originalUrl = previous.originalUrl;
        if (previous.kind === 'url') {
          try {
            const url = new URL(sharedUrl(previous.value));
            if (!url.username && !url.password) originalUrl = url.href;
          } catch { /* Invalid links do not become source references. */ }
        }
        this.db.prepare('UPDATE conversations SET source_input=?,source_id=NULL WHERE id=?')
          .run(JSON.stringify({...input.source,originalUrl}),conversationId);
      }
      this.db.prepare(`INSERT INTO tasks(id,client_request_id,request_hash,conversation_id,message,status,progress,created_at,updated_at)
        VALUES(?,?,?,?,?,'queued','已接收，等待处理',?,?)`).run(taskId,input.clientRequestId,hash,conversationId,input.message,time,time);
      this.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(time,conversationId);
      this.addEvent(taskId, 'status', { status: 'queued', progress: '已接收，等待处理' });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { task: this.getTask(taskId)!, created: true };
  }
  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    return row ? this.taskRow(row) : null;
  }
  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    return row ? this.conversationRow(row) : null;
  }
  listConversations(): Array<Conversation & { latestTask: Task | null }> {
    return this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100').all().map(row => {
      const conversation = this.conversationRow(row);
      const task = this.db.prepare('SELECT * FROM tasks WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1').get(conversation.id);
      return { ...conversation, latestTask: task ? this.taskRow(task) : null };
    });
  }
  conversationTasks(id: string): Task[] {
    return this.db.prepare('SELECT * FROM tasks WHERE conversation_id=? ORDER BY rowid').all(id).map(row => this.taskRow(row));
  }
  queuedTasks(): Task[] { return this.db.prepare("SELECT * FROM tasks WHERE status='queued' ORDER BY rowid").all().map(row => this.taskRow(row)); }
  updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'progress' | 'result' | 'error' | 'errorCode' | 'usage' | 'memorySave'>>): Task {
    const current = this.getTask(id);
    if (!current) throw new AppError('NOT_FOUND', '任务不存在', 404);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE tasks SET status=?,progress=?,result=?,error=?,error_code=?,usage=?,memory_save=?,updated_at=? WHERE id=?')
      .run(next.status,next.progress,next.result,next.error,next.errorCode??null,next.usage ? JSON.stringify(next.usage) : null,
        next.memorySave ? JSON.stringify(next.memorySave):null,next.updatedAt,id);
    this.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(next.updatedAt,next.conversationId);
    return next;
  }
  updateConversation(id: string, patch: Partial<Pick<Conversation, 'title' | 'sourceId' | 'sessionFile'>>): void {
    const current = this.getConversation(id);
    if (!current) throw new AppError('NOT_FOUND', '会话不存在', 404);
    const next = { ...current, ...patch };
    this.db.prepare('UPDATE conversations SET title=?,source_id=?,session_file=?,updated_at=? WHERE id=?')
      .run(next.title,next.sourceId,next.sessionFile,new Date().toISOString(),id);
  }
  addEvent(taskId: string, type: string, data: unknown): TaskEvent {
    const time = new Date().toISOString();
    const result = this.db.prepare('INSERT INTO events(task_id,type,data,created_at) VALUES(?,?,?,?)').run(taskId,type,JSON.stringify(data),time);
    return { id: Number(result.lastInsertRowid), taskId, type, data, createdAt: time };
  }
  events(taskId: string, after = 0): TaskEvent[] {
    return this.db.prepare('SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 500').all(taskId,after).map(row => ({
      id:Number(row.id),taskId:String(row.task_id),type:String(row.type),data:JSON.parse(String(row.data)),createdAt:String(row.created_at),
    }));
  }
  recover(): void {
    const pendingSaves=this.db.prepare("SELECT id FROM tasks WHERE json_extract(memory_save,'$.status')='saving'").all();
    for(const row of pendingSaves){
      const task=this.getTask(String(row.id))!;
      this.updateTask(task.id,{memorySave:{...task.memorySave!,status:'failed',error:'服务重启中断知识库保存，结果已保留，请重试保存'},
        progress:'总结已保留，知识库保存被中断，可重试'});
      this.addEvent(task.id,'memory_save',this.getTask(task.id)!.memorySave);
    }
    const active = this.db.prepare("SELECT id FROM tasks WHERE status='running'").all();
    for (const row of active) {
      const id = String(row.id);
      this.updateTask(id, { status:'interrupted',progress:'服务重启，任务已中断；可在原会话重试',error:'执行中断，已有来源与历史结果已保留' });
      this.addEvent(id,'status',{status:'interrupted'});
    }
  }
  close(): void { this.db.close(); }
  private taskRow(row: Record<string, unknown>): Task {
    return { id:String(row.id),clientRequestId:String(row.client_request_id),conversationId:String(row.conversation_id),
      message:String(row.message),status:String(row.status) as Task['status'],progress:String(row.progress),
      result:row.result == null ? null : String(row.result),error:row.error == null ? null : String(row.error),errorCode:row.error_code==null?null:String(row.error_code),
      usage:row.usage == null ? null : JSON.parse(String(row.usage)),memorySave:row.memory_save == null ? null : JSON.parse(String(row.memory_save)),
      createdAt:String(row.created_at),updatedAt:String(row.updated_at) };
  }
  private conversationRow(row: Record<string, unknown>): Conversation {
    return { id:String(row.id),title:String(row.title),sourceInput:JSON.parse(String(row.source_input)),
      sourceId:row.source_id == null ? null : String(row.source_id),sessionFile:row.session_file == null ? null : String(row.session_file),
      createdAt:String(row.created_at),updatedAt:String(row.updated_at) };
  }
}
