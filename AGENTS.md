# AGENTS.md

## Language policy

**Everything in this repository must be written in English. No exceptions.**

This applies to:

- **Code**: variable names, function names, class names, file names, and directory names.
- **Comments**: inline comments, block comments, JSDoc/TSDoc annotations.
- **Strings and literals**: including error messages, log messages, and constants.
- **Documentation**: README files, markdown docs, ADRs, and any other written docs.
- **Tests**: test names, descriptions, and fixtures.
- **Commit messages**: subject line, body, and footer — all in English.
- **Branch names**, pull request titles and descriptions, and code review comments.

### Exception

User-facing content that is intentionally localized (i18n translation files, locale
bundles) may contain other languages. The keys, structure, and surrounding code and
comments still stay in English.

### Examples

```ts
// Bad: Spanish naming and comment
// Calcula la duración total de la lista
function calcularDuracionTotal(canciones: Cancion[]): number { ... }

// Good: English naming and comment
// Calculates the total duration of the playlist
function calculateTotalDuration(tracks: Track[]): number { ... }
```

```
Bad commit message:  fix: arregla el error al cargar la playlist
Good commit message: fix: resolve error when loading the playlist
```

If you find existing non-English code, comments, or docs, translate them to English as
part of the change you are already making in that file.
