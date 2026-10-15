# Third-party notices

## Reused syntax grammar

- Source: https://github.com/maj2c/jte-template-syntax-highlight
- Reviewed commit: `0b1242fdccb25bc9f72fccef48c51b01d9ac354d`
- Original author: Mansour Abou Jaoude
- Copyright 2022 Mansour Abou Jaoude
- License: Apache License 2.0
- Unmodified source: `third-party/jte-syntax/jte.tmLanguage.json`
- Retained license: `third-party/jte-syntax/LICENSE`
- Distributed derivative: `syntaxes/jte.tmLanguage.json`

HTML tag, attribute, string, and script/style inclusion rules are reused. JTE directives, Java brackets and strings, template paths and arguments, and nested inline content rules were rewritten. `scripts/build-grammar.mjs` reproduces these changes and records the original copyright and modification notice in the generated grammar. The vendored original grammar and license remain unchanged.

JTE comment delimiters and general bracket settings in the language configuration were also informed by this source.

## Design references without copied implementation

- Source: https://github.com/casid/jte-intellij
- Reviewed commit: `3af5e3872ff7381477451864ea07a52c19d78a27`, version 2.3.1
- Authors: casid and jte-intellij contributors
- License: Apache License 2.0
- Files reviewed: `JteJavaLanguageInjector.java`, `parsing/Lexer.java`, `parsing/parsers/ContentTokenParser.java`, and `parsing/parsers/ParamTokenParser.java`

This project follows the approach of assembling imports and parameters into Java declarations while preserving Java scope in conditionals, loops, and Content blocks. IntelliJ PSI, MultiHostInjector, reference services, and completion implementations were not copied. The parser, projection, client bridge, and Java command handler were written for VS Code and Eclipse JDT.

## Runtime and build dependencies

- [Red Hat Java](https://github.com/redhat-developer/vscode-java), EPL-2.0: uses the API and language server of the separately installed 1.56.0 extension.
- [Eclipse JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls), EPL-2.0: calls public types and some internal handler APIs from installed bundles. Its implementation source and JARs are not copied into the VSIX.
- [Gradle Wrapper](https://github.com/gradle/gradle), Apache-2.0: the fixture wrapper was generated with Gradle 9.8.1. Original copyright comments are retained. The license is stored in `third-party/gradle/LICENSE`.
- [JTE](https://github.com/casid/jte), Apache-2.0: fixtures resolve `gg.jte:jte-runtime:3.2.1` through their build tools. The runtime JAR is not included in the VSIX.
- npm build and test dependencies are pinned by `package-lock.json`. The VSIX bundles the project's runtime TypeScript code without shipping the development dependency tree.

Original project code is provided under the Apache License 2.0 in the root `LICENSE` file. Public repository preparation changes names and translates project-owned prose; it does not alter upstream license texts or copyright attribution.
