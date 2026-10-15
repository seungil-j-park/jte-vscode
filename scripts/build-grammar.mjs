import fs from 'node:fs';

// Preserve the Apache-2.0 grammar's HTML rules and replace its JTE rules with recursive patterns.
const grammar = JSON.parse(fs.readFileSync('third-party/jte-syntax/jte.tmLanguage.json', 'utf8'));
grammar.name = 'JTE for VS Code';
grammar.comment = 'HTML rules: Copyright 2022 Mansour Abou Jaoude, Apache-2.0. JTE rules rewritten in 2026; see THIRD_PARTY_NOTICES.md.';
const repository = grammar.repository;
const include = name => ({ include: '#' + name }); // Reference a rule in the same grammar repository.
const keyword = { '0': { name: 'keyword.control.jte' } };
const java = [include('inline'), include('java-string'), include('java-comment'), include('java-parens'), include('java-braces'), include('java-brackets'), { include: 'source.java' }];
repository['jte-root'] = { patterns: [include('jte-comment'), include('jte-raw'), include('jte-call'), include('jte-declaration'), include('jte-condition'), include('jte-keyword'), include('jte-statement')] };
grammar.patterns = [include('jte-root'), include('html_tags'), { include: 'text.html.basic' }];
repository['jte-comment'] = { begin: '<%--', end: '--%>', name: 'comment.block.jte' };
repository['jte-raw'] = { begin: '@raw\\b', end: '@endraw\\b', beginCaptures: keyword, endCaptures: keyword };
repository['jte-keyword'] = { match: '@(?:else|endif|endfor)\\b', name: 'keyword.control.jte' };
repository['jte-declaration'] = { begin: '@(?:import|param)\\b', end: '$', beginCaptures: keyword, contentName: 'meta.embedded.block.java source.java', patterns: java };
repository['jte-condition'] = { begin: '(@(?:if|elseif|for))\\s*(\\()', end: '\\)',
  beginCaptures: { '1': { name: 'keyword.control.jte' }, '2': { name: 'punctuation.section.parens.begin.java' } },
  contentName: 'meta.embedded.block.java source.java', patterns: java };
repository['jte-statement'] = { begin: '[$!]\\{', end: '\\}', beginCaptures: { '0': { name: 'punctuation.section.embedded.begin.jte' } },
  endCaptures: { '0': { name: 'punctuation.section.embedded.end.jte' } }, contentName: 'meta.embedded.block.java source.java', patterns: java };
repository['jte-call'] = { begin: '(@template)(\\.)', end: '(?<=\\))|(?=[^\\w.$\\s(])',
  beginCaptures: { '1': { name: 'keyword.control.jte' }, '2': { name: 'punctuation.accessor.jte' } },
  patterns: [
    { match: '[A-Za-z_$][\\w$]*(?=\\.)', name: 'entity.name.namespace.jte' },
    { match: '[A-Za-z_$][\\w$]*', name: 'entity.name.function.jte' },
    { match: '\\.', name: 'punctuation.accessor.jte' }, include('jte-arguments')
  ] };
repository['jte-arguments'] = { begin: '\\(', end: '\\)', name: 'meta.arguments.jte', contentName: 'meta.embedded.block.java source.java', patterns: [
  { match: '\\b([A-Za-z_$][\\w$]*)(\\s*)(=)(?!=)', captures: { '1': { name: 'variable.parameter.jte' }, '3': { name: 'keyword.operator.assignment.java' } } },
  ...java
] };
repository.inline = { begin: '@`', end: '`', name: 'meta.inline-content.jte', contentName: 'text.html.jte',
  beginCaptures: { '0': { name: 'punctuation.section.embedded.begin.jte' } },
  endCaptures: { '0': { name: 'punctuation.section.embedded.end.jte' } }, patterns: [{ include: '$self' }] };
repository['java-string'] = { patterns: [
  { begin: '"""', end: '"""', name: 'string.quoted.triple.java', patterns: [{ match: '\\\\.', name: 'constant.character.escape.java' }] },
  { begin: '"', end: '"|$', name: 'string.quoted.double.java', patterns: [{ match: '\\\\.', name: 'constant.character.escape.java' }] },
  { begin: "'", end: "'|$", name: 'string.quoted.single.java', patterns: [{ match: '\\\\.', name: 'constant.character.escape.java' }] }
] };
repository['java-comment'] = { patterns: [
  { begin: '/\\*', end: '\\*/', name: 'comment.block.java' }, { match: '//.*$', name: 'comment.line.double-slash.java' }
] };
for (const [name, begin, end] of [['parens', '\\(', '\\)'], ['braces', '\\{', '\\}'], ['brackets', '\\[', '\\]']]) {
  repository['java-' + name] = { begin, end, contentName: 'source.java', patterns: java };
}
delete repository['jte-comparison'];
// Give JTE expressions priority inside the existing HTML script and style rules.
/** Add JTE inclusion rules to nested HTML grammar patterns. */
function inject(rule) {
  if (!rule || typeof rule !== 'object') return;
  if (Array.isArray(rule.patterns) && rule.patterns.some(item => ['source.css', 'source.js'].includes(item.include))) {
    rule.patterns.unshift(include('jte-root'));
  }
  for (const value of Object.values(rule)) {
    if (Array.isArray(value)) value.forEach(inject);
    else if (value && typeof value === 'object') inject(value);
  }
}
inject(repository.html_tags);
fs.mkdirSync('syntaxes', { recursive: true });
fs.writeFileSync('syntaxes/jte.tmLanguage.json', JSON.stringify(grammar, null, 2) + '\n');
