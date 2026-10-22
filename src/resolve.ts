/**
 * Where `@typespec/openapi3` writes, worked out from its own rule rather than from one observed
 * filename.
 *
 * **Read from its source, `openapi.js`, and reproduced here as the rule it is:**
 *
 * ```js
 * const outputFile = resolvedOptions["output-file"] ??
 *   (fileTypes.length > 1
 *     ? `openapi.{service-name-if-multiple}.{version}.{file-type}`
 *     : `openapi.{service-name-if-multiple}.{version}.${fileTypes[0]}`);
 * const specDir = openapiVersions.length > 1 ? "{openapi-version}" : "";
 * outputFile: resolvePath(context.emitterOutputDir, specDir, outputFile)
 * ```
 *
 * So the path varies on four axes, and getting any of them wrong emits an import to a file that does
 * not exist: the **file type** (`yaml` by DEFAULT, not json), whether there are **multiple services**,
 * whether the service is **versioned**, and whether **several OpenAPI versions** were requested.
 *
 * **Reproducing another package's naming is a drift risk, and the answer to that is a test rather
 * than cleverness.** `test/resolution.test.ts` compiles across every combination of those axes and
 * asserts the path this computes is the file openapi3 actually wrote, comparing bytes, not paths. If
 * openapi3 changes its rule, that arm goes red naming the combination, which is the only honest way to
 * depend on somebody else's convention.
 */

/** openapi3's own option shape, as far as this package reads it. */
export interface OpenApi3Options {
	readonly "emitter-output-dir"?: string;
	readonly "output-file"?: string;
	readonly "file-type"?: string | readonly string[];
	readonly "openapi-versions"?: readonly string[];
}

export interface DocumentTarget {
	/** The absolute path openapi3 will write this service's document to. */
	readonly path: string;
	/** The file type it will be written as, `json` or `yaml`. */
	readonly fileType: string;
}

/**
 * `openapi.{service-name-if-multiple}.{version}.{file-type}` with the undefined segments dropped.
 *
 * **Dropping is what produces `openapi.yaml` rather than `openapi...yaml`**, and it is why a naive
 * `replace` of each placeholder is wrong. `interpolatePath` in the compiler removes a `.{x}` segment
 * whose value is undefined; this reproduces that, and the resolution test is what proves it agrees.
 */
function interpolate(
	template: string,
	values: Readonly<Record<string, string | undefined>>,
): string {
	return template.replace(/\.?\{([\w-]+)\}/g, (match, key: string) => {
		const value = values[key];
		if (value === undefined || value === "") return "";
		return match.startsWith(".") ? `.${value}` : value;
	});
}

/**
 * The file types openapi3 will write, in its own precedence order.
 *
 * `file-type` wins; otherwise the extension of an explicit `output-file`; otherwise `yaml`.
 */
export function fileTypesOf(options: OpenApi3Options): readonly string[] {
	const raw = options["file-type"];
	if (Array.isArray(raw)) return raw;
	if (typeof raw === "string") return [raw];
	const named = options["output-file"];
	if (named !== undefined) {
		const extension = /\.(\w+)$/.exec(named)?.[1];
		if (extension === "json" || extension === "yaml" || extension === "yml") return [extension];
	}
	// The default is YAML. A generated module cannot import that, see `unsupported-document-format`.
	return ["yaml"];
}

/**
 * Where openapi3 writes one service's document.
 *
 * `undefined` when the rule cannot reproduce it. An `output-file` naming something this does not
 * model. Reported as `document-path-unresolved` rather than guessed at.
 */
export function documentTargetFor(
	options: OpenApi3Options,
	outputDir: string,
	service: {
		/** The service's namespace name, used only when the program declares more than one. */
		readonly name: string;
		readonly multipleServices: boolean;
		/** The version this document is for, when the service is versioned. */
		readonly version: string | undefined;
	},
): DocumentTarget | undefined {
	const fileTypes = fileTypesOf(options);
	const fileType = fileTypes[0];
	if (fileType === undefined) return undefined;

	const template =
		options["output-file"] ??
		(fileTypes.length > 1
			? "openapi.{service-name-if-multiple}.{version}.{file-type}"
			: `openapi.{service-name-if-multiple}.{version}.${fileType}`);

	/**
	 * **No `{openapi-version}` directory, because more than one version is refused before this runs.**
	 * `@typespec/openapi3` nests per version only when several are named; this used to resolve that by
	 * taking the first entry, which made list order decide which document was served. See
	 * `multiple-openapi-versions` in `emitter.ts`.
	 */
	const specDir = undefined;

	const file = interpolate(template, {
		"openapi-version": specDir,
		"service-name-if-multiple": service.multipleServices ? service.name : undefined,
		"service-name": service.name,
		"file-type": fileType,
		version: service.version,
	});
	// An unresolved placeholder means the template used something this does not model.
	if (file.includes("{") || file === "") return undefined;

	return { path: [outputDir, specDir, file].filter((p) => p !== undefined).join("/"), fileType };
}
