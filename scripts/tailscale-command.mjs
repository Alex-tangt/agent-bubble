// Account setup must have an exit even when the CLI waits for a browser approval.
import {spawn} from 'node:child_process';
const [exe,...args]=process.argv.slice(2);
const env={...process.env};
for(const name of ['DEEPSEEK_API_KEY','DASHSCOPE_API_KEY','AGENT_BUBBLE_TOKEN'])delete env[name];
const child=spawn(exe,args,{env,stdio:'inherit',windowsHide:true});
let expired=false;
const deadline=setTimeout(()=>{expired=true;child.kill();console.error('Setup paused after 60 seconds. Complete the account-page step above, then run remote-access.ps1 again.');},60000);
child.on('error',()=>{clearTimeout(deadline);console.error('Could not start the Tailscale CLI.');process.exitCode=1;});
child.on('exit',code=>{clearTimeout(deadline);process.exitCode=expired?2:(code??1);});
