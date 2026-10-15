import * as vscode from 'vscode';
import { parse, Parsed, Span } from './parser';
import { mapOffset, mapSpan, project, Projection } from './projection';
import { TemplateIndex } from './templates';

interface WirePosition { line: number; character: number }
interface WireRange { start: WirePosition; end: WirePosition }
interface WireLocation { uri: string; range: WireRange }
interface Response<T> { uri: string; project: string; result: T }
interface Snapshot<T> { response: Response<T>; projection: Projection; parsed: Parsed; version: number }
interface JavaAPI { serverReady(): Promise<boolean>; onDidClasspathUpdate?: vscode.Event<vscode.Uri>; onDidProjectsImport?: vscode.Event<vscode.Uri[]> }

/** Manage Java server requests and source position mappings. */
export class JavaBridge implements vscode.Disposable {
  private api?: Promise<JavaAPI>;
  private disposables: vscode.Disposable[] = [];
  private output = vscode.window.createOutputChannel('JTE');
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  status = 'Waiting for the Java server';

  /** Connect the template index and watch Java edits that can change analysis results. */
  constructor(private index: TemplateIndex) {
    this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
      // Reanalyze JTE when the server receives changes to unsaved Java working copies.
      if (event.document.languageId === 'java') this.changed.fire();
    }));
  }

  /** Activate the Java extension and subscribe to project changes once. */
  private async ready(): Promise<JavaAPI> {
    if (!this.api) {
      this.api = (async () => {
        // Use the installed extension version without requesting installation or upgrades.
        const extension = vscode.extensions.getExtension<JavaAPI>('redhat.java');
        if (!extension) throw new Error('The Red Hat Java extension is not installed.');
        const api = await extension.activate();
        this.output.appendLine('Red Hat Java ' + extension.packageJSON.version);
        if (api.onDidClasspathUpdate) this.disposables.push(api.onDidClasspathUpdate(() => this.changed.fire()));
        if (api.onDidProjectsImport) this.disposables.push(api.onDidProjectsImport(() => this.changed.fire()));
        await api.serverReady();
        this.status = 'Java server ready';
        this.changed.fire();
        return api;
      })();
    }
    return withTimeout(this.api, 15000);
  }

  /** Analyze the current unsaved document and discard results made stale by further edits. */
  async request<T>(document: vscode.TextDocument, operation: string, offset = 0, token?: vscode.CancellationToken): Promise<Snapshot<T> | undefined> {
    if (!vscode.workspace.getConfiguration('jte', document.uri).get('java.enabled', true)) return;
    const version = document.version;
    const parsed = parse(document.getText());
    try {
      await this.ready();
      if (token?.isCancellationRequested || document.version !== version || document.isClosed) return;
      const types = await this.index.argumentTypes(parsed);
      const projection = project(parsed, document.uri.toString(), types);
      const mapped = operation === 'diagnostics' ? 0 : mapOffset(projection.mappings, offset, 'source');
      if (mapped === undefined) return;
      const raw = await vscode.commands.executeCommand<string>('java.execute.workspaceCommand', 'jte.java.request', JSON.stringify({
        operation, sourceUri: document.uri.toString(), className: projection.className, code: projection.code, offset: mapped
      }));
      if (token?.isCancellationRequested || document.version !== version || document.isClosed) return;
      const response = unwrap(JSON.parse(raw!)) as Response<T>;
      this.status = 'Java analysis connected: ' + response.project;
      return { response, projection, parsed, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.status !== message) this.output.appendLine(message);
      this.status = message;
      return undefined;
    }
  }

  /** Use Java-resolved definitions and map helper class declarations back to JTE. */
  async definition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
    const snapshot = await this.request<WireLocation[]>(document, 'definition', document.offsetAt(position), token);
    if (!snapshot) return [];
    const locations: vscode.Location[] = [];
    for (const location of snapshot.response.result ?? []) {
      if (sameUri(location.uri, snapshot.response.uri)) {
        const range = originalRange(snapshot.projection, location.range);
        if (range) locations.push(new vscode.Location(document.uri, documentRange(document, range)));
      } else locations.push(new vscode.Location(vscode.Uri.parse(location.uri), wireRange(location.range)));
    }
    return locations;
  }

  /** Return read-only Markdown documentation for Java methods and types. */
  async hover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
    const snapshot = await this.request<any>(document, 'hover', document.offsetAt(position), token);
    if (!snapshot?.response.result) return;
    const result = snapshot.response.result;
    const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
    const markdown = contents.filter((value: any) => {
      // Hide nonexistent file links for the in-memory analysis class.
      const text = typeof value === 'string' ? value : value?.value ?? '';
      return value && (value.language || !text.includes(snapshot.projection.className));
    }).map((value: any) => {
      // Do not grant execution permission to command links returned by the language server.
      const item = new vscode.MarkdownString();
      if (value.language) item.appendCodeblock(value.value.replaceAll(snapshot.projection.className, 'JTE'), value.language);
      else item.appendMarkdown(typeof value === 'string' ? value : value.value ?? '');
      return item;
    });
    return markdown.length ? new vscode.Hover(markdown) : undefined;
  }

  /** Translate Java completion replacement ranges and import additions into JTE edits. */
  async completion(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
    const snapshot = await this.request<any[]>(document, 'completion', document.offsetAt(position), token);
    if (!snapshot) return [];
    const items: vscode.CompletionItem[] = [];
    for (const value of snapshot.response.result ?? []) {
      if (value.label.startsWith('__jte') || value.label.startsWith('JteAnalysis_')) continue;
      if (value.detail?.includes(snapshot.projection.className)) continue;
      const kind = typeof value.kind === 'string' ? (vscode.CompletionItemKind as any)[value.kind] : value.kind - 1;
      const item = new vscode.CompletionItem(value.label, kind);
      item.detail = value.detail;
      item.sortText = value.sortText;
      item.filterText = value.label;
      if (value.labelDetails) item.label = { label: value.label, ...value.labelDetails };
      if (value.documentation) item.documentation = new vscode.MarkdownString(typeof value.documentation === 'string' ? value.documentation : value.documentation.value);
      const edit = value.textEdit;
      const newText = edit?.newText ?? value.insertText ?? value.label;
      item.insertText = value.insertTextFormat === 'Snippet' || value.insertTextFormat === 2 ? new vscode.SnippetString(newText) : newText;
      if (edit) {
        const inserting = originalRange(snapshot.projection, edit.range ?? edit.insert);
        const replacing = originalRange(snapshot.projection, edit.range ?? edit.replace);
        if (!inserting || !replacing) continue;
        item.range = { inserting: documentRange(document, inserting), replacing: documentRange(document, replacing) };
      }
      const additional: vscode.TextEdit[] = [];
      let safe = true;
      for (const extra of value.additionalTextEdits ?? []) {
        const mapped = originalRange(snapshot.projection, extra.range);
        if (mapped) additional.push(vscode.TextEdit.replace(documentRange(document, mapped), extra.newText));
        else {
          const imports = extra.newText.trim().split(/\r?\n/).filter((line: string) => line.trim());
          if (!imports.length || !imports.every((line: string) => /^\s*import\s+(?:static\s+)?[\w$.*]+\s*;\s*$/.test(line))) { safe = false; break; }
          const text = imports.map((line: string) => line.trim().replace(/^import\s+/, '@import ').replace(/;$/, '')).join('\n') + '\n';
          additional.push(vscode.TextEdit.insert(new vscode.Position(0, 0), text));
        }
      }
      if (!safe) continue;
      item.additionalTextEdits = additional;
      items.push(item);
    }
    return items;
  }

  /** Return server-resolved overload candidates and the active argument position. */
  async signature(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
    const snapshot = await this.request<any>(document, 'signature', document.offsetAt(position), token);
    const result = snapshot?.response.result;
    if (!result?.signatures?.length) return;
    const help = new vscode.SignatureHelp();
    help.activeSignature = result.activeSignature ?? 0;
    help.activeParameter = result.activeParameter ?? 0;
    help.signatures = result.signatures.filter((signature: any) => !signature.label.includes('__jte')).map((value: any) => {
      // Hide generated helper calls from signature help.
      const signature = new vscode.SignatureInformation(value.label, markdown(value.documentation));
      signature.parameters = (value.parameters ?? []).map((param: any) => new vscode.ParameterInformation(param.label, markdown(param.documentation)));
      return signature;
    });
    return help.signatures.length ? help : undefined;
  }

  /** Show compiler diagnostics only when their entire range maps to source text. */
  async diagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    const snapshot = await this.request<Array<Span & { message: string; code: number }>>(document, 'diagnostics');
    if (!snapshot) return [];
    const diagnostics: vscode.Diagnostic[] = [];
    const seen = new Set<string>();
    for (const problem of snapshot.response.result ?? []) {
      const mapped = mapSpan(snapshot.projection.mappings, problem, 'generated');
      if (!mapped || mapped.start === mapped.end) continue;
      const key = [mapped.start, mapped.end, problem.code, problem.message].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const diagnostic = new vscode.Diagnostic(documentRange(document, mapped), problem.message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'JTE Java'; diagnostic.code = problem.code;
      diagnostics.push(diagnostic);
    }
    return diagnostics;
  }

  /** Release the server working copy when its JTE document closes. */
  async close(uri: vscode.Uri) {
    if (!this.api) return;
    try { await vscode.commands.executeCommand('java.execute.workspaceCommand', 'jte.java.request', JSON.stringify({ operation: 'close', sourceUri: uri.toString() })); }
    catch (error) { this.output.appendLine('Working copy release: ' + String(error)); }
  }

  /** Open the output channel so users can inspect status and errors. */
  showStatus() { this.output.appendLine(this.status); this.output.show(true); return this.status; }

  /** Dispose of event subscriptions and the output channel. */
  dispose() { this.disposables.forEach(item => item.dispose()); this.changed.dispose(); this.output.dispose(); }
}

/** Bound request waiting time while projects load slowly. */
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    // The server continues loading after the request times out.
    const timer = setTimeout(() => reject(new Error('The Java project is still importing. Try again shortly.')), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** Recursively unwrap server Either values into ordinary protocol values. */
function unwrap(value: any): any {
  if (Array.isArray(value)) return value.map(unwrap);
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && (keys[0] === 'left' || keys[0] === 'right')) return unwrap(value[keys[0]]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]));
}

/** Convert a language server position into a Java string offset. */
function offsetAt(text: string, position: WirePosition): number {
  let start = 0;
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf('\n', start);
    if (next < 0) return text.length;
    start = next + 1;
  }
  return start + position.character;
}

/** Return a JTE range only when the Java range lies within a source fragment. */
function originalRange(projection: Projection, range: WireRange): Span | undefined {
  return mapSpan(projection.mappings, { start: offsetAt(projection.code, range.start), end: offsetAt(projection.code, range.end) }, 'generated');
}

/** Convert source offsets into a VS Code range. */
export function documentRange(document: vscode.TextDocument, span: Span) { return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)); }

/** Convert a language server range into VS Code position objects. */
function wireRange(range: WireRange) { return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character); }

/** Handle differences in URI drive-letter casing. */
function sameUri(left: string, right: string) {
  const a = vscode.Uri.parse(left); const b = vscode.Uri.parse(right);
  return a.scheme === b.scheme && (process.platform === 'win32' ? a.fsPath.toLowerCase() === b.fsPath.toLowerCase() : a.path === b.path);
}

/** Convert documentation strings or MarkupContent into safe Markdown. */
function markdown(value: any): vscode.MarkdownString | undefined { return value ? new vscode.MarkdownString(typeof value === 'string' ? value : value.value ?? '') : undefined; }
