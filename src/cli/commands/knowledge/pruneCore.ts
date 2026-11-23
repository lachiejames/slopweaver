/**
 * `knowledge prune`'s flag spec, parse and usage text. Pure: no I/O, no clock.
 *
 * Apart from `./core.ts` for the reason that file gives — the help-truth ratchet reads the flag list without
 * importing the command — and apart from it at all because the one delete verb is its own seam.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { flagNames } from "./flagSpecs.js";

const PRUNE_FLAGS: FlagSpec = {
  boolean: ["apply"],
  string: ["plan", "home"],
};

/** `--`-prefixed prune flags, for the help-truth ratchet. */
export const KNOWLEDGE_PRUNE_FLAG_NAMES: readonly string[] = flagNames({ spec: PRUNE_FLAGS });

/**
 * Parse `knowledge prune`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgePruneArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PRUNE_FLAGS });
}

/** What `knowledge prune --help` prints. */
export const PRUNE_USAGE =
  "usage: slopweaver knowledge prune --plan <path> [--apply] [--home <dir>]\n" +
  "\n" +
  "Apply a hygiene pass THEY approved: retire claims from the register and write their rewrites. The one\n" +
  "verb that removes a row — every other verb only appends. A dry run unless --apply.\n" +
  "\n" +
  "  --plan   one JSON object per line:\n" +
  '             {"op":"retire","id":"<claim id>","reason":"<why it leaves>"}\n' +
  '             {"op":"replace","replaces":"<claim id>","reason":"…","row":{kind,domain,claim,evidence,\n' +
  "              verdict,tier,surface,repro,question,outcome,caveat,learner,behaviourChange,retrievalCue,run}}\n" +
  "           One malformed line, one claim named twice, or a rewrite landing on a claim the plan retires\n" +
  "           refuses the whole plan.\n" +
  "  --apply  archive every retired claim's recordings and recalls under $SLOPWEAVER_HOME/knowledge/pruned/\n" +
  "           (export format, the plan beside it), then write and delete in ONE transaction.\n" +
  "\n" +
  "  A claim found wrong mid-task is regraded with `knowledge recalled`, because the correction is itself a\n" +
  "  lesson. Prune is for claims a pass THEY approved names for removal — canon carries it, its mechanism is\n" +
  "  gone, it is dated project state, or it folds into a keeper.";
