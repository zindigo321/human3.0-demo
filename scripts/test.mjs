import { build } from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('work', { recursive: true });
const tests = (await readdir('tests')).filter(file => file.endsWith('.test.ts'));
const outputs = [];
for (const file of tests) {
  const outfile = `work/${file.replace('.ts', '.mjs')}`;
  await build({ entryPoints: [`tests/${file}`], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' });
  outputs.push(outfile);
}
const runner = spawn(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
runner.on('error', () => { process.exitCode = 1; });
runner.on('exit', code => { process.exitCode = code ?? 1; });
