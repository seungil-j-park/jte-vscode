# Public repository preparation

## Identity

| Item | Value |
| --- | --- |
| Display name | JTE for VS Code |
| Repository and package name | `jte-vscode` |
| Repository | https://github.com/seungil-j-park/jte-vscode |
| Development extension ID | `jte-local.jte-vscode` |
| Local package | `artifacts/jte-vscode-<version>.vsix` |

The Git repository is hosted under `seungil-j-park/jte-vscode`. The repository, homepage, and issue tracker URLs are configured in `package.json`, so packaging resolves relative documentation links against the public repository. The Marketplace publisher remains the development placeholder `jte-local`; GitHub account ownership does not establish Marketplace publisher ownership. Before Marketplace publication, set an owned `publisher` identifier. Changing it changes the extension ID and may require removing the previous development installation.

## Files to commit

| Content | Reason |
| --- | --- |
| `src/`, `server/src/`, `server/MANIFEST.MF`, `server/plugin.xml` | Extension and Java bridge source |
| `scripts/`, `test/unit/`, `test/integration/` | Reproducible builds and verification |
| `test/fixtures/` source and build configuration | Portable Maven and Gradle projects |
| Gradle wrapper scripts, properties, and `gradle-wrapper.jar` | Run the pinned fixture Gradle version without a separate installation |
| `syntaxes/`, `language-configuration.json` | Reviewable generated grammar and editor configuration |
| `package.json`, `package-lock.json`, `tsconfig.json` | Package identity and reproducible development dependencies |
| `.vscode/launch.json`, `.vscode/tasks.json` | Portable development commands |
| `.gitignore`, `.vscodeignore`, `.gitattributes`, `.editorconfig` | Repository and package boundaries and text formatting |
| Documentation, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `third-party/` | Usage, validation, provenance, and licensing |

## Files to keep local

| Content | Reason |
| --- | --- |
| `node_modules/` | Recreated by `npm ci` |
| `dist/`, `server/classes/`, `server/jte-java.jar` | Recreated by the build |
| `artifacts/`, `*.vsix`, `*.log` | Packages and raw reports; reports can expose private paths or source |
| `.test-runtime/` | Isolated editor state, installed extensions, and local tooling |
| Fixture `build/`, `target/`, `bin/`, `.gradle/`, and Eclipse metadata | Generated project data |
| Personal `.vscode` files, `.idea/`, `*.code-workspace`, `.codex/`, root `AGENTS.md` | Local editor and assistant configuration |
| `.env*`, `.npmrc`, `*.local.*`, keys and certificates | Machine configuration and credentials |

`.gitignore` controls source control. `.vscodeignore` separately controls the installable package: runtime JavaScript, the built Java bridge, the generated grammar, user documentation, and required notices belong in the VSIX, while development sources, tests, logs, profiles, and dependencies do not. The Gradle wrapper is a deliberate source repository binary; it is not shipped in the VSIX.

## Review before the first push

From the repository root, initialize Git if it has not already been initialized, then inspect candidates and ignore rules:

```sh
git init -b main
git status --short --untracked-files=all
git check-ignore artifacts/integration-maven.json server/jte-java.jar
```

After staging your intended files, inspect the actual staged content:

```sh
git diff --cached --stat
git diff --cached
```

Do not use `git add -f` to include local artifacts. Ignore rules do not remove files already tracked in an existing repository or erase prior Git history. Publishing source to GitHub and publishing an extension to the Marketplace are separate actions.

Build the VSIX with `npm run package`. Distribute it as a release attachment if desired rather than committing generated packages. Keep raw local validation reports private; publish a reviewed summary such as [validation.md](validation.md).
