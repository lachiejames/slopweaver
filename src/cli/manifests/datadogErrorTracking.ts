/**
 * The Error Tracking verbs of the `datadog` noun — `errors`, the read half of the weekly fix batch
 * (`skills/automation/reference/error-tracking-batch.md`), and `triage`, the doored write half that moves
 * each triaged issue out of For Review. Held apart so `./datadog.ts` stays under its file-size ceiling.
 */
import { DATADOG_ERRORS_USAGE, DATADOG_TRIAGE_USAGE } from "../commands/datadog/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `datadog errors` and `datadog triage`, spread into `datadogManifest`. */
export const datadogErrorTrackingManifest: Readonly<Record<string, VerbManifestEntry>> = {
  errors: lazy({
    load: () => import("../commands/datadog/errorsRun.js").then((m) => m.datadogErrorsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // One read-only issue search through the SDK. Moving an issue's state is `triage`'s PUT, never this verb's.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example:
        "slopweaver datadog errors --query 'env:(prod OR production)' --from 1d --state for-review --order count",
      parseRejectIsIoFree: true,
      summary:
        "List Error Tracking issues over a window — most events or newest first, by state (For Review, Reviewed, " +
        "Ignored) — each with its service, first-seen age and version, plus how old each state's issues are",
      usage: DATADOG_ERRORS_USAGE,
    },
  }),
  triage: lazy({
    load: () => import("../commands/datadog/triageRun.js").then((m) => m.datadogTriageCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A PUT per issue through the SDK's `updateIssueState`, changing what the team's Error Tracking list says.
      // No approval digest: moving triaged issues is the batch's own job, and the same verb undoes a move —
      // which still changes monitor eligibility (Ignored mutes). `--dry-run` only reads.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver datadog triage --issue 6d6d6d6d-4444-4444-8444-444444444444 --state reviewed",
      parseRejectIsIoFree: true,
      summary:
        "Move Error Tracking issues to Reviewed, Ignored, Resolved or For Review — read each first, skip one " +
        "already there, move the rest through the door and read every one back, exiting non-zero unless all are",
      usage: DATADOG_TRIAGE_USAGE,
    },
  }),
};
