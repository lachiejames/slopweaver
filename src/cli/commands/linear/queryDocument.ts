/**
 * The `linear query` answer document and its two renderings — pure, so what a reader sees and what `--json`
 * emits are the same object shaped twice rather than two independently-drifting descriptions of one answer.
 *
 * The document says three things a local-only answer cannot, and every one of them is deliberate:
 * how far behind the corpus is (`newestLocalIso`), how many objects matched behind the page (`matched`),
 * and — per cited row — whether the live provider still agrees (`verification`). A page with no verification
 * block says so in words; it never renders as though the citations were checked.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { LinearQueryFilter, LinearQueryHit } from "../../../corpus/linear/query.js";
import type {
  LinearVerification,
  LinearVerifyDocument,
  LinearVerifyStatus,
} from "../../../live/linear/verifyDocument.js";

/** Why a page carries no verification — never rendered as though the citations were checked. */
export type LinearVerifySkipReason = "not-requested" | "no-token" | "no-hits";

/** One local-first Linear answer: the page, what it was drawn from, and what the live check said. */
export interface LinearQueryDocument {
  readonly source: "linear";
  readonly filter: LinearQueryFilter;
  readonly readAtIso: string;
  /** How many distinct objects matched, of which the page holds at most `limit`. */
  readonly matched: number;
  /** How many bronze rows the local scan read to find them. */
  readonly rowsScanned: number;
  /** The newest matching record's own instant — the corpus's own watermark for THIS answer. */
  readonly newestLocalIso: string | undefined;
  readonly hits: readonly LinearQueryHit[];
  /** Present only when the live leg ran. */
  readonly verification?: LinearVerifyDocument;
  /** Present only when it did not, saying why. */
  readonly verifySkipped?: LinearVerifySkipReason;
  /** Bronze files the scan could not open at all — an unknown shortfall, never silently zero. */
  readonly unreadable: readonly string[];
}

/** The verdict for one identifier, or undefined when nothing was verified. Pure. */
function verdictFor({
  document,
  identifier,
}: {
  document: LinearQueryDocument;
  identifier: string;
}): LinearVerification | undefined {
  return document.verification?.verifications.find((entry) => entry.identifier === identifier);
}

/** The one-word marker a verdict prints beside a row. Pure. */
function verdictMarker({ verdict }: { verdict: LinearVerification | undefined }): string {
  if (verdict === undefined) {
    return "unchecked";
  }
  return verdict.status;
}

/** The human sentence for why verification did not run; a document naming no reason was not asked to. Pure. */
function skipSentence({ reason }: { reason: LinearVerifySkipReason | null }): string {
  if (reason === "no-token") {
    return "citations UNVERIFIED — no Linear token configured; run `slopweaver connect linear` to check them live";
  }
  if (reason === "no-hits") {
    return "nothing to verify — the local scan matched no object";
  }
  return "citations UNVERIFIED — --no-verify was passed";
}

/** Every constrained facet, rendered as the query a reader could retype. Pure. */
function filterSummary({ filter }: { filter: LinearQueryFilter }): string {
  const parts: string[] = [`kind=${filter.kind}`];
  const push = ({ label, value }: { label: string; value: string | number | undefined }): void => {
    if (value !== undefined) {
      parts.push(`${label}=${String(value)}`);
    }
  };
  push({ label: "assignee", value: filter.assignee });
  push({ label: "state", value: filter.state });
  push({ label: "state-type", value: filter.stateType });
  push({ label: "team", value: filter.team });
  push({ label: "project", value: filter.project });
  push({ label: "cycle", value: filter.cycle });
  push({ label: "priority", value: filter.priority });
  push({ label: "labels", value: labelsFacet({ filter }) });
  push({ label: "updated-since", value: filter.updatedSinceIso });
  push({ label: "text", value: filter.text });
  return parts.join(" ");
}

/** The `labels=` facet as a reader would retype it, or nothing when the query constrained no label. Pure. */
function labelsFacet({ filter }: { filter: LinearQueryFilter }): string | undefined {
  const labels = unsetFieldAsNull({ key: "labels", record: filter });
  if (labels === null) {
    return undefined;
  }
  const joined = labels.join("+");
  if (joined.length === 0) {
    return undefined;
  }
  return joined;
}

/**
 * Render the answer as stable, pretty JSON.
 *
 * @param document the answer document
 * @returns one JSON document, with a trailing newline supplied by the logger rather than embedded here
 */
export function renderLinearQueryJson({ document }: { document: LinearQueryDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/**
 * The `state · owner · project` context line under one row.
 *
 * A project's `project` facet is its own name, which the row above already printed, so it is omitted rather
 * than echoed. Pure.
 */
function contextLine({ hit }: { hit: LinearQueryHit }): string {
  return [
    stateWord({ hit }),
    ownerWord({ hit }),
    projectWord({ hit }),
    hit.labels.length > 0 ? hit.labels.join(",") : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

/** A row's workflow state, or `(no state)` for one the corpus captured without one. Pure. */
function stateWord({ hit }: { hit: LinearQueryHit }): string {
  const { state } = hit;
  if (state === undefined) {
    return "(no state)";
  }
  return state;
}

/** A row's owner: an issue's assignee or a project's lead, or the words for having none. Pure. */
function ownerWord({ hit }: { hit: LinearQueryHit }): string {
  const { assignee } = hit;
  if (assignee !== undefined) {
    return assignee;
  }
  if (hit.kind === "issue") {
    return "(unassigned)";
  }
  return "(no lead)";
}

/** An issue's project, or `(no project)`; a project row prints none, since its title already names it. Pure. */
function projectWord({ hit }: { hit: LinearQueryHit }): string | undefined {
  if (hit.kind !== "issue") {
    return undefined;
  }
  const { project } = hit;
  if (project === undefined) {
    return "(no project)";
  }
  return project;
}

/** The corpus watermark for this answer, or `(none)` when nothing matched to carry one. Pure. */
function watermarkWord({ document }: { document: LinearQueryDocument }): string {
  const newest = document.newestLocalIso;
  if (newest === undefined) {
    return "(none)";
  }
  return newest;
}

/** The `field: local → live` lines a drifted citation prints. Pure. */
function driftLines({ verdict }: { verdict: LinearVerification | undefined }): readonly string[] {
  if (verdict === undefined) {
    return [];
  }
  const reason = verdict.reason === undefined ? [] : [`      unverified: ${verdict.reason}`];
  return [...verdict.drifts.map((drift) => `      ${drift.field}: ${drift.local} → ${drift.live}`), ...reason];
}

/** The one-line tally of what the live leg found. Pure. */
function verificationSummary({ verification }: { verification: LinearVerifyDocument }): string {
  const tally = ({ status }: { status: LinearVerifyStatus }): number =>
    verification.verifications.filter((entry) => entry.status === status).length;
  return (
    `verified ${String(verification.verifications.length)} citation(s) in ` +
    `${String(verification.requests)} request(s) at ${verification.verifiedAtIso} — ` +
    `${String(tally({ status: "confirmed" }))} confirmed, ${String(tally({ status: "changed" }))} changed, ` +
    `${String(tally({ status: "gone" }))} gone, ${String(tally({ status: "unverified" }))} unverified`
  );
}

/**
 * Render the answer as human-readable text, with "no match" and "not verified" both first-class outcomes.
 *
 * @param document the answer document
 * @returns the page, the corpus watermark behind it, and the live verdict on every row it cites
 */
export function renderLinearQueryText({ document }: { document: LinearQueryDocument }): string {
  const header = [
    `linear query: ${filterSummary({ filter: document.filter })}`,
    `local: ${String(document.matched)} match(es) over ${String(document.rowsScanned)} bronze row(s); ` +
      `newest local record ${watermarkWord({ document })}`,
  ];
  if (document.unreadable.length > 0) {
    header.push(`UNREADABLE (the match count is a floor, not a total): ${document.unreadable.join(", ")}`);
  }
  if (document.hits.length === 0) {
    return [...header, "no matching Linear object in the local corpus"].join("\n");
  }
  const rows = document.hits.flatMap((hit) => {
    const verdict = verdictFor({ document, identifier: hit.identifier });
    return [
      `  ${hit.identifier}  [${verdictMarker({ verdict })}]  ${hit.title}`,
      `      ${contextLine({ hit })}`,
      `      ${hit.url}`,
      ...driftLines({ verdict }),
    ];
  });
  const footer =
    document.verification === undefined
      ? skipSentence({ reason: unsetFieldAsNull({ key: "verifySkipped", record: document }) })
      : verificationSummary({ verification: document.verification });
  return [...header, "", ...rows, "", footer].join("\n");
}
