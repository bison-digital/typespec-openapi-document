/**
 * The package's entry point: what a consumer may use, and the emitter written against it.
 *
 * **No decorators, and no re-export of `@typespec/openapi3`.** A spec should not have to know this
 * emitter exists, and the document is openapi3's to produce. This package only says where it landed.
 */
export { $lib, EmitterOptionsSchema, type EmitterOptions } from "./lib.js";
export { $onEmit } from "./emitter.js";
export {
	documentTargetFor,
	fileTypesOf,
	type DocumentTarget,
	type OpenApi3Options,
} from "./resolve.js";
export { renderModule } from "./render.js";
