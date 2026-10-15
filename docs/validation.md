# Validation record

Validation date: 2026-10-15.

## Environment

| Component | Version |
| --- | --- |
| Operating system | Windows x64 |
| Node.js | 22.19.0 |
| Project Java | 21 |
| VS Code | 1.142.0 |
| Red Hat Java | 1.56.0 |
| Bundled JDT LS | 1.61.0.202609021834 |
| Gradle fixture | 9.8.1, model/web modules |
| Maven fixture | Java 21 with jte-runtime |

The Java extension is linked into an isolated test profile with automatic updates disabled. The installed version is not upgraded.

## Results

The renamed extension was packaged as `artifacts/jte-vscode-0.1.0.vsix`, installed into an isolated extensions directory, and exercised in actual Extension Hosts after the English translation and source cleanup.

| Check | Passed | Failed |
| --- | --- | --- |
| TypeScript checks and extension build | Yes | 0 |
| Unit and TextMate tests | 7 | 0 |
| Installed VSIX, Maven Extension Host | 26 | 0 |
| Installed VSIX, Gradle multi-module Extension Host | 26 | 0 |
| Public file and package content review | Yes | 0 |

Both successful editor runs report Red Hat Java 1.56.0. A preliminary isolated installation resolved the Java dependency to a newer version, which the test version check rejected before feature tests ran. Fresh scenario profiles linked to the existing 1.56.0 installation were then used. The user's original Java installation was not changed. The version check belongs to the test runner; the extension itself does not enforce a runtime version lock.

The final documentation and manifest descriptions were packaged after testing. Runtime JavaScript, grammar, and Java bridge entry contents were compared with the installed package used for the successful editor tests.

The public review covered 57 source-control candidates and the VSIX contents. No Korean or CJK prose, previous project identity, private application identifiers, machine-specific absolute paths, or common token/private-key signatures were found in that scan. Build output, local profiles, and raw reports are ignored by Git; the package contains runtime files and required licenses without development sources or local reports. This is a scoped content review, not a general security certification.

## Coverage

- Exact template paths, nested calls, and named argument declarations.
- Imported Java classes, nested records, record accessors, and static fields.
- Distinct String and int overload targets selected by argument type.
- JTE parameter definitions, loop variables, and nested Content scope.
- Java hover and signature help, without exposing generated helper links.
- Completion in unsaved, incomplete Java expressions and parameter types.
- Java class completion with imports converted into `@import` edits.
- Template path and named parameter completion.
- Precise unresolved method, assignment mismatch, and template argument mismatch ranges.
- UTF-16 supplementary characters and CRLF position mappings.
- Unsaved changes to called templates and Java classes.
- Index refresh after file creation, rename, and deletion.
- Rejection of ambiguous template paths across roots.
- No generated Java analysis files on disk.

Integration tests start an actual VS Code process, activate the extension, and wait for Java project import. They invoke definition, completion, hover, and signature providers and inspect diagnostic ranges. The `editor.action.revealDefinition` command also verifies which document opens for F12 navigation. These are editor tests, not mocked VS Code API tests.

## Local evidence

The test runner writes `artifacts/integration-maven.json`, `artifacts/integration-gradle.json`, and `artifacts/extension-host-*.log`. These files are intentionally excluded from Git and the VSIX: they may contain absolute paths, environment details, or source excerpts. This document records portable results without copying private application data.

## Limits

Other operating systems and Java extension versions have not been validated. The fixtures do not establish compatibility with every Lombok setup, custom loader, nonstandard source layout, or JTE syntax combination. Token scopes are checked automatically; every theme has not been reviewed visually. See the [README](../README.md#limitations) for unsupported features.

`npm audit --omit=dev` reported zero findings. The full dependency audit still reports six high-severity findings in development tooling, including the vsce/braces dependency chain. This repository preparation does not resolve those findings; development dependencies are not shipped in the extension runtime bundle.
