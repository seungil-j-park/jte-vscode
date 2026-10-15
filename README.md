# JTE for VS Code

An integrated VS Code extension for JTE templates: syntax highlighting, template navigation, and Java language intelligence powered by the Red Hat Java language server.

**Java integration baseline: Red Hat Java (`redhat.java`) 1.56.0. Other versions are unverified.** Keep this version for the supported setup. This is a documented compatibility requirement, not an activation-time version lock.

## Features

- Theme-aware highlighting for JTE, HTML, Java, CSS, and JavaScript, including multiline calls and nested inline content.
- Distinct token scopes for template keywords, paths, names, and named arguments.
- Go to definition for templates, template parameters, Java classes, nested types, records, methods, and fields.
- Completion for template paths, named arguments, Java types, and members, with Java imports translated into `@import` edits.
- Hover documentation and signature help for Java overloads and template calls.
- Diagnostics for missing templates, invalid arguments, unresolved Java references, and type mismatches.
- Analysis of unsaved JTE and Java edits, with template index updates after file creation, rename, and deletion.

Java analysis uses in-memory working copies in the owning Maven or Gradle module. Generated analysis files are not written to application source folders. Dependency resolution and Lombok support follow the project model imported by Red Hat Java.

## Install

Build the VSIX as described below, then run **Extensions: Install from VSIX...** in the VS Code Command Palette and select `artifacts/jte-vscode-0.1.0.vsix`. Alternatively:

```sh
code --install-extension artifacts/jte-vscode-0.1.0.vsix
```

Disable other extensions that register the `jte` language, including `maj2c.jte-template-syntax-highlight`, to avoid competing grammars. Remove or disable earlier development builds if they appear as a separate extension after the rename.

Install **Red Hat Java 1.56.0 before installing the VSIX**. VS Code may otherwise resolve the Java dependency to its current Marketplace version. To select the verified version, use **Install Another Version...** on the Red Hat Java extension or the [version-specific CLI installation](https://code.visualstudio.com/docs/configure/command-line#_working-with-extensions):

```sh
code --install-extension redhat.java@1.56.0
```

The extension does not request Java upgrades or reject activation based on the installed version. Run **Developer: Reload Window**, open the entire Maven or Gradle project, and wait for Java project import to finish. The Java server must run in Standard mode. The previous syntax extension is not required.

The current extension ID is `jte-local.jte-vscode`. `jte-local` is a development publisher identifier, not a claim of Marketplace ownership. See [public repository preparation](docs/publishing.md) before publishing to the Marketplace.

## Settings

By default, all `src/main/jte` and `src/test/jte` directories across workspace modules become template roots. For a different layout, or to narrow ambiguous paths, set roots relative to each workspace folder:

```json
{
  "jte.templateRoots": [
    "module-a/src/main/jte",
    "module-b/src/main/jte"
  ],
  "jte.java.enabled": true,
  "jte.diagnostics.enabled": true
}
```

Navigation requires an exact relative template path. If multiple roots contain that path, the extension reports ambiguity instead of choosing a target by order or filename. Use **JTE: Show Analysis Status** to inspect the Java connection and the most recent failure.

## Develop and build

The verified environment is Windows, Node.js 22, Java 21, VS Code 1.142.0, and Red Hat Java 1.56.0. Install those prerequisites before running:

```sh
npm ci
npm run check
npm run build
npm test
npm run test:integration
npm run package
```

`build` regenerates the grammar, compiles the Java bridge, and bundles the extension and integration tests. `package` builds first and writes `artifacts/jte-vscode-<version>.vsix`, using the version from `package.json`.

Build scripts look for Red Hat Java 1.56.0 in the user's standard VS Code extensions directory. Java tools are selected from `JTE_JDK_HOME`, `JAVA_HOME`, the Java extension's bundled runtime, or `PATH`. No developer-specific absolute paths are required in repository files.

| Environment variable | Purpose |
| --- | --- |
| `JTE_JAVA_EXTENSION` | Installed Red Hat Java 1.56.0 extension directory |
| `JTE_JDK_HOME` | Java 21 JDK directory for compilation and integration test project import |
| `JTE_VSCODE` | VS Code application executable for integration tests, rather than the shell launcher |
| `JTE_VSCODE_GRAMMARS` | VS Code built-in extensions directory containing the HTML, Java, CSS, and JavaScript grammars |
| `JTE_TEST_SCENARIO` | `maven` (default) or `gradle`; selects the corresponding bundled fixture |
| `JTE_TEST_WORKSPACE` | Optional alternate checkout of the selected fixture, not an arbitrary application |
| `JTE_TEST_EXTENSION` | Optional extracted or installed extension directory for packaged-extension testing |

Windows user installations of VS Code are detected automatically. Other layouts require the executable and built-in grammar directory variables. Other operating systems have not been verified.

Press **F5** in this repository to launch an Extension Development Host with the Gradle fixture. Restart that development window after rebuilding so the Java bridge is reloaded.

## Verify

`npm test` checks parsing, UTF-16 source mappings, and actual TextMate tokenization using VS Code's built-in grammars. `npm run test:integration` launches the real VS Code Extension Host in a separate profile for each scenario under `.test-runtime/jte-vscode`, with automatic updates disabled. It checks the Java version before launching, invokes editor providers and the F12 command, and checks unsaved edits and diagnostic ranges.

Run both fixture scenarios in PowerShell:

```powershell
$env:JTE_TEST_SCENARIO = 'maven'
npm run test:integration
$env:JTE_TEST_SCENARIO = 'gradle'
npm run test:integration
Remove-Item Env:JTE_TEST_SCENARIO
```

The fixture projects require network access on first import to resolve Maven and Gradle dependencies. Test reports and editor logs are written to `artifacts/` and excluded from Git because they can contain local paths and source excerpts. See [validation results](docs/validation.md).

## Limitations

- Java compatibility has been verified with Red Hat Java 1.56.0 only. The bridge uses some internal JDT LS handlers; other versions need separate verification.
- Java analysis requires a successfully imported project. Dependency failures are not hidden behind filename-based guesses.
- Standard main/test Java source roots are preferred. If a nonstandard project has no unique suitable root, Java analysis reports that limitation.
- Template resolution covers workspace files, not templates inside JARs or custom runtime loaders.
- A target template with wildcard imports skips argument assignability checks; Java analysis of the argument expression still runs.
- The editing-oriented JTE scanner is not a complete JTE compiler. Recovery is limited for severely unbalanced syntax or ambiguous combinations of comparisons and generics.
- HTML, CSS, and JavaScript receive syntax highlighting; this extension does not provide separate language servers for them.
- KTE, find all references, rename refactoring, and Java quick fixes are not implemented.
- Untitled documents have no owning module for Java analysis. Unsaved edits to existing files are supported.
- Token scopes are tested automatically. Visual contrast has not been reviewed in every theme.

## Contribute and license

See [contributing](CONTRIBUTING.md), [architecture](docs/design.md), and [repository contents](docs/publishing.md). The project is licensed under [Apache-2.0](LICENSE). Reused syntax rules retain their original attribution; see [third-party notices](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE).
