/**
 * Lazy manifest for the `value` noun — the weekly value sample: five asks that ended, picked at random, each with
 * its cost and its outcome, and the owner's one word per ask on whether the work got used.
 *
 * `sample` is `effect: "external-read"`: it reads GitHub for the state of each sampled ask's pull requests, and
 * every write is local — the week's sample under `$SLOPWEAVER_HOME/ledgers/value-samples/`, its page under
 * `pages/`, and ONE board row, the week's Queue card (`createsWorkItem`). `answer` writes the sample file and
 * withdraws that card once every ask is answered, so it is `local-state`. **No model** — AGENTS.md rule 2.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `value` noun's verbs as lazy manifest entries. */
export const valueManifest: Readonly<Record<string, VerbManifestEntry>> = {
  answer: lazy({
    load: () => import("../commands/value/answer.js").then((m) => m.valueAnswerCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // `--slug` and `--answer` are required, so a bare run refuses before it reads anything.
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver value answer --slug acme-export-row --answer used",
      parseRejectIsIoFree: true,
      summary:
        "Record the owner's one word for a sampled ask — used, not-used or not-yet — never replacing an earlier " +
        "answer, and withdraw the week's card once every ask carries one",
      usage:
        "usage: slopweaver value answer --slug <ask slug> --answer <used|not-used|not-yet> [--week <YYYY-Www>] " +
        "[--home <dir>]",
    },
  }),
  sample: lazy({
    load: () => import("../commands/value/sample.js").then((m) => m.valueSampleCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: false,
      // Every flag is optional: a bare run draws the week's sample, publishes its page and places its card.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver value sample",
      parseRejectIsIoFree: true,
      summary:
        "Draw this week's value sample — five asks that ended, at random, each with its cost and outcome — publish " +
        "its page and place ONE Queue card asking whether each was used; exits 3 when no ask ended",
      usage: "usage: slopweaver value sample [--projects-dir <dir>] [--home <dir>]",
    },
  }),
};
