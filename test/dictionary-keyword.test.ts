import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compileSource } from "./support/compile-fixture.js";

/**
 * **The dictionary keyword `docs/guides.md` promises, read from the document openapi3 writes.**
 *
 * Up to `1.16.0`, `@typespec/openapi3` published a declared `Record<T>` indexer as
 * `unevaluatedProperties`, a keyword `openapi-typescript` does not implement, so a generated client
 * read the schema as declaring no properties at all and a dictionary became `Record<string, never>`
 * - an object that must be empty. A typed dictionary lost its value type as well. This package
 * shipped a patch for it until `1.17.0`, which carries the fix upstream (microsoft/typespec#11954).
 *
 * The arms were written against that patch and are unchanged: they now grade openapi3 itself, so a
 * regression upstream turns them red rather than reaching a consumer's generated client. Control:
 * pin `@typespec/openapi3` back to `1.16.0`, unpatched, and the first two go red.
 */

interface Schema {
	readonly additionalProperties?: unknown;
	readonly unevaluatedProperties?: unknown;
}

let schemas: Readonly<Record<string, Schema>> = {};

beforeAll(async () => {
	const compiled = await compileSource(
		"dictionary-keyword",
		`import "@typespec/http";
using Http;

@service(#{ title: "Dictionaries" })
namespace Dictionaries;

/** A leaf dictionary: an indexer and no base model. The case #11954 changed. */
model Metadata is Record<unknown>;

/** A typed one, where the VALUE type is what a client generator loses. */
model Labels is Record<string>;

/** A base and a derived model, so the composing case is covered too. */
model Base {
  id: string;
}

model Derived extends Base {
  ...Record<unknown>;
}

@route("/things")
@get
op read(): { metadata: Metadata; labels: Labels; derived: Derived };
`,
		{ openapi3: { "openapi-versions": ["3.1.0"], "file-type": "json" } },
	);
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	// `file-type: json` above, so this suite needs no YAML parser to read what was published.
	const file = readdirSync(compiled.documentDir).find((n) => n.endsWith(".json"));
	expect(file, "no JSON document was written").toBeDefined();
	const parsed = JSON.parse(readFileSync(join(compiled.documentDir, file ?? ""), "utf8")) as {
		components: { schemas: Record<string, Schema> };
	};
	schemas = parsed.components.schemas;
}, 300_000);

describe("the dictionary keyword in an OpenAPI 3.1 document", () => {
	it("emits additionalProperties for a LEAF dictionary, which is what a client generator reads", () => {
		expect(schemas["Metadata"]).toHaveProperty("additionalProperties");
		expect(schemas["Metadata"]).not.toHaveProperty("unevaluatedProperties");
	});

	it("keeps the declared VALUE type, which is the half a typed dictionary loses", () => {
		expect(schemas["Labels"]?.additionalProperties).toMatchObject({ type: "string" });
	});

	it("leaves a model that composes with allOf on unevaluatedProperties", () => {
		// `additionalProperties` cannot see properties evaluated by the `allOf` subschema holding the
		// base model, so it would constrain them. openapi3 guards on `model.baseModel` for this.
		expect(schemas["Derived"]).toHaveProperty("unevaluatedProperties");
		expect(schemas["Derived"]).not.toHaveProperty("additionalProperties");
	});
});
