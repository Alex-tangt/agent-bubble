export async function waitForBackend({inspect, healthy, pause, now = Date.now, timeoutMs = 120000, onWaiting = () => {}}) {
  const started = now();
  let lastReport = started;
  while (now() - started < timeoutMs) {
    const state = inspect();
    if (state?.phase === 'failed') return 'failed';
    if (state?.phase === 'running' && await healthy()) return 'ready';
    if (now() - lastReport >= 5000) { onWaiting(now() - started, state?.phase); lastReport = now(); }
    await pause(250);
  }
  return 'timeout';
}
