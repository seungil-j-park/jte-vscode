import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vsceManifestPath = require.resolve('@vscode/vsce/package.json');
const vsceManifest = JSON.parse(fs.readFileSync(vsceManifestPath, 'utf8'));
const cli = path.resolve(path.dirname(vsceManifestPath), vsceManifest.bin.vsce);
fs.mkdirSync('artifacts', { recursive: true });
// Derive the output name from the manifest so version and identity cannot drift.
// Resolve documentation links against main, which is also used for the initial release.
execFileSync(process.execPath, [cli, 'package', '--no-dependencies', '--githubBranch', 'main',
  '--out', path.join('artifacts', `${manifest.name}-${manifest.version}.vsix`)], { stdio: 'inherit' });
