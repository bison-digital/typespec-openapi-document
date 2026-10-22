import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **What the emitter's behaviour may rest on, checked rather than remembered.** Its behaviour comes
 * from the TypeSpec language, from what `typespec-http-zod` publishes and from `@typespec/openapi3`'s
 * documented convention, never from a name one spec happens to use or from a library internal.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const src = join(packageRoot, "src");

/**
 * Every hand-written `.ts` and `.tsp` file under `src/` and `test/`. `.out*` directories hold
 * generated files, which are graded by other suites.
 */
function handWrittenFiles(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".out") || entry === "node_modules" || entry === "dist") continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".ts") || entry.endsWith(".tsp")) found.push(full);
		}
	};
	walk(src);
	walk(join(packageRoot, "test"));
	return found;
}

describe("behaviour comes from the language, not from a spec author's names", () => {
	const files = handWrittenFiles();

	it("has source to inspect at all", () => {
		// Without this the arm below passes the day the walk stops finding files.
		expect(files.length).toBeGreaterThanOrEqual(13);
	});

	it("keys no behaviour on a name the spec AUTHOR chose", () => {
		/**
		 * **`.kind` is TypeSpec's vocabulary and `.name` is the spec author's.** Branching on
		 * `type.kind === "Model"` is reading the language; branching on `parameter.name === "ownerId"`
		 * decides that one word means something in every spec that uses it, which is a rule no document
		 * states.
		 *
		 * The exception is a name TypeSpec itself decides: `bytes`, `Record`, `never`, the empty name an
		 * anonymous model carries. That is a closed first-party set, not a list this package maintains.
		 */
		const TYPESPEC_BUILT_IN =
			/^(|null|unknown|void|never|bytes|integer|string|boolean|numeric|Array|Record|File)$/;
		const offenders: string[] = [];
		for (const file of files) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
				for (const match of line.matchAll(/\.name\s*[=!]==\s*"([^"]*)"/g)) {
					const literal = match[1] ?? "";
					if (!TYPESPEC_BUILT_IN.test(literal)) {
						offenders.push(`${file}:${index + 1}: keyed on the author-chosen name "${literal}"`);
					}
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});

describe("the emitter is written against published APIs", () => {
	it("reaches into `typespec-http-zod` only through what it publishes", () => {
		/**
		 * The library's `exports` map forbids a deep import, so anything the emitter cannot do from the
		 * published surface is a gap in that surface, to be fixed there rather than worked around here.
		 * Asserted over every specifier the file names, so a new import cannot slip in unexamined.
		 */
		const source = readFileSync(join(src, "emitter.ts"), "utf8");
		const specifiers = [
			...source.matchAll(/^(?:import|export)\s(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm),
		].map((match) => match[1] ?? "");
		expect(specifiers.length).toBeGreaterThanOrEqual(3);
		const deepImport = specifiers.filter((specifier) =>
			/^typespec-http-zod\/(?!runtime$)/.test(specifier),
		);
		expect(deepImport).toEqual([]);
	});

	it("depends on openapi3's convention, never on its internals", () => {
		/**
		 * **This package reproduces another package's naming rule, and that is only defensible if the
		 * dependency is a CONVENTION rather than an API.** `@typespec/openapi3` is a peer for version
		 * compatibility; importing from it, especially past its entry point, would couple this package
		 * to internals it does not publish and could change without a major bump. `resolution.test.ts`
		 * compiles openapi3 for real and asserts the emitted import resolves to the bytes it wrote,
		 * which is what catches drift.
		 */
		const specifiers = handWrittenFiles()
			.filter((file) => file.startsWith(src) && file.endsWith(".ts"))
			.flatMap((file) =>
				[
					...readFileSync(file, "utf8").matchAll(
						/^(?:import|export)\s(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm,
					),
				].map((match) => match[1] ?? ""),
			);
		expect(specifiers.length).toBeGreaterThanOrEqual(3);
		expect(specifiers.filter((s) => s.startsWith("@typespec/openapi3"))).toEqual([]);
	});
});
