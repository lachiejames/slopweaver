/**
 * Lazy manifest for the `private-terms` noun — the owner's private words, kept hands-free, and the review a write
 * a meant term matched waits on.
 *
 * `effect: "local-state"`: every write lands under this home: a proposal, the terms file at 0600 on a confirm, a
 * review packet or a receipt. Nothing is sent anywhere. `add`, `narrow` and `remove` only PROPOSE, and the terms
 * file changes on `confirm` alone, after the read-back has gone back to the owner (`src/hygiene/privateTermsStore.ts`);
 * `retire` removes a waiting proposal without applying it.
 * `answer` keeps the owner's per-item yes or no from the Queue card beside its proposal (`src/hygiene/privateTermAnswers.ts`).
 * `review-record` is `diagnostic`: a BROKEN verdict exits 1, which is the verb reporting that the write stays held.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `private-terms` noun's verbs as lazy manifest entries. */
export const privateTermsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  add: lazy({
    load: () => import("../commands/privateTerms/edit.js").then((m) => m.privateTermsAddCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver private-terms add --class person --case insensitive --pattern-file /tmp/term.txt " +
        '--meaning "a colleague at acme" --allowed-where "the acme workspace" --source relay:<row> --misses acme',
      summary:
        "Propose one private term WITH the owner's meaning and where it is fine, probes counted; prints the " +
        "read-back and writes nothing until `confirm`",
      usage:
        "usage: slopweaver private-terms add [--allowed-where <value>] [--case <value>] [--class <value>] " +
        "[--home <value>] [--json] [--matches <value>] [--meaning <value>] [--misses <value>] [--pattern <value>] " +
        "[--pattern-file <value>] [--source <value>]",
    },
  }),
  answer: lazy({
    load: () => import("../commands/privateTerms/answer.js").then((m) => m.privateTermsAnswerCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver private-terms answer pp-0123456789ab --as yes --via console --by-session work-console",
      summary:
        "Record the owner's yes or no to one waiting proposal, pressed on the Queue card that shows the word; " +
        "writes the answer beside it, and `confirm` refuses one answered no",
      usage:
        "usage: slopweaver private-terms answer <proposal-id> [--as <value>] [--by-session <value>] " +
        "[--home <value>] [--json] [--via <value>]",
    },
  }),
  confirm: lazy({
    load: () => import("../commands/privateTerms/edit.js").then((m) => m.privateTermsConfirmCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver private-terms confirm pp-0123456789ab",
      summary:
        "Land one proposal the owner said yes to after its read-back: the terms file is rewritten whole at 0600, " +
        "refused if it changed since the proposal",
      usage: "usage: slopweaver private-terms confirm <proposal-id> [--home <value>] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/privateTerms/list.js").then((m) => m.privateTermsListCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver private-terms list",
      summary:
        "Every private term by id, class and case, whether it carries a meaning, and every proposal waiting " +
        "with the owner's answer, marked current or stale; never a pattern",
      usage: "usage: slopweaver private-terms list [--home <value>] [--json]",
    },
  }),
  narrow: lazy({
    load: () => import("../commands/privateTerms/edit.js").then((m) => m.privateTermsNarrowCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver private-terms narrow pt-0123456789ab --allowed-where "the acme workspace"',
      summary:
        "Propose a changed pattern, case, meaning or allowed place for one term; prints the read-back and writes " +
        "nothing until `confirm`",
      usage:
        "usage: slopweaver private-terms narrow <term-id> [--allowed-where <value>] [--case <value>] " +
        "[--home <value>] [--json] [--matches <value>] [--meaning <value>] [--misses <value>] [--pattern <value>] " +
        "[--pattern-file <value>]",
    },
  }),
  remove: lazy({
    load: () => import("../commands/privateTerms/edit.js").then((m) => m.privateTermsRemoveCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver private-terms remove pt-0123456789ab",
      summary: "Propose taking one term out; prints the read-back and writes nothing until `confirm`",
      usage: "usage: slopweaver private-terms remove <term-id> [--home <value>] [--json]",
    },
  }),
  retire: lazy({
    load: () => import("../commands/privateTerms/retire.js").then((m) => m.privateTermsRetireCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver private-terms retire pp-0123456789ab",
      summary:
        "Retire one waiting proposal without applying it, under the confirm lock; the terms file is never " +
        "written, and the line says whether it was stale",
      usage: "usage: slopweaver private-terms retire <proposal-id> [--home <value>] [--json]",
    },
  }),
  "review-prepare": lazy({
    load: () => import("../commands/privateTerms/review.js").then((m) => m.privateTermsReviewPrepareCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver private-terms review-prepare --hold ph-0123456789ab",
      summary:
        "Commit a held write into a review packet (meanings at the base, matched contexts at the head) and print " +
        "the one-property review a fresh reviewer runs",
      usage: "usage: slopweaver private-terms review-prepare [--hold <value>] [--home <value>] [--json]",
    },
  }),
  "review-record": lazy({
    load: () => import("../commands/privateTerms/review.js").then((m) => m.privateTermsReviewRecordCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      example: "slopweaver private-terms review-record --review <artifact-id>",
      summary:
        "Bind a Codex pass to its hold's packet and store one receipt: CLEAN releases that exact write once, " +
        "BROKEN keeps it held; a Claude fallback receipt is refused",
      usage: "usage: slopweaver private-terms review-record [--home <value>] [--json] [--review <value>]",
    },
  }),
};
