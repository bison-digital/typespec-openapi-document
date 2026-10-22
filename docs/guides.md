# Guides

## Versioned services

`@versioned` makes openapi3 write one document per version, and all of them are exported:

```ts
import document0 from "../openapi/openapi.v1.json" with { type: "json" };
import document1 from "../openapi/openapi.v2.json" with { type: "json" };

export const openApiDocument = document1; // the current version
export const openApiDocumentsByVersion = { v1: document0, v2: document1 } as const;
export const OPENAPI_VERSIONS = ["v1", "v2"] as const;
```

`openApiDocument` is the last **declared** version, not the last alphabetically. A version name sorts
however its author spelled it, and `v1, v2preview, v2` sorts as `v1, v2, v2preview`, so choosing by
filename would hand you a preview as though it were current.

## `file-type: json` is required

openapi3's default output is YAML, and a TypeScript module cannot import YAML without a parser and a
build plugin. Shipping a YAML parser into a Worker to read a document that could have been JSON is not
a trade this package makes on your behalf, so it reports `unsupported-document-format` and names the
one-line remedy.

## Dictionary properties in OpenAPI 3.1

**Up to `@typespec/openapi3@1.16.0`, a `Record<T>` property in a 3.1 document generates a client
type that admits nothing.** Those versions publish a declared indexer as `unevaluatedProperties`,
which `openapi-typescript` does not implement, so it reads the schema as declaring no properties at
all. **`1.17.0` fixes this upstream (microsoft/typespec#11954), and this package requires it.**
Measured on `openapi-typescript@7.13.0`, with no patch applied:

| TypeSpec                                            | generated client type, `1.16.0` | generated client type, `1.17.0`                 |
| --------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| `model Metadata is Record<unknown>`                 | `Record<string, never>`         | `{ [key: string]: unknown }`                    |
| `settings: Record<unknown>`                         | `Record<string, never>`         | `{ [key: string]: unknown }`                    |
| `labels: Record<string>`                            | `Record<string, never>`         | `{ [key: string]: string }`                     |
| `model Widget { name: string; ...Record<unknown> }` | `{ name: string }`              | `{ name: string } & { [key: string]: unknown }` |

The last row is the commonest in practice, an open model spreading `Record<unknown>` beside its
declared properties: on `1.16.0` its client type keeps the properties and loses the openness, so a
consumer's generated client changes shape on the upgrade even where no dictionary is declared.

From `1.17.0`, a declared indexer emits `additionalProperties`, except on a model that also extends
another model. There, `unevaluatedProperties` is still needed to account for the properties
evaluated by the `allOf` subschema holding the base model. Sealing is untouched.

### Moving off the patch

`0.5.0` shipped a patch for `1.15.0` and `1.16.0`. If you copied it into your project, delete it when
you move to `1.17.0`:

1. Remove the `@typespec/openapi3` entry from `patchedDependencies` in `pnpm-workspace.yaml`.
2. Delete the patch file.
3. Run `pnpm install`.

The entry is keyed to an exact version, so if you leave it in place the install fails with
`ERR_PNPM_UNUSED_PATCH`.

**To confirm the change, check the document, not the installed file.** The patch was checked by
grepping `schema-emitter-3-1.js` for `indexerKeyword`. `1.17.0` uses the same identifier, so that
grep still matches after the patch is gone and cannot tell the two apart. Compile and read the 3.1
document instead: a leaf dictionary carries `additionalProperties` and no `unevaluatedProperties`.

To stay on `1.15.0` or `1.16.0`, stay on `typespec-openapi-document@0.5.0`, which still ships both
patches.
