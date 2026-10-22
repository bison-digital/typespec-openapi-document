import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { $lib } from "../src/lib.js";
import { compileSource } from "./support/compile-fixture.js";

/**
 * **The refusals, which are the actual product.**
 *
 * **Emitting a broken import is the one outcome this package must never have.** Its whole job is
 * resolving one specifier; a generated file importing a document that is not there would be worse than
 * no package at all, because the consumer would find out from a bundler with no idea why. The sibling
 * server emitter shipped exactly that defect. A generated file importing a runtime module that
 * exported none of the names it used, and it compiled clean, passed 83 tests, and was only caught by
 * installing it from a tarball.
 *
 * So every refusal is asserted on both halves: it **fires**, and it **emits nothing** rather than
 * emitting something broken alongside the complaint.
 *
 * **`warning`, not `error`, and that is a measured decision rather than a soft one.** An error sets
 * `program.hasError()`, and `@typespec/openapi3` declines to write anything when the program has
 * errors, including errors that are not its own. A docs emitter that refused loudly enough to destroy
 * the very document it exists to export would be self-defeating. A consumer who wants a refusal to
 * fail the build sets `warn-as-error`, which is the compiler's own switch for it.
 */

const SPEC = `
import "@typespec/http";
using Http;
@service(#{ title: "Widgets" })
namespace Widgets;
model Widget { id: string; }
@route("/widgets") @get op list(): Widget[];
`;

function ours(compiled: { diagnostics: readonly { code: string; severity: string }[] }): string[] {
	return compiled.diagnostics
		.filter((d) => d.code.startsWith("typespec-openapi-document/"))
		.map((d) => `${d.severity}: ${d.code}`);
}

function generatedFiles(dir: string): string[] {
	return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".gen.ts")) : [];
}

describe("it refuses rather than emitting an import that cannot resolve", () => {
	it("names every refusal it declares, so none can be added without a test", () => {
		/**
		 * **A floor over `$lib` rather than a list here.** A diagnostic added later without an arm
		 * below fails this, which is the point. The class is "every refusal is exercised", not "these
		 * three are".
		 */
		const declared = Object.keys($lib.diagnostics);
		expect(declared).toHaveLength(4);
		expect(declared.toSorted()).toEqual([
			"document-path-unresolved",
			"multiple-openapi-versions",
			"openapi3-not-emitted",
			"unsupported-document-format",
		]);
	});

	/**
	 * **Several OpenAPI versions is several DOCUMENTS, and this package exports one module.**
	 *
	 * `openapi-versions: [3.1.0, 3.0.0]` makes `@typespec/openapi3` write a document per version into
	 * a directory per version. This emitter resolved that by taking the FIRST entry of the list and
	 * exporting only that one - so the served document was decided by list order, silently, and
	 * adding a version to get a second artefact instead changed which single artefact was served.
	 *
	 * Refused rather than guessed, and refused rather than inventing a second export name the spec
	 * never asked for. A consumer who wants both documents can run two compiles, each naming its own
	 * version and its own output directory, which keeps one module exporting one document.
	 */
	it("reports several OpenAPI versions rather than exporting whichever is first", async () => {
		const compiled = await compileSource("many-spec-versions", SPEC, {
			openapi3: { "file-type": "json", "openapi-versions": ["3.1.0", "3.0.0"] },
		});
		expect(ours(compiled)).toEqual([
			"warning: typespec-openapi-document/multiple-openapi-versions",
		]);
		expect(existsSync(join(compiled.outDir, "document.gen.ts"))).toBe(false);
	});

	it("says nothing when one OpenAPI version is named, the ordinary case", async () => {
		const compiled = await compileSource("one-spec-version", SPEC, {
			openapi3: { "file-type": "json", "openapi-versions": ["3.1.0"] },
		});
		expect(ours(compiled)).toEqual([]);
	});

	it("reports when @typespec/openapi3 is not in `emit`, and emits nothing", async () => {
		/**
		 * **The common case, and it is a configuration mistake rather than a spec one.** A consumer
		 * adds this emitter expecting a document and does not realise it emits nothing itself, it
		 * exports what openapi3 wrote. Without this they get `Cannot find module` from a bundler later,
		 * with nothing pointing at the cause.
		 */
		const compiled = await compileSource("no-openapi3", SPEC, { withoutOpenApi3: true });
		expect(ours(compiled)).toEqual(["warning: typespec-openapi-document/openapi3-not-emitted"]);
		expect(generatedFiles(compiled.outDir)).toEqual([]);
	});

	it("reports when the document is YAML, which is openapi3's DEFAULT", async () => {
		/**
		 * **Compiled with NO `file-type` set**, deliberately. This is what a consumer gets by
		 * default, and a test that passed `file-type: yaml` explicitly would be checking a path almost
		 * nobody takes while the default one stayed ungraded.
		 *
		 * A TypeScript module can import JSON and cannot import YAML without a parser and a build
		 * plugin. Refused with the one-line remedy rather than shipping a parser on the consumer's
		 * behalf.
		 */
		const compiled = await compileSource("yaml-default", SPEC);
		expect(ours(compiled)).toEqual([
			"warning: typespec-openapi-document/unsupported-document-format",
		]);
		expect(generatedFiles(compiled.outDir)).toEqual([]);
	});

	it("emits cleanly once the document is JSON, so the refusal is about format alone", async () => {
		// The control for the arm above: same spec, one option changed, no diagnostic and a module.
		const compiled = await compileSource("yaml-fixed", SPEC, { openapi3: { "file-type": "json" } });
		expect(ours(compiled)).toEqual([]);
		expect(generatedFiles(compiled.outDir)).toEqual(["document.gen.ts"]);
	});

	it("accepts an explicit document-path, which is the escape hatch the messages name", async () => {
		/**
		 * **It bypasses the format check too, and that is deliberate.** A consumer setting this has
		 * said where the document is; second-guessing them would make the escape hatch useless in
		 * exactly the situations it exists for.
		 */
		const compiled = await compileSource("override", SPEC, {
			emitter: { "document-path": "./elsewhere/api.json" },
		});
		expect(ours(compiled)).toEqual([]);
		expect(generatedFiles(compiled.outDir)).toEqual(["document.gen.ts"]);
	});
});
