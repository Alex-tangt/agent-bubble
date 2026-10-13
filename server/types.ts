import { z } from 'zod';

export const sourceInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), value: z.string().min(1).max(12000) }),
  z.object({ kind: z.literal('text'), value: z.string().min(1).max(300000), title: z.string().max(200).optional() }),
  z.object({ kind: z.literal('transcript'), value: z.string().min(1).max(300000), title: z.string().max(200).optional() }),
]);
export const taskInputSchema = z.object({
  clientRequestId: z.string().min(8).max(120),
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(6000),
  source: sourceInputSchema.optional(),
}).refine(input => input.conversationId || input.source, '首次交办需要链接或正文');
// originalUrl is server-derived when an unavailable link receives supplied text.
export type SourceInput = z.infer<typeof sourceInputSchema> & { originalUrl?: string };
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskStatus = 'queued' | 'running' | 'completed' | 'needs_input' | 'failed' | 'cancelled' | 'interrupted';
export interface Segment { start: number; end: number; text: string }
export interface SourceDocument {
  id: string;
  kind: 'article' | 'video' | 'text';
  title: string;
  url?: string;
  text: string;
  segments?: Segment[];
  method: 'readability' | 'browser_readability' | 'shared_text' | 'shared_transcript' | 'subtitles' | 'audio_transcription';
  language?: string;
  durationSeconds?: number;
  videoPart?: number;
  transcriptBasis?: string;
  transcriptionModel?: string;
  transcriptionProvider?:'local'|'qwen';
  processingMs?:{metadata:number;subtitles:number;download:number;transcription:number;total:number;modelLoad?:number;audioPreparation?:number;recognition?:number;upload?:number;cloudWait?:number};
  fetchedAt: string;
}
export interface SourceSummary extends Omit<SourceDocument, 'text' | 'segments'> {
  characters: number;
  segmentCount: number;
}
export interface Conversation {
  id: string;
  title: string;
  sourceInput: SourceInput;
  sourceId: string | null;
  sessionFile: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Usage { input: number; output: number; total: number }
export interface MemorySave {
  status:'saving'|'saved'|'failed';
  requestId:string;
  uri?:string;
  contentHash?:string;
  error?:string;
  savedAt?:string;
}
export interface Task {
  id: string;
  clientRequestId: string;
  conversationId: string;
  message: string;
  status: TaskStatus;
  progress: string;
  result: string | null;
  error: string | null;
  errorCode?: string | null;
  usage: Usage | null;
  memorySave?:MemorySave|null;
  createdAt: string;
  updatedAt: string;
}
export interface TaskEvent { id: number; taskId: string; type: string; data: unknown; createdAt: string }
export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode = 400) { super(message); }
}
export class SourceUnavailable extends AppError {
  constructor(message: string,public readonly reason='CONTENT_UNAVAILABLE') { super('SOURCE_UNAVAILABLE', message, 422); }
}
