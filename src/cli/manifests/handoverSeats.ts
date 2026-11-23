/**
 * The `handover` noun's SEAT verbs — `park`, which closes a seat waiting on the owner's question, a clock or CI and keeps
 * its worktree, branch and last screen on the row so `cmux spawn` can reseat it, and `wake`, which reseats the
 * clock and CI parks once due.
 *
 * Its own module for the reason `./handoverRulings.ts` is: `./handover.ts` sits at the file-size ratchet's
 * cap, and park is the one verb that acts on a live workspace rather than on the journal alone. That is a seam
 * a reader would draw anyway.
 *
 * It is NOT a second declaration: the entry is declared here and nowhere else, and `./handover.ts` spreads
 * this object into the one `handoverManifest` the barrel folds. The `usage` is a LITERAL, kept honest by the
 * help-truth ratchet.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { lifecycleMeta } from "./handoverLifecycleMeta.js";

/** `handover park`, the verb that closes a waiting seat for a later reseat. */
export const handoverSeatManifest: Readonly<Record<string, VerbManifestEntry>> = {
  park: lazy({
    load: () => import("../commands/handover/parkRun.js").then((m) => m.handoverParkCommand),
    meta: lifecycleMeta({
      example: "slopweaver handover park my-doc --wake-on-checks acme/acme-admin#<number>",
      summary:
        "Park a seat on its open Queue question, a clock or a pull request's CI and close its workspace in one act; the worktree, branch and last screen stay on the row for the reseat",
      usage:
        "usage: slopweaver handover park <slug> [--base <value>] [--dir <value>] [--home <value>] " +
        "[--read-owner-words <call anchor,...>] [--wake-at <value>] [--wake-on-checks <value>] [--workspace <value>]",
    }),
  }),
  wake: lazy({
    load: () => import("../commands/handover/wakeRun.js").then((m) => m.handoverWakeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare invocation reseats due seats, so it is not a dry parse; a refused flag still touches nothing.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver handover wake --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Reseat every parked seat whose clock or CI wake is due by a visible cmux spawn, longest-due first inside the boot window's share, after reconciling a park whose pull request ended — a merge of the run's own branch with nothing left on the park is finished and closed, every other one is named — and offering a merged pull request's park to handover finish; an unreadable provider never wakes one, a park re-parked on the condition its reseat acted on is held, --retry reseats one backoff-deferred park once the backoff opens, and --settle-only reconciles every ended park and reseats none",
      usage: "usage: slopweaver handover wake [--retry <nonce> | --settle-only] [--dry-run] [--home <dir>] [--json]",
    },
  }),
};
