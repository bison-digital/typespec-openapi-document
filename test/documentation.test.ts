import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { $lib } from "../src/lib.js";
import { EmitterOptionsSchema } from "../src/lib.js";

/**
 * **A user who hits a refusal should find it documented, not discover it.**
 *
 * **Documentation is asserted as a CLASS, the way every other rule here is.** A README listing the
 * diagnostics that existed when somebody last wrote it is a list that stops covering what the package
 * does, and the failure is silent. The reader concludes the emitter has no opinion about the thing
 * that just refused their spec.
 *
 * So a diagnostic or an option added later fails this suite until it is written down. That is the
 * whole mechanism: the cost of documenting is paid at the moment the capability is added, by the
 * person who knows why it exists.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
/**
 * The reference lives in `docs/`, so the README stays short enough to read. These arms follow it
 * there: what matters is that a capability is documented somewhere a reader is pointed to.
 */
const reference = readFileSync(join(packageRoot, "docs", "reference.md"), "utf8");

describe("the README documents everything this package can do to you", () => {
	it("has a README with the sections the arms below read", () => {
		// Non-vacuity: every arm below passes trivially against an empty file.
		expect(readme.length).toBeGreaterThanOrEqual(1000);
		expect(reference.length).toBeGreaterThanOrEqual(1000);
		expect(reference).toMatch(/^## What it refuses, and why$/m);
		expect(reference).toMatch(/^## Options$/m);
		// A reference nothing points at is the failure mode of moving it out of the README.
		for (const doc of ["docs/guides.md", "docs/reference.md"]) {
			expect(readme, `README does not link ${doc}`).toContain(`(${doc})`);
		}
	});

	it("names every diagnostic it can raise", () => {
		const codes = Object.keys($lib.diagnostics);
		expect(codes.length).toBeGreaterThanOrEqual(3);
		expect(codes.filter((code) => !reference.includes(`\`${code}\``)).toSorted()).toEqual([]);
	});

	it("names every option it accepts", () => {
		const options = Object.keys(EmitterOptionsSchema.properties ?? {});
		/**
		 * **One option, and the floor says one rather than six.** The sibling forwards a library's
		 * whole option set; this package accepts a single escape hatch. A floor copied from there would
		 * have been unsatisfiable, and lowering it to fit is only honest because the CLASS assertion
		 * below (every declared option appears in the README) is what actually guards this.
		 */
		expect(options.length).toBeGreaterThanOrEqual(1);
		expect(options.filter((option) => !reference.includes(`\`${option}\``)).toSorted()).toEqual([]);
	});

	it("documents every diagnostic that has a call site, and declares none that has not", () => {
		/**
		 * **A declared diagnostic with no call site is coverage that does not exist.** It reads as a
		 * capability (the package refuses this thing) while nothing can ever raise it. Asserting the
		 * class is what keeps one from appearing unnoticed.
		 */
		const sources = ["app.ts", "emitter.ts", "runtime.ts", "lib.ts"]
			.map((name) => {
				try {
					return readFileSync(join(packageRoot, "src", name), "utf8");
				} catch {
					return "";
				}
			})
			.join("\n");
		const unreachable = Object.keys($lib.diagnostics).filter(
			(code) => !sources.includes(`code: "${code}"`),
		);
		expect(unreachable.toSorted()).toEqual([]);
	});

	/**
	 * **The version being published must have a CHANGELOG entry.**
	 *
	 * Without this, work can sit unreleased with no entry at all, and nothing compares the changelog
	 * to the version beside it.
	 *
	 * Keyed on `package.json`'s own version rather than a literal, so the next bump fails this suite
	 * until it is written down.
	 */
	it("has a changelog entry for the version it is about to publish", () => {
		const changelog = readFileSync(join(packageRoot, "CHANGELOG.md"), "utf8");
		const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			version: string;
		};
		// Non-vacuity: a missing or empty changelog would otherwise pass the match below by accident.
		expect(changelog.length).toBeGreaterThanOrEqual(500);
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
		expect(changelog).toMatch(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m"));
	});

	/**
	 * **An `[Unreleased]` heading belongs at the top or not at all.** One sitting BELOW a released
	 * version describes neither the release above it nor anything pending - a reader scrolling for
	 * what is unreleased would find a section that stopped being true releases ago.
	 */
	it("keeps any Unreleased heading above every released version", () => {
		const changelog = readFileSync(join(packageRoot, "CHANGELOG.md"), "utf8");
		const unreleased = changelog.indexOf("## [Unreleased]");
		const firstRelease = changelog.search(/^## \[\d+\.\d+\.\d+\]/m);
		expect(firstRelease).toBeGreaterThan(-1);
		if (unreleased !== -1) expect(unreleased).toBeLessThan(firstRelease);
	});
});
