/**
 * Whether `github attach upload` may send a picture or a recording off this machine — the owner's recorded word,
 * read at run time, CLOSED until a ruling permits it. Called the attach-upload standing, never a door or a gate: the
 * admission Door (`../admit/`) and ruling gates (`./rulingGate.ts`) are other mechanisms, and an upload still crosses
 * the Door once this permits it.
 *
 * ## The failure this closes
 *
 * The owner's standing line on one install was that no screenshot goes through `github attach`. Nothing in the verb
 * read it, so two working seats uploaded proof pictures anyway: one after its compacted brief had lost the line, one
 * after a description reviewer named the terminal-shot route as the fix. Every check the verb ran was about the
 * PICTURE (its receipt, its pixel text, its crop); none asked whether a picture may leave at all.
 *
 * ## Why a ruling half, not a gate, and why closed by default
 *
 * A ruling gate (`./rulingGate.ts`) refuses a verb once recorded and lets it run when absent, and its projection fails
 * OPEN. Both point the wrong way here: the question is the owner's open call, and an unrecorded answer must not read as
 * yes. So the answer is a half of the `ruling` event, `attachUpload: { verdict }`, and EITHER answer is one
 * `handover rule … --attach-upload permitted|refused` away. Install-wide rather than per row: the latest LIVE ruling
 * carrying the half, on any row, by decision instant, decides. A later ruling of the other verdict reverses it, so no
 * release mechanism is needed.
 *
 * **It fails CLOSED.** No ruling is refused; a journal that names the half and holds a line this build cannot decode is
 * a gap, and any gap is refused, because the line it could not read may be the owner's newer `refused`. A
 * reconstruction (`backfilledFrom`) never counts, on either verdict.
 *
 * Pure: journals in, a standing out. The walk is `./attachUploadRulingStore.ts`.
 */
import type { AttachUploadRuling } from "./attachUploadRulingTypes.js";
import type { RulingEvent, RunEvent } from "./ledger.js";
import { rulingDecisionOrder } from "./ruling.js";

/** A live ruling carrying the attach-upload half, and the row it sits on. */
export interface AttachUploadRulingOnRow {
  readonly slug: string;
  readonly ruling: RulingEvent & { readonly attachUpload: AttachUploadRuling };
}

/** Whether attach upload is permitted, and why. */
export type AttachUploadStanding =
  | { readonly kind: "permitted"; readonly by: AttachUploadRulingOnRow }
  | { readonly kind: "refused"; readonly because: "unruled" }
  | { readonly kind: "refused"; readonly because: "ruled"; readonly by: AttachUploadRulingOnRow }
  | { readonly kind: "refused"; readonly because: "unreadable"; readonly gaps: readonly string[] };

/** One row's decoded journal. */
export interface RowJournal {
  readonly slug: string;
  readonly events: readonly RunEvent[];
}

/** Whether an event is a live ruling carrying the half. */
function isAttachUploadRuling(event: RunEvent): event is AttachUploadRulingOnRow["ruling"] {
  return event.kind === "ruling" && event.attachUpload !== undefined && event.backfilledFrom === undefined;
}

/** Whether `event` places at or after the current latest: decision instant first, then the instant it was recorded. */
function placesAtOrAfter({
  event,
  latest,
}: {
  event: AttachUploadRulingOnRow["ruling"];
  latest: AttachUploadRulingOnRow["ruling"];
}): boolean {
  const decided = rulingDecisionOrder({ event });
  const latestDecided = rulingDecisionOrder({ event: latest });
  if (decided !== latestDecided) {
    return decided > latestDecided;
  }
  return Date.parse(event.atIso) >= Date.parse(latest.atIso);
}

/**
 * The latest live attach-upload ruling across every journal: by decision instant, then by the instant it was
 * recorded. Two rulings equal on both go to the later in walk order — within one journal that is the later line;
 * across journals there is no global append order, so it is the later journal name, a deterministic tie-break and
 * nothing more.
 *
 * @param journals every row's decoded journal, sorted by journal name
 * @returns the deciding ruling, or `undefined` when the owner never ruled on attach upload
 */
export function latestAttachUploadRuling({
  journals,
}: {
  journals: readonly RowJournal[];
}): AttachUploadRulingOnRow | undefined {
  let latest: AttachUploadRulingOnRow | undefined;
  for (const journal of journals) {
    for (const event of journal.events) {
      if (!isAttachUploadRuling(event)) {
        continue;
      }
      if (latest === undefined || placesAtOrAfter({ event, latest: latest.ruling })) {
        latest = { ruling: event, slug: journal.slug };
      }
    }
  }
  return latest;
}

/**
 * The attach-upload standing over what a walk read.
 *
 * @param journals every row's decoded journal that names the half, in walk order
 * @param gaps every such journal the walk could not read whole; any one refuses
 * @returns the standing
 */
export function attachUploadStanding({
  journals,
  gaps,
}: {
  journals: readonly RowJournal[];
  gaps: readonly string[];
}): AttachUploadStanding {
  if (gaps.length > 0) {
    return { because: "unreadable", gaps, kind: "refused" };
  }
  const by = latestAttachUploadRuling({ journals });
  if (by === undefined) {
    return { because: "unruled", kind: "refused" };
  }
  if (by.ruling.attachUpload.verdict === "permitted") {
    return { by, kind: "permitted" };
  }
  return { because: "ruled", by, kind: "refused" };
}

/** The one command that releases a refused upload, printed whole so a reader never assembles it. */
const PERMIT_COMMAND =
  'slopweaver handover rule <slug> --anchor <where the owner said it> --words "<the owner\'s words>" ' +
  "--attach-upload permitted";

/**
 * The lines a refused upload prints, naming the rule, the ruling that decided it when one did, and the one way past.
 *
 * @param standing a refused standing
 * @returns the lines, first one carrying the verdict
 */
export function attachUploadRefusalLines({
  standing,
}: {
  standing: Exclude<AttachUploadStanding, { kind: "permitted" }>;
}): readonly string[] {
  const lines = [
    "refused: attach-upload: `slopweaver github attach upload` sends no picture or recording off this machine",
    "  until the owner's recorded ruling permits it; nothing was read, scanned or sent.",
  ];
  if (standing.because === "unruled") {
    lines.push("  no ruling on this install decides it, and an unrecorded answer is not a yes.");
  } else if (standing.because === "ruled") {
    lines.push(`  the owner ruled it refused on ${standing.by.slug}: ${standing.by.ruling.ruling}`);
    lines.push(`    where: ${standing.by.ruling.anchor}`);
  } else {
    lines.push("  a journal naming the attach-upload ruling would not read whole, so the latest word is unknown:");
    for (const gap of standing.gaps) {
      lines.push(`    ${gap}`);
    }
  }
  lines.push(
    "  The picture stays local: a description says so in its proof, and that is an honest reading.",
    "  There is no escape hatch and no environment override. The owner's ruling, recorded on the board, is the only",
    `  way past: ${PERMIT_COMMAND}`,
  );
  return lines;
}

/**
 * The one line a dry run prints about the attach-upload standing.
 *
 * @param standing what the walk over every run journal decided
 * @returns the line, naming the deciding row and its anchor when a ruling decided it
 */
export function attachUploadStandingLine({ standing }: { standing: AttachUploadStanding }): string {
  if (standing.kind === "permitted") {
    return `attach upload is permitted by the owner's ruling on ${standing.by.slug} (${standing.by.ruling.anchor})`;
  }
  if (standing.because === "ruled") {
    return `attach upload is refused by the owner's ruling on ${standing.by.slug} (${standing.by.ruling.anchor})`;
  }
  if (standing.because === "unreadable") {
    return "attach upload is refused: a journal naming its ruling would not read whole";
  }
  return "attach upload is refused: no ruling on this install permits it";
}
