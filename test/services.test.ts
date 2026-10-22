import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileSource } from "./support/compile-fixture.js";

/**
 * **Per-service output routing, so a document module can land beside the worker that serves it.**
 *
 * A program declaring several services emits one module per service. Without this every one lands
 * in a single directory, so a service deployed on its own has to import across a package boundary to
 * reach its own document.
 *
 * `typespec-hono` and `typespec-http-zod` already take a `services` map keyed on the service name.
 * This is that same seam, spelled the same way, because a consumer configuring three emitters should
 * not have to learn three shapes.
 */

const TWO_SERVICES = `
import "@typespec/http";
using Http;
@service(#{ title: "Alpha" })
namespace Alpha { model A { id: string; } @route("/a") @get op a(): A; }
@service(#{ title: "Beta" })
namespace Beta { model B { id: string; } @route("/b") @get op b(): B; }
`;

describe("per-service output routing", () => {
	/**
	 * **Alpha is routed to a NESTED directory and Beta to a sibling one, deliberately.** Two
	 * destinations at the same depth as the emitter's own output directory make a wrong import base
	 * produce an identical relative specifier, so the arm below cannot tell a correct emission from one
	 * that moved the file and left the base behind. Measured: with both at the same depth, breaking the
	 * base left this test green.
	 */
	it("writes each service's module to the directory that service names", async () => {
		const compiled = await compileSource("per-service", TWO_SERVICES, {
			openapi3: { "file-type": "json" },
			emitter: {
				services: {
					Alpha: { "output-dir": "workers/alpha/src/generated" },
					Beta: { "output-dir": "beta-generated" },
				},
			},
		});

		// A relative service path resolves against the PROJECT ROOT, which for a fixture is its own
		// directory - the parent of the emitter's output dir.
		const root = join(compiled.outDir, "..");
		const alpha = join(root, "workers", "alpha", "src", "generated", "document.Alpha.gen.ts");
		const beta = join(root, "beta-generated", "document.Beta.gen.ts");

		expect(existsSync(alpha), `Alpha's module is not at ${alpha}`).toBe(true);
		expect(existsSync(beta), `Beta's module is not at ${beta}`).toBe(true);

		// Non-vacuity: each must import a document that EXISTS, which is this package's whole claim.
		for (const file of [alpha, beta]) {
			const specifier = /from "([^"]+\.json)"/.exec(readFileSync(file, "utf8"))?.[1];
			expect(specifier, `${file} imports no document`).toBeDefined();
			expect(existsSync(join(file, "..", specifier as string))).toBe(true);
		}
	});

	it("leaves a service the map does not name in the emitter's own output directory", async () => {
		/**
		 * A partial map must route what it names and nothing else. Routing every service the moment one
		 * is configured would move files a consumer never asked to move.
		 */
		const compiled = await compileSource("per-service-partial", TWO_SERVICES, {
			openapi3: { "file-type": "json" },
			emitter: { services: { Alpha: { "output-dir": "alpha-only" } } },
		});
		// A relative service path resolves against the PROJECT ROOT, which for a fixture is its own
		// directory - the parent of the emitter's output dir.
		const root = join(compiled.outDir, "..");
		expect(existsSync(join(root, "alpha-only", "document.Alpha.gen.ts"))).toBe(true);
		expect(existsSync(join(compiled.outDir, "document.Beta.gen.ts"))).toBe(true);
	});
});
