import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Locate compilation dependencies in the pinned Red Hat Java installation. */
function javaExtension() {
  if (process.env.JTE_JAVA_EXTENSION) return process.env.JTE_JAVA_EXTENSION;
  const root = path.join(homedir(), '.vscode', 'extensions');
  const name = existsSync(root) ? readdirSync(root).find(name => /^redhat\.java-1\.56\.0(?:-|$)/.test(name)) : undefined;
  if (!name) throw new Error('Set JTE_JAVA_EXTENSION to the Red Hat Java 1.56.0 installation directory.');
  return path.join(root, name);
}

/** Locate Java build tools in an installed JDK. */
function javaTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const bundled = path.join(javaExtension(), 'jre');
  const candidates = [process.env.JTE_JDK_HOME, process.env.JAVA_HOME,
    ...(existsSync(bundled) ? readdirSync(bundled).map(directory => path.join(bundled, directory)) : [])].filter(Boolean);
  for (const home of candidates) {
    if (existsSync(path.join(home, 'bin', executable))) return path.join(home, 'bin', executable);
  }
  return executable;
}

mkdirSync('server/classes', { recursive: true });
const plugins = path.join(javaExtension(), 'server', 'plugins');
execFileSync(javaTool('javac'), ['-encoding', 'UTF-8', '--release', '21', '-cp', path.join(plugins, '*'),
  '-d', 'server/classes', 'server/src/dev/jte/bridge/JteCommand.java'], { stdio: 'inherit' });
execFileSync(javaTool('jar'), ['cfm', 'server/jte-java.jar', 'server/MANIFEST.MF', '-C', 'server/classes', '.',
  '-C', 'server', 'plugin.xml'], { stdio: 'inherit' });
