import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--watch', 'src/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PERCH_ASSETS: 'source' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
