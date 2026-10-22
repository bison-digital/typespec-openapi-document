import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

/**
 * Compile a spec with BOTH this emitter and `@typespec/openapi3`, from one program.
 *
 * **One program, not two compiles.** This package's entire job is naming the file openapi3 wrote,
 * so a suite that ran them separately would be comparing a path against a document from a different
 * compile, and any disagreement would be ambiguous between "the resolver is wrong" and "the two
 * compiles differed". The sibling package learned that the expensive way.
 *
 * **Each caller owns its output directory.** Vitest runs test files in parallel, and two suites
 * compiling one fixture into one directory overwrite each other. A failure that once made the same
 * request answer 400, 200 and 204 across three runs of an unchanged emitter.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export interface CompiledFixture {
	readonly outDir: string;
	readonly documentDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
}

export interface FixtureOptions {
	/** Options handed to `@typespec/openapi3`, beyond its output directory. */
	readonly openapi3?: Readonly<Record<string, unknown>>;
	/** Options handed to this emitter. */
	readonly emitter?: Readonly<Record<string, unknown>>;
	/** Omit `@typespec/openapi3` from `emit` entirely. The configuration mistake this package names. */
	readonly withoutOpenApi3?: boolean;
}

/**
 * Compile inline TypeSpec source, so a test states the spec it is about rather than pointing at a
 * fixture file three directories away.
 */
export async function compileSource(
	name: string,
	source: string,
	options: FixtureOptions = {},
): Promise<CompiledFixture> {
	const root = join(packageRoot, "test", ".out", name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	const mainFile = join(root, "main.tsp");
	writeFileSync(mainFile, source);

	const outDir = join(root, "generated");
	const documentDir = join(root, "openapi");
	const emit =
		options.withoutOpenApi3 === true
			? ["typespec-openapi-document"]
			: ["typespec-openapi-document", "@typespec/openapi3"];

	const program = await compile(NodeHost, mainFile, {
		outputDir: root,
		emit,
		options: {
			"typespec-openapi-document": { "emitter-output-dir": outDir, ...options.emitter },
			"@typespec/openapi3": { "emitter-output-dir": documentDir, ...options.openapi3 },
		},
	});

	return {
		outDir,
		documentDir,
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
	};
}
