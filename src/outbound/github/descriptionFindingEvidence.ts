/**
 * The witness a description review reads for a problem the fleet found itself.
 *
 * A body for a fleet finding says the problem was seen on a day, by an agent, and the reviewer refused both for
 * having no record in `evidence/`: the row that holds them reached only `stack push`'s own output. So a branch the
 * finding gate matches (`../../handover/findingGate.ts`, three exact matches, never a resemblance) gets one record
 * at the packet's base, before any `--evidence` file.
 *
 * The record carries FIXED fields only: the origin, the observer's public role, the registered day and how many
 * evidence records the row cites. No string the row's author wrote reaches it — a finding's evidence is
 * typically paths under the state home, and its `observedBy` a session id, both installation state — so there is
 * nothing in it a publication scan would have to judge, and a test pins its exact bytes.
 *
 * Pure: rows and journals in, a record out.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { HandoverDoc } from "../../handover/doc.js";
import { findingRowForBranch } from "../../handover/findingGate.js";
import type { RunEvent } from "../../handover/ledger.js";
import { utcMidnightOf } from "./days.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import type { PacketEvidence } from "./descriptionReviewPacket.js";

/** The file name the record is committed under, before the packet numbers it. */
const FLEET_FINDING_EVIDENCE_NAME = "fleet-finding.json";

/** The calendar day an ISO-8601 instant starts with. */
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})T/u;

/**
 * The fleet-finding record for the branch a description is written for, or none when no finding row claims it.
 *
 * @param docs every row on the board
 * @param journals each finding row's run-journal events, by slug, so a branch recorded at `handover start` matches
 * @param branch the pull request's head branch, exactly
 * @returns the record, `undefined` for a branch no finding claims, or a refusal for a matched row with no
 *   registered day or one that is not a real calendar day
 */
export function findingPacketEvidence({
  docs,
  journals,
  branch,
}: {
  docs: readonly HandoverDoc[];
  journals: ReadonlyMap<string, readonly RunEvent[]>;
  branch: string;
}): Result<PacketEvidence | undefined, DescriptionReviewError> {
  const row = findingRowForBranch({ branch, docs, journals });
  if (row === undefined) {
    return ok(undefined);
  }
  const day = row.askedIso === undefined ? undefined : ISO_DAY.exec(row.askedIso)?.[1];
  if (day === undefined) {
    return err(
      DescriptionReviewErrors.preparationFailed({
        detail:
          `finding row ${row.slug} carries no askedIso instant, so its fleet-finding record has no day to state; ` +
          "set askedIso: on the row to when it was registered",
      }),
    );
  }
  // `Date.parse` rolls a 31st of February into March, so the board's own instant check admits one; the badge rule
  // says an agent's seen day IS this day, and `problem-seen.on` refuses a day that does not exist.
  if (utcMidnightOf({ day }) === undefined) {
    return err(
      DescriptionReviewErrors.preparationFailed({
        detail:
          `finding row ${row.slug} carries askedIso ${row.askedIso}, whose day ${day} is not a real calendar day, ` +
          "so no seen day could ever match its fleet-finding record; set askedIso: on the row to when it was registered",
      }),
    );
  }
  const record = {
    evidenceRecords: row.evidence.length,
    observedBy: "agent",
    origin: "finding",
    registeredOn: day,
    schemaVersion: 1,
    what: "A visible agent session observed this problem and registered it on the board as a fleet finding.",
  };
  return ok({ contents: `${JSON.stringify(record, null, 2)}\n`, name: FLEET_FINDING_EVIDENCE_NAME });
}
