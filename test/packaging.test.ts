import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSource } from "./support/compile-fixture.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * **What a stranger gets when they install this package.**
 *
 * **Every other test here runs inside the checkout, where that question cannot be asked.** A
 * package resolves its own devDependencies, so a source file importing something it never declared
 * works perfectly, right up until somebody installs it on its own and gets `Cannot find package`.
 * Measured before an arm like this existed: the emitter imported `resolveOperationId` from
 * `@typespec/openapi`, which appeared in `devDependencies` and in no `peerDependencies` at all. The
 * published package would not have run.
 *
 * The generated OUTPUT has the same problem one level out: whatever it imports becomes the consumer's
 * requirement too, and saying so is this manifest's job.
 *
 * **Asserted as a CLASS** (every specifier the source and the output reference) rather than as a
 * list somebody remembers to extend.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
	name: string;
	license?: string;
	repository?: unknown;
	files?: readonly string[];
	publishConfig?: { access?: string; provenance?: boolean };
	exports?: Record<string, string | Record<string, string>>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

/** `@scope/name/sub` -> `@scope/name`; `node:fs` and relative paths are not packages. */
function packageOf(specifier: string): string | undefined {
	if (specifier.startsWith(".") || specifier.startsWith("node:")) return undefined;
	// An emitted import line is itself a template literal, so its specifier can be a placeholder
	// decided by the consumer's options, not by this manifest.
	if (specifier.includes("${")) return undefined;
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((entry) => entry.endsWith(".ts"))
		.map((entry) => join(dir, entry));
}

/** Static `from "x"` and guarded `import("x")` alike, both resolve at run time. */
function specifiersIn(source: string): string[] {
	return [
		...[...source.matchAll(/^import\s[^"']*from\s*"([^"]+)"/gm)].map((match) => match[1] ?? ""),
		...[...source.matchAll(/\bimport\("([^"]+)"\)/g)].map((match) => match[1] ?? ""),
	];
}

describe("the package declares what it needs to run outside this checkout", () => {
	const declared = new Set([
		...Object.keys(manifest.peerDependencies ?? {}),
		...Object.keys(manifest.dependencies ?? {}),
	]);
	let emitted: string[] = [];

	beforeAll(async () => {
		const compiled = await compileSource(
			"packaging",
			`
import "@typespec/http";
using Http;
@service(#{ title: "Widgets" })
namespace Widgets;
model Widget { id: string; }
@route("/widgets") @get op list(): Widget[];
`,
			{ openapi3: { "file-type": "json" } },
		);
		emitted = readdirSync(compiled.outDir)
			.filter((f) => f.endsWith(".gen.ts"))
			.map((f) => `${compiled.outDir}/${f}`);
	}, 600_000);

	it("declares every package `src/` imports", () => {
		const used = new Set<string>();
		for (const file of sourceFiles(join(packageRoot, "src"))) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				const owner = packageOf(specifier);
				if (owner !== undefined && owner !== manifest.name) used.add(owner);
			}
		}
		/**
		 * Non-vacuity: a regex that stops matching would report perfect agreement.
		 *
		 * **One, not the sibling's three.** This emitter imports `@typespec/compiler` and nothing else
		 *. It reads the compile and writes a module. A floor copied from a package with more surface
		 * would be unsatisfiable here, and the CLASS assertion below is what actually guards this: every
		 * package `src/` imports must be declared.
		 */
		expect(used.size).toBeGreaterThanOrEqual(1);
		expect([...used].filter((name) => !declared.has(name)).toSorted()).toEqual([]);
	});

	it("declares every package the GENERATED output imports", () => {
		/**
		 * **The output's imports are the consumer's problem, and the consumer learns about them from
		 * this manifest.** Generated code importing a package the project does not have fails at its
		 * build, naming a package it never chose.
		 */
		/**
		 * **Compiled by this suite, into a directory only this suite writes.** Walking `test/` for
		 * whatever other suites had emitted would grade the previous run's build on a populated tree
		 * and nothing at all on a fresh clone.
		 */
		expect(emitted.length).toBeGreaterThanOrEqual(1);

		const used = new Set<string>();
		for (const file of emitted) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				const owner = packageOf(specifier);
				// Relative paths, placeholders and this package's own name are not dependencies.
				if (owner === undefined || owner === manifest.name) continue;
				used.add(owner);
			}
		}
		/**
		 * **Zero, and that is the assertion.** The generated module imports one relative JSON file and
		 * nothing else. It adds no dependency to the consumer's project, which is what makes this
		 * package framework-agnostic in practice rather than only in intent. A package name appearing
		 * here later means the emitted module started requiring something, and that is a decision.
		 */
		expect(used.size).toBe(0);
		expect([...used].filter((name) => !declared.has(name)).toSorted()).toEqual([]);
	});

	it("marks as optional exactly the peers behind a guarded import", () => {
		/**
		 * **A guarded `import()` that is a REQUIRED peer forces every consumer to install it.**
		 * `@typespec/versioning` is resolved inside `try`/`catch` precisely so a spec declaring no
		 * versions does not need it, the same treatment `@typespec/openapi3` gives it. A guarded import
		 * whose peer is not marked optional is how that promise quietly stops being true.
		 */
		const guarded = new Set<string>();
		for (const file of sourceFiles(join(packageRoot, "src"))) {
			for (const match of readFileSync(file, "utf8").matchAll(/\bimport\("([^"]+)"\)/g)) {
				const owner = packageOf(match[1] ?? "");
				if (owner !== undefined) guarded.add(owner);
			}
		}
		const optional = Object.entries(manifest.peerDependenciesMeta ?? {})
			.filter(([, meta]) => meta.optional === true)
			.map(([name]) => name);
		/**
		 * **The two sets must be equal.** Every guarded import is an optional peer, and declaring an
		 * optional peer that nothing resolves lazily would be a promise about behaviour this package
		 * does not have.
		 */
		expect(optional.toSorted()).toEqual([...guarded].toSorted());
	});

	it("emits a module that needs no runtime from this package", () => {
		/**
		 * **The sibling packages ship a `src/runtime.ts` and this one deliberately does not.** Their
		 * generated output imports a runtime contract; this one imports a JSON file and exports it, so
		 * there is nothing for a consumer to install or substitute. A runtime appearing here later would
		 * mean the emitted module had grown a dependency, which is a decision rather than a detail,
		 * so its ABSENCE is asserted rather than assumed.
		 */
		expect(existsSync(join(packageRoot, "src", "runtime.ts"))).toBe(false);
		expect(manifest.exports?.["./runtime"]).toBeUndefined();
	});
});

describe("the package is configured to publish the way it claims", () => {
	it("declares public access and provenance", () => {
		/**
		 * **Provenance is what lets a stranger verify the tarball came from this commit**, via a
		 * signed attestation npm produces at publish time. It is off by default, its absence is
		 * invisible on the published page, and nobody notices until somebody wants to check, which is
		 * the shape of thing worth asserting rather than remembering.
		 *
		 * **`access: "public"` matters even for an unscoped name.** It is the default today; stating
		 * it means a later rename to a scoped package cannot publish privately by accident.
		 */
		expect(manifest.publishConfig?.access).toBe("public");
		expect(manifest.publishConfig?.provenance).toBe(true);
	});

	it("has a release workflow that can only publish deliberately", () => {
		/**
		 * **`id-token: write` is not optional.** Provenance is an OIDC exchange, so a workflow
		 * without that permission fails the publish outright rather than quietly publishing unsigned,
		 * which is the better failure, but only if the permission is there to begin with.
		 *
		 * The trigger is asserted too: publishing must follow a tag or a deliberate dispatch, never a
		 * merge to the default branch.
		 */
		const workflow = readFileSync(join(packageRoot, ".github/workflows/release.yml"), "utf8");
		expect(workflow).toMatch(/id-token:\s*write/);
		expect(workflow).toMatch(/--provenance/);
		expect(workflow).toMatch(/tags:\s*\["v\*"\]/);
		expect(workflow).not.toMatch(/branches:\s*\[\s*["']?main/);
	});
});

describe("the package is publishable", () => {
	let extracted = "";

	beforeAll(() => {
		/**
		 * **`pnpm pack` is the only thing that answers "what actually ships".** `files` is a set of
		 * globs, and a glob that stops matching is indistinguishable from one that matches nothing,
		 * an entry point outside it installs as a missing module. Reading the real tarball is the
		 * difference between checking the manifest and checking the package.
		 */
		const workspace = mkdtempSync(join(tmpdir(), "tsh-pack-"));
		const output = execFileSync("pnpm", ["pack", "--pack-destination", workspace], {
			cwd: packageRoot,
			encoding: "utf8",
		});
		const tarball = output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.endsWith(".tgz"))
			.at(-1);
		expect(tarball, output).toBeDefined();
		execFileSync("tar", ["-xzf", tarball ?? "", "-C", workspace]);
		extracted = join(workspace, "package");
	}, 300_000);

	afterAll(() => {
		if (extracted !== "") rmSync(join(extracted, ".."), { recursive: true, force: true });
	});

	it("ships every path its own entry points resolve to", () => {
		// A target is a path, `"./package.json": "./package.json"`, or a path per condition.
		const targets = Object.values(manifest.exports ?? {}).flatMap((entry) =>
			typeof entry === "string" ? [entry] : Object.values(entry),
		);
		/**
		 * **Three, not four.** The sibling publishes a second entry point, `./runtime`, that a running
		 * server imports; this package has none. Its generated module imports a JSON file and needs
		 * nothing from here at run time. So the floor is the three conditions of the single entry, and
		 * every one of them is then asserted to exist in the tarball below.
		 */
		expect(targets.length).toBeGreaterThanOrEqual(3);
		const missing = targets.filter((path) => !existsSync(join(extracted, path)));
		expect(missing.toSorted(), `missing from the tarball`).toEqual([]);
	});

	it("ships no test material", () => {
		/**
		 * **Test material in a published package becomes de-facto public API, delivered to every
		 * installer forever.** `@typespec/openapi3` excludes `dist/test/**` explicitly; so does this.
		 */
		const shipped: string[] = [];
		const walk = (dir: string, prefix: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
				else shipped.push(`${prefix}${entry}`);
			}
		};
		walk(extracted, "");
		expect(shipped.length).toBeGreaterThanOrEqual(10);
		expect(
			shipped.filter((path) => /(^|\/)test\//.test(path) || path.endsWith(".test.js")),
		).toEqual([]);
		expect(shipped.filter((path) => path.endsWith(".tsp") && !path.startsWith("lib/"))).toEqual([]);
	});

	it("carries a licence, a readme, and points at its source", () => {
		expect(manifest.license).toBe("MIT");
		expect(manifest.repository).toBeDefined();
		expect(existsSync(join(extracted, "LICENSE"))).toBe(true);
		expect(existsSync(join(extracted, "README.md"))).toBe(true);
	});

	it("declares no dependency by path", () => {
		/**
		 * **A `link:` or `file:` range is a local checkout, and publishing one breaks every
		 * installer.** This package has no runtime dependencies today; the arm exists because linking
		 * sibling packages during development is exactly the arrangement that invites the mistake, and
		 * it costs nothing to hold the line before there is something to hold it on.
		 */
		for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
			expect(range, `${name} is declared by path`).not.toMatch(/^(link|file|workspace):/);
		}
	});
});

describe("the manifest is exported", () => {
	/**
	 * A tool that finds a package's root or version through its `package.json`, such as a check that
	 * two emitters resolve one copy of typespec-http-zod, resolves it by name. Asked of Node itself,
	 * through the package's own self-reference, so the `exports` map is the one a consumer's Node reads.
	 */
	it("resolves typespec-openapi-document/package.json by name, as Node reads the exports map", () => {
		const resolved = execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				'console.log(import.meta.resolve("typespec-openapi-document/package.json"))',
			],
			{ cwd: packageRoot, encoding: "utf8" },
		).trim();
		const found = JSON.parse(readFileSync(fileURLToPath(resolved), "utf8")) as { name: string };
		expect(found.name).toBe("typespec-openapi-document");
	});
});
