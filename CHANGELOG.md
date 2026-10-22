# Changelog

All notable changes to `typespec-openapi-document` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API**, a change to what
`document.gen.ts` exports, or to the specifier it imports, is a change a consumer feels, and is
treated as such here rather than as an implementation detail.

## [Unreleased]

### Added

- `typespec-openapi-document/package.json` is exported, for a tool that finds the installed version
  or root by name.

## [0.6.0] - 2026-10-11

`@typespec/openapi3@1.17.0` publishes a leaf dictionary as `additionalProperties` itself
(microsoft/typespec#11954), so the patch this package shipped is gone, and `1.17.0` is the floor.

### Changed, breaking

- **Peers are `@typespec/compiler` and `@typespec/openapi3` `^1.17.0`, and `@typespec/versioning`
  `^0.87.0`.** `1.15.0` and `1.16.0` are no longer accepted. Without the patch, the dictionary claim
  in `docs/guides.md` would be false on both, and `0.5.0` still serves them with the patches it
  ships. The `versioning` range had excluded `0.87.0`, the version `1.17.0` pairs with.

### Changed

- **Development moved to `@typespec/{compiler,http,openapi,openapi3}@1.17.0` and
  `@typespec/{rest,versioning}@0.87.0`.**

- **`test/patch-effect.test.ts` is now `test/dictionary-keyword.test.ts`, with its arms unchanged.**
  They read the published document, so they now grade openapi3 itself. Control: pin
  `@typespec/openapi3` back to `1.16.0`, unpatched, and the leaf and typed arms go red.

### Fixed

- **The generated import resolves when an output directory is configured through `..`.** The
  specifier was derived by comparing the two paths segment by segment, so a literal `..` counted as
  a directory, and where the document's directory and the module's climbed a different number of
  levels - `{project-root}/../openapi` beside `{project-root}/../../site/src/generated` - the import
  pointed outside the project and Node refused the module. Both paths are normalised first.

### Removed

- **`patches/@typespec__openapi3@1.15.0.patch` and `patches/@typespec__openapi3@1.16.0.patch`**,
  with the `patchedDependencies` entry that applied the second here.

### Fixed

- **The guide's removal check would have reported a failure after a successful removal.** It said
  that, after removing the patch, the `indexerKeyword` grep of `schema-emitter-3-1.js` should fail.
  Upstream merged the same identifier, so on unpatched `1.17.0` it still matches. The guide now says
  to read the document instead, and gives the measured `openapi-typescript@7.13.0` output for both
  versions.

## [0.5.0] - 2026-09-12

A minor that unblocks TypeSpec 1.16.0. **`0.4.0` held any project that applied its patch at
1.15.0**, by design: the shipped patch is pinned to an exact `@typespec/openapi3` version so an
upgrade fails loudly rather than applying to a version nobody tested. That is the right failure mode
and it is also a wall when there is nothing to move to: moving to `1.16.0` with only the `1.15.0`
patch available fails the install with `ERR_PNPM_UNUSED_PATCH`.

### Added

- **`patches/@typespec__openapi3@1.16.0.patch`.** Verified rather than assumed:
  `schema-emitter-3-1.js` is byte-identical in the patched region between `1.15.0` and `1.16.0`, so
  the defect survived the minor and the same diff applies, confirmed by `git apply --check` against
  the real `1.16.0` tarball. **Both patches ship.** A consumer on either version is served and
  neither is forced to move.

- **`test/patch-effect.test.ts`, which proves the patch does what it claims.** The patch was
  documented in `docs/guides.md`, shipped in the tarball, and asserted by nothing, so the only
  evidence it worked was that someone had watched it work once, on a compiler version that has since
  moved twice. Re-cutting it without an arm would have been the same act of hope again.

  It reads the published DOCUMENT rather than the patch file, so it fails whether the patch stopped
  being applied, stopped being correct, or upstream changed the behaviour underneath it. Three arms:
  a leaf dictionary emits `additionalProperties`, a typed one keeps its declared value type, and a
  model composing with `allOf` still emits `unevaluatedProperties`, which is the case the patch
  deliberately does not touch. Control: remove the `patchedDependencies` block and two of the three
  go red.

### Changed

- **The `@typespec/versioning` peer is `^0.85.0 || ^0.86.0`.** On a `0.x` version a caret pins the
  minor, so `^0.85.0` excluded `0.86.0` outright.

- **Development moved to `@typespec/{compiler,http,openapi,openapi3}@1.16.0` and
  `@typespec/{rest,versioning}@0.86.0`**, so the gates here run against the versions a consumer is
  moving to rather than the ones they are leaving.

### Fixed

- **The verification command in `docs/guides.md` reported a false negative.** It said to confirm the
  patch with `readlink node_modules/@typespec/openapi3 | grep -q 'patch_hash='`. pnpm only spells
  `patch_hash=` into the store directory while that name is short enough; once the peer-dependency
  suffix grows it hashes the whole name and the marker disappears from a correctly patched install.
  On pnpm 11.21.0 the same dependency can land as `...@1.16.0_patch_hash=...` in one install and
  `...@1.16.0_@typespec+compiler@1.16.0_...` in another, **both patched**. The guide now greps the
  installed file, which is the fact rather than a naming detail.

## [0.4.0] - 2026-08-29

A minor: **the `@typespec/openapi3` patch for dictionary properties now ships in the tarball**, so a
consuming project can copy it off disk instead of reconstructing it. Nothing about the emitted
document or `document.gen.ts` changes.

### The defect it addresses

`@typespec/openapi3@1.15.0` publishes a declared `Record<T>` indexer as `unevaluatedProperties`.
No TypeScript client generator implements that keyword, so the schema reads as declaring no
properties at all. Measured end to end on `openapi-typescript@7.13.0`:

| TypeSpec                            | 3.1 document                            | generated client type   |
| ----------------------------------- | --------------------------------------- | ----------------------- |
| `model Metadata is Record<unknown>` | `unevaluatedProperties: {}`             | `Record<string, never>` |
| `labels: Record<string>`            | `unevaluatedProperties: {type: string}` | `Record<string, never>` |

**The typed case loses its value type as well**, and `Record<string, never>` is an object that must
be empty - so a consumer cannot build one. Measured by compiling a value against the generated
client: `Type 'string' is not assignable to type 'never'`. With the patch the same value compiles,
against `{ [key: string]: string }`.

### What the patch does NOT change, measured on both sides

| model                               | without                           | with                       |
| ----------------------------------- | --------------------------------- | -------------------------- |
| a leaf dictionary                   | `unevaluatedProperties`           | **`additionalProperties`** |
| a dictionary on a model with a BASE | `unevaluatedProperties`           | unchanged                  |
| a sealed model (`...Record<never>`) | `unevaluatedProperties: {not:{}}` | unchanged                  |
| a plain model                       | no keyword                        | unchanged                  |

The guard is `model.baseModel`, not `derivedModels`: a keyword sitting beside an `allOf` must account
for properties the base subschema evaluates, which `additionalProperties` cannot see.

### Added

- **`patches/` is published.** The patch was previously applied on one machine and shipped to nobody:
  `files` gained `patches/**` without a version bump, and the published `0.3.0` tarball contains no
  such directory. A recipe nobody can obtain is not a recipe.
- **`docs/guides.md` carries the copy-paste wiring**, including that `patchedDependencies` must live
  in `pnpm-workspace.yaml` - pnpm 11 no longer reads it from `package.json` and only warns.
- **Two changelog guards**, as the sibling packages carry: the version being published has an
  entry, and any `[Unreleased]` heading sits above every released version. Both problems they catch
  were already present: work with no entry, under an `[Unreleased]` heading left below a released
  version still reading "Nothing since `0.2.0`".

### Removal is automatic

The patch is pinned to `@typespec/openapi3@1.15.0`, so the first install that moves off that version
fails with `ERR_PNPM_UNUSED_PATCH` and exit 1 rather than silently going unapplied. Verified by
pointing the dependency at `1.14.0` and watching the install refuse.

## [0.3.0] - 2026-08-15

### Fixed

- **Several `openapi-versions` made list order decide which document was served.**
  `@typespec/openapi3` writes one document per version, nested under a directory per version. This
  emitter exports a single module, and resolved that by taking the FIRST entry of the list - so
  adding a version to gain a second published artefact silently changed which single artefact was
  served instead.

  It is now refused with `multiple-openapi-versions`, and nothing is emitted. A consumer who needs
  both documents runs a second compile with its own `openapi-versions` and `emitter-output-dir`,
  which keeps one module exporting one document.

## [0.2.0] - 2026-08-14

A minor: a service can be routed to a directory of its own, which changes where its module lands.

### Added

- **`services`**, keyed on the service's namespace name, each entry taking an `output-dir`. A program
  declaring several services emitted every module into one directory, so a service deployed on its
  own had to import across a package boundary to reach its own document. The
  same seam, spelled the same way, as `typespec-hono` and `typespec-http-zod`. A service the map does
  not name is unaffected.

  An absolute path is used as given; a relative one resolves against the project root.
  `{project-root}` is not available in a nested option - the compiler interpolates only the path
  options it defines itself, measured, so the resolution rule is stated in `docs/reference.md`
  instead of a second copy of that interpolation being written here.

Nothing since `0.1.1`.

## [0.1.1] - 2026-08-13

A patch rather than a minor: `document.gen.ts` is byte-identical to what `0.1.0` emitted, verified by
diffing this package's source since the tag. The only non-comment change is the punctuation of one
diagnostic message.

### Documentation

The README is a README again rather than a manual: what it is, install, a quick start that runs end to
end, and links to the rest. The reference material moved to `docs/guides.md` and `docs/reference.md`.
The quick start is new, and shows the project layout with generated files marked as generated, which
the previous README did not make clear.

Every tracked file is ASCII.

## [0.1.0] - 2026-08-13

First release.
