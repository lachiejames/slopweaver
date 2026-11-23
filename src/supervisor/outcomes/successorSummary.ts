/**
 * THE SUCCESSOR SUMMARY — the handover document a chair does not get to write.
 *
 * ## What it replaces
 *
 * A successor boots from a hand-written boot block (`skills/supervisor/reference/state-doc.md`). MEASURED over
 * eleven handoffs: the block is shift MECHANICS — what is in flight, the merge queue, where to
 * pick up — and what it does NOT carry is what the owner wants to be true. So each chair inherits a picture
 * of the fleet and none of the owner's direction, re-derives the direction from whatever it happens to read, and
 * drifts.
 *
 * So the outcomes half of the handover is DERIVED, exactly as the briefing's `yourList` is and for the same
 * reason: registering and deriving, rather than authoring, removes a point of failure. Nothing here is composable by a chair: `handover reconcile --json` carries
 * the owner's kept outcomes off the Workstreams register — their words and anchors — with their coverage and the whole ready
 * set, and this function turns that into markdown.
 *
 * ## Why the marker carries a hash
 *
 * `slopweaver supervisor state-archive` requires a summary and verifies it, so the archive step cannot be
 * taken with a hand-typed file pretending to be one. The first line is a marker carrying the sha256 of
 * everything below it; a chair that edits a sentence breaks the hash, and the archive refuses. That is the
 * same forcing `../tickSchema.ts` puts on a tick's stats — the numbers are computed, so a row cannot assert
 * its own.
 *
 * Pure: the outcomes, their coverage and the ready set in, markdown out. `./successorSummaryStore.ts` hashes
 * and writes.
 */

/** One outcome as the reconciliation reported it, the owner's words included. */
export interface SummaryOutcome {
  readonly id: string;
  readonly title: string;
  readonly words: string;
  readonly anchor: string;
  readonly liveSessions: readonly string[];
  readonly unspawned: readonly { readonly id: string; readonly label: string }[];
}

/** One ready row, as the successor will see it on the board. */
export interface SummaryRow {
  readonly rank: number;
  readonly id: string;
  readonly priority: string;
  readonly kind: string;
  readonly label: string;
}

/** How many characters of a row's label the ready list carries. */
const LABEL_CHARS = 160;

/**
 * How many ready rows the list carries before it says how many more there are.
 *
 * @internal — this module's own cap, named so its test can assert the cut rather than restate the number.
 */
export const SUMMARY_READY_ROWS = 200;

/** One label, cut to {@link LABEL_CHARS} with an ellipsis rather than silently truncated. */
function shortLabel({ label }: { label: string }): string {
  const flat = label.replace(/\s+/gu, " ").trim();
  return flat.length <= LABEL_CHARS ? flat : `${flat.slice(0, LABEL_CHARS - 1)}…`;
}

/** The outcomes section: the owner's words, their anchor, and who is on it. */
function outcomeSection({ outcomes }: { outcomes: readonly SummaryOutcome[] }): readonly string[] {
  const lines = [
    "## What the owner has said they expect",
    "",
    "Derived from the owner's Workstreams register, as this tick's own `slopweaver handover reconcile --json` read it.",
    "The owner's words are verbatim; the anchor is the earliest citation on the entry's timeline.",
    "",
  ];
  for (const outcome of outcomes) {
    lines.push(`### ${outcome.title}`, "");
    lines.push(`> ${outcome.words}`, "");
    lines.push(`Anchor: \`${outcome.anchor}\``, "");
    lines.push(
      outcome.liveSessions.length === 0 ? "**Nobody is on this.**" : `On it now: ${outcome.liveSessions.join(", ")}.`,
    );
    lines.push(
      outcome.unspawned.length === 0
        ? "No ready row under it is unspawned."
        : `${String(outcome.unspawned.length)} ready row(s) unspawned, highest first:`,
    );
    for (const row of outcome.unspawned.slice(0, 10)) {
      lines.push(`- \`${row.id}\` — ${shortLabel({ label: row.label })}`);
    }
    if (outcome.unspawned.length > 10) {
      lines.push(`- … and ${String(outcome.unspawned.length - 10)} more`);
    }
    lines.push("");
  }
  return lines;
}

/** The ready set: the whole runnable board, ranked. */
function readySection({ ready }: { ready: readonly SummaryRow[] }): readonly string[] {
  const lines = [
    "## Every row that can be picked up right now, ranked",
    "",
    `${String(ready.length)} ready row(s). This is the whole ready set, not the top five: a five-row window`,
    "over a board this size is what let a shift be aligned by every number it printed and off the owner's direction",
    "anyway.",
    "",
  ];
  for (const row of ready.slice(0, SUMMARY_READY_ROWS)) {
    lines.push(
      `${String(row.rank)}. [${row.priority} ${row.kind}] \`${row.id}\` — ${shortLabel({ label: row.label })}`,
    );
  }
  if (ready.length > SUMMARY_READY_ROWS) {
    lines.push(
      "",
      `… and ${String(ready.length - SUMMARY_READY_ROWS)} more; read them all with \`slopweaver handover reconcile --json\`.`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * Render the whole summary's BODY — everything below the marker line.
 *
 * @param outcomes every kept outcome with this tick's coverage; none when the owner has kept none
 * @param ready the whole ready set, ranked
 * @param headline the reconciliation's own generated sentence, carried verbatim
 * @param generatedIso when it was derived
 * @returns the markdown body
 */
export function renderSuccessorSummary({
  outcomes,
  ready,
  headline,
  generatedIso,
}: {
  outcomes: readonly SummaryOutcome[];
  ready: readonly SummaryRow[];
  headline: string;
  generatedIso: string;
}): string {
  return [
    `# Successor summary — derived ${generatedIso}`,
    "",
    "**This file is derived, never written.** `slopweaver supervisor successor-summary` produced it from one",
    "`handover reconcile --json`, whose outcomes are the ones the owner kept on the Workstreams register;",
    "`slopweaver supervisor state-archive` verifies its hash before it will archive a boot block.",
    "",
    `Fleet against the board: ${headline}`,
    "",
    coverageLine({ outcomes }),
    "",
    ...outcomeSection({ outcomes }),
    ...readySection({ ready }),
  ].join("\n");
}

/** The one sentence saying how the owner's kept outcomes stand: none kept yet, all attended, or which have nobody. */
function coverageLine({ outcomes }: { outcomes: readonly SummaryOutcome[] }): string {
  if (outcomes.length === 0) {
    return "The owner has kept no outcome on the Workstreams register yet, so there is nothing to hold the fleet to.";
  }
  const uncovered = outcomes.filter((outcome) => outcome.liveSessions.length === 0 && outcome.unspawned.length > 0);
  if (uncovered.length === 0) {
    return "Every one of the owner's kept outcomes has somebody on it.";
  }
  return `**${String(uncovered.length)} of the owner's kept outcomes have nobody on them: ${uncovered.map((outcome) => outcome.id).join(", ")}.**`;
}
