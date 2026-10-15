import { createHash } from 'node:crypto';
import { Fragment, Node, Parsed, Span, trimSpan } from './parser';

export interface Mapping { source: Span; generated: Span }
export interface Projection { code: string; className: string; mappings: Mapping[] }

/** Map positions only within verbatim source spans, excluding generated helper code. */
export function mapOffset(mappings: Mapping[], offset: number, direction: 'source' | 'generated'): number | undefined {
  const other = direction === 'source' ? 'generated' : 'source';
  const exact = mappings.find(segment => offset >= segment[direction].start && offset < segment[direction].end);
  const segment = exact ?? mappings.find(segment => offset === segment[direction].end);
  return segment ? segment[other].start + offset - segment[direction].start : undefined;
}

/** Reject edits or diagnostics that cross separate source fragments. */
export function mapSpan(mappings: Mapping[], span: Span, direction: 'source' | 'generated'): Span | undefined {
  const other = direction === 'source' ? 'generated' : 'source';
  const segment = mappings.find(segment => span.start >= segment[direction].start && span.end <= segment[direction].end);
  if (!segment) return undefined;
  return { start: segment[other].start + span.start - segment[direction].start,
    end: segment[other].start + span.end - segment[direction].start };
}

/** Assemble JTE Java fragments into classes and methods analyzed in the owning module. */
export function project(parsed: Parsed, uri: string, argumentTypes = new Map<number, string[]>()): Projection {
  const className = 'JteAnalysis_' + createHash('sha256').update(uri).digest('hex').slice(0, 20);
  const output: Projection = { code: '', className, mappings: [] };
  const text = parsed.text;

  /** Append generated helper code without assigning source locations. */
  function emit(value: string) { output.code += value; }

  /** Copy source fragments verbatim and record their exact position mappings. */
  function copy(span: Span) {
    const start = output.code.length;
    emit(text.slice(span.start, span.end));
    output.mappings.push({ source: span, generated: { start, end: output.code.length } });
  }

  /** Turn inline HTML into a Content implementation while preserving Java scope. */
  function java(fragment: Fragment) {
    let cursor = fragment.start;
    for (const inline of fragment.contents) {
      if (inline.start < fragment.start || inline.end > fragment.end) continue;
      copy({ start: cursor, end: inline.start });
      emit('new gg.jte.Content() { /** Analyze Java code inside inline content. */ public void writeTo(gg.jte.TemplateOutput jteOutput) {\n');
      body(inline.nodes);
      emit('\n} }');
      cursor = inline.end;
    }
    copy({ start: cursor, end: fragment.end });
  }

  /** Preserve nested control flow while projecting Java expressions and template arguments. */
  function body(nodes: Node[]) {
    const blocks: string[] = [];
    for (const node of nodes) {
      switch (node.kind) {
        case 'expression': emit('__jteOutput('); java(node.body!); emit(');\n'); break;
        case 'statement': java(node.body!); emit('\n'); break;
        case 'if': emit('if ('); java(node.body!); emit(') {\n'); blocks.push('if'); break;
        case 'elseif': if (blocks.at(-1) === 'if') { emit('} else if ('); java(node.body!); emit(') {\n'); } break;
        case 'else': if (blocks.at(-1) === 'if') emit('} else {\n'); break;
        case 'for': emit('for ('); java(node.body!); emit(') {\n'); blocks.push('for'); break;
        case 'endif': if (blocks.at(-1) === 'if') { emit('}\n'); blocks.pop(); } break;
        case 'endfor': if (blocks.at(-1) === 'for') { emit('}\n'); blocks.pop(); } break;
        case 'call':
          for (const [index, arg] of (node.args ?? []).entries()) {
            if (arg.value.start === arg.value.end) continue;
            const type = argumentTypes.get(node.start)?.[index];
            // Assignments place type errors on the value, preventing errors from pointing only to generated method names.
            emit(type ? '{ ' + type + ' __jteArgument = ' : '__jteOutput(');
            java(arg.value);
            emit(type ? '; }\n' : ');\n');
          }
          break;
      }
    }
    // Close unfinished control flow only in generated code while the document is being edited.
    for (const _ of blocks) emit('}\n');
  }

  for (const node of parsed.imports) {
    const span = trimSpan(text, node.body!.start, node.body!.end);
    if (text[span.end - 1] === ';') span.end--;
    emit('import '); copy(span); emit(';\n');
  }
  emit('@SuppressWarnings("all")\nclass ' + className + ' {\n');
  emit('static final String JTE_NAME = ""; gg.jte.TemplateOutput jteOutput;\n');
  emit('/** Check output expression types. */ void __jteOutput(Object value) {}\n/** Establish variable scope for the template body. */ void render(');
  let parameterCount = 0;
  parsed.params.forEach((param, index) => {
    // Represent declarations as method parameters so nested Content refers to the same values.
    if (index > 0) emit(', ');
    copy(param.declaration);
    parameterCount++;
  });
  for (const node of parsed.nodes) {
    if (node.kind !== 'param' || node.param || !node.body) continue;
    const span = trimSpan(text, node.body.start, node.body.end);
    if (span.start === span.end) continue;
    if (parameterCount++) emit(', ');
    // Add a temporary parameter name so completion also works while only the type is entered.
    copy(span); emit(' __jteIncomplete' + parameterCount);
  }
  emit(') throws Exception {\n');
  body(parsed.nodes);
  emit('}\n');
  for (const [index, param] of parsed.params.entries()) {
    if (!param.value) continue;
    // Check defaults in separate methods without changing the meaning of body variables.
    emit('/** Check parameter default value types. */ void __jteDefault' + index + '(');
    parsed.params.forEach((value, position) => {
      // Map parameter references in defaults back to their original declarations.
      if (position) emit(', ');
      copy(value.declaration);
    });
    emit(') throws Exception {\n');
    emit(text.slice(param.type.start, param.type.end) + ' __jteValue = ');
    java(param.value);
    emit(';\n}\n');
  }
  emit('}\n');
  return output;
}
