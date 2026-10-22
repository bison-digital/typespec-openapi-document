# Reference

## Options

| option          | what it does                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services`      | Per-service overrides, keyed on the service's namespace name. Each entry takes an `output-dir`, so a program serving its services from different workers can put each document module beside the worker that serves it. A service the map does not name is unaffected. |
| `document-path` | Point the generated import at a path of your own rather than resolving openapi3's. An escape hatch; if you are setting this, a diagnostic above has told you why.                                                                                                      |

## What it refuses, and why

All three are configuration problems in your own `tspconfig.yaml`, each reported with the change that
fixes it.

| code                          | why                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi3-not-emitted`        | `@typespec/openapi3` is not in your `emit` list, so there is no document to export. This emitter produces none of its own.                                                                                                                                                                                                    |
| `unsupported-document-format` | The document is YAML, which is openapi3's default. A module cannot import it. Set `file-type: json`.                                                                                                                                                                                                                          |
| `document-path-unresolved`    | openapi3's naming rule could not be reproduced for a service, usually because of a custom `output-file`. Set `document-path` to point at it.                                                                                                                                                                                  |
| `multiple-openapi-versions`   | `openapi-versions` names more than one version, which is one document per version, and this emitter exports a single module. It used to export whichever was listed first, so the served document depended on list order. Name one version, or run a second compile with its own `openapi-versions` and `emitter-output-dir`. |

All three are warnings rather than errors. A TypeSpec `error` sets `program.hasError()`, and openapi3
declines to write anything when the program has errors, including errors that are not its own. An
emitter that refused loudly enough to destroy the document it exists to export would be self-defeating.

To make a refusal fail the build, use the compiler's own switch:

```yaml
warn-as-error: true
```

### Where a per-service `output-dir` resolves

An absolute path is used as given. A relative one resolves against the **project root**, which is
what a consumer means by it.

`{project-root}` and its siblings are **not** available here. The compiler interpolates those only in
the path options it defines itself, so a nested custom option receives the string verbatim - measured,
`"{project-root}/alpha"` creates a directory literally named `{project-root}`. Reproducing that
interpolation would be a second, quietly divergent copy of a compiler behaviour, so the resolution
rule is stated here instead. Write `workers/alpha/src/generated`, not `{project-root}/workers/alpha/src/generated`.
