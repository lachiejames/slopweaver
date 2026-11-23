/**
 * `atlas probe`'s usage line, in a leaf the manifest can reach without loading the command.
 *
 * The shape `commands/listen/listenUsage.ts` set and `.claude/rules/area-cli.md` names: a manifest is
 * loaded EAGERLY on every CLI invocation to enumerate the surface, so importing the usage out of
 * {@link ./probeCore} would pull drizzle and the store schema onto the load path of every unrelated verb.
 * This module imports nothing.
 */

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_PROBE_USAGE =
  "usage: slopweaver atlas probe [<keyword> ...] [--platform <name>] [--cells <n>] [--json]\n" +
  "  <keyword>    POSITIONAL, once per keyword; quote a phrase to keep it one keyword\n" +
  "               NO keyword is the SCOPE read: what each platform holds, and nothing about a question\n" +
  "  --platform   count only this atlas, instead of the whole estate\n" +
  "  --cells      how many (platform, kind) cells to keep per keyword (default 40)\n" +
  "  --json       the whole count matrix, for a wave planner to read\n" +
  "  reads the atlas tables in the store — no network call, no credential, no generation file opened\n" +
  "  a count is of STORED records and proves nothing about a provider: `atlas <platform> read` is what\n" +
  "  carries the claim boundary, and this verb only says which atlas is worth opening";
