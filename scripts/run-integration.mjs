import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scenario = process.env.JTE_TEST_SCENARIO || 'maven';
if (!['maven', 'gradle'].includes(scenario)) throw new Error('Unknown fixture scenario: ' + scenario);
const runtime = path.join(root, '.test-runtime', manifest.name, scenario);
const extensions = path.join(runtime, 'extensions');
const profile = path.join(runtime, 'profile');
fs.mkdirSync(extensions, { recursive: true });
fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
const installed = javaExtension();
const javaVersion = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version;
if (javaVersion !== '1.56.0') throw new Error('Integration tests require Red Hat Java 1.56.0; found ' + javaVersion);
const linked = path.join(extensions, path.basename(installed));
const conflicting = fs.readdirSync(extensions).filter(name => name.startsWith('redhat.java-') && name !== path.basename(installed));
if (conflicting.length) throw new Error('The isolated test profile contains another Java version: ' + conflicting.join(', '));
if (!fs.existsSync(linked)) fs.symlinkSync(installed, linked, process.platform === 'win32' ? 'junction' : 'dir');
const settings = {
  'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'update.mode': 'none',
  'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false,
  'java.server.launchMode': 'Standard', 'java.configuration.updateBuildConfiguration': 'automatic',
  'java.import.gradle.wrapper.enabled': true, 'java.import.gradle.enabled': true,
  'java.autobuild.enabled': true, 'java.completion.guessMethodArguments': false,
  'java.import.generatesMetadataFilesAtProjectRoot': false,
  'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'java.import.projectSelection': 'automatic'
};
if (process.env.JTE_JDK_HOME) {
  settings['java.jdt.ls.java.home'] = process.env.JTE_JDK_HOME;
  settings['java.import.gradle.java.home'] = process.env.JTE_JDK_HOME;
  settings['java.configuration.runtimes'] = [{ name: 'JavaSE-21', path: process.env.JTE_JDK_HOME, default: true }];
}
fs.writeFileSync(path.join(profile, 'User', 'settings.json'), JSON.stringify(settings, null, 2));
const executable = process.env.JTE_VSCODE || (process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : undefined);
if (!executable || !fs.existsSync(executable)) throw new Error('Set JTE_VSCODE to the VS Code application executable.');
const workspace = path.resolve(process.env.JTE_TEST_WORKSPACE || path.join('test/fixtures', scenario));
const extensionRoot = path.resolve(process.env.JTE_TEST_EXTENSION || root);
const testedManifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
const env = { ...process.env, JTE_TEST_ROOT: root, JTE_TEST_EXTENSION_ID: `${testedManifest.publisher}.${testedManifest.name}` };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', extensions,
  '--extensionDevelopmentPath=' + extensionRoot, '--extensionTestsPath=' + path.join(root, 'dist/test/integration/index.js'),
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
fs.mkdirSync('artifacts', { recursive: true });
const log = fs.createWriteStream(path.join(root, 'artifacts', 'extension-host-' + scenario + '.log'));
child.stdout.pipe(log); child.stderr.pipe(log);
console.log('Starting VS Code Extension Host: ' + workspace);
// If project import stalls, terminate only the VS Code process started for this test.
const timeout = setTimeout(() => { console.error('Extension Host validation timed out'); child.kill(); }, 600000);
// Forward the real Extension Host exit code to the build tool.
child.on('exit', code => { clearTimeout(timeout); console.log('Extension Host exited: ' + code); process.exitCode = code ?? 1; });
// Report launch failures immediately instead of leaving the timeout active.
child.on('error', error => { clearTimeout(timeout); log.end(); console.error(error.message); process.exitCode = 1; });

/** Locate the pinned Java extension without downloading or updating it. */
function javaExtension() {
  if (process.env.JTE_JAVA_EXTENSION) return path.resolve(process.env.JTE_JAVA_EXTENSION);
  const directory = path.join(os.homedir(), '.vscode', 'extensions');
  const name = fs.existsSync(directory)
    ? fs.readdirSync(directory).find(entry => /^redhat\.java-1\.56\.0(?:-|$)/.test(entry)) : undefined;
  if (!name) throw new Error('Set JTE_JAVA_EXTENSION to the Red Hat Java 1.56.0 installation directory.');
  return path.join(directory, name);
}
