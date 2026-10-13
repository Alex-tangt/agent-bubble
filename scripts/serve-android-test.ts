import { join } from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

const config = loadConfig();
const { app } = createApp({...config,host:'127.0.0.1',port:8788,dataDir:join(config.dataDir,'android-test'),token:'android-instrumentation-test-token-20261008'});
await app.listen({host:'127.0.0.1',port:8788});
console.log('Isolated Android test service: http://127.0.0.1:8788');
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => { void app.close().then(() => process.exit(0)); });
