# Contributing

Use the setup and commands in [README](README.md#develop-and-build). Keep documentation, comments, diagnostics, configuration descriptions, and test labels in English.

Add a purpose comment to each new or edited function. Explain non-obvious parsing, scope, and position mapping decisions in concise comments. Java comments should not contain HTML tags. Keep examples out of comments unless the behavior would otherwise be difficult to understand.

For behavior changes, add focused tests that exercise the affected feature. Run `npm run check`, `npm run build`, and `npm test`. Changes to providers, Java integration, or source mappings also require the Maven and Gradle Extension Host scenarios. State which checks actually ran; unit tests alone do not prove editor behavior.

Keep Red Hat Java 1.56.0 unchanged unless a change explicitly addresses and verifies version compatibility. Rebuild and restart the development host after editing the Java bridge.

The generated `syntaxes/jte.tmLanguage.json` is committed so grammar changes can be reviewed. Update it through `scripts/build-grammar.mjs`, together with the generator. Preserve the unmodified upstream grammar and license in `third-party/jte-syntax/` and record reuse changes in `THIRD_PARTY_NOTICES.md`.

Commit `package-lock.json`, the fixture sources, Gradle wrapper scripts and JAR, and required licenses. Keep logs, VSIX files, editor profiles, private application fixtures, and personal configuration out of commits. See [public repository preparation](docs/publishing.md) for the exact boundary.
