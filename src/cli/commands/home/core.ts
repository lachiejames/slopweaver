/**
 * Flag specs and usage text for the `home` noun. Pure: no I/O, no clock — so the help-truth ratchet can
 * read a flag list without importing a command, the way `../sweep/core.ts` and `../autonomy/core.ts` do.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `home`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const RECLAIM_STRINGS = ["root", "home"] as const;
const RECLAIM_BOOLEANS = ["apply", "json"] as const;
const RECLAIM_FLAGS: FlagSpec = { boolean: RECLAIM_BOOLEANS, string: RECLAIM_STRINGS };

const LIST_STRINGS = ["home"] as const;
const LIST_BOOLEANS = ["json"] as const;
const LIST_FLAGS: FlagSpec = { boolean: LIST_BOOLEANS, string: LIST_STRINGS };

/** Every `--`-prefixed flag one verb accepts, sorted, for the help-truth ratchet. */
function flagNames({
  strings,
  booleans,
}: {
  strings: readonly string[];
  booleans: readonly string[];
}): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed `reclaim` flags, for the help-truth ratchet. */
export const HOME_RECLAIM_FLAG_NAMES: readonly string[] = flagNames({
  booleans: RECLAIM_BOOLEANS,
  strings: RECLAIM_STRINGS,
});

/** `--`-prefixed `reclaimed` flags, for the help-truth ratchet. */
export const HOME_RECLAIMED_FLAG_NAMES: readonly string[] = flagNames({
  booleans: LIST_BOOLEANS,
  strings: LIST_STRINGS,
});

/**
 * Parse `home reclaim`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHomeReclaimArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECLAIM_FLAGS });
}

/**
 * Parse `home reclaimed`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHomeReclaimedArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/** What `home reclaim --help` prints. */
export const RECLAIM_USAGE =
  "usage: slopweaver home reclaim [--root <name>] [--apply] [--home <dir>] [--json]\n" +
  "\n" +
  "Reclaims the obviously-junk bytes from the DECLARED scratch roots under $SLOPWEAVER_HOME, and reports\n" +
  "everything without --apply. The rule: delete what is obviously junk — node_modules, build\n" +
  "output — with NO RETENTION POLICY, and keep anything that could hold useful information not\n" +
  "re-derivable elsewhere. There is no age anywhere in this verb; the criterion is a fact about what a\n" +
  "directory IS.\n" +
  "\n" +
  "  codex-scratch       a FINISHED pass's whole `orchestration/<id>.scratch` workspace — the clones,\n" +
  "                      installs and builds it ran to check a claim. Finished means the sibling\n" +
  "                      `<id>/artifact.md` exists, which the pass writes last, so a running pass's\n" +
  "                      workspace is never taken. The pass's output is that record directory,\n" +
  "                      `<id>/` (record.json and artifact.md), and it is never touched\n" +
  "\n" +
  "It can reach nothing else in the home. The roots are an ALLOWLIST (src/home/reclaim/roots.ts) because\n" +
  "under a denylist a directory nobody has thought about yet defaults to deletable, and the first thing\n" +
  "that would take is exec-store/ — the content-addressed store every checkout privatised before it\n" +
  "moved to the cache root is still hardlinked to, which is large, rebuildable and the dedup mechanism\n" +
  "itself.\n" +
  "\n" +
  "There is NO duplicate-file class and supervisor-scratch is NOT a root. Both were here and both did\n" +
  "real damage: one run took handoff-9291/shell.txt and autonomy-qualified.jsonl out of the\n" +
  "LIVE supervisor chair as byte-identical copies, and the briefing publish refused to render four\n" +
  "minutes later. Under a scratch root the PATH is the state — a script opens a name, not bytes — so\n" +
  "identical content there is the ordinary case. roots.ts carries the whole finding.\n" +
  "\n" +
  "  --apply  actually delete. Every act is journalled, so a reclaim stays findable afterwards, and the\n" +
  "           run REFUSES to report success unless the witness holds: every path the walk KEPT, which is\n" +
  "           every file outside the pruned trees, still stats afterwards\n" +
  "  --root   only this declared root\n" +
  "  --json   one JSON object per root\n" +
  "\n" +
  "example: slopweaver home reclaim --root codex-scratch";

/** What `home reclaimed --help` prints. */
export const RECLAIMED_USAGE =
  "usage: slopweaver home reclaimed [--home <dir>] [--json]\n" +
  "\n" +
  "Read the reclaim journal back — what each run took, from which root, and whether the witness held. A\n" +
  "delete is not reversible, so the rail is that it stays FINDABLE.\n" +
  "\n" +
  "example: slopweaver home reclaimed";
