/**
 * Lazy manifest for the `fresh-cut` noun — one parentless commit over a `main` commit's tree, written into a NEW
 * local repository, and the verification that re-derives it and scans every file.
 *
 * Every verb is `local-state`: `produce` writes a new repository on this machine and a record under the state
 * home, `verify` a report beside that record, `accept` one line of the reviewed-residue list under the state home.
 * None creates, names or pushes to any remote; `produce`'s one
 * network call is the GitHub viewer READ that supplies the commit identity. There is no bare-noun default, so
 * `slopweaver fresh-cut` prints its verbs and runs nothing.
 *
 * Not `slice` or `subset`: those copy the CORPUS. This copies the repository's own tree, and sharing a word with
 * either would give one name two concepts (rule 11).
 */
import {
  FRESH_CUT_ACCEPT_USAGE,
  FRESH_CUT_PRODUCE_USAGE,
  FRESH_CUT_VERIFY_USAGE,
} from "../commands/freshCut/freshCutUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every verb: a required flag is missing on a bare run, so the parse refuses before any read. */
const LOCAL_META = {
  createsWorkItem: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `fresh-cut` noun's verbs as lazy manifest entries. */
export const freshCutManifest: Readonly<Record<string, VerbManifestEntry>> = {
  accept: lazy({
    load: () => import("../commands/freshCut/run.js").then((m) => m.freshCutAcceptCommand),
    meta: {
      ...LOCAL_META,
      diagnostic: false,
      example:
        "slopweaver fresh-cut accept --record 0b7e… --path src/a.test.ts --line 12 --class owner-address --as placeholder",
      summary:
        "Record that this visible session read one owner-address finding of a cut and judged it a placeholder or no address, " +
        "keyed by path, class and line hash; verify then counts it as reviewed, accepted",
      usage: FRESH_CUT_ACCEPT_USAGE,
    },
  }),
  produce: lazy({
    load: () => import("../commands/freshCut/run.js").then((m) => m.freshCutProduceCommand),
    meta: {
      ...LOCAL_META,
      diagnostic: false,
      example: "slopweaver fresh-cut produce --commit 7adba736 --out /private/tmp/cut",
      summary:
        "Write ONE parentless commit over a main commit's tracked tree into a new local repository, signed as the " +
        "GitHub token owner's no-reply address, and record source SHA, tree hash and root SHA in the state home",
      usage: FRESH_CUT_PRODUCE_USAGE,
    },
  }),
  verify: lazy({
    load: () => import("../commands/freshCut/run.js").then((m) => m.freshCutVerifyCommand),
    meta: {
      ...LOCAL_META,
      diagnostic: true,
      example: "slopweaver fresh-cut verify --record 0b7e…",
      summary:
        "Re-derive a recorded cut from its source SHA, refuse any tree difference, then scan every file with the " +
        "hygiene gate and every private term; findings go to the state home, never the terminal",
      usage: FRESH_CUT_VERIFY_USAGE,
    },
  }),
};
