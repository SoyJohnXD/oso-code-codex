import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}dist/oso-codex.cjs`;
const result = await build({
  entryPoints: [`${root}src/cli.ts`], bundle: true, platform: 'node',
  target: 'node22', format: 'cjs', write: false, minify: false,
  legalComments: 'none',
});
const bytes = result.outputFiles[0].contents;
if (process.argv.includes('--check')) {
  if (!Buffer.from(bytes).equals(readFileSync(output))) throw new Error('Runtime bundle is stale; run npm run build.');
} else {
  mkdirSync(`${root}dist`, { recursive: true });
  writeFileSync(output, bytes);
}
