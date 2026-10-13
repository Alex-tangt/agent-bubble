// Run reading integration tests on an already connected, unlocked phone.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const serial = process.argv[2];
if (!serial) throw Error('Pass the authorized phone serial reported by adb devices.');
const token = process.env.AGENT_BUBBLE_TOKEN;
if (!token) throw Error('Load the backend .env before running phone tests.');
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT.');
const adb = resolve('.tools/android-sdk/platform-tools/adb.exe');
const apk = resolve('android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
if (!existsSync(apk)) throw Error('Build assembleDebugAndroidTest first.');
const secrets = [token, process.env.DEEPSEEK_API_KEY, process.env.DASHSCOPE_API_KEY].filter(Boolean);
const environment = { ...process.env };
delete environment.AGENT_BUBBLE_TOKEN;
delete environment.DEEPSEEK_API_KEY;
delete environment.DASHSCOPE_API_KEY;
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '<REDACTED>'), value)
  .replace(/sk-[a-zA-Z0-9_.-]+/g, '<REDACTED>');
function run(args, timeout = 120000) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    env: environment, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8000000,
  });
  const output = redact((result.stdout || '') + (result.stderr || ''));
  if (result.error || result.status !== 0) throw Error(redact(result.error?.message || output || 'ADB command failed'));
  return output;
}
const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
  headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw Error(`Backend unavailable: HTTP ${response.status}`);
run(['reverse', `tcp:${port}`, `tcp:${port}`]);
console.log(run(['install', '--no-streaming', '-r', apk]).trim());
console.log('Running phone UI integration tests. Keep the phone unlocked.');
// Tests read the saved encrypted service credential inside the target app.
const output = run(['shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
  'dev.agentbubble.ReadingFlowTest', 'dev.agentbubble.test/androidx.test.runner.AndroidJUnitRunner'], 300000);
const directory = resolve('data/phone-validation', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'instrumentation.txt'), output, 'utf8');
console.log(output);
console.log('Sanitized report: ' + directory);
if (!output.includes('OK (4 tests)')) process.exitCode = 1;
run(['shell', 'am', 'start', '-n', 'dev.agentbubble/.MainActivity']);
