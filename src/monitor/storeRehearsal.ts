/**
 * `store-rehearsal-failed` — the most recent restore rehearsal says the store backup would not restore.
 *
 * The monthly rehearsal raises a card ONLY when it fails. So a passed
 * record is `clear` and says nothing, and a failed one is ONE card naming the backup and the first reason.
 *
 * **A rehearsal that stopped RUNNING is not this monitor's.** The row is a standing row
 * (`src/live/automation/standingRows.ts`), so a row that vanished is printed by `automation due`, and one that stops
 * firing or keeps exiting non-zero is `recipe-stopped`'s card. Answering it here too would be two cards for one
 * condition. A record that is not there at all is `unmeasurable`, never `clear`: nothing has been proven yet.
 *
 * Pure: the record arrives already read.
 */
import type { RehearsalRecordRead } from "../store/backup/rehearsalRecord.js";

import type { MonitorReading } from "./types.js";

/**
 * Judge the most recent rehearsal record.
 *
 * @param record what a read of `rehearsal/last.json` found
 * @returns firing on a failed rehearsal, clear on a passed one, unmeasurable when there is no readable record
 */
export function evaluateStoreRehearsal({ record }: { record: RehearsalRecordRead }): MonitorReading {
  if (record === "absent") {
    return {
      because: "no restore rehearsal has run on this install yet — `slopweaver store rehearse` writes the first record",
      monitorId: "store-rehearsal-failed",
      state: "unmeasurable",
    };
  }
  if (record === "unreadable") {
    return {
      because: "the rehearsal record is not one this build can read, so whether the backup restores is unknown",
      monitorId: "store-rehearsal-failed",
      state: "unmeasurable",
    };
  }
  if (record.status === "passed") {
    return { monitorId: "store-rehearsal-failed", state: "clear" };
  }
  const [why = "no reason was recorded"] = record.failures;
  return {
    monitorId: "store-rehearsal-failed",
    state: "firing",
    subjects: [
      {
        id: "store-rehearsal",
        key: "failed",
        label: `${backupNamed({ prefix: record.prefix })} at ${record.atIso}: ${why}`,
      },
    ],
  };
}

/**
 * The backup a failed run names: its own prefix, or the newest one when the run stopped before choosing.
 *
 * @param prefix the chosen backup's prefix, `null` when none was chosen
 * @returns how the subject names it
 */
function backupNamed({ prefix }: { prefix: string | null }): string {
  if (prefix === null) {
    return "the newest backup";
  }
  return prefix;
}
