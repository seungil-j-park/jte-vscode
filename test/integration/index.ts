import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';

interface Result { name: string; passed: boolean; detail?: unknown; error?: string }
const results: Result[] = [];

/** Record each check independently to report the full set of results. */
async function check(name: string, action: () => Promise<unknown>) {
  try { results.push({ name, passed: true, detail: await action() }); }
  catch (error) { results.push({ name, passed: false, error: String(error instanceof Error ? error.stack : error) }); }
}

/** Poll within a time limit for asynchronous file events and server results. */
async function eventually<T>(action: () => Promise<T>, accept: (value: T) => boolean, milliseconds = 20000): Promise<T> {
  const deadline = Date.now() + milliseconds;
  let result: T;
  do {
    result = await action();
    if (accept(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 400));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting: ' + JSON.stringify(result));
}

/** Apply unsaved text changes in the editor. */
async function replace(document: vscode.TextDocument, text: string) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
  assert.ok(await vscode.workspace.applyEdit(edit));
}

/** Calculate a cursor position within the requested word. */
function at(document: vscode.TextDocument, word: string, delta = 1, last = false) {
  const offset = last ? document.getText().lastIndexOf(word) : document.getText().indexOf(word);
  assert.ok(offset >= 0, 'Search text not found in document: ' + word);
  return document.positionAt(offset + delta);
}

/** Invoke the definition provider registered in the real editor. */
async function definitions(document: vscode.TextDocument, word: string, delta = 1, last = false): Promise<vscode.Location[]> {
  const values = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDefinitionProvider', document.uri, at(document, word, delta, last));
  return (values ?? []).map(value => 'targetUri' in value ? new vscode.Location(value.targetUri, value.targetSelectionRange ?? value.targetRange) : value);
}

/** Read completion results from the real editor provider. */
async function completions(document: vscode.TextDocument, word: string) {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, at(document, word, word.length, true), undefined, 100);
  return list?.items ?? [];
}

/** Extract the plain label of a completion item. */
function label(item: vscode.CompletionItem) { return typeof item.label === 'string' ? item.label : item.label.label; }

/** Read the definition source to catch navigation to the wrong same-named method. */
async function definitionText(location: vscode.Location) {
  const target = await vscode.workspace.openTextDocument(location.uri);
  return { file: location.uri.fsPath, line: target.lineAt(location.range.start.line).text, selection: target.getText(location.range) };
}

/** Verify providers and unsaved edits in the Maven and Gradle fixtures. */
async function fixture(api: any, folder: vscode.Uri, gradle: boolean) {
  const prefix = gradle ? 'web/' : '';
  const model = gradle ? 'model/' : '';
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, prefix + 'src/main/jte/index.jte'));
  await vscode.window.showTextDocument(document);
  const original = document.getText();
  try {
    await check('template definition across roots', async () => {
      const found = await definitions(document, 'shared.card');
      assert.equal(found.length, 1);
      assert.ok(found[0].uri.path.endsWith(model + 'src/main/jte/shared/card.jte'));
      return found[0].uri.toString();
    });
    await check('editor F12 command opens template', async () => {
      const editor = await vscode.window.showTextDocument(document);
      const position = at(document, 'shared.card');
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('editor.action.revealDefinition');
      await eventually(async () => vscode.window.activeTextEditor?.document.uri.path ?? '', value => value.endsWith('/shared/card.jte'));
      await vscode.window.showTextDocument(document);
    });
    await check('imported Java class', async () => {
      const found = await definitions(document, 'demo.Person', 7);
      assert.equal(found.length, 1); const target = await definitionText(found[0]);
      assert.match(target.line, /public record Person/); return target;
    });
    await check('nested record type', async () => {
      const found = await definitions(document, 'Person.Address', 9);
      assert.equal(found.length, 1); const target = await definitionText(found[0]);
      assert.match(target.line, /record Address/); return target;
    });
    for (const [expression, expected] of [['greet("Hello")', 'String prefix'], ['greet(2)', 'int times']]) {
      await check('exact overload ' + expected, async () => {
        const found = await definitions(document, expression);
        assert.equal(found.length, 1); const target = await definitionText(found[0]);
        assert.ok(target.line.includes(expected)); return target;
      });
    }
    await check('JTE parameter declaration', async () => {
      const found = await definitions(document, 'person.greet');
      assert.equal(found.length, 1); assert.equal(found[0].uri.toString(), document.uri.toString());
      assert.equal(document.getText(found[0].range), 'person');
      assert.ok(document.lineAt(found[0].range.start.line).text.startsWith('@param'));
    });
    await check('record accessor and static field', async () => {
      for (const [word, delta] of [['person.name', 8], ['Person.LABEL', 8]] as const) {
        const found = await definitions(document, word, delta);
        assert.equal(found.length, 1); assert.ok(found[0].uri.path.endsWith('demo/Person.java'));
      }
    });
    await check('nested Content local variable scope', async () => {
      const found = await definitions(document, 'row.greet', 6);
      assert.equal(found.length, 1); assert.match((await definitionText(found[0])).line, /String prefix/);
    });
    await check('Java hover', async () => {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, at(document, 'greet("Hello")'));
      const contents = hovers?.flatMap(hover => hover.contents.map(value => typeof value === 'string' ? value : value.value));
      assert.ok(contents?.some(value => value.includes('String prefix')), JSON.stringify(contents)); return contents;
    });
    await check('parameter hover has no generated file link', async () => {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, at(document, 'person.greet'));
      const contents = hovers?.flatMap(hover => hover.contents.map(value => typeof value === 'string' ? value : value.value));
      assert.ok(contents?.some(value => value.includes('Person')), JSON.stringify({ contents,
        raw: (await api.java.request(document, 'hover', document.offsetAt(at(document, 'person.greet'))))?.response.result }));
      assert.ok(!contents?.some(value => value.includes('JteAnalysis_'))); return contents;
    });
    await check('Java overload signature help', async () => {
      const help = await vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', document.uri, at(document, 'greet("Hello")', 6));
      assert.ok(help.signatures.some(signature => signature.label.includes('String prefix')));
      assert.ok(help.signatures.some(signature => signature.label.includes('int times'))); return help;
    });
    await check('valid document has no Java errors', async () => {
      const errors = await api.java.diagnostics(document);
      assert.deepEqual(errors, []); return errors;
    });
    await check('analysis working copy has no physical Java file', async () => {
      const snapshot = await api.java.request(document, 'probe', document.offsetAt(at(document, 'person.greet')));
      assert.ok(snapshot?.response.result.resolved);
      assert.equal(fs.existsSync(vscode.Uri.parse(snapshot.response.uri).fsPath), false);
      return snapshot.response.uri;
    });
    await check('parameter default references original declaration', async () => {
      await replace(document, '@param String first\n@param String second = first\n${second}');
      const found = await definitions(document, 'first', 2, true);
      assert.equal(found.length, 1); assert.equal(found[0].range.start.line, 0);
      await replace(document, original);
    });
    await check('Java method completion from unsaved incomplete expression', async () => {
      await replace(document, original + '\n${person.gre}');
      const items = await completions(document, 'person.gre');
      assert.ok(items.some(item => label(item) === 'greet'));
      const item = items.find(item => label(item) === 'greet')!;
      assert.ok(item.range); return { label: item.label, range: item.range, insertText: item.insertText };
    });
    await check('Java class completion and import conversion', async () => {
      await replace(document, original.replace('@param Person person', '@param ArrayLis values\n@param Person person'));
      const items = await completions(document, 'ArrayLis');
      const item = items.find(item => label(item) === 'ArrayList');
      assert.ok(item, JSON.stringify(items.map(label)));
      assert.ok(item.additionalTextEdits?.some(edit => edit.newText.includes('@import java.util.ArrayList')));
      return { label: item.label, edits: item.additionalTextEdits };
    });
    await check('incomplete parameter type completion', async () => {
      await replace(document, '@param Str');
      assert.ok((await completions(document, 'Str')).some(item => label(item) === 'String'));
    });
    await check('template path completion', async () => {
      await replace(document, original + '\n@template.shared.ca');
      assert.ok((await completions(document, 'shared.ca')).some(item => label(item) === 'shared.card'));
    });
    await check('template parameter completion', async () => {
      await replace(document, original + '\n@template.shared.card(ti)');
      assert.ok((await completions(document, 'card(ti')).some(item => label(item) === 'title'));
    });
    await check('Java diagnostics preserve exact source locations', async () => {
      await replace(document, original + '\n<p>' + String.fromCodePoint(0x1f600) + '${person.missingMethod()}</p>\n!{int count = "wrong";}\n');
      await api.validate(document);
      const errors = await eventually(async () => [...(api.diagnostics.get(document.uri) ?? [])] as vscode.Diagnostic[], values => values.some(value => document.getText(value.range) === 'missingMethod'));
      assert.ok(errors.some(value => document.getText(value.range) === '"wrong"'));
      return errors.map(value => ({ text: document.getText(value.range), message: value.message, range: value.range }));
    });
    await check('template argument type mismatch', async () => {
      await replace(document, original + '\n@template.shared.card(title = 42, content = @`ok`)');
      const errors = await api.java.diagnostics(document) as vscode.Diagnostic[];
      assert.ok(errors.some(error => document.getText(error.range) === '42'), JSON.stringify({ errors,
        raw: await api.java.request(document, 'diagnostics') }));
      return errors;
    });
    await check('unresolved template and missing required argument', async () => {
      await replace(document, original + '\n@template.does.not.exist()\n@template.shared.card(title = "Only")');
      await api.validate(document);
      const values = await eventually(async () => [...(api.diagnostics.get(document.uri) ?? [])] as vscode.Diagnostic[], values => values.some(value => value.code === 'unknown-template'));
      assert.ok(values.some(value => value.code === 'missing-parameter')); return values;
    });
    await check('unsaved target parameters', async () => {
      const target = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, model + 'src/main/jte/shared/card.jte'));
      const saved = target.getText();
      try {
        await replace(target, saved + '\n@param int capacity = 1');
        await replace(document, original + '\n@template.shared.card(capa)');
        assert.ok((await completions(document, 'card(capa')).some(item => label(item) === 'capacity'));
      } finally { await replace(target, saved); }
    });
    await check('unsaved Java member is visible', async () => {
      const target = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, model + 'src/main/java/demo/Person.java'));
      const saved = target.getText();
      try {
        await replace(target, saved.replace(/}\s*$/, '    /** Verify unsaved Java edits. */\n    public String unsavedName() { return name; }\n}\n'));
        await replace(document, original + '\n${person.unsavedName()}');
        const found = await eventually(() => definitions(document, 'unsavedName'), values => values.length === 1);
        assert.equal(found[0].uri.toString(), target.uri.toString());
      } finally { await replace(target, saved); }
    });
    await check('create rename delete refresh and ambiguous roots', async () => {
      const created = vscode.Uri.joinPath(folder, prefix + 'src/main/jte/generated.jte');
      const renamed = vscode.Uri.joinPath(folder, prefix + 'src/main/jte/renamed.jte');
      const duplicate = vscode.Uri.joinPath(folder, 'duplicate/src/main/jte/shared/card.jte');
      try {
        await vscode.workspace.fs.writeFile(created, Buffer.from('<p>Temporary</p>'));
        await eventually(async () => { await api.index.refresh(); return api.index.entries; }, entries => entries.some((entry: any) => entry.name === 'generated'));
        await vscode.workspace.fs.rename(created, renamed);
        await eventually(async () => { await api.index.refresh(); return api.index.entries; }, entries => entries.some((entry: any) => entry.name === 'renamed') && !entries.some((entry: any) => entry.name === 'generated'));
        await vscode.workspace.fs.delete(renamed);
        await eventually(async () => { await api.index.refresh(); return api.index.entries; }, entries => !entries.some((entry: any) => entry.name === 'renamed'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, 'duplicate/src/main/jte/shared'));
        await vscode.workspace.fs.writeFile(duplicate, Buffer.from('<p>Duplicate</p>'));
        await eventually(async () => { await api.index.refresh(); return api.index.entries; }, entries => entries.filter((entry: any) => entry.name === 'shared.card').length === 2);
        await replace(document, original);
        assert.deepEqual(await definitions(document, 'shared.card'), []);
      } finally {
        for (const uri of [created, renamed, duplicate]) {
          try { await vscode.workspace.fs.delete(uri); } catch { /* An already deleted temporary file needs no further cleanup. */ }
        }
        api.index.invalidate();
      }
    });
  } finally { await replace(document, original); }
}

/** Run all checks in the real VS Code Extension Host and write a result report. */
export async function run() {
  const scenario = process.env.JTE_TEST_SCENARIO || 'maven';
  const report: Record<string, unknown> = { scenario, vscode: vscode.version, timestamp: new Date().toISOString(), results };
  try {
    const java = vscode.extensions.getExtension('redhat.java')!;
    report.java = java.packageJSON.version; assert.equal(report.java, '1.56.0');
    const javaApi = await java.activate(); await javaApi.serverReady();
    const extension = vscode.extensions.getExtension(process.env.JTE_TEST_EXTENSION_ID!)!;
    report.extensionPath = extension.extensionPath;
    report.extensionVersion = extension.packageJSON.version;
    const api = await extension.activate();
    const folder = vscode.workspace.workspaceFolders![0].uri;
    assert.ok(['maven', 'gradle'].includes(scenario), 'Unknown fixture scenario: ' + scenario);
    await fixture(api, folder, scenario === 'gradle');
    report.status = api.java.status;
    assert.equal(results.filter(result => !result.passed).length, 0, JSON.stringify(results.filter(result => !result.passed)));
  } catch (error) {
    report.error = String(error instanceof Error ? error.stack : error); throw error;
  } finally {
    fs.mkdirSync(path.join(process.env.JTE_TEST_ROOT!, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(process.env.JTE_TEST_ROOT!, 'artifacts', 'integration-' + scenario + '.json'), JSON.stringify(report, null, 2));
  }
}
