/**
 * Lazy manifest for the `spend` noun — the company AI card's spend, from a page the owner pasted or a live read of it.
 *
 * ## Where card spend comes from
 *
 * `import` takes an export the owner copied out of their own Airwallex console. `capture` visits the card page in the owner's
 * own signed-in Chrome through the browser relay — navigate and observe, no click, no replay, no credential —
 * which is the read-only door chosen for it: never Airwallex's API, never a write.
 * `../commands/spend/capture.ts` carries why that is a read by construction.
 *
 * `forward` is the one verb here that writes outside the home: a draft in the owner's OWN Gmail, addressed to Airwallex's
 * receipts mailbox, which the owner sends themselves. Airwallex itself is still never written.
 *
 * Which merchant a charge belongs to, and where its receipts come from, is the install's own register in the store,
 * written by `merchants set` — never a list in the code.
 */
import {
  SPEND_CAPTURE_USAGE,
  SPEND_FORWARD_USAGE,
  SPEND_IMPORT_USAGE,
  SPEND_MERCHANTS_USAGE,
  SPEND_READ_USAGE,
  SPEND_TASKS_USAGE,
} from "../commands/spend/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `spend` noun's verbs as lazy manifest entries. */
export const spendManifest: Readonly<Record<string, VerbManifestEntry>> = {
  capture: lazy({
    load: () => import("../commands/spend/run.js").then((m) => m.spendCaptureCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver spend capture --url 'https://www.airwallex.com/app/cards/cardholder/<id>?cardAccountId=<id>' --discover",
      parseRejectIsIoFree: true,
      summary:
        "Visit the owner's Airwallex card page in their own signed-in Chrome, read-only: --discover reports what its " +
        "backend answered as shape, never a value; --store keeps the card's limits and transactions as a snapshot",
      usage: SPEND_CAPTURE_USAGE,
    },
  }),
  forward: lazy({
    load: () => import("../commands/spend/forwardRun.js").then((m) => m.spendForwardCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // It writes a draft into the owner's own mailbox, routed through the door as `gmail draft` is; it never sends.
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver spend forward --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "For each Airwallex task whose receipt is in the owner's mailbox, draft a forward of it to " +
        "receipts@expenses.airwallex.com in their own Drafts — PDF kept, subject unchanged, one draft per receipt. " +
        "Never sends: the owner presses Send",
      usage: SPEND_FORWARD_USAGE,
    },
  }),
  import: lazy({
    load: () => import("../commands/spend/run.js").then((m) => m.spendImportCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver spend import ~/card-page-export.md --as-of 2026-09-28",
      parseRejectIsIoFree: true,
      summary:
        "Store one pasted company-card page (Airwallex) as a snapshot under the home — its limits, merchant " +
        "control and every transaction row. Local only: it never reaches the card provider",
      usage: SPEND_IMPORT_USAGE,
    },
  }),
  merchants: lazy({
    load: () => import("../commands/spend/merchantsRun.js").then((m) => m.spendMerchantsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // `set` replaces the install's own register in its own store; `show` only reads it.
      effect: "local-state",
      example: "slopweaver spend merchants set --form merchants.json",
      parseRejectIsIoFree: true,
      summary:
        "Show or replace the install's card-merchant register — each merchant's slug, the merchant-string " +
        "prefixes that group a charge under it, and the domains its receipt mail comes from",
      usage: SPEND_MERCHANTS_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/spend/run.js").then((m) => m.spendReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver spend read --card 0042",
      parseRejectIsIoFree: true,
      summary:
        "What is left on the AI card this month, when it resets, what the page proves about the latest " +
        "declines, and what each merchant was charged — as fresh as the newest pasted export or live capture",
      usage: SPEND_READ_USAGE,
    },
  }),
  tasks: lazy({
    load: () => import("../commands/spend/tasksRun.js").then((m) => m.spendTasksCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A read of the owner's mailbox, like `gmail attachment`: nothing in the mailbox changes, so it takes no door.
      doorRouted: false,
      dryParseSafe: false,
      // It saves a matched receipt's PDFs under the home, as `gmail attachment` does.
      effect: "local-state",
      example: "slopweaver spend tasks",
      parseRejectIsIoFree: true,
      summary:
        "The newest Airwallex task reminder in the owner's inbox as one upload act per card expense, each beside the " +
        "invoice PDF pulled from the receipt mail naming its amount, or why there is none — mail only, never Airwallex",
      usage: SPEND_TASKS_USAGE,
    },
  }),
};
