import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const {app} = createApp(config);
await app.listen({host:config.host,port:config.port});
console.log(`Agent Bubble 已启动：http://${config.host}:${config.port} · ${config.model}`);
process.send?.({type:'ready'});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  void app.close().then(() => process.exit(0)).catch(() => process.exit(1));
}
for (const event of ['SIGINT','SIGTERM'] as const) process.once(event,shutdown);
// The local launcher uses IPC so Windows can close SQLite and browser sessions cleanly.
if (process.send) process.on('message',message => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown') shutdown();
});
