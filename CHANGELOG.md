# Changelog

## Unreleased

- Standardize the display name as JTE for VS Code and the package name as `jte-vscode`.
- Translate project documentation, comments, configuration descriptions, and user-facing messages into English.
- Remove application-specific validation code and private paths from public files.
- Separate source control contents from local reports, editor profiles, build output, and VSIX packages.
- Derive package filenames and integration test extension IDs from the manifest.
- State the Red Hat Java 1.56.0 compatibility baseline without adding a runtime version lock.

## 0.1.0

- Integrate JTE, HTML, Java, CSS, and JavaScript syntax highlighting.
- Add template file and parameter navigation, completion, and signature help.
- Analyze Java through Red Hat Java 1.56.0 in-memory working copies.
- Map Java definitions, completion, hover, signatures, and diagnostics back to JTE source locations.
- Add Maven and Gradle multi-module fixtures and real Extension Host validation.
- Record reused syntax rules, source references, licenses, and modifications.
