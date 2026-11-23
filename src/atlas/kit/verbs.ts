/**
 * The verb vocabulary of one atlas — the four every platform answers, and the shape a platform's own take.
 *
 * ## Why a platform's verbs are DATA on its registration rather than a module of dispatch code
 *
 * Before this file, each of 31 platforms carried a hand-wired `cli/commands/atlas/<p>Platform.ts`: its own
 * verb list, its own usage builder, and a `run<P>PlatformVerb` that was an if-chain over the verb name
 * loading `../<p>Atlas/<verb>Run.js` — 88 such branches, every one a copy of the one beside it with the
 * platform name swapped. The manifest then restated the same verb list a THIRD time in its `usage`.
 * MEASURED: 3 of 199 atlas module basenames were universal, 141 sat in
 * exactly one platform, and at the owner's stated direction of about a hundred atlases the 88 branches become
 * roughly 300. A dispatch that is the same for every platform is a table, not a function per platform.
 *
 * So a platform now declares its verbs as rows: the name, the line a usage block prints for it, the flag
 * tail the catalogue advertises, and a lazy `import()` of the command that runs it. One dispatcher
 * (`cli/commands/atlas/platformRun.ts`) reads the table; one manifest builder reads the same table; a new
 * atlas is its descriptor plus these rows, and nothing else changes.
 *
 * ## Why `load` is a thunk
 *
 * The same reason `registry.ts` holds `import()` thunks for descriptors: a verb's run module pulls in its
 * platform's whole model, transport and browser plumbing, and asking `atlas vanta --help` should load none
 * of them. The registration is strings and thunks only, cheap enough to import eagerly.
 */
import type { CommandRun } from "../../cli/defineCommand.js";

/**
 * The verbs EVERY registered platform answers, whatever it maps.
 *
 * All four are kit-level and know no platform's vocabulary — `registry.ts` and its read adapters own that.
 * Alphabetical, so a usage block built from them is stable.
 *
 * `reset` is kit-level too and is deliberately NOT here, because it is the one kit verb a platform may not
 * answer: three atlases reset through their own top-level noun. It is therefore CONDITIONAL on the row declaring `readReset`, and {@link atlasKitVerbsFor} is
 * the list to ask rather than this constant. Keeping the unconditional four separate is what lets this
 * sentence stay true.
 */
export const ATLAS_KIT_VERBS: readonly string[] = ["coverage", "read", "render", "restore"];

/**
 * The kit verbs one platform answers, which is the four above plus `reset` when it declares one.
 *
 * @param hasReset whether the platform's registration carries a `readReset`
 * @returns the kit verb names this platform answers, alphabetical
 */
export function atlasKitVerbsFor({ hasReset }: { hasReset: boolean }): readonly string[] {
  if (hasReset) {
    return [...ATLAS_KIT_VERBS, "reset"].toSorted();
  }
  return ATLAS_KIT_VERBS;
}

/**
 * One line per kit verb, as a platform's usage block prints it.
 *
 * A platform may REPLACE any of these through {@link AtlasCatalogueEntry.kitDescriptions}, and six do. That
 * is not a courtesy: a surface-map atlas reads operations rather than entities, and Gemini's coverage line
 * names who holds the entities instead — text a shared default would flatten into something false.
 * MEASURED while the shared helper was first written: a cut with no overrides destroyed nine such lines
 * across six platforms before a test caught one of them.
 */
const ATLAS_KIT_VERB_DESCRIPTIONS: Readonly<Record<string, string>> = {
  coverage: "what this atlas knows it does NOT know",
  read: "the stored entities, filtered by kind, surface, id or query",
  render: "one self-contained HTML page: everything held, and what exists that was never hit",
  reset: "archive the current generation and install an empty one in its place",
  restore: "list the generations `reset` archived, and install one back as the live generation",
};

/** One verb a platform answers that the kit does not supply. */
export interface AtlasOwnVerb {
  /** The word after the platform on the command line: `sync`, `walk`, `controls-evidence`. */
  readonly verb: string;
  /** What the verb does, as the platform's usage block prints it — one line, no leading verb name. */
  readonly describe: string;
  /**
   * The flag tail(s) the catalogue advertises for this verb, one entry per printed line, without the
   * leading two spaces: `"sync [--json] [--home <dir>]"`. Every flag the verb parses is named here, because
   * the platform row is the deepest manifest match a reader or a canon check resolves to.
   */
  readonly usage: readonly string[];
  /** The command that runs it, imported only when this verb is the one asked for. */
  readonly load: () => Promise<CommandRun>;
}

/**
 * What the catalogue says about one platform — the row's differences from the generic one.
 *
 * `effect` is not here because every platform row is `local-state`: a sync or a walk reads its provider and
 * writes only under `$SLOPWEAVER_HOME`, and `restore` moves generation directories there. A row that wrote
 * to a provider would not be an atlas.
 */
export interface AtlasCatalogueEntry {
  /**
   * One line for `catalog` and help: what this atlas holds and which verbs reach it.
   *
   * `null` is a statement, not an omission: this atlas answers only the kit's four verbs and the generic
   * kit summary describes it exactly, so the catalogue prints that one rather than a copy of it.
   */
  readonly summary: string | null;
  /** A copy-pasteable invocation. */
  readonly example: string;
  /**
   * Whether a verb under this row reaches a doored provider through `throughDoor`. True for the platforms
   * whose `sync` reads Linear, Clerk, Knock or Trelica under a read-only grant; false where the sync
   * compiles a published document or reads a provider the door does not govern.
   */
  readonly doorRouted: boolean;
  /** A platform's own wording for a kit verb, replacing {@link ATLAS_KIT_VERB_DESCRIPTIONS} for that verb. */
  readonly kitDescriptions?: Readonly<Partial<Record<string, string>>>;
}

/**
 * Every verb one platform answers, kit and its own together, in one sorted list.
 *
 * @param ownVerbs the platform's own verbs, from its registration
 * @param hasReset whether the platform's registration carries a `readReset`, which makes `reset` a verb it answers
 * @returns the verb names, sorted so a usage block is stable
 */
export function atlasPlatformVerbNames({
  ownVerbs,
  hasReset,
}: {
  ownVerbs: readonly AtlasOwnVerb[];
  hasReset: boolean;
}): readonly string[] {
  return [...atlasKitVerbsFor({ hasReset }), ...ownVerbs.map((own) => own.verb)].toSorted();
}

/**
 * The usage block one platform prints when its verb is missing or unknown.
 *
 * The description column is sized from the platform's own longest verb, so a platform whose longest verb is
 * `vulnerabilities` aligns without anyone maintaining a magic width beside it.
 *
 * @param platform the platform being addressed
 * @param ownVerbs the platform's own verbs, from its registration
 * @param hasReset whether the platform's registration carries a `readReset`, which makes `reset` a verb it answers
 * @param kitDescriptions the platform's own wording for any kit verb
 * @returns the usage block, ending without a trailing newline
 */
export function atlasPlatformUsage({
  platform,
  ownVerbs,
  hasReset,
  kitDescriptions = {},
}: {
  platform: string;
  ownVerbs: readonly AtlasOwnVerb[];
  hasReset: boolean;
  kitDescriptions?: Readonly<Partial<Record<string, string>>>;
}): string {
  const names = atlasPlatformVerbNames({ hasReset, ownVerbs });
  const pad = Math.max(...names.map((verb) => verb.length)) + 2;
  // A description may run to a second line; each continuation is indented under the first.
  const describe = ({ verb, text }: { verb: string; text: string }): string =>
    text
      .split("\n")
      .map((line, index) => (index === 0 ? `  ${verb.padEnd(pad)}${line}` : `  ${" ".repeat(pad)}${line}`))
      .join("\n");
  // An explicit branch rather than `??`: the house `no-silent-fallback` gate names every `??`, and a platform
  // replacing a kit line is a stated substitution, not a default.
  const kitLines = atlasKitVerbsFor({ hasReset }).map((verb) => {
    const override = kitDescriptions[verb];
    if (override !== undefined) {
      return describe({ text: override, verb });
    }
    return describe({ text: ATLAS_KIT_VERB_DESCRIPTIONS[verb]!, verb });
  });
  const ownLines = ownVerbs.map((own) => describe({ text: own.describe, verb: own.verb }));
  return [`usage: slopweaver atlas ${platform} <${names.join(" | ")}>`, ...kitLines, ...ownLines].join("\n");
}

/**
 * The one-line summary an atlas with only the kit's four verbs gets.
 *
 * The kit verbs it answers are named because the catalogue lists platforms, not the verbs beneath them.
 *
 * @param platform the platform this row addresses
 * @returns the summary
 */
export function atlasKitOnlySummary({ platform }: { platform: string }): string {
  return (
    `The ${platform} atlas: \`read\` its stored entities filtered by kind, surface, id or query, ` +
    "`coverage` for what it knows it does NOT know — surfaces, states, open gaps and declared " +
    "exclusions — `render` for one self-contained HTML page carrying everything it holds and what " +
    "exists that it never hit, or `restore` to list the generations `reset` archived and install one " +
    "back. Read from local state, no network call"
  );
}

/**
 * What one platform says about itself, whether or not it wrote the sentence.
 *
 * It lives in the kit rather than beside either reader because BOTH the manifest row
 * (`cli/manifests/atlasPlatformMeta.ts`) and the derived routing row (`route/atlasCapability.ts`) need the
 * same answer, and two copies of "what does an atlas with no summary say" is the drift this kit exists to
 * prevent. `null` is the registration's way of saying the generic kit summary describes it exactly, so an
 * explicit branch names that substitution rather than hiding it behind a `??`.
 *
 * @param platform the platform whose row this is
 * @param summary the catalogue entry's own summary, or `null` when it declares none
 * @returns the summary to print
 */
export function atlasCatalogueSummary({ platform, summary }: { platform: string; summary: string | null }): string {
  if (summary === null) {
    return atlasKitOnlySummary({ platform });
  }
  return summary;
}
