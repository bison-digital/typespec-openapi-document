# typespec-openapi-document

Import your OpenAPI document as a typed TypeScript module, so you can serve it from your app.

[`@typespec/openapi3`](https://typespec.io) writes the document; this generates the module that
imports it, with the path worked out for you. Use it with any framework.

## Install

```bash
pnpm add -D typespec-openapi-document
```

Peer dependencies: `@typespec/compiler`, `@typespec/openapi3`. `@typespec/versioning` is an optional
peer, behind a guarded import, so a spec declaring no versions does not need it installed.

```yaml
# tspconfig.yaml
emit:
  - "@typespec/openapi3"
  - typespec-openapi-document
options:
  "@typespec/openapi3":
    emitter-output-dir: "{project-root}/openapi"
    file-type: json # required, see below
  typespec-openapi-document:
    emitter-output-dir: "{project-root}/src/generated"
```

## Quick start

You write two files. `src/generated/document.gen.ts` is produced by the compiler and never edited:

```
main.tsp                        your API definition
tspconfig.yaml                  which emitters to run
openapi/openapi.json            written by @typespec/openapi3
src/
  generated/
    document.gen.ts             written by this emitter, never edited by hand
  index.ts                      your app
```

### `tspconfig.yaml`

```yaml
emit:
  - "@typespec/openapi3"
  - typespec-openapi-document
options:
  "@typespec/openapi3":
    emitter-output-dir: "{project-root}/openapi"
    file-type: json
  typespec-openapi-document:
    emitter-output-dir: "{project-root}/src/generated"
```

```bash
pnpm exec tsp compile .
```

### `src/generated/document.gen.ts`

Generated. One per `@service`:

```ts
import document from "../../openapi/openapi.json" with { type: "json" };

export const openApiDocument = document;
export const OPENAPI_DOCUMENT_PATH = "/openapi.json";
```

### `src/index.ts`

Serve it with whatever you already use. This example is Hono, but nothing here is Hono-specific:

```ts
import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";
import { openApiDocument, OPENAPI_DOCUMENT_PATH } from "./generated/document.gen.js";

app.get(OPENAPI_DOCUMENT_PATH, (c) => c.json(openApiDocument));
app.get("/docs", swaggerUI({ url: OPENAPI_DOCUMENT_PATH }));
app.get("/reference", Scalar({ url: OPENAPI_DOCUMENT_PATH }));
```

Both of those take a URL and peer-depend on `hono` alone, so no code-first generator is involved.

The document is imported rather than read from disk, so it is part of your bundle. It cannot go stale
relative to the build, and a missing one fails the build rather than a request. JSON compresses well,
so even a document describing hundreds of operations is a small fraction of a Cloudflare Worker's
3 MB budget.

## Docs

- [Guides](docs/guides.md): versioned services, and why `file-type: json` is required
- [Reference](docs/reference.md): every option and every diagnostic

## Licence

MIT.
