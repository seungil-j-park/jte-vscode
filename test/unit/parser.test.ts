import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/parser';
import { mapOffset, mapSpan, project } from '../../src/projection';

/** Check independent parsing of nested content, string delimiters, and generic arguments. */
test('nested inline content and Java delimiters', () => {
  const text = '@import java.util.Map\n@param String title = "a,b"\n' +
    '@template.layout(title = title, content = @`<p>${title}</p>\n' +
    '@template.child(data = Map.<String, Integer>of("x,)", 1), content = @`<b>${"}"}</b>`)\n`)';
  const parsed = parse(text);
  assert.equal(parsed.calls.length, 2);
  assert.deepEqual(parsed.calls.map(call => text.slice(call.path!.start, call.path!.end)), ['layout', 'child']);
  assert.equal(parsed.calls[1].args!.length, 2);
  assert.equal(parsed.params[0].name, 'title');
  const projection = project(parsed, 'file:///test.jte');
  assert.match(projection.code, /Map\.<String, Integer>of\("x,\)", 1\)/);
  assert.equal((projection.code.match(/new gg.jte.Content/g) ?? []).length, 2);
  assert.deepEqual(parsed.issues, []);
});

/** Check UTF-16 round trips for every copied span between source and generated code. */
test('source mapping preserves CRLF and supplementary characters', () => {
  const text = '@param String name\r\n<p>' + String.fromCodePoint(0x1f600) + '${name.toUpperCase()}</p>\r\n';
  const projection = project(parse(text), 'file:///mapping.jte');
  for (const segment of projection.mappings) {
    assert.equal(text.slice(segment.source.start, segment.source.end), projection.code.slice(segment.generated.start, segment.generated.end));
    for (let i = segment.source.start; i < segment.source.end; i++) {
      const generated = mapOffset(projection.mappings, i, 'source')!;
      assert.equal(mapOffset(projection.mappings, generated, 'generated'), i);
    }
  }
  assert.equal(mapOffset(projection.mappings, text.indexOf('<p>'), 'source'), undefined);
  assert.equal(mapSpan(projection.mappings, { start: 0, end: projection.code.length }, 'generated'), undefined);
});

/** Ensure apparent JTE calls inside comments and strings do not become navigation targets. */
test('comments, strings and unfinished editing recover', () => {
  const parsed = parse('<%-- @template.fake() --%>\n${"@template.fake()"}\n${person.\n@template.real()');
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.text.slice(parsed.calls[0].path!.start, parsed.calls[0].path!.end), 'real');
  assert.ok(parsed.issues.some(issue => issue.message.includes('Java')));
  assert.ok(project(parsed, 'file:///recover.jte').code.includes('person.'));
});

/** Keep conditional and loop variables in scope inside inline content. */
test('control flow and default content are represented in Java', () => {
  const text = '@param java.util.List<String> names\n@param gg.jte.Content empty = @`<b>Empty</b>`\n' +
    '@for(String name : names)\n@if(name != null)\n@template.row(content = @`${name}`)\n@else\n${empty}\n@endif\n@endfor';
  const generated = project(parse(text), 'file:///flow.jte').code;
  assert.match(generated, /for \(String name : names\) \{/);
  assert.match(generated, /if \(name != null\) \{/);
  assert.match(generated, /__jteOutput\(name\)/);
  assert.match(generated, /__jteDefault1/);
});

/** Ensure brackets in strings and text blocks do not terminate expressions. */
test('Java text blocks and comments are balanced', () => {
  const parsed = parse('!{String value = """\n})\n"""; /* } */}\n${value}');
  assert.equal(parsed.nodes.length, 2);
  assert.deepEqual(parsed.issues, []);
});

/** Map an unfinished parameter type to Java completion before its name is entered. */
test('incomplete parameter type has a mapped completion position', () => {
  const text = '@param Str';
  const projection = project(parse(text), 'file:///partial.jte');
  assert.match(projection.code, /render\(Str __jteIncomplete1\)/);
  assert.notEqual(mapOffset(projection.mappings, text.length, 'source'), undefined);
});
