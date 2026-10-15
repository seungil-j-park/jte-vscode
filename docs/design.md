# Architecture

## Reviewed sources

The following revisions were inspected on 2026-10-15. These are fixed reference revisions, not a promise that they remain the latest upstream versions.

| Source | Revision | Relevant structure and license |
| --- | --- | --- |
| [jte-intellij](https://github.com/casid/jte-intellij) | `3af5e3872ff7381477451864ea07a52c19d78a27` | 2.3.1; Java lexer/parser, PSI, injection, completion, refactoring; Apache-2.0 |
| [jte-template-syntax-highlight](https://github.com/maj2c/jte-template-syntax-highlight) | `0b1242fdccb25bc9f72fccef48c51b01d9ac354d` | 1.0.3; TextMate JSON and language configuration; Apache-2.0 |
| [vscode-java](https://github.com/redhat-developer/vscode-java) | v1.56.0, `9262eef5a183e8a78638ff045df70729acd3eeef` | Extension API, Java extension bundles, server commands; EPL-2.0 |

## Components

1. `scripts/build-grammar.mjs` retains attributed upstream HTML rules and generates recursive JTE rules using standard theme scopes.
2. `src/parser.ts` distinguishes strings, comments, balanced brackets, and inline content to extract template calls and Java fragments. It recovers from some unfinished edits.
3. `src/templates.ts` indexes exact relative template paths. Duplicate paths remain ambiguous rather than selecting a file by root order or basename. It reads open documents so unsaved parameter changes are visible.
4. `src/projection.ts` assembles imports, parameters, conditions, loops, and inline Content into Java analysis code. Only verbatim source fragments receive bidirectional UTF-16 mappings. Generated helper code has no guessed source location.
5. `src/javaBridge.ts` forwards editor requests to the Java server and converts responses back into JTE locations and edits. It discards stale document versions and hides generated helper details.
6. `server/src/dev/jte/bridge/JteCommand.java` registers an OSGi command in Red Hat Java 1.56.0. It associates an in-memory working copy with the original module's source root and uses its imported dependencies. No analysis file is saved to application source directories.
7. `src/extension.ts` registers providers, diagnostics, and lifecycle handlers. Closing documents releases timers and working copies. File, configuration, and project changes invalidate relevant results.

Java types and overloads are resolved by the Java project model. When the project is unavailable or analysis fails, the extension records the reason and omits Java results. Template syntax and navigation remain independent of Java project loading.

IntelliJ's approach to Java scope informed the design; its PSI and platform services are not portable to VS Code and were not copied. Reuse and modification details are recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Verification layers

Unit tests check parsing and exact source mapping. TextMate tests load actual embedded language grammars. Extension Host tests then exercise providers, F12, diagnostics, and unsaved edits in self-contained Maven and Gradle fixtures. Passing the first two layers alone does not establish editor integration.

## API references

- [Contribute a Java extension](https://github.com/redhat-developer/vscode-java/wiki/Contribute-a-Java-Extension)
- [VS Code embedded languages](https://code.visualstudio.com/api/language-extensions/embedded-languages)

TextMate `embeddedLanguages` identifies embedded regions for editor behavior. It does not send JTE expressions to the Java language server; explicit request forwarding and source mappings are required.
