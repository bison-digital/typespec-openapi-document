import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSource } from "./support/compile-fixture.js";

/**
 * **The import this emitter writes points at the file `@typespec/openapi3` actually wrote.**
 *
 * **This is the whole package, and it depends on somebody else's naming convention.** openapi3
 * builds its output path from four things, and getting any one wrong emits an import to a file that
 * does not exist:
 *
 * ```js
 * const outputFile = options["output-file"] ??
 *   `openapi.{service-name-if-multiple}.{version}.${fileTypes[0]}`;
 * const specDir = openapiVersions.length > 1 ? "{openapi-version}" : "";
 * resolvePath(emitterOutputDir, specDir, outputFile)
 * ```
 *
 * **Reproducing another package's convention is a drift risk, and a test is the only honest answer
 * to it.** Every combination below is compiled for real, and the assertion is not "the path looks
 * right". It is that the emitted specifier RESOLVES to a file that exists and whose bytes are the
 * document openapi3 wrote. If openapi3 changes its rule, this goes red naming the combination rather
 * than a consumer finding out from their bundler.
 *
 * **Bytes, not paths.** A path comparison passes when both sides are wrong in the same way, which
 * is exactly what happens when a resolver and its test are written from the same mistaken reading.
 */

/** The specifier the generated module imports, and where it lands. */
function importedDocuments(
	outDir: string,
	file = "document.gen.ts",
): { specifier: string; path: string }[] {
	const source = readFileSync(join(outDir, file), "utf8");
	const found = [...source.matchAll(/import document\d+ from "([^"]+)"/g)].map((match) => ({
		specifier: match[1] ?? "",
		path: resolve(outDir, match[1] ?? ""),
	}));
	expect(found.length, `no document import found in ${file}`).toBeGreaterThanOrEqual(1);
	return found;
}

/** The single import, for the cases where exactly one is expected. */
function importedDocument(
	outDir: string,
	file = "document.gen.ts",
): { specifier: string; path: string } {
	const found = importedDocuments(outDir, file);
	expect(found, `expected one import in ${file}`).toHaveLength(1);
	return found[0] ?? { specifier: "", path: "" };
}

/** Every document openapi3 wrote under a directory, recursively, it may nest by openapi version. */
function documentsUnder(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));
}

const SINGLE = `
import "@typespec/http";
using Http;
@service(#{ title: "Widgets" })
namespace Widgets;
model Widget { id: string; }
@route("/widgets") @get op list(): Widget[];
`;

describe("the emitted import resolves to the document openapi3 wrote", () => {
	it("with default naming, JSON, one unversioned service", async () => {
		const compiled = await compileSource("single", SINGLE, { openapi3: { "file-type": "json" } });
		const { specifier, path } = importedDocument(compiled.outDir);

		// Relative, because an absolute path is committed by the consumer and works on one machine.
		expect(specifier.startsWith(".")).toBe(true);
		expect(existsSync(path), `emitted import does not resolve: ${specifier}`).toBe(true);

		// Bytes, not paths: openapi3 wrote exactly one document, and this must BE it.
		const written = documentsUnder(compiled.documentDir);
		expect(written).toHaveLength(1);
		expect(readFileSync(path)).toEqual(readFileSync(written[0] ?? ""));
	});

	/**
	 * **Output directories spelled through `..`, as a monorepo's spec package names its neighbours.**
	 * The specifier was computed by comparing the two paths segment by segment, so a literal `..`
	 * counted as a directory: where the two climbed a different number of levels, the import pointed
	 * outside the project, and Node refused the module.
	 */
	it("with output directories spelled through '..', climbing different distances", async () => {
		const root = fileURLToPath(new URL("./.out/dotted", import.meta.url));
		const compiled = await compileSource("dotted", SINGLE, {
			emitter: { "emitter-output-dir": `${root}/a/b/../../site/src/generated` },
			openapi3: { "file-type": "json", "emitter-output-dir": `${root}/a/b/../openapi` },
		});
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const { specifier, path } = importedDocument(join(root, "site", "src", "generated"));
		expect(specifier).toBe("../../../a/openapi/openapi.json");
		expect(existsSync(path), `emitted import does not resolve: ${specifier}`).toBe(true);
		const written = documentsUnder(join(root, "a", "openapi"));
		expect(written).toHaveLength(1);
		expect(readFileSync(path)).toEqual(readFileSync(written[0] ?? ""));
	});

	it("with a custom output-file, which changes the name entirely", async () => {
		const compiled = await compileSource("custom-name", SINGLE, {
			openapi3: { "file-type": "json", "output-file": "service-document.json" },
		});
		const { path } = importedDocument(compiled.outDir);
		expect(existsSync(path)).toBe(true);
		const written = documentsUnder(compiled.documentDir);
		expect(readFileSync(path)).toEqual(readFileSync(written[0] ?? ""));
	});

	it("with several OpenAPI versions, which is refused rather than resolved", async () => {
		/**
		 * **This arm used to assert that the resolver accounted for the `{openapi-version}` directory**,
		 * because `openapi-versions: [a, b]` nests each document under one. It resolved the FIRST
		 * entry, so the served document was decided by list order and adding a version to gain a
		 * second artefact silently changed which single artefact was served.
		 *
		 * Several documents cannot be exported from one module, so the resolution is gone and the
		 * refusal replaces it - see `diagnostics.test.ts`. What is asserted here is that nothing is
		 * emitted, because a plausible-looking wrong path is the failure this package exists to avoid.
		 */
		const compiled = await compileSource("multi-version", SINGLE, {
			openapi3: { "file-type": "json", "openapi-versions": ["3.0.0", "3.1.0"] },
		});
		// The directory is not created at all when nothing is emitted, which is itself the claim.
		const emitted = existsSync(compiled.outDir)
			? readdirSync(compiled.outDir).filter((file) => file.endsWith(".gen.ts"))
			: [];
		expect(emitted).toEqual([]);
	});

	it("with several services, which puts the service name in the filename", async () => {
		/**
		 * **`{service-name-if-multiple}` is empty for one service and populated for several**, so a
		 * resolver tested only against a single-service spec passes while being wrong for every
		 * multi-service one. Both are compiled here for that reason.
		 */
		const compiled = await compileSource(
			"multi-service",
			`
import "@typespec/http";
using Http;
@service(#{ title: "Alpha" })
namespace Alpha { model A { id: string; } @route("/a") @get op a(): A; }
@service(#{ title: "Beta" })
namespace Beta { model B { id: string; } @route("/b") @get op b(): B; }
`,
			{ openapi3: { "file-type": "json" } },
		);
		const emitted = readdirSync(compiled.outDir).filter((f) => f.endsWith(".gen.ts"));
		expect(emitted.length, "expected one module per service").toBe(2);

		const written = documentsUnder(compiled.documentDir);
		expect(written).toHaveLength(2);
		for (const file of emitted) {
			const { path } = importedDocument(compiled.outDir, file);
			expect(existsSync(path), `unresolved for ${file}`).toBe(true);
			expect(written).toContain(path);
		}
	});

	it("with a VERSIONED service, where openapi3 writes one document per version", async () => {
		/**
		 * **The fifth axis, and the one that was listed and not tested.** `@versioned` makes openapi3
		 * write `openapi.v1.json` and `openapi.v2.json` rather than `openapi.json`, so a resolver that
		 * passes no version emits an import to a file that does not exist, the exact failure this
		 * package exists to prevent, in the package built to prevent it.
		 */
		const compiled = await compileSource(
			"versioned",
			`
import "@typespec/http";
import "@typespec/versioning";
using Http;
using Versioning;

@service(#{ title: "Widgets" })
@versioned(Versions)
namespace Widgets;
enum Versions {
	v1,
	v2preview,
	v2,
}
model Widget { id: string; }
@route("/widgets") @get op list(): Widget[];
`,
			{ openapi3: { "file-type": "json" } },
		);
		const written = documentsUnder(compiled.documentDir);
		expect(written.length, "openapi3 should write one document per version").toBeGreaterThanOrEqual(
			2,
		);

		const found = importedDocuments(compiled.outDir);
		expect(found.length, "one import per declared version").toBe(written.length);
		for (const { specifier, path } of found) {
			expect(existsSync(path), `emitted import does not resolve: ${specifier}`).toBe(true);
			expect(written).toContain(path);
		}

		/**
		 * **`openApiDocument` must be the last DECLARED version, not the last by name.** Asserted
		 * against the source rather than inferred: `v2` is declared after `v1`, so the current document
		 * is the second import. A resolver that sorted filenames would still pass every arm above.
		 */
		const source = readFileSync(join(compiled.outDir, "document.gen.ts"), "utf8");
		expect(source).toMatch(/export const openApiDocument = document2;/);
		expect(source).toContain('"v1": document0');
		expect(source).toContain('"v2": document2');
	});
});
