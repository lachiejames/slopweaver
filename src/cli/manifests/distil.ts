/**
 * Lazy manifest for the `distil` noun.
 *
 * THREE verbs, and the split is the feature: under rule 2 (no spawned model, anywhere — `AGENTS.md`)
 * `distil` cannot call `claude` itself. `status` reads the batch plan (no write, no model — its own `meta`
 * object, `effect: "none"`, is what makes that TRUE rather than asserted). `brief` retrieves the NEXT
 * uncached batch and writes it as local state — no model, no door. `answer` grounds what the visible session
 * composed and updates the cache (and gold, once complete) — also no model. The bare noun is an ALIAS of
 * `brief`, not a fourth behaviour: `slopweaver distil` and `slopweaver distil brief` are the same command at
 * two different argv offsets, which is why they share one `meta` object rather than two that could drift.
 *
 * This mirrors `turn`'s `brief`/`answer` split (`src/cli/manifests/turn.ts`) deliberately — the thinking that used to happen in a forced-tool `claude`
 * call now happens in the visible session between the two verbs, and this is the third noun to say so the
 * same way rather than inventing a fourth protocol.
 *
 * A cold full corpus can be thousands of batches — one batch per handoff is
 * not ergonomic for that, and there is deliberately no automatic bulk mode. Say so in `--help` rather than
 * concealing it with a hidden loop.
 */
import { DISTIL_ANSWER_USAGE, DISTIL_BRIEF_USAGE, DISTIL_STATUS_USAGE } from "../commands/distil/usage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const distilBriefMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // No flag is required, so a bare `distil brief` reads the corpus for real — NOT dry-parse-safe. An
  // unknown/removed flag is still caught before any I/O, so the REJECT path is IO-free.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver distil brief --out ~/.slopweaver/briefs/distil-<hash>.json",
  parseRejectIsIoFree: true,
  summary: "Hand the NEXT uncached distil batch to the visible session — no model runs",
  usage: DISTIL_BRIEF_USAGE,
} as const;

const distilStatusMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // Same reasoning as `distilBriefMeta` — no required flag, so a bare invocation does real I/O.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver distil status",
  parseRejectIsIoFree: true,
  summary: "Report the distil batch plan — total/cached/remaining, read-only, zero model calls",
  usage: DISTIL_STATUS_USAGE,
} as const;

const distilAnswerMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // Unlike `brief`/`status`, `--brief`/`--answer` are REQUIRED — a bare `distil answer` refuses on the
  // missing flags before touching the corpus, so it IS dry-parse-safe (like `turn answer`).
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver distil answer --brief ~/.slopweaver/briefs/distil-<hash>.json --answer ./answer.json",
  parseRejectIsIoFree: true,
  summary: "Ground the digest the visible supervisor composed from a distil brief, and cache it — no model runs",
  usage: DISTIL_ANSWER_USAGE,
} as const;

const loadDistilBrief = () => import("../commands/distil/run.js").then((m) => m.distilRunCommand);
const loadDistilBriefVerb = () => import("../commands/distil/brief.js").then((m) => m.distilBriefCommand);
const loadDistilStatus = () => import("../commands/distil/status.js").then((m) => m.distilStatusCommand);
const loadDistilAnswer = () => import("../commands/distil/answer.js").then((m) => m.distilAnswerCommand);

export const distilManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadDistilBrief, meta: distilBriefMeta }),
  answer: lazy({ load: loadDistilAnswer, meta: distilAnswerMeta }),
  brief: lazy({ load: loadDistilBriefVerb, meta: distilBriefMeta }),
  status: lazy({ load: loadDistilStatus, meta: distilStatusMeta }),
};
