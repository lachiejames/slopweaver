/**
 * Lazy-load bridge for the verb registry.
 *
 * A `VerbManifestEntry` separates a verb's METADATA from its run function: the `meta` rides on the
 * registry entry (so enumeration — catalog, help — reads it with zero imports) while the run function
 * is fetched lazily, only when that exact verb is dispatched. This keeps process startup cheap even as
 * the command surface grows, and keeps a verb's heavy transitive deps out of every unrelated
 * invocation's load path. A noun maps its verbs to `VerbManifestEntry` values.
 *
 * Pure: no I/O, no console, no global state — just the type + the wrap. The `import()` inside a `lazy`
 * loader fires only when `load()` is awaited.
 */
import type { CommandMeta, CommandRun } from "./defineCommand.js";

/**
 * The registry key for a noun's DEFAULT verb — the handler that runs on a bare noun (`slopweaver doctor`)
 * or that owns a free-text tail (`slopweaver distil "…"`). It is the empty string (an alias distinct from any
 * real verb name), named here so the convention reads intentionally instead of as a bare `''` literal.
 */
export const DEFAULT_VERB = "";

/**
 * A verb described by its metadata alone, with its run function deferred behind `load()`. Enumeration
 * reads `meta` without importing the command module; dispatch awaits `load()` to fetch the run function
 * lazily, so only the invoked verb's module is ever imported.
 */
export interface VerbManifestEntry {
  /** Same metadata `defineCommand` carries, lifted onto the registry entry so enumeration is import-free. */
  readonly meta: CommandMeta;
  /** Deferred fetch of the verb's run function. The wrapped `import()` fires only when this is awaited. */
  readonly load: () => Promise<CommandRun>;
}

/**
 * Build a `VerbManifestEntry` from a verb's `meta` and a thunk that dynamically imports its run
 * function. Pass the `import(...).then(m => m.run)` thunk so the module is fetched only when `load()` is
 * awaited.
 *
 * @param meta the verb's command metadata (read import-free during enumeration)
 * @param load the deferred import of the verb's run function
 * @returns a frozen lazy manifest entry
 * @example
 *   lazy({ meta: doctorMeta, load: () => import('./commands/doctor/run.js').then((m) => m.doctorRunCommand) })
 */
export function lazy({ meta, load }: { meta: CommandMeta; load: () => Promise<CommandRun> }): VerbManifestEntry {
  return Object.freeze({ load, meta });
}

/**
 * A whole noun, self-describing: its name, its one-line `slopweaver <noun>` summary, and its verb map.
 * The `manifests/index.ts` barrel exports one of these per noun, spread from the family files beside it,
 * and `nounGroups.ts` folds the barrel into `NOUN_GROUPS` + `NOUN_SUMMARIES` GENERICALLY — so adding a noun
 * is "add the manifest file + one row in its family file", never an edit to a central import-and-assign
 * list. The barrel stays synchronous (a normal `import`), so `NOUN_GROUPS` keeps its synchronous shape.
 */
export interface NounManifestModule {
  /** The noun this module registers (e.g. `doctor`). Becomes a key in `NOUN_GROUPS`. */
  readonly noun: string;
  /** The `slopweaver <noun>` one-line summary, folded into `NOUN_SUMMARIES`. */
  readonly summary: string;
  /** The noun's verbs as lazy entries — spread under `noun` in `NOUN_GROUPS`. */
  readonly verbs: Readonly<Record<string, VerbManifestEntry>>;
}
