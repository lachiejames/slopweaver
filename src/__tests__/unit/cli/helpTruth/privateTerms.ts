/**
 * The help-truth tables' rows for `private-terms`: merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves. Every term here is synthetic.
 */

import { parsePrivateTermsAnswerArgs } from "../../../../cli/commands/privateTerms/answerArgs.js";
import {
  PRIVATE_TERMS_FLAG_NAMES,
  parsePrivateTermsAddArgs,
  parsePrivateTermsListArgs,
  parsePrivateTermsNarrowArgs,
  parsePrivateTermsReviewArgs,
  parsePrivateTermsTargetArgs,
} from "../../../../cli/commands/privateTerms/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** A complete `add`, every required flag named once, the pattern a synthetic word. */
const ADD_BASE = [
  "--class",
  "person",
  "--case",
  "insensitive",
  "--pattern",
  "quillfeather",
  "--meaning",
  "a colleague at acme",
  "--allowed-where",
  "nowhere",
  "--source",
  "relay:acme-row",
] as const;

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "private-terms add": PRIVATE_TERMS_FLAG_NAMES["add"]!,
  "private-terms answer": PRIVATE_TERMS_FLAG_NAMES["answer"]!,
  "private-terms confirm": PRIVATE_TERMS_FLAG_NAMES["confirm"]!,
  "private-terms list": PRIVATE_TERMS_FLAG_NAMES["list"]!,
  "private-terms narrow": PRIVATE_TERMS_FLAG_NAMES["narrow"]!,
  "private-terms remove": PRIVATE_TERMS_FLAG_NAMES["remove"]!,
  "private-terms retire": PRIVATE_TERMS_FLAG_NAMES["retire"]!,
  "private-terms review-prepare": PRIVATE_TERMS_FLAG_NAMES["review-prepare"]!,
  "private-terms review-record": PRIVATE_TERMS_FLAG_NAMES["review-record"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "private-terms add": {
    "--allowed-where": ["--allowed-where", "the acme workspace"],
    "--case": ["--case", "sensitive"],
    "--class": ["--class", "person"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--matches": ["--matches", "a quillfeather here"],
    "--meaning": ["--meaning", "a colleague at acme"],
    "--misses": ["--misses", "acme"],
    "--pattern": ["--pattern", "quillfeather"],
    "--pattern-file": ["--pattern-file", "/tmp/term.txt"],
    "--source": ["--source", "relay:acme-row"],
  },
  "private-terms answer": {
    "--as": ["--as", "no"],
    "--by-session": ["--by-session", "work-console"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--via": ["--via", "console"],
  },
  "private-terms confirm": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "private-terms list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "private-terms narrow": {
    "--allowed-where": ["--allowed-where", "the acme workspace"],
    "--case": ["--case", "sensitive"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--matches": ["--matches", "a quillfeather here"],
    "--meaning": ["--meaning", "a colleague at acme"],
    "--misses": ["--misses", "acme"],
    "--pattern": ["--pattern", "quillfeather"],
    "--pattern-file": ["--pattern-file", "/tmp/term.txt"],
  },
  "private-terms remove": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "private-terms retire": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "private-terms review-prepare": {
    "--hold": ["--hold", "ph-0123456789ab"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "private-terms review-record": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--review": ["--review", "r-0123"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // `add` requires its whole row, so a fragment probing one flag carries the rest or every probe reports the same
  // missing-flag error instead of the one it tests. `--pattern-file` is `--pattern`'s alternative, so its probe
  // drops the inline pattern rather than giving both.
  "private-terms add": ({ fragment }) =>
    parsePrivateTermsAddArgs({
      rest: dedupeFlags({
        base: fragment.includes("--pattern-file")
          ? ADD_BASE.filter((_, index) => index !== 4 && index !== 5)
          : [...ADD_BASE],
        fragment,
      }),
    }),
  "private-terms answer": ({ fragment }) =>
    parsePrivateTermsAnswerArgs({
      rest: [
        "pp-0123456789ab",
        ...dedupeFlags({
          base: ["--as", "yes", "--via", "console", "--by-session", "work-console"],
          fragment,
        }),
      ],
    }),
  "private-terms confirm": ({ fragment }) =>
    parsePrivateTermsTargetArgs({ rest: ["pp-0123456789ab", ...fragment], verb: "confirm" }),
  "private-terms list": ({ fragment }) => parsePrivateTermsListArgs({ rest: [...fragment] }),
  "private-terms narrow": ({ fragment }) => parsePrivateTermsNarrowArgs({ rest: ["pt-0123456789ab", ...fragment] }),
  "private-terms remove": ({ fragment }) =>
    parsePrivateTermsTargetArgs({ rest: ["pt-0123456789ab", ...fragment], verb: "remove" }),
  "private-terms retire": ({ fragment }) =>
    parsePrivateTermsTargetArgs({ rest: ["pp-0123456789ab", ...fragment], verb: "retire" }),
  "private-terms review-prepare": ({ fragment }) =>
    parsePrivateTermsReviewArgs({
      rest: dedupeFlags({ base: ["--hold", "ph-0123456789ab"], fragment }),
      verb: "review-prepare",
    }),
  "private-terms review-record": ({ fragment }) =>
    parsePrivateTermsReviewArgs({
      rest: dedupeFlags({ base: ["--review", "r-0123"], fragment }),
      verb: "review-record",
    }),
};

/** The rows for `private-terms`. */
export const privateTermsSlice: HelpTruthSlice = { guarded, probes, parsers };
