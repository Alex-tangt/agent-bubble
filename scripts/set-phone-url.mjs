// Change a debug phone's server URL without copying its encrypted connection credential.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
const [serial,url]=process.argv.slice(2);
const address=new URL(url);
if(!serial||!['http:','https:'].includes(address.protocol)||address.username||address.password||address.search||address.hash)throw Error('Pass an authorized ADB serial and HTTP(S) server URL.');
const environment={...process.env};
const secrets=['AGENT_BUBBLE_TOKEN','DEEPSEEK_API_KEY','DASHSCOPE_API_KEY'].map(k=>environment[k]).filter(Boolean);
for(const k of ['AGENT_BUBBLE_TOKEN','DEEPSEEK_API_KEY','DASHSCOPE_API_KEY'])delete environment[k];
const adb=resolve('.tools/android-sdk/platform-tools/adb.exe');
function run(args,input){const result=spawnSync(adb,['-s',serial,...args],{input,env:environment,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:5000000});if(result.status!==0){let error=result.stderr||result.error?.message||'ADB failed';for(const key of secrets)error=error.replaceAll(key,'<REDACTED>');throw Error(error);}return result.stdout;}
run(['shell','am','force-stop','dev.agentbubble']);
const xml=run(['shell','run-as','dev.agentbubble','cat','shared_prefs/agent_bubble.xml']);
const document=new JSDOM(xml,{contentType:'text/xml'});
const prefs=document.window.document;
const token=prefs.querySelector('string[name="connection_token"]');
if(!token?.textContent)throw Error('Connect the app first; no saved encrypted credential was found.');
let node=prefs.querySelector('string[name="server_url"]');
if(!node){node=prefs.createElement('string');node.setAttribute('name','server_url');prefs.querySelector('map').appendChild(node);}
node.textContent=url.replace(/\/$/,'');
run(['shell','run-as','dev.agentbubble','tee','shared_prefs/agent_bubble.xml'],document.serialize());
run(['shell','run-as','dev.agentbubble','rm','-f','shared_prefs/agent_bubble.xml.bak']);
document.window.close();
run(['shell','am','start','-n','dev.agentbubble/.MainActivity']);
console.log('Saved server URL: '+url+'; encrypted credential preserved. Re-enable the floating bubble in the app.');
