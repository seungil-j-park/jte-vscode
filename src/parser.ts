export interface Span { start: number; end: number }
export interface Inline extends Span { nodes: Node[] }
export interface Fragment extends Span { contents: Inline[] }
export interface Parameter extends Span { name: string; nameSpan: Span; type: Span; declaration: Span; value?: Fragment }
export interface Argument extends Span { name?: string; nameSpan?: Span; value: Fragment }
export interface Node extends Span {
  kind: 'import' | 'param' | 'expression' | 'statement' | 'if' | 'elseif' | 'else' | 'endif' | 'for' | 'endfor' | 'call';
  body?: Fragment;
  param?: Parameter;
  path?: Span;
  args?: Argument[];
  closed?: boolean;
}
export interface ParseIssue extends Span { message: string }
export interface Parsed { text: string; nodes: Node[]; imports: Node[]; params: Parameter[]; calls: Node[]; issues: ParseIssue[] }

/** Skip delimiters inside strings and comments to find actual Java code boundaries. */
export function skipJavaLiteral(text: string, start: number): number {
  const quote = text[start];
  if (text.startsWith('//', start)) {
    const end = text.indexOf('\n', start + 2);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith('/*', start)) {
    const end = text.indexOf('*/', start + 2);
    return end < 0 ? text.length : end + 2;
  }
  if (text.startsWith('"""', start)) {
    let end = start + 3;
    while (end < text.length) {
      if (text[end] === '\\') { end += 2; continue; }
      if (text.startsWith('"""', end)) return end + 3;
      end++;
    }
    return end;
  }
  if (quote !== '"' && quote !== "'") return start;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** Return a span without surrounding whitespace or an optional trailing declaration semicolon. */
export function trimSpan(text: string, start: number, end: number): Span {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

/** Separate HTML and Java states and recursively parse nested inline content. */
export function parse(text: string): Parsed {
  const result: Parsed = { text, nodes: [], imports: [], params: [], calls: [], issues: [] };

  /** Avoid splitting commas or HTML content while Java brackets remain open. */
  function fragment(start: number, stops: string): Fragment {
    const stack: string[] = [];
    const contents: Inline[] = [];
    let i = start;
    for (; i < text.length; i++) {
      if (stack.length === 0 && stops.includes(text[i])) break;
      const literal = skipJavaLiteral(text, i);
      if (literal > i) { i = literal - 1; continue; }
      if (text.startsWith('@`', i)) {
        const inline = html(i + 2, true);
        contents.push({ start: i, end: inline.end, nodes: inline.nodes });
        i = inline.end - 1;
        continue;
      }
      const close = ({ '(': ')', '[': ']', '{': '}' } as Record<string, string>)[text[i]];
      if (close) stack.push(close);
      else if (stack[stack.length - 1] === text[i]) stack.pop();
      else if (text[i] === '<' && /^[\w$?,.\s<>\[\]@]+>/.test(text.slice(i + 1))) {
        // Commas inside type arguments do not separate template arguments.
        stack.push('>');
      }
      // Recover at a new JTE directive after unfinished Java syntax.
      if (text[i] === '\n' && /^\s*@(param|import|template|endif|endfor)\b/.test(text.slice(i + 1))) break;
    }
    return { start, end: i, contents };
  }

  /** Distinguish named and positional arguments while preserving source spans for values. */
  function argument(body: Fragment): Argument {
    const span = trimSpan(text, body.start, body.end);
    const named = /^([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(text.slice(span.start, span.end));
    const valueStart = named ? span.start + named[0].length : span.start;
    const value = { ...trimSpan(text, valueStart, span.end), contents: body.contents };
    return { ...span, name: named?.[1], nameSpan: named ? { start: span.start, end: span.start + named[1].length } : undefined, value };
  }

  /** Separate parameter types and names and retain default Java expressions independently. */
  function parameter(body: Fragment): Parameter | undefined {
    let split = body.end;
    for (let i = body.start; i < body.end; i++) {
      const literal = skipJavaLiteral(text, i);
      if (literal > i) { i = literal - 1; continue; }
      if (text[i] === '=') { split = i; break; }
    }
    const declaration = trimSpan(text, body.start, split);
    if (text[declaration.end - 1] === ';') declaration.end--;
    const nameMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(declaration.start, declaration.end));
    if (!nameMatch) return undefined;
    const nameSpan = { start: declaration.start + nameMatch.index, end: declaration.start + nameMatch.index + nameMatch[1].length };
    const type = trimSpan(text, declaration.start, nameSpan.start);
    if (type.start === type.end) return undefined;
    return { ...body, name: nameMatch[1], nameSpan, type, declaration,
      value: split < body.end ? { ...trimSpan(text, split + 1, body.end), contents: body.contents } : undefined };
  }

  /** Find directives only in HTML state and read up to the end of inline content. */
  function html(start: number, inline: boolean): { nodes: Node[]; end: number } {
    const nodes: Node[] = [];
    let i = start;
    while (i < text.length) {
      if (inline && text[i] === '`') return { nodes, end: i + 1 };
      if (text.startsWith('<%--', i)) {
        const end = text.indexOf('--%>', i + 4);
        if (end < 0) {
          result.issues.push({ start: i, end: i + 4, message: 'Unclosed JTE comment.' });
          return { nodes, end: text.length };
        }
        i = end + 4;
        continue;
      }
      if (text.startsWith('@raw', i) && !/[\w$]/.test(text[i + 4] || '')) {
        const end = text.indexOf('@endraw', i + 4);
        i = end < 0 ? text.length : end + 7;
        continue;
      }
      if (text[i] === '\\' && /[@$!`]/.test(text[i + 1] || '')) { i += 2; continue; }
      if (text.startsWith('${', i) || text.startsWith('!{', i)) {
        const body = fragment(i + 2, '}');
        const closed = text[body.end] === '}';
        nodes.push({ kind: text[i] === '$' ? 'expression' : 'statement', start: i, end: body.end + Number(closed), body, closed });
        if (!closed) result.issues.push({ start: i, end: i + 2, message: 'Unclosed Java code block.' });
        i = body.end + Number(closed);
        continue;
      }
      const directive = /^@(import|param|elseif|endif|endfor|else|if|for|template)\b/.exec(text.slice(i));
      if (!directive) { i++; continue; }
      const kind = directive[1];
      const begin = i;
      i += directive[0].length;
      if (kind === 'import' || kind === 'param') {
        const body = fragment(i, '\r\n');
        const node: Node = { kind, start: begin, end: body.end, body };
        if (kind === 'param') { node.param = parameter(body); if (node.param) result.params.push(node.param); }
        else result.imports.push(node);
        nodes.push(node);
        i = body.end;
      } else if (kind === 'template') {
        if (text[i] !== '.') continue;
        const pathStart = ++i;
        while (/[\w$.]/.test(text[i] || '')) i++;
        const path = { start: pathStart, end: i };
        while (/\s/.test(text[i] || '')) i++;
        const args: Argument[] = [];
        let closed = false;
        if (text[i] === '(') {
          i++;
          while (i < text.length && text[i] !== ')') {
            const body = fragment(i, ',)');
            if (text.slice(body.start, body.end).trim()) args.push(argument(body));
            i = body.end;
            if (text[i] === ',') i++;
            else break;
          }
          closed = text[i] === ')';
          if (closed) i++;
        }
        const node: Node = { kind: 'call', start: begin, end: i, path, args, closed };
        nodes.push(node); result.calls.push(node);
      } else if (kind === 'if' || kind === 'elseif' || kind === 'for') {
        while (/\s/.test(text[i] || '')) i++;
        if (text[i] === '(') {
          const body = fragment(i + 1, ')');
          const closed = text[body.end] === ')';
          i = body.end + Number(closed);
          nodes.push({ kind, start: begin, end: i, body, closed });
        }
      } else nodes.push({ kind: kind as Node['kind'], start: begin, end: i });
    }
    if (inline) result.issues.push({ start: Math.max(0, start - 2), end: start, message: 'Unclosed inline content.' });
    return { nodes, end: i };
  }

  result.nodes = html(0, false).nodes;
  result.params.sort((a, b) => a.start - b.start);
  result.calls.sort((a, b) => a.start - b.start);
  return result;
}
