import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import './build-java.mjs';
import './build-grammar.mjs';

mkdirSync('artifacts', { recursive: true });
await build({ entryPoints: { extension: 'src/extension.ts', 'test/integration/index': 'test/integration/index.ts' }, bundle: true,
  platform: 'node', format: 'cjs', target: 'node22', outdir: 'dist', external: ['vscode'], sourcemap: true });
