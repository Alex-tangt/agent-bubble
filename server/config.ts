import { resolve } from 'node:path';
import { z } from 'zod';

export interface Config {
  host: string; port: number; token: string; dataDir: string;
  apiKey: string; model: string; baseUrl: string;
  ytDlpCommand: string; cookiesFile?: string; maxRunMs: number;
  taskConcurrency?:number;
  memoryBase?: {baseUrl:string;token?:string;pythonCommand?:string;home?:string};
  video?: {maxRunMs:number;maxDurationSeconds:number;maxAudioBytes:number;asrEnabled:boolean;pythonCommand:string;modelDir:string;threads:number;asrProvider?:'local'|'qwen'};
  qwenAsr?:{apiKey:string;model:string;baseUrl:string;pollMs:number};
  articleBrowser?: {enabled:boolean;channel:'chromium'|'chrome'|'msedge';headless:boolean;profileDir:string;timeoutMs:number;zhihuEngine?:'electron'|'playwright';electronProfileDir?:string;electronExecutable?:string};
}
export function loadConfig(env = process.env): Config {
  const vars = z.object({
    AGENT_BUBBLE_TOKEN: z.string().min(24, 'AGENT_BUBBLE_TOKEN 至少 24 个字符'),
    DEEPSEEK_API_KEY: z.string().min(1, '请配置 DEEPSEEK_API_KEY'),
    DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
    DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    DATA_DIR: z.string().default('./data'),
    YTDLP_COMMAND: z.string().default('yt-dlp'),
    BILIBILI_COOKIES_FILE: z.string().optional(),
    MAX_RUN_MS: z.coerce.number().min(1000).max(1800000).default(300000),
    TASK_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
    MEMORY_BASE_URL: z.union([z.literal(''),z.string().url()]).optional(),
    MEMORY_BASE_TOKEN: z.string().optional(),
    MEMORY_BASE_PYTHON: z.string().optional(),
    MEMORY_BASE_HOME: z.string().optional(),
    VIDEO_MAX_RUN_MS: z.coerce.number().min(1000).max(7200000).default(1800000),
    VIDEO_MAX_DURATION_SECONDS: z.coerce.number().int().min(30).max(14400).default(3600),
    VIDEO_MAX_AUDIO_MB: z.coerce.number().min(1).max(1000).default(100),
    ASR_ENABLED: z.enum(['true','false']).default('true'),
    ASR_PROVIDER: z.enum(['local','qwen']).optional(),
    DASHSCOPE_API_KEY:z.string().optional(),
    QWEN_ASR_MODEL:z.string().default('qwen-audio-3.0-asr-flash-filetrans'),
    QWEN_ASR_BASE_URL:z.string().url().default('https://dashscope.aliyuncs.com/api/v1'),
    QWEN_ASR_POLL_MS:z.coerce.number().int().min(1000).max(30000).default(2000),
    ASR_PYTHON_COMMAND: z.string().default(''),
    ASR_MODEL_DIR: z.string().default('.tools/asr-models/small'),
    ASR_CPU_THREADS: z.coerce.number().int().min(1).max(32).default(8),
    ARTICLE_BROWSER_ENABLED: z.enum(['true','false']).default('true'),
    ARTICLE_BROWSER_CHANNEL: z.enum(['chromium','chrome','msedge']).default('chrome'),
    ARTICLE_BROWSER_HEADLESS: z.enum(['true','false']).default('true'),
    ARTICLE_BROWSER_PROFILE: z.string().optional(),
    ARTICLE_BROWSER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
    ARTICLE_BROWSER_ZHIHU_ENGINE: z.enum(['electron','playwright']).default('electron'),
    ARTICLE_ELECTRON_PROFILE: z.string().optional(),
    ARTICLE_ELECTRON_EXECUTABLE: z.string().optional(),
  }).parse(env);
  return { host: vars.HOST, port: vars.PORT, token: vars.AGENT_BUBBLE_TOKEN,
    dataDir: resolve(vars.DATA_DIR), apiKey: vars.DEEPSEEK_API_KEY, model: vars.DEEPSEEK_MODEL,
    baseUrl: vars.DEEPSEEK_BASE_URL, ytDlpCommand: vars.YTDLP_COMMAND,
    cookiesFile: vars.BILIBILI_COOKIES_FILE ? resolve(vars.BILIBILI_COOKIES_FILE) : undefined,
    maxRunMs: vars.MAX_RUN_MS,
    taskConcurrency:vars.TASK_CONCURRENCY,
    memoryBase:vars.MEMORY_BASE_URL?{baseUrl:vars.MEMORY_BASE_URL,token:vars.MEMORY_BASE_TOKEN||undefined,
      pythonCommand:vars.MEMORY_BASE_PYTHON||undefined,home:vars.MEMORY_BASE_HOME||undefined}:undefined,
    video:{maxRunMs:vars.VIDEO_MAX_RUN_MS,maxDurationSeconds:vars.VIDEO_MAX_DURATION_SECONDS,maxAudioBytes:Math.floor(vars.VIDEO_MAX_AUDIO_MB*1024*1024),
      asrEnabled:vars.ASR_ENABLED==='true',pythonCommand:vars.ASR_PYTHON_COMMAND,modelDir:resolve(vars.ASR_MODEL_DIR),threads:vars.ASR_CPU_THREADS,
      asrProvider:vars.ASR_PROVIDER??(vars.DASHSCOPE_API_KEY?'qwen':'local')},
    qwenAsr:{apiKey:vars.DASHSCOPE_API_KEY??'',model:vars.QWEN_ASR_MODEL,baseUrl:vars.QWEN_ASR_BASE_URL,pollMs:vars.QWEN_ASR_POLL_MS},
    articleBrowser:{enabled:vars.ARTICLE_BROWSER_ENABLED==='true',channel:vars.ARTICLE_BROWSER_CHANNEL,headless:vars.ARTICLE_BROWSER_HEADLESS==='true',
      profileDir:resolve(vars.ARTICLE_BROWSER_PROFILE||resolve(vars.DATA_DIR,'article-browser')),timeoutMs:vars.ARTICLE_BROWSER_TIMEOUT_MS,
      zhihuEngine:vars.ARTICLE_BROWSER_ZHIHU_ENGINE,electronProfileDir:resolve(vars.ARTICLE_ELECTRON_PROFILE||resolve(vars.DATA_DIR,'article-electron-browser')),
      electronExecutable:vars.ARTICLE_ELECTRON_EXECUTABLE||undefined} };
}
