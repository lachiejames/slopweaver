/**
 * Rendering the pass ledger for a human. Pure.
 *
 * The job is one sentence: make a skipped pass impossible to miss.
 *
 * `NOT RUN` means "no record on this branch", which is NOT the same as "did not happen". A pass whose tree
 * capture failed is persisted without a branch and cannot be placed on one, so it lands in the
 * `UNATTRIBUTED` count instead. A review pass caught the skill doc claiming the stronger thing — "if it says
 * a pass never ran, it never ran" — which this renderer cannot honour and never could. Everything here is shaped by that. The
 * expected passes are listed even when they never ran, because a table of what DID happen cannot show an
 * absence — and an absence was the whole failure. `codex status` printing three rows was how a loop that
 * skipped its plan and all three reviews looked indistinguishable from a complete one.
 */

import { shortDigest } from "./fingerprint.js";
import type { LedgerEntry, PassFreshness } from "./ledger.js";
import { chaseLines, propertyChases } from "./propertyChase.js";
import type { CodexPassId } from "./types.js";
import type { UnplaceableRecord } from "./unplaceable.js";

/** Every pass the loop defines, in the order it is meant to run. Absence is reported against this list. */
export const LOOP_PASSES: readonly CodexPassId[] = ["p1", "p2", "p3", "r1", "r2", "r3"];

/** Column width for the freshness token, so verdicts line up under each other. */
const FRESHNESS_WIDTH = 8;

/**
 * One word for a freshness, for the aligned column.
 *
 * @param freshness the pass's freshness against the current tree
 * @returns the single word shown in the column
 */
function freshnessToken({ freshness }: { freshness: PassFreshness }): string {
  if (freshness.kind === "current") {
    return "CURRENT";
  } else if (freshness.kind === "stale") {
    return "STALE";
  } else {
    return "UNKNOWN";
  }
}

/**
 * Render the ledger for one branch as plain lines.
 *
 * @param branch the branch reported on
 * @param entries the passes found for it, newest first
 * @param unreadable how many finished passes could not be parsed
 * @param headSha the current HEAD, for the header line
 * @param withoutSidecar how many passes predate branch attribution
 * @param unattributed how many recorded passes captured no branch at all — surfaced because a `NOT RUN`
 *   row above may be wrong when this is non-zero
 * @param unplaceable the checkout's passes that recorded no tree, retired ones included — each NAMED, because
 *   the landing floor fails closed on every unretired one and `codex supersede` needs its artifact id
 * @returns the lines to print
 */
export function renderLedger({
  branch,
  entries,
  unreadable,
  withoutSidecar,
  unattributed,
  unplaceable,
  headSha,
}: {
  branch: string;
  entries: readonly LedgerEntry[];
  unreadable: number;
  withoutSidecar: number;
  unattributed: number;
  unplaceable: readonly UnplaceableRecord[];
  headSha: string | undefined;
}): readonly string[] {
  const head = headSha === undefined ? "unknown" : shortDigest({ value: headSha });
  const lines = [`Codex loop for ${branch} (HEAD ${head})`, ""];
  for (const pass of LOOP_PASSES) {
    lines.push(...passLines({ entries, pass }));
  }
  lines.push("", ...summaryLines({ entries, withoutSidecar, unattributed, unreadable }));
  lines.push(...unplaceableLines({ unplaceable }));
  // Last, so it is the line a reader deciding on another run is left looking at (./propertyChase.ts).
  lines.push(...chaseLines({ chases: propertyChases({ entries }) }));
  return lines;
}

/**
 * One line per pass in this checkout that recorded no tree, and what to do about each.
 *
 * A retired one keeps its line with its reason — the same visibility a retired wording gets above.
 */
function unplaceableLines({ unplaceable }: { unplaceable: readonly UnplaceableRecord[] }): readonly string[] {
  return unplaceable.flatMap((record) => {
    const row = `NO TREE: ${record.artifactId}  ${record.pass}  ${record.verdict}  ${record.createdAtIso}`;
    if (record.superseded === undefined) {
      return [
        `${row} — blocks --check and landing from this checkout; once a later ${record.mode} on this branch ` +
          `captured a tree: slopweaver codex supersede --artifact ${record.artifactId} --reason <text>`,
      ];
    }
    return [
      row,
      `        SUPERSEDED by ${record.superseded.replacedBy} on ${record.superseded.atIso}`,
      `        reason: ${record.superseded.reason}`,
    ];
  });
}

/** The rows for one pass id: every run of it, or a single NOT RUN line. */
function passLines({ entries, pass }: { entries: readonly LedgerEntry[]; pass: CodexPassId }): readonly string[] {
  const runs = entries.filter((entry) => entry.pass === pass);
  if (runs.length === 0) {
    return [`  ${pass}  ${"NOT RUN".padEnd(FRESHNESS_WIDTH)}  —`];
  }
  return runs.flatMap((entry) => {
    const property = entry.propertyId === undefined ? "" : `  ${entry.propertyId}`;
    // The provider is printed ONLY when it is not Codex. Every row was Codex until the fallback review
    // existed, so tagging each of those would be noise; tagging the exception is what a reader needs to see.
    const provider = entry.provider === "codex" ? "" : `  [${entry.provider}]`;
    // A current row carries a reason only when it was carried across a rebase on its diff (`./ledger.ts`'s
    // `freshnessOf`), and that is exactly when a reader needs to be told why a moved tree still counts.
    const reason = entry.freshness.reason;
    const why = reason === undefined ? "" : `  (${reason})`;
    const context = entry.outcomeContext === undefined ? "" : ` — ${entry.outcomeContext}`;
    const row = `  ${pass}  ${freshnessToken({ freshness: entry.freshness }).padEnd(FRESHNESS_WIDTH)}  ${entry.verdict}${property}${provider}${why}${context}`;
    if (entry.superseded === undefined) {
      return [row];
    }
    // The retired pass keeps its own row, verdict and all. Its retirement is an EXTRA line under it rather
    // than a replacement for it, because the whole reason this shape was chosen over "read only the latest
    // verdict" is that a reader must be able to see a wording was set aside, and by whom, forever.
    return [
      row,
      `        SUPERSEDED by ${entry.superseded.replacedBy} on ${entry.superseded.atIso}`,
      `        reason: ${entry.superseded.reason}`,
    ];
  });
}

/**
 * The closing summary.
 *
 * States what is MISSING first. A reader skimming a list of green rows does not notice the row that is not
 * there, so the absence is spelled out as a sentence rather than left to be inferred from the table.
 */
function summaryLines({
  entries,
  unreadable,
  withoutSidecar,
  unattributed,
}: {
  entries: readonly LedgerEntry[];
  unreadable: number;
  withoutSidecar: number;
  unattributed: number;
}): readonly string[] {
  const ran = new Set(entries.map((entry) => entry.pass));
  const missing = LOOP_PASSES.filter((pass) => !ran.has(pass));
  const stale = entries.filter((entry) => entry.freshness.kind === "stale").length;
  const retired = entries.filter((entry) => entry.superseded !== undefined).length;
  const unknown = entries.filter((entry) => entry.freshness.kind === "unknown").length;
  const lines = [
    missing.length === 0
      ? "every pass in the loop has run"
      : `NOT RUN: ${missing.join(", ")} — ${String(missing.length)} of ${String(LOOP_PASSES.length)} passes never ran on this branch`,
  ];
  if (stale > 0) {
    lines.push(
      `STALE: ${String(stale)} pass(es) describe a tree that has since changed — re-run before relying on them`,
    );
  }
  if (unknown > 0) {
    lines.push(`UNKNOWN: ${String(unknown)} pass(es) recorded no tree, so staleness is undecidable rather than fine`);
  }
  if (retired > 0) {
    lines.push(
      `SUPERSEDED: ${String(retired)} pass(es) had their property WORDING retired and count for nothing, ` +
        "in either direction — each names why, above",
    );
  }
  if (unattributed > 0) {
    lines.push(
      `UNATTRIBUTED: ${String(unattributed)} recorded pass(es) captured no branch, so a NOT RUN above may be wrong`,
    );
  }
  if (unreadable > 0) {
    lines.push(
      `CORRUPT: ${String(unreadable)} finished pass(es) have an unparseable record and are absent from this table`,
    );
  }
  if (withoutSidecar > 0) {
    lines.push(
      `(${String(withoutSidecar)} older pass(es) predate pass provenance and cannot be attributed to any branch)`,
    );
  }
  return lines;
}
