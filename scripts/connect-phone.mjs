// Configure only Agent Bubble on a selected authorized phone; never send the model key.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const serial = process.argv[2];
if (!serial) throw Error('Pass the phone serial reported by adb devices.');
const token = process.env.AGENT_BUBBLE_TOKEN;
if (!token || token.length < 24) throw Error('Load .env and configure AGENT_BUBBLE_TOKEN.');
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT.');
const url = `http://127.0.0.1:${port}`;
const adb = resolve('.tools/android-sdk/platform-tools/adb.exe');
const testApk = resolve('android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
if (!existsSync(testApk)) throw Error('Build assembleDebugAndroidTest first.');
const environment = {...process.env};
delete environment.DEEPSEEK_API_KEY; delete environment.DASHSCOPE_API_KEY; delete environment.AGENT_BUBBLE_TOKEN;
function run(args,input) {
  const result = spawnSync(adb,['-s',serial,...args],{input,encoding:'utf8',env:environment,windowsHide:true,timeout:120000,maxBuffer:4000000});
  const output = ((result.stdout || '') + (result.stderr || '')).replaceAll(token,'<REDACTED>');
  if (result.error || result.status !== 0) throw Error(result.error?.message || output || 'ADB command failed');
  return output;
}
const response = await fetch(url + '/api/health',{headers:{authorization:'Bearer ' + token},signal:AbortSignal.timeout(5000)});
if (!response.ok) throw Error('Local backend or connection token unavailable: HTTP ' + response.status);
run(['reverse',`tcp:${port}`,`tcp:${port}`]);
run(['install','-r',testApk]);
run(['shell','run-as','dev.agentbubble','mkdir','-p','files']);
// tee's echo remains captured and discarded; no secret is placed in shell arguments.
run(['shell','run-as','dev.agentbubble','tee','files/debug-connection.json'],JSON.stringify({url,token}));
try {
  const output = run(['shell','am','instrument','-w','-r','-e','class','dev.agentbubble.ConnectionSetupTest',
    'dev.agentbubble.test/androidx.test.runner.AndroidJUnitRunner']);
  if (!output.includes('OK (1 test)')) throw Error(output);
  const persisted = run(['shell','run-as','dev.agentbubble','cat','shared_prefs/agent_bubble.xml']);
  if (!persisted.includes(`<string name="server_url">${url}</string>`)) throw Error('The backend address was not persisted on the phone.');
  run(['shell','am','start','-n','dev.agentbubble/.MainActivity']);
  console.log('Phone connected to the personal backend. Model key remains on the computer.');
} finally {
  run(['shell','run-as','dev.agentbubble','rm','-f','files/debug-connection.json']);
}
