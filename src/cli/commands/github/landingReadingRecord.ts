/**
 * `github landing --record-reading <by>` — the one step that appends the reported document to the readings
 * ledger, kept beside the run rather than inside it so `landingRun.ts` stays under the file-size ratchet.
 */
import { safeJsonStringify } from "#lib/safeJson.js";

import { askedRowsOf } from "../../../review/reviewerRegister.js";

import type { GithubLandingArgs } from "./landingCore.js";
import type { LandingDocument } from "./landingReport.js";
import type { GithubLandingDeps } from "./landingRun.js";

/**
 * Append the reported document to the readings ledger when `--record-reading` named who took it, and every
 * ask it carries to the reviewer register.
 *
 * The bytes are the ones `--json` prints, serialised once here so the ledger and the terminal can never
 * disagree. The instant is the run's own clock, read ONCE: the document carries no `observedAtIso` of its
 * own, and the reading and the asks it certified are one observation, so both writes carry the same instant.
 * A refusal is a diagnostic and never changes the exit code — the read HAPPENED and was reported, and a
 * ledger that would not take it is a fact about the ledger. The two writes are independent for the same
 * reason: an ask this read certified is true whether or not the readings ledger took the document.
 *
 * @param args the parsed invocation, whose `recordReadingBy` decides whether anything is written
 * @param deps the two ledger seams, the clock and the diagnostic channel
 * @param document the document the run just reported
 */
export function recordReadingOf({
  args,
  deps,
  document,
}: {
  args: Pick<GithubLandingArgs, "home" | "recordReadingBy">;
  deps: Pick<GithubLandingDeps, "appendReviewerAsks" | "now" | "recordReading" | "writeDiagnostic">;
  document: LandingDocument;
}): void {
  if (args.recordReadingBy === undefined) {
    return;
  }
  const nowIso = deps.now().toISOString();
  const recorded = deps.recordReading({
    by: args.recordReadingBy,
    document: safeJsonStringify({ label: "github landing document", value: document }),
    home: args.home,
    observedAtIso: nowIso,
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`landing: the reading was not recorded — ${recorded.error}`);
  } else {
    deps.writeDiagnostic(`landing: reading recorded as ${args.recordReadingBy} (${recorded.value})`);
  }
  const asks = deps.appendReviewerAsks({
    home: args.home,
    nowIso,
    rows: askedRowsOf({ people: document.people, recordedAtIso: nowIso, rows: document.rows }),
  });
  if (asks.isErr()) {
    deps.writeDiagnostic(`landing: the reviewer register did not take this read's asks — ${asks.error}`);
    return;
  }
  deps.writeDiagnostic(`landing: reviewer register took ${String(asks.value)} new ask(s)`);
}
