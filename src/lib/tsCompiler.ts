/**
 * The checker-backed half of TypeScript, for `named-object-params` alone: the AST (`typescript/ast`) and the Go
 * server's Program, Checker, Type and Symbol (`typescript/sync`) as one namespace — `import * as ts from
 * "#lib/tsCompiler.js"`. The `typescript-import-seam` gate lets only named-object-params and its checker-backed tests
 * import this file, so the whole-repo type pass stays the one the area rule allows.
 *
 * The two halves share two enum names, `ModifierFlags` and `ScriptKind`; the AST's is the one named here.
 */
export * from "typescript/ast";
/**
 * The AST's two enums whose names the server half also exports: two `export *` sharing a name export neither, so
 * naming them here is what makes `ts.ModifierFlags` and `ts.ScriptKind` resolve at all.
 *
 * @internal — a caller reaches them through the namespace, never by importing these names.
 */
export { ModifierFlags, ScriptKind } from "typescript/ast";
export * from "typescript/sync";
