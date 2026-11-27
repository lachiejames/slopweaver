/**
 * The escape-hatch rows for the CODEX PASS surface — the duplicate-pass admission, the two refusals that keep
 * a Claude fallback plan or review from standing in for a Codex that is open, and the one that keeps a free
 * usage-limit reset for the cap it would clear.
 *
 * ## Why these are a file and not a section
 *
 * `./registry.ts` composes its register from one category file per surface, and this is one of them: when a
 * pairing pass may RUN. `ESCAPE_HATCHES` spreads this array in at its position, so there is exactly ONE
 * register, and `src/devLint/escapeHatch.ts` reads that array rather than any file's text.
 *
 * Add a row for a new Codex-pass refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the Codex pass surface, in register order. */
export const CODEX_PASS_HATCHES = [
  {
    caught:
      "this exact pass already has a conclusive record — a plan at the same branch/pass/HEAD, or a review of the same diff, property and pass — and running it again buys a second copy of an answer already on file (a measured share of all Codex input was exactly such a repeat)",
    command: "slopweaver codex plan / slopweaver codex review",
    exceptions: [
      "the PLANNING QUESTION changed while branch, pass and HEAD did not — the plan key deliberately excludes the task text, so this case reads as a duplicate and is not one",
      "the earlier artifact is known to be defective and the pass is being re-run to replace it",
      "a deliberate independent second opinion on the same question, wanted as a second opinion",
    ],
    id: "codex-duplicate-pass",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_DUPLICATE_CODEX_PASS" },
    lane: "ambient",
    reader: "src/codex/passAdmission.ts",
    standing: "proposed",
  },
  {
    caught:
      "the registered Codex fleet is not capped — a destination can take the pass, or none of those that cannot is " +
      "refusing or at the routing pause — and a Claude fallback review exists only for a " +
      "capped Codex or an install with no Codex plan registered, so Codex takes the pass; a " +
      "review refused on policy twice takes --after-refusal",
    command: "slopweaver codex review-fallback prepare",
    exceptions: [
      "the gauge is stale: a pass on this branch just failed FATAL on a spend cap Codex has not yet written to its own rollout log",
      "the account is known closed by a channel the gauge cannot read — a banner, an owner message — and waiting for the log would stall a landing",
    ],
    id: "fallback-review-uncapped",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_FALLBACK_REVIEW_UNCAPPED" },
    lane: "ambient",
    reader: "src/cli/commands/codex/fallbackCapRead.ts",
    standing: "proposed",
  },
  {
    caught:
      "the registered Codex fleet is not capped — a destination can take the pass, or none of those that cannot is " +
      "refusing or at the routing pause — and a Claude fallback plan exists only for a " +
      "capped Codex (owner ruling on gold-owed-677, option A) or an install with no Codex plan registered — while " +
      "Codex can take the plan, the pairing rule wants Codex to take it",
    command: "slopweaver codex plan-fallback prepare",
    exceptions: [
      "the gauge is stale: a planning pass on this branch just failed FATAL on a spend cap Codex has not yet written to its own rollout log",
      "the account is known closed by a channel the gauge cannot read — a banner, an owner message — and waiting for the log would start the work unplanned",
    ],
    id: "fallback-plan-uncapped",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_FALLBACK_PLAN_UNCAPPED" },
    lane: "ambient",
    reader: "src/cli/commands/codex/fallbackCapRead.ts",
    standing: "proposed",
  },
  {
    caught:
      "the branch's review fold could not be read, so this diff cannot be shown not to be a review pass past its " +
      "cap of two — a pass is one distinct diff reviewed to a CLEAN or BROKEN verdict, Codex and Claude fallback " +
      "alike; a diff KNOWN to be past the cap is a hold no hatch opens, and runs only when the pinned supervisor " +
      "named it with `codex extend --diff`",
    command: "slopweaver codex review / slopweaver codex review-fallback prepare",
    exceptions: [
      "a ledger source is unreadable and you have checked by hand that this branch has had fewer than two passes",
    ],
    id: "codex-review-pass-cap",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP" },
    lane: "ambient",
    reader: "src/cli/commands/codex/reviewCapGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the store's own live read finds no window at its limit, and a free usage-limit reset refills only full windows — " +
      "spent now it buys nothing and is gone for the cap it was held for",
    command: "slopweaver codex reset",
    exceptions: [
      "the live read is stale: a pass on this store just failed FATAL on a usage limit the app-server has not yet reported",
      "the reset expires before the store could plausibly reach a limit, so holding it loses it anyway",
    ],
    id: "early-codex-reset",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_EARLY_CODEX_RESET" },
    lane: "ambient",
    reader: "src/cli/commands/codex/resetOne.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
