/**
 * The summary's own marker line: what a derived successor summary is SEALED with, and how a reader checks it.
 *
 * `slopweaver supervisor state-archive` will not archive a boot block without a summary whose marker matches
 * its body, which is what stops the derived half of a handover becoming another hand-written paragraph. The
 * hash is over the body exactly as the file carries it, so any edit at all — a re-worded sentence, a deleted
 * row, an outcome quietly dropped — breaks it, and the fix is to re-derive rather than to repair.
 *
 * Pure: text in, a marker or a verdict out.
 */
import { createHash } from "node:crypto";

/** The literal every marker line opens with. */
const MARKER_PREFIX = "<!-- slopweaver successor-summary sha256:";

/** The sha256 of one body, hex. */
function digestOf({ body }: { body: string }): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * The marker line for one body.
 *
 * @param body the summary's markdown, everything below the marker
 * @param outcomes how many outcomes it covers
 * @param ready how many ready rows it lists
 * @returns the marker line, without a trailing newline
 */
export function summaryMarker({ body, outcomes, ready }: { body: string; outcomes: number; ready: number }): string {
  return `${MARKER_PREFIX}${digestOf({ body })} outcomes:${String(outcomes)} ready:${String(ready)} -->`;
}

/**
 * The whole file: marker first, body below.
 *
 * @param body the summary's markdown
 * @param outcomes how many outcomes it covers
 * @param ready how many ready rows it lists
 * @returns the file's text, newline-terminated
 */
export function sealSummary({ body, outcomes, ready }: { body: string; outcomes: number; ready: number }): string {
  return `${summaryMarker({ body, outcomes, ready })}\n${body}\n`;
}

/** What checking a summary file found. */
export type SummaryCheck =
  | { readonly kind: "sealed"; readonly outcomes: number; readonly ready: number }
  | { readonly kind: "unsealed"; readonly why: string };

/** The one command that produces a summary, printed on every refusal so the fix is never a guess. */
export const DERIVE_SUMMARY_HINT =
  "Derive one: `slopweaver handover reconcile --json > r.json && slopweaver supervisor successor-summary " +
  "--reconcile r.json --out <path>`";

/**
 * The lines a caller refuses with when a summary is not one this repository derived.
 *
 * The wording lives here rather than at the call site because this module owns what "sealed" means: a
 * refusal composed beside the check cannot drift from the verdict it is reporting.
 *
 * @param path the file that was read
 * @param why the verdict's own reason
 * @returns the refusal's lines
 */
export function unsealedSummaryLines({ path, why }: { path: string; why: string }): readonly string[] {
  return [`${path} is not a derived successor summary: ${why}.`, DERIVE_SUMMARY_HINT];
}

/**
 * Check a summary file's marker against its own body.
 *
 * @param text the whole file
 * @returns what it is, or why it is not a derived summary
 */
export function checkSummary({ text }: { text: string }): SummaryCheck {
  const newline = text.indexOf("\n");
  if (newline === -1 || !text.startsWith(MARKER_PREFIX)) {
    return {
      kind: "unsealed",
      why: "its first line is not a `<!-- slopweaver successor-summary …` marker —it was not produced by `slopweaver supervisor successor-summary`",
    };
  }
  const marker = text.slice(0, newline);
  const body = text.slice(newline + 1).replace(/\n$/u, "");
  const parsed = /^<!-- slopweaver successor-summary sha256:([0-9a-f]{64}) outcomes:(\d+) ready:(\d+) -->$/u.exec(
    marker,
  );
  if (parsed === null) {
    return { kind: "unsealed", why: "its marker line is malformed — re-derive it rather than repairing it" };
  }
  if (body.trim().length === 0) {
    // A marker over an empty body seals correctly — sha256("") is a real digest — and says nothing at all
    // about the owner's direction, which is the one thing this file exists to carry. Refused as unsealed rather than
    // admitted as a technically valid seal.
    return { kind: "unsealed", why: "it carries a marker and no body — there is nothing under it to read" };
  }
  if (parsed[1] !== digestOf({ body })) {
    return {
      kind: "unsealed",
      why: "its body does not hash to the digest on its marker, so it has been edited since it was derived — re-derive it",
    };
  }
  return { kind: "sealed", outcomes: Number.parseInt(parsed[2]!, 10), ready: Number.parseInt(parsed[3]!, 10) };
}
