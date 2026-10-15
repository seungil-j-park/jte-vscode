import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';

/** Locate the installed VS Code built-in grammars for tokenization tests. */
function builtinExtensions(): string {
  if (process.env.JTE_VSCODE_GRAMMARS) return process.env.JTE_VSCODE_GRAMMARS;
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code') : undefined;
  const candidates = root && fs.existsSync(root) ? [root, ...fs.readdirSync(root).map(name => path.join(root, name))] : [];
  for (const candidate of candidates) {
    const location = path.join(candidate, 'resources', 'app', 'extensions');
    if (fs.existsSync(path.join(location, 'html'))) return location;
  }
  throw new Error('Set JTE_VSCODE_GRAMMARS to the VS Code built-in extensions directory.');
}

/** Check real TextMate tokenization of HTML, Java, CSS, JavaScript, and nested JTE. */
test('TextMate nested JTE and embedded languages', async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const grammars = new Map<string, string>();
  const builtins = builtinExtensions();
  for (const folder of fs.readdirSync(builtins)) {
    const manifest = path.join(builtins, folder, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    for (const grammar of JSON.parse(fs.readFileSync(manifest, 'utf8')).contributes?.grammars ?? []) {
      grammars.set(grammar.scopeName, path.join(builtins, folder, grammar.path));
    }
  }
  grammars.set('text.html.jte', path.resolve('syntaxes/jte.tmLanguage.json'));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: patterns => new OnigScanner(patterns), createOnigString: text => new OnigString(text) }),
    /** Load actual built-in grammars for embedded languages instead of empty substitutes. */
    async loadGrammar(scope) {
      const file = grammars.get(scope);
      return file ? parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null;
    }
  });
  const grammar = (await registry.loadGrammar('text.html.jte'))!;
  let stack = INITIAL;
  const rows = [
    '@import demo.Person', '@param Person person', '<%-- comment --%>',
    '@template.shared.card(', '  title = person.greet("Hello"), content = @`',
    '  @template.shared.inner(content = @`<b>${person.name()}</b>`)',
    '  <p class="${person.name()}">${person.age()}</p>', '`)',
    '<style>.card { color: red; }</style>', '<script>const value = 42;</script>',
    '!{var names = java.util.List.of("}");}', '${names.stream().map(x -> { return x; }).toList()}'
  ];
  const tokens = rows.map(row => {
    // Preserve state between lines to verify multiline calls and inline content.
    const result = grammar.tokenizeLine(row, stack); stack = result.ruleStack; return result.tokens;
  });
  /** Check that a word receives the expected standard token scope. */
  function scope(line: number, word: string, expected: string) {
    const offset = rows[line].indexOf(word);
    const token = tokens[line].find(token => token.startIndex <= offset && token.endIndex > offset)!;
    assert.ok(token.scopes.some(scope => scope.includes(expected)), JSON.stringify({ line, word, expected, scopes: token.scopes }));
  }
  scope(0, '@import', 'keyword.control'); scope(2, 'comment', 'comment.block');
  scope(3, 'shared', 'entity.name.namespace'); scope(3, 'card', 'entity.name.function');
  scope(4, 'title', 'variable.parameter'); scope(4, 'person', 'source.java');
  scope(5, 'inner', 'entity.name.function'); scope(5, 'name', 'source.java');
  scope(6, 'class', 'attribute-name'); scope(6, 'age', 'source.java');
  scope(8, 'color', 'source.css'); scope(9, 'const', 'source.js');
  scope(10, 'var', 'source.java'); scope(11, 'return', 'source.java');
  assert.equal(stack.depth, 1, 'Closed expressions must return to the top-level JTE state.');
});
