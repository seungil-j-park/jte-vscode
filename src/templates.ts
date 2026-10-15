import * as vscode from 'vscode';
import * as path from 'node:path';
import { Node, Parameter, Parsed, parse } from './parser';

export interface TemplateEntry { uri: vscode.Uri; root: vscode.Uri; name: string }
export interface TemplateTarget { entry: TemplateEntry; document: vscode.TextDocument; parsed: Parsed }
export interface TemplateProblem { start: number; end: number; message: string; code: string }

/** Discover workspace template roots and resolve files only by their exact relative paths. */
export class TemplateIndex implements vscode.Disposable {
  entries: TemplateEntry[] = [];
  generation = 0;
  private pending?: Promise<void>;
  private dirty = true;
  private disposables: vscode.Disposable[] = [];
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  /** Invalidate the path index when files or workspace folders change. */
  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.jte');
    this.disposables.push(watcher, watcher.onDidCreate(() => this.invalidate()), watcher.onDidDelete(() => this.invalidate()),
      watcher.onDidChange(() => this.invalidate()), vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(event => {
        // Use the updated roots on the next request after configuration changes.
        if (event.affectsConfiguration('jte.templateRoots')) this.invalidate();
      }));
  }

  /** Notify listeners and mark the index for rebuilding on the next request. */
  invalidate() { this.dirty = true; this.generation++; this.changed.fire(); }

  /** Share one file discovery result across concurrent requests. */
  async refresh(): Promise<void> {
    if (this.pending) { await this.pending; if (this.dirty) await this.refresh(); return; }
    if (!this.dirty) return;
    this.dirty = false;
    this.pending = this.scan();
    try { await this.pending; } finally { this.pending = undefined; }
  }

  /** Build template names from detected or configured roots. */
  private async scan() {
    const entries: TemplateEntry[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const configured = vscode.workspace.getConfiguration('jte', folder.uri).get<string[]>('templateRoots', []);
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.jte'), '**/{node_modules,.git,build,target,.gradle}/**');
      for (const uri of files) {
        let root: vscode.Uri | undefined;
        if (configured.length) {
          const candidates = configured.map(value => vscode.Uri.file(path.resolve(folder.uri.fsPath, value)))
            .filter(candidate => isWithin(candidate, uri)).sort((a, b) => b.path.length - a.path.length);
          root = candidates[0];
        } else {
          const match = /^(.*\/src\/(?:main|test)\/jte)\//.exec(uri.path);
          if (match) root = uri.with({ path: match[1] });
        }
        if (!root) continue;
        const relative = path.relative(root.fsPath, uri.fsPath).replace(/\\/g, '/');
        entries.push({ uri, root, name: relative.slice(0, -4).replace(/\//g, '.') });
      }
    }
    const unique = new Map(entries.map(entry => [entry.uri.toString(), entry]));
    this.entries = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Read a target document only when its exact template name resolves to one file. */
  async resolve(name: string): Promise<TemplateTarget | undefined> {
    await this.refresh();
    const matches = this.entries.filter(entry => entry.name === name);
    if (matches.length !== 1) return undefined;
    const document = await vscode.workspace.openTextDocument(matches[0].uri);
    return { entry: matches[0], document, parsed: parse(document.getText()) };
  }

  /** Report template path, argument name, and missing argument errors at source locations. */
  async problems(parsed: Parsed): Promise<TemplateProblem[]> {
    await this.refresh();
    const problems: TemplateProblem[] = [];
    for (const call of parsed.calls) {
      const name = parsed.text.slice(call.path!.start, call.path!.end);
      if (!call.closed) continue;
      const matches = this.entries.filter(entry => entry.name === name);
      if (matches.length !== 1) {
        problems.push({ ...call.path!, code: matches.length ? 'ambiguous-template' : 'unknown-template',
          message: matches.length ? 'Multiple template roots contain this path. Narrow the scope with jte.templateRoots.' : `Template not found: ${name}` });
        continue;
      }
      const target = await this.resolve(name);
      if (!target) continue;
      const params = target.parsed.params;
      const used = new Set<string>();
      let named = false;
      for (const [index, arg] of (call.args ?? []).entries()) {
        const parameter = arg.name ? params.find(param => param.name === arg.name) : params[index];
        if (!arg.name && named) problems.push({ ...arg, code: 'positional-after-named', message: 'Positional arguments cannot follow named arguments.' });
        named ||= !!arg.name;
        if (!parameter) problems.push({ ...(arg.nameSpan ?? arg), code: 'unknown-parameter', message: `Template parameter not found: ${arg.name ?? index + 1}` });
        else if (used.has(parameter.name)) problems.push({ ...(arg.nameSpan ?? arg), code: 'duplicate-parameter', message: `Duplicate parameter: ${parameter.name}` });
        else used.add(parameter.name);
      }
      for (const param of params) {
        if (!param.value && !used.has(param.name)) problems.push({ ...call.path!, code: 'missing-parameter', message: `Missing required parameter: ${param.name}` });
      }
    }
    return problems;
  }

  /** Return a target template type when it can be qualified without import conflicts. */
  qualifiedType(target: TemplateTarget, parameter: Parameter): string | undefined {
    const imports = new Map<string, string>();
    let wildcard = false;
    for (const node of target.parsed.imports) {
      const value = target.parsed.text.slice(node.body!.start, node.body!.end).trim().replace(/;$/, '');
      if (value.startsWith('static ')) continue;
      if (value.endsWith('.*')) wildcard = true;
      else imports.set(value.split('.').at(-1)!, value);
    }
    const original = target.parsed.text.slice(parameter.type.start, parameter.type.end);
    if (wildcard) return undefined;
    const javaLang = new Set(['String', 'Object', 'Boolean', 'Byte', 'Short', 'Integer', 'Long', 'Float', 'Double', 'Character',
      'Number', 'CharSequence', 'StringBuilder', 'StringBuffer', 'Iterable', 'Comparable', 'Class', 'Enum', 'Record', 'Throwable', 'Exception', 'RuntimeException', 'Void']);
    return original.replace(/\b[A-Za-z_$][\w$]*\b/g, (word, offset) => {
      // Do not replace words that already belong to a qualified name.
      return original[offset - 1] === '.' ? word : imports.get(word) ?? (javaLang.has(word) ? 'java.lang.' + word : word);
    });
  }

  /** Collect argument types for each call so the Java compiler can check assignability. */
  async argumentTypes(parsed: Parsed): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    for (const call of parsed.calls) {
      const target = await this.resolve(parsed.text.slice(call.path!.start, call.path!.end));
      if (!target) continue;
      const types = (call.args ?? []).map((arg, index) => {
        // Resolve named argument types independently of declaration order.
        const param = arg.name ? target.parsed.params.find(param => param.name === arg.name) : target.parsed.params[index];
        return param ? this.qualifiedType(target, param) ?? 'Object' : 'Object';
      });
      result.set(call.start, types);
    }
    return result;
  }

  /** Dispose of index events and file watchers. */
  dispose() { this.changed.dispose(); this.disposables.forEach(item => item.dispose()); }
}

/** Check path boundaries so similarly named folders are not mistaken for the root. */
function isWithin(parent: vscode.Uri, child: vscode.Uri) {
  const relative = path.relative(parent.fsPath, child.fsPath);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

/** Select the innermost call for accurate argument help inside nested content. */
export function callAt(parsed: Parsed, offset: number): Node | undefined {
  return parsed.calls.filter(call => offset >= call.start && offset <= call.end).sort((a, b) => b.start - a.start)[0];
}
