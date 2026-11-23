/**
 * The usage lines of `slopweaver distil answer`, `brief` and `status`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/distil.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

export const DISTIL_ANSWER_USAGE =
  "usage: slopweaver distil answer --brief <file> --answer <file> [--home <dir>] [--corpus <dir>]\n" +
  "  [--max-per-batch N] [--top-containers N] [--recent-only]\n" +
  "  Grounds the digest the visible session composed: reloads the brief, verifies the corpus still produces\n" +
  "  the SAME batch (contract, pinned records, content hash, rendered prompt), validates the answer shape,\n" +
  "  and only then updates the cache. Writes gold once every unique batch in the plan is cached.\n" +
  "  The plan flags must match the ones `distil brief` was run with, or `distil status`'s completeness count\n" +
  "  will not agree with what was actually briefed.\n" +
  "  --brief   the file `slopweaver distil brief` wrote.\n" +
  '  --answer  a JSON file: {"summary": "…", "points": [{"point": "…", "citations": ["…", …]}, …]}';

/** `slopweaver distil brief`'s usage line. */
export const DISTIL_BRIEF_USAGE =
  "usage: slopweaver distil brief [--home <dir>] [--corpus <dir>] [--max-per-batch N] [--top-containers N]\n" +
  "  [--recent-only] [--accept-prompt-change] [--out <file>]\n" +
  "  Writes the NEXT uncached batch as a brief for the supervisor session: the pinned record refs and the\n" +
  "  exact prompt. Prints the prompt, the required answer shape, and the `distil answer` command. Runs no\n" +
  "  model. `slopweaver distil` with no verb is this verb.\n" +
  "  --out                   where to write the brief JSON.\n" +
  "                          Defaults to $SLOPWEAVER_HOME/briefs/distil-<hash>.json\n" +
  "  --accept-prompt-change  authorise briefing under a changed distil contract, which invalidates every\n" +
  "                          previously cached digest (see `slopweaver distil status`).";

/** `slopweaver distil status`'s usage line. */
export const DISTIL_STATUS_USAGE =
  "usage: slopweaver distil status [--home <dir>] [--corpus <dir>] [--max-per-batch N] [--top-containers N] [--recent-only]\n" +
  "  Reports the batch plan — total/cached/remaining UNIQUE batches, and the next batch's source, container,\n" +
  "  record count, prompt chars and truncation. Read-only: no model call, no write.\n" +
  "  CLI model calls: zero, always — distil never spawns a model. The digest is composed by the visible\n" +
  "  supervisor session running `distil brief` / `distil answer`.\n" +
  "  A cold full corpus can be thousands of batches — one batch per handoff\n" +
  "  is not ergonomic for that, and there is deliberately no automatic bulk mode.";
