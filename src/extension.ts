import * as vscode from 'vscode';
import { parse } from './parser';
import { TemplateIndex, callAt } from './templates';
import { JavaBridge, documentRange } from './javaBridge';

/** Register JTE editor features and the Java analysis lifecycle. */
export function activate(context: vscode.ExtensionContext) {
  const index = new TemplateIndex();
  const java = new JavaBridge(index);
  const diagnostics = vscode.languages.createDiagnosticCollection('jte');
  const selector: vscode.DocumentSelector = { language: 'jte', scheme: 'file' };
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const runs = new Map<string, number>();
  const status = vscode.languages.createLanguageStatusItem('jte.java', selector);
  status.name = 'JTE Java'; status.text = 'JTE'; status.command = { command: 'jte.showStatus', title: 'Show Analysis Status' };

  /** Prevent older analysis results from replacing newer document diagnostics. */
  async function validate(document: vscode.TextDocument) {
    if (document.isClosed || document.languageId !== 'jte') return;
    const key = document.uri.toString();
    const run = (runs.get(key) ?? 0) + 1; runs.set(key, run);
    const version = document.version;
    if (!vscode.workspace.getConfiguration('jte', document.uri).get('diagnostics.enabled', true)) { diagnostics.delete(document.uri); return; }
    try {
      const parsed = parse(document.getText());
      const templateProblems = await index.problems(parsed);
      const local = [...parsed.issues, ...templateProblems].map(problem => {
        // Show JTE syntax and path errors independently of Java server loading.
        const diagnostic = new vscode.Diagnostic(documentRange(document, problem), problem.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'JTE';
        if ('code' in problem) diagnostic.code = problem.code as string;
        return diagnostic;
      });
      if (document.version === version && runs.get(key) === run) diagnostics.set(document.uri, local);
      const javaProblems = await java.diagnostics(document);
      if (!document.isClosed && document.version === version && runs.get(key) === run) diagnostics.set(document.uri, [...local, ...javaProblems]);
      status.detail = java.status;
    } catch (error) { status.detail = 'Analysis failed: ' + String(error); }
  }

  /** Debounce rapid edits and analyze only the latest document version. */
  function schedule(document: vscode.TextDocument) {
    if (document.languageId !== 'jte') return;
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); void validate(document); }, 300));
  }

  /** Recheck open templates after dependency files change. */
  function refreshOpen() { vscode.workspace.textDocuments.forEach(schedule); }

  context.subscriptions.push(index, java, diagnostics, status,
    vscode.commands.registerCommand('jte.showStatus', () => java.showStatus()),
    index.onDidChange(refreshOpen), java.onDidChange(refreshOpen),
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(event => {
      // Parameter declaration changes also affect callers of the template.
      if (event.document.languageId === 'jte') refreshOpen();
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      // Release each document's timer and server working copy together.
      if (document.languageId !== 'jte') return;
      const key = document.uri.toString();
      clearTimeout(timers.get(key)); timers.delete(key); runs.delete(key);
      diagnostics.delete(document.uri); void java.close(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      // Refresh existing diagnostics when a feature is disabled.
      if (event.affectsConfiguration('jte')) refreshOpen();
    }),
    { dispose() { /* Cancel pending analysis when the extension shuts down. */ for (const timer of timers.values()) clearTimeout(timer); } },
    vscode.languages.registerDefinitionProvider(selector, {
      /** Resolve exact template paths and argument declarations before delegating Java definitions to the server. */
      async provideDefinition(document, position, token) {
        const parsed = parse(document.getText());
        const offset = document.offsetAt(position);
        const call = callAt(parsed, offset);
        if (call) {
          const target = await index.resolve(parsed.text.slice(call.path!.start, call.path!.end));
          if (offset >= call.path!.start && offset <= call.path!.end) {
            return target ? new vscode.Location(target.entry.uri, new vscode.Position(0, 0)) : undefined;
          }
          const arg = call.args?.find(arg => arg.nameSpan && offset >= arg.nameSpan.start && offset <= arg.nameSpan.end);
          const param = target?.parsed.params.find(param => param.name === arg?.name);
          if (target && param) return new vscode.Location(target.entry.uri, documentRange(target.document, param.nameSpan));
        }
        return java.definition(document, position, token);
      }
    }),
    vscode.languages.registerCompletionItemProvider(selector, {
      /** Suggest template paths and parameter names together with Java completions. */
      async provideCompletionItems(document, position, token) {
        const parsed = parse(document.getText());
        const offset = document.offsetAt(position);
        const call = callAt(parsed, offset);
        if (call && offset >= call.path!.start && offset <= call.path!.end) {
          await index.refresh();
          const items: vscode.CompletionItem[] = [];
          for (const entry of index.entries) {
            const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.File);
            item.range = documentRange(document, call.path!); item.insertText = entry.name;
            item.detail = vscode.workspace.asRelativePath(entry.uri);
            items.push(item);
          }
          return items;
        }
        const items: vscode.CompletionItem[] = [];
        if (call) {
          const start = call.args?.find(arg => offset >= arg.start && offset <= arg.end)?.start ?? offset;
          if (/^\s*[\w$]*$/.test(parsed.text.slice(start, offset))) {
            const target = await index.resolve(parsed.text.slice(call.path!.start, call.path!.end));
            for (const param of target?.parsed.params ?? []) {
              if (call.args?.some(arg => arg.name === param.name)) continue;
              const item = new vscode.CompletionItem(param.name, vscode.CompletionItemKind.Property);
              item.detail = target!.parsed.text.slice(param.type.start, param.type.end);
              item.insertText = new vscode.SnippetString(param.name + ' = $0');
              items.push(item);
            }
          }
        }
        return [...items, ...await java.completion(document, position, token)];
      }
    }, '.', '=', ' ', ','),
    vscode.languages.registerHoverProvider(selector, {
      /** Show template declarations or documentation for Java types and methods. */
      async provideHover(document, position, token) {
        const parsed = parse(document.getText());
        const offset = document.offsetAt(position);
        const call = callAt(parsed, offset);
        if (call && offset >= call.path!.start && offset <= call.path!.end) {
          const target = await index.resolve(parsed.text.slice(call.path!.start, call.path!.end));
          if (target) {
            const content = new vscode.MarkdownString().appendCodeblock(target.parsed.params.map(param => '@param ' + target.parsed.text.slice(param.declaration.start, param.end).trim()).join('\n'), 'jte');
            return new vscode.Hover(content, documentRange(document, call.path!));
          }
        }
        return java.hover(document, position, token);
      }
    }),
    vscode.languages.registerSignatureHelpProvider(selector, {
      /** Prefer inner Java call signatures, then provide template argument help. */
      async provideSignatureHelp(document, position, token) {
        const fromJava = await java.signature(document, position, token);
        if (fromJava) return fromJava;
        const parsed = parse(document.getText());
        const offset = document.offsetAt(position);
        const call = callAt(parsed, offset);
        if (!call || offset <= call.path!.end) return;
        if (call.args?.some(arg => arg.value.contents.some(content => offset > content.start && offset < content.end))) return;
        const target = await index.resolve(parsed.text.slice(call.path!.start, call.path!.end));
        if (!target) return;
        const declarations = target.parsed.params.map(param => target.parsed.text.slice(param.declaration.start, param.declaration.end));
        const signature = new vscode.SignatureInformation(target.entry.name + '(' + declarations.join(', ') + ')');
        signature.parameters = declarations.map(value => new vscode.ParameterInformation(value));
        const help = new vscode.SignatureHelp(); help.signatures = [signature]; help.activeSignature = 0;
        const argIndex = call.args?.findIndex(arg => offset <= arg.end) ?? -1;
        const arg = call.args?.[argIndex];
        help.activeParameter = arg?.name ? Math.max(0, target.parsed.params.findIndex(param => param.name === arg.name)) : Math.max(0, argIndex);
        return help;
      }
    }, '(', ',')
  );
  refreshOpen();
  // Extension Host tests invoke editor providers; this API is only for awaiting diagnostics and checking status.
  return { validate, index, java, diagnostics };
}
