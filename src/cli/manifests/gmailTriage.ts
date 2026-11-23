/**
 * The `gmail` verbs behind an inbox-triage card, split out of `./gmail.ts` when adding `card-mail` took that manifest
 * past its size ratchet — the same seam and the same reason as `./githubCi.ts`.
 *
 * They belong together rather than merely fitting together. `triage` reads the inbox grouped by sender and, on
 * `--pin`, reads the group's newest messages in full, stores them under `live/gmail/card-mail/` and then pins their
 * ids under the card's slug; `card-mail` prints that stored copy from this home alone — what the Queue draws inside
 * the card, never Gmail live.
 * `triage-rules` reads and replaces the install's own triage policy `triage` applies (sender rows, structural rules,
 * delegates and gated rules), which is the store's `gmail-triage-rules` row; the code ships none of it.
 *
 * All three are `local-state`, the contract `attachment` carries: each changes nothing in the mailbox and goes
 * through no door — `triage` writes its reading, a pin and the pinned mail under the home, `card-mail --fetch` a
 * replacement copy of that mail, and `triage-rules --set` the store's row.
 */
import { GMAIL_CARD_MAIL_USAGE } from "../commands/gmail/cardMailUsage.js";
import { GMAIL_TRIAGE_RULES_USAGE } from "../commands/gmail/triageRulesUsage.js";
import { GMAIL_TRIAGE_USAGE } from "../commands/gmail/triageUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const gmailTriageManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "card-mail": lazy({
    load: () => import("../commands/gmail/cardMailRun.js").then((m) => m.gmailCardMailCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads this home's stored copy and nothing else; only `--fetch` reaches Gmail, as a read, and replaces that
      // copy under the home.
      doorRouted: false,
      // Genuinely no-args-safe: with no slug, or a slug that is not an inbox-triage card's, it refuses on the pure
      // parser, having read nothing.
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver gmail card-mail inbox-triage-20261001-linear --json",
      parseRejectIsIoFree: true,
      summary: "Print the mail an inbox-triage card pinned, from the copy stored beside the pin — what the Queue draws",
      usage: GMAIL_CARD_MAIL_USAGE,
    },
  }),
  "triage-rules": lazy({
    load: () => import("../commands/gmail/triageRulesRun.js").then((m) => m.gmailTriageRulesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // The install's own policy lives in its store; nothing here reaches the mailbox or a provider door.
      doorRouted: false,
      // A bare `gmail triage-rules` is a valid list, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      // `--set` replaces the store's row — install state, the way `triage --write` persists its reading.
      effect: "local-state",
      example: "slopweaver gmail triage-rules --set ./rules.json",
      parseRejectIsIoFree: true,
      summary: "List this install's own gmail triage policy, or replace it whole, from the store",
      usage: GMAIL_TRIAGE_RULES_USAGE,
    },
  }),
  triage: lazy({
    load: () => import("../commands/gmail/triageRun.js").then((m) => m.gmailTriageCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `gmail triage` is a valid whole-inbox read, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      // `local-state`, not a read: `--write` persists the reading under the home, the way `attachment` does.
      effect: "local-state",
      example: "slopweaver gmail triage --key from:notifications@linear.app --pin inbox-triage-20261001-linear",
      parseRejectIsIoFree: true,
      summary: "Group the inbox by sender — how many, how old, automated or a person, and what way out it offers",
      usage: GMAIL_TRIAGE_USAGE,
    },
  }),
};
