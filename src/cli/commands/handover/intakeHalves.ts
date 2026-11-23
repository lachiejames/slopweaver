/**
 * Both intake halves — owner turns typed into the chair, and voice relays that never reached it — read against one
 * intake-mark ledger. `handover reconcile` reads them over the sweep's own window; `handover currency` reads them
 * from the oldest Queue card's floor, so a card can say whether anything the owner said since it was asked is unfiled.
 *
 * One read, two callers, so the two can never disagree about which of the owner's words a mark has cleared. The chain's
 * turns are walked ONCE: the voice half reads the same turns for a relay's delivery line
 * (`../../../talk/chairReceipt.ts`), so a relay graded `stranded` or `skipped` that the chair holds anyway is never
 * counted as one that never reached it.
 */

import type { JournalEvidence } from "../../../handover/assemble.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { lookupArchivedDoc } from "../../../handover/store.js";
import { readSupervisorChainEvents } from "../../../supervisor/chainStore.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import type { IntakeReport, OwnerTurn } from "../../../supervisor/intake.js";
import { readSupervisorChainIntake } from "../../../supervisor/intakeRead.js";
import { readIntakeMarks } from "../../../supervisor/intakeStore.js";
import { type CursorCoverage, chairReceiptOf } from "../../../talk/chairReceipt.js";
import { supervisorCursorCoverage } from "../../../talk/chairReceiptRead.js";
import type { ChairHasRelay, VoiceRelayIntake } from "../../../talk/relayIntake.js";
import { readVoiceRelayIntake } from "../../../talk/relayIntakeRead.js";

/**
 * Read both halves from one floor. A ledger present and unreadable makes BOTH unavailable: read as empty, it would
 * re-raise everything a mark had cleared while claiming to have read the marks.
 *
 * @param docs every board doc the scan resolved
 * @param journals each row's run journal, keyed by slug
 * @param sinceIso the earliest instant a turn or relay is read from
 * @returns the chair's turns and the undelivered relays, each read or unavailable with the reason
 */
export function readIntakeHalves({
  docs,
  handoverDir,
  home,
  journals,
  nowIso,
  sinceIso,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  home: string;
  journals: ReadonlyMap<string, JournalEvidence>;
  nowIso: string;
  sinceIso: string;
}): { intake: IntakeReport; voice: VoiceRelayIntake } {
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    const why = marks.error.message;
    return { intake: { kind: "unavailable", why }, voice: { kind: "unavailable", why } };
  }
  const intake = readSupervisorChainIntake({
    chain: readSupervisorChainEvents({ home }),
    claudeHome: claudeHomeDir(),
    docs,
    home,
    marks: marks.value,
    nowIso,
    sinceIso,
  });
  const archivedDoc = ({ slug }: { slug: string }): HandoverDoc | undefined => lookupArchivedDoc({ handoverDir, slug });
  const chairHas = chairHasFrom({ cursor: supervisorCursorCoverage({ home }), intake });
  return {
    intake,
    voice: readVoiceRelayIntake({ archivedDoc, chairHas, docs, home, journals, marks: marks.value, nowIso, sinceIso }),
  };
}

/**
 * Whether the chair holds a relay, off the turns the intake half already read and how far the supervisor cursor has
 * read. An intake that could not be read supplies no turns: it is reported unavailable on its own half, and here it
 * proves nothing.
 */
function chairHasFrom({ intake, cursor }: { intake: IntakeReport; cursor: CursorCoverage | undefined }): ChairHasRelay {
  let turns: readonly OwnerTurn[] = [];
  if (intake.kind === "read") {
    turns = intake.finding.turns.map(({ turn }) => turn);
  }
  return ({ record }) => chairReceiptOf({ cursor, turnId: record.turnId, turns }) !== undefined;
}
