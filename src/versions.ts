import type { Program, Type } from "@typespec/compiler";

/**
 * The versions a service declares, **in the order it declared them**.
 *
 * **Declared order, never filename order, and this exact mistake has already been made once in
 * this set of packages.** `versioning/removed` declares `v1, v2preview, v2`, so the documents sort as
 * `openapi.v1.json`, `openapi.v2.json`, `openapi.v2preview.json`, and taking the last one by name
 * compares against a PREVIEW. The sibling library's differential did precisely that and it hid a real
 * defect. A version name sorts however its author spelled it; only the declaration says which is
 * current.
 *
 * **`@typespec/versioning` is behind a guarded `import()` and is an OPTIONAL peer**, the same
 * treatment `@typespec/openapi3` gives it. A spec that declares no versions must not need the package
 * installed, and a service is versioned for this emitter precisely when it is versioned for the
 * document it resolves against.
 */

interface VersionMap {
	readonly getVersions: () => readonly { readonly value: string }[];
}

interface VersioningModule {
	readonly getVersions: (
		program: Program,
		type: Type,
	) => readonly [unknown, VersionMap | undefined];
}

let resolved: VersioningModule | undefined | null = null;

/** Resolved once. `undefined` when the package is not installed, which is the ordinary case. */
export async function resolveVersioningModule(): Promise<VersioningModule | undefined> {
	if (resolved !== null) return resolved ?? undefined;
	try {
		resolved = (await import("@typespec/versioning")) as unknown as VersioningModule;
	} catch {
		resolved = undefined;
	}
	return resolved ?? undefined;
}

/**
 * Every version of a service, oldest first, or an empty list when it declares none.
 *
 * The LAST entry is the current one, which is what a document is normally wanted for.
 */
export function versionsOf(
	versioning: VersioningModule | undefined,
	program: Program,
	service: Type,
): readonly string[] {
	if (versioning === undefined) return [];
	const [, map] = versioning.getVersions(program, service);
	return map?.getVersions().map((version) => version.value) ?? [];
}
