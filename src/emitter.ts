import {
	emitFile,
	getNamespaceFullName,
	listServices,
	NoTarget,
	resolvePath,
	type EmitContext,
	type Service,
} from "@typespec/compiler";
import { reportDiagnostic, type EmitterOptions } from "./lib.js";
import { documentTargetFor, fileTypesOf, type OpenApi3Options } from "./resolve.js";
import { renderModule } from "./render.js";
import { resolveVersioningModule, versionsOf } from "./versions.js";

/** The emitter name this package exports the document of. It is not ours and is never guessed at. */
const OPENAPI3 = "@typespec/openapi3";

/**
 * This emitter's entire job: work out where `@typespec/openapi3` wrote, and export it as a module.
 *
 * **It emits a MODULE, never a route.** A route would tie a framework-agnostic concern to one
 * framework's mounting API, and in the sibling server emitter it would break an invariant that
 * matters: `mounted + refused === declared`. A `/openapi.json` route the spec never declared makes
 * `mounted` exceed `declared`, and an exception to that arithmetic is where unreachable routes can
 * hide. Two lines in the consumer's own app is the better trade.
 *
 * **An emitter can see the whole compile, and that is what makes this a package rather than a
 * README section.** `program.compilerOptions.emit` says whether openapi3 ran at all, and
 * `program.compilerOptions.options` is keyed BY EMITTER NAME, so its `emitter-output-dir` and
 * `file-type` are readable here. Verified at runtime before anything was built on it.
 */
export async function $onEmit(context: EmitContext<EmitterOptions>): Promise<void> {
	const compilerOptions = context.program.compilerOptions;
	const emit = compilerOptions.emit ?? [];
	const override = context.options["document-path"];

	/**
	 * **Checked before anything else, because it is the common case and it is a CONFIGURATION
	 * mistake.** A consumer adds this emitter expecting a document and does not realise it emits
	 * nothing itself, it exports what openapi3 wrote. Saying so by name beats `Cannot find module`
	 * from a bundler an hour later.
	 */
	if (override === undefined && !emit.includes(OPENAPI3)) {
		reportDiagnostic(context.program, { code: "openapi3-not-emitted", target: NoTarget });
		return;
	}

	const openapi3Options = (compilerOptions.options?.[OPENAPI3] ?? {}) as OpenApi3Options;

	/**
	 * **YAML is openapi3's DEFAULT**, so this is the first wall most consumers meet. A TypeScript
	 * module can import JSON and cannot import YAML without a parser and a build plugin, and shipping a
	 * YAML parser into a Worker to read a document that could have been JSON is not a trade to make on
	 * somebody's behalf. Refused, with the one-line remedy stated.
	 */
	if (override === undefined) {
		const fileTypes = fileTypesOf(openapi3Options);
		const unusable = fileTypes.filter((type) => type !== "json");
		if (unusable.length > 0) {
			reportDiagnostic(context.program, {
				code: "unsupported-document-format",
				format: { fileType: unusable.join(", ") },
				target: NoTarget,
			});
			return;
		}
	}

	const services = listServices(context.program);
	const multipleServices = services.length > 1;
	/**
	 * **Resolved once, here, because the walk below is synchronous and this is not.** `undefined`
	 * when `@typespec/versioning` is not installed, which is the ordinary case.
	 */
	const versioning = await resolveVersioningModule();

	for (const service of services) {
		const name = getNamespaceFullName(service.type);
		/**
		 * **A versioned service gets one document PER VERSION**, so resolving as though it were
		 * unversioned emits an import to `openapi.json` when openapi3 wrote `openapi.v1.json` and
		 * `openapi.v2.json`. A broken import, from the package whose whole job is not emitting one.
		 * Measured before this existed.
		 */
		/**
		 * **Several OpenAPI versions is several documents, and this exports one module.**
		 *
		 * `documentTargetFor` used to resolve them by taking the first entry of the list, so which
		 * document was served was decided by list order - and adding a version to gain a second
		 * artefact silently changed which single artefact was served instead. Refused rather than
		 * guessed, and rather than inventing a second export name the spec never asked for.
		 */
		const specVersions = openapi3Options["openapi-versions"] ?? [];
		if (specVersions.length > 1) {
			reportDiagnostic(context.program, {
				code: "multiple-openapi-versions",
				format: { versions: specVersions.join(", ") },
				target: service.type,
			});
			continue;
		}
		const versions = versionsOf(versioning, context.program, service.type);
		const outputDir = openapi3Options["emitter-output-dir"] ?? defaultOpenApi3Dir(context);

		const targets =
			override !== undefined
				? [{ version: undefined, target: { path: override, fileType: "json" } }]
				: (versions.length === 0 ? [undefined] : versions).map((version) => ({
						version,
						target: documentTargetFor(openapi3Options, outputDir, {
							name,
							multipleServices,
							version,
						}),
					}));

		/**
		 * Narrowed by filtering rather than asserted: a non-null assertion here would be a claim the
		 * compiler cannot check, in the one place where being wrong emits a broken import.
		 */
		const resolvedTargets = targets.flatMap((entry) =>
			entry.target === undefined ? [] : [{ version: entry.version, ...entry.target }],
		);
		if (resolvedTargets.length !== targets.length) {
			reportDiagnostic(context.program, {
				code: "document-path-unresolved",
				format: { service: name },
				target: service.type,
			});
			continue;
		}

		/**
		 * **Where THIS service's module lands**, which is the emitter's own output directory unless the
		 * service names another.
		 *
		 * **`renderModule` is given the same directory, and that is the whole of the correctness
		 * here.** The emitted import is relative to where the module sits, so moving the file without
		 * moving the base emits a specifier resolved from a directory the file is no longer in - a
		 * broken import, from the package whose entire job is not emitting one. The arm that asserts
		 * each emitted module imports a document that EXISTS is what holds this.
		 */
		const serviceDir =
			context.options.services?.[name]?.["output-dir"] ??
			context.options.services?.[service.type.name]?.["output-dir"];
		/**
		 * **A relative path is resolved against the PROJECT ROOT, not against the emitter's output
		 * directory**, because that is what a consumer means by it and what `{project-root}` would have
		 * meant if it worked here.
		 *
		 * It does not work here: the compiler interpolates `{project-root}` and friends only in the
		 * path options it defines itself, so a nested custom option receives the string verbatim.
		 * Measured - `"{project-root}/alpha"` created a directory literally named `{project-root}`.
		 * Reimplementing that interpolation would be a second, quietly divergent copy of a compiler
		 * behaviour, so the resolution rule is stated instead, in `docs/reference.md`.
		 */
		const moduleDir =
			serviceDir === undefined
				? context.emitterOutputDir
				: resolvePath(context.program.projectRoot, serviceDir);

		await emitFile(context.program, {
			path: resolvePath(moduleDir, fileNameFor(service, multipleServices)),
			content: renderModule(resolvedTargets, moduleDir),
		});
	}
}

/** `document.gen.ts`, or one per service where the program declares several. */
function fileNameFor(service: Service, multipleServices: boolean): string {
	if (!multipleServices) return "document.gen.ts";
	const name = getNamespaceFullName(service.type).replace(/[^A-Za-z0-9]+/g, "-");
	return `document.${name}.gen.ts`;
}

/**
 * Where openapi3 writes when the consumer configured no `emitter-output-dir` for it.
 *
 * **The compiler's own default layout: `{output-dir}/{emitter-name}`.** Read from how the compiler
 * resolves `emitterOutputDir`, not from one observed path.
 */
function defaultOpenApi3Dir(context: EmitContext<EmitterOptions>): string {
	const root = context.program.compilerOptions.outputDir ?? "";
	return resolvePath(root, OPENAPI3);
}
