import {spawn} from 'node:child_process';

export class MediaProcessError extends Error {
  constructor(readonly reason:'missing'|'exit'|'timeout'|'output_limit',readonly stderr='',readonly code:number|null=null) {
    super('媒体工具未能完成处理');
  }
}
export interface MediaProcessOptions {
  signal?:AbortSignal; timeoutMs:number; maxOutputBytes?:number;
  onStderrLine?:(line:string)=>void;
}
export interface MediaProcessResult {stdout:string;stderr:string}
export type MediaProcess = (command:string,args:string[],options:MediaProcessOptions)=>Promise<MediaProcessResult>;

/** Captures private output; callers expose only classified, credential-free errors. */
export const runMediaProcess:MediaProcess = (command,args,options) => new Promise((resolve,reject) => {
  if (options.signal?.aborted) {reject(options.signal.reason);return;}
  const env:NodeJS.ProcessEnv = {...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_TELEMETRY:'1'};
  delete env.DEEPSEEK_API_KEY; delete env.AGENT_BUBBLE_TOKEN;delete env.DASHSCOPE_API_KEY;delete env.MEMORY_BASE_TOKEN;
  const child = spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env});
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  let stdout='',stderr='',pendingLine='',outputBytes=0,finished=false,failure:unknown;
  const stop = (error:unknown) => {
    if (failure !== undefined || finished) return;
    failure=error;
    if(process.platform==='win32'&&child.pid) {
      // Target only this owned tree: Python/yt-dlp launchers can have children.
      const killer=spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',()=>child.kill());
      killer.once('close',()=>{if(child.exitCode===null)child.kill();});
    } else child.kill();
  };
  const aborted = () => stop(options.signal?.reason ?? new Error('aborted'));
  options.signal?.addEventListener('abort',aborted,{once:true});
  const timer = setTimeout(()=>stop(new MediaProcessError('timeout')),options.timeoutMs);
  const cleanup = () => {finished=true;clearTimeout(timer);options.signal?.removeEventListener('abort',aborted);};
  child.stdout.on('data',(part:string)=>{
    outputBytes+=Buffer.byteLength(part);
    if(outputBytes>(options.maxOutputBytes??12000000))stop(new MediaProcessError('output_limit'));
    else stdout+=part;
  });
  child.stderr.on('data',(part:string)=>{
    stderr=(stderr+part).slice(-6000);pendingLine=(pendingLine+part).slice(-12000);
    const lines=pendingLine.split(/\r?\n/);pendingLine=lines.pop()??'';
    for(const line of lines)options.onStderrLine?.(line);
  });
  child.once('error',error=>{cleanup();reject(failure??new MediaProcessError((error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'exit'));});
  child.once('close',code=>{
    cleanup();
    if(failure!==undefined)reject(failure);
    else if(code===0)resolve({stdout,stderr});
    else reject(new MediaProcessError('exit',stderr,code));
  });
  if(options.signal?.aborted)aborted();
});
