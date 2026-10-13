import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);

// Credentials stay in process memory. Never write stdout or the child environment to a log.
export async function memoryEnvironment(env) {
  if(!env.MEMORY_BASE_URL||env.MEMORY_BASE_TOKEN)return {...env};
  if(!env.MEMORY_BASE_PYTHON)throw new Error('Knowledge-base credential provider is not configured');
  try {
    const {stdout}=await exec(env.MEMORY_BASE_PYTHON,['-m','memory_base','host-token','--profile','agent-bubble'],{
      env,windowsHide:true,timeout:15000,maxBuffer:4096});
    const token=stdout.trim();
    if(!token||/\s/.test(token))throw new Error('Invalid credential output');
    return {...env,MEMORY_BASE_TOKEN:token};
  }catch{throw new Error('Unable to read knowledge-base credentials; complete agent-bubble host registration');}
}
