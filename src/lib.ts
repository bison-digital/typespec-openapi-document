import {
	type CallableMessage,
	createTypeSpecLibrary,
	type DiagnosticReport,
	type JSONSchemaType,
	paramMessage,
	type Program,
	type TypeSpecLibrary,
} from "@typespec/compiler";

/**
 * The library definition, kept in its own module so `tsp-index.ts` and the emitter can both reach it
 * without importing each other.
 */

export interface EmitterOptions {
	/**
	 * The path the generated module imports the document from, when this emitter cannot work it out.
	 *
	 * **An escape hatch, not the normal path.** Everything this package does is resolve that import
	 * for you; if you are setting this, something above has gone wrong and the diagnostic that fired
	 * says what. It exists so that an unusual layout is never blocked on a release of this package.
	 */
	"document-path"?: string;
	/**
	 * Per-service overrides, keyed on the service's namespace name.
	 *
	 * **The same seam, spelled the same way, as `typespec-hono` and `typespec-http-zod`.** A consumer
	 * configuring three emitters for one program should not have to learn three shapes for the same
	 * idea, and a service's output directory is the same idea in all three.
	 *
	 * Without it every service's module lands in one directory, so a program whose services are served
	 * by different workers has to import across a package boundary to reach its own document.
	 *
	 * A service the map does not name is unaffected: a partial map routes what it names and nothing
	 * else, because moving a file a consumer never asked to move is worse than not offering the option.
	 */
	services?: Record<string, { "output-dir"?: string }>;
}

const EmitterOptionsSchema: JSONSchemaType<EmitterOptions> = {
	type: "object",
	additionalProperties: false,
	properties: {
		"document-path": { type: "string", nullable: true },
		services: {
			type: "object",
			nullable: true,
			required: [],
			additionalProperties: {
				type: "object",
				additionalProperties: false,
				properties: { "output-dir": { type: "string", nullable: true } },
				required: [],
			},
		},
	},
	required: [],
};

/**
 * What this emitter refuses, and why each one exists.
 *
 * **These were designed before the happy path, deliberately.** The whole product is the failure it
 * prevents: a generated file importing a document that is not there. That is the same defect class as
 * a generated server importing a runtime module that exports nothing, which compiles clean and is
 * only caught by installing from a tarball. Emitting a broken import is the one outcome this package
 * must never have.
 */
const diagnostics = {
	/**
	 * `@typespec/openapi3` is not in `emit`, so there is no document to import.
	 *
	 * **This is the common case and it is a configuration mistake, not a spec one.** A consumer adds
	 * this emitter expecting a document and does not realise it emits nothing itself, it exports what
	 * openapi3 wrote. Reporting it by name costs nothing and is the difference between a clear message
	 * at compile time and `Cannot find module './openapi.json'` from a bundler much later.
	 *
	 * Readable because an emitter can see the whole compile: `program.compilerOptions.emit` carries the
	 * list, and `options` is keyed by emitter name. Verified at runtime rather than assumed.
	 */
	"openapi3-not-emitted": {
		severity: "warning",
		messages: {
			default:
				"'@typespec/openapi3' is not in this project's `emit` list, so there is no OpenAPI document to export. Add it to `emit` in tspconfig.yaml, or remove this emitter.",
		},
	},
	/**
	 * The document is not JSON, so a generated module cannot import it.
	 *
	 * **`yaml` is openapi3's DEFAULT, so this is the first thing most consumers will hit.** A
	 * TypeScript module can import JSON (`with { type: "json" }`) and cannot import YAML at all
	 * without a parser and a build plugin. Shipping a YAML parser into a Worker to read a document that
	 * could have been JSON is not a trade this package will make on a consumer's behalf.
	 *
	 * Refused rather than approximated: the remedy is one line of THEIR configuration, and it is stated.
	 */
	"unsupported-document-format": {
		severity: "warning",
		messages: {
			default: paramMessage`'@typespec/openapi3' is configured to write ${"fileType"}, which a generated module cannot import. Set 'file-type: json' in its options in tspconfig.yaml. A TypeScript module can import JSON directly, and cannot import YAML without a parser and a build plugin.`,
		},
	},
	/**
	 * openapi3 ran, but where it wrote cannot be worked out.
	 *
	 * **The honest failure, and it must exist.** This emitter derives the document's path from
	 * openapi3's own rule. `openapi.{service-name-if-multiple}.{version}.{file-type}` under
	 * `emitter-output-dir`, in a `{openapi-version}` subdirectory when several are requested. A
	 * consumer who sets `output-file` to something that rule cannot reproduce, or a future openapi3
	 * that changes it, lands here.
	 *
	 * **Reporting is the whole point.** The alternative is guessing a path, emitting an import to it,
	 * and letting the consumer find out from their bundler. `document-path` is the escape hatch this
	 * message names.
	 */
	/**
	 * Several OpenAPI versions requested, which is several documents, and this exports one module.
	 *
	 * **It used to take the FIRST entry of the list.** So which document was served was decided
	 * by list order, silently, and adding a version to gain a second artefact instead changed which
	 * single artefact was served. A warning like the rest here: an error stops `@typespec/openapi3`
	 * writing the very documents this exists to export.
	 */
	"multiple-openapi-versions": {
		severity: "warning",
		messages: {
			default: paramMessage`'openapi-versions' names ${"versions"}, which is one document per version, and this emitter exports a single module. It used to export whichever version was listed first, so the served document depended on list order. Name one version here, or run a second compile with its own 'openapi-versions' and 'emitter-output-dir' if you need both documents.`,
		},
	},
	"document-path-unresolved": {
		severity: "warning",
		messages: {
			default: paramMessage`The OpenAPI document's location could not be resolved for service '${"service"}'. Set 'document-path' in this emitter's options to point at it, or remove 'output-file' from '@typespec/openapi3' so its default naming applies.`,
		},
	},
} as const;

/**
 * **Spelled out rather than inferred, and every type imported through THIS package's own
 * specifier.** Both this package and its siblings declare `@typespec/compiler` as a peer, so a
 * side-by-side checkout resolves two physically distinct copies of the identical version. TypeScript
 * then has a choice of which to name in the emitted declarations and picks the wrong one, producing
 * `TS2883`, whose message is exactly the problem: *"this is likely not portable"*.
 *
 * A published `.d.ts` naming a `node_modules/.pnpm/...` path is broken for everyone who installed
 * differently, and a consumer never hits it, which is precisely why it is guarded here rather than
 * trusted.
 */
type Diagnostics = {
	"openapi3-not-emitted": { readonly default: string };
	"unsupported-document-format": { readonly default: CallableMessage<["fileType"]> };
	"multiple-openapi-versions": { readonly default: CallableMessage<["versions"]> };
	"document-path-unresolved": { readonly default: CallableMessage<["service"]> };
};

export const $lib: TypeSpecLibrary<Diagnostics, EmitterOptions> = createTypeSpecLibrary({
	name: "typespec-openapi-document",
	diagnostics,
	emitter: { options: EmitterOptionsSchema },
});

export const reportDiagnostic: <C extends keyof Diagnostics, M extends keyof Diagnostics[C]>(
	program: Program,
	diagnostic: DiagnosticReport<Diagnostics, C, M>,
) => void = $lib.reportDiagnostic;
export { EmitterOptionsSchema };
