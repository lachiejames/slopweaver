/**
 * The `judgement/standing-asks.jsonl` home-file read: the journal the standing-ask store imports once
 * (`../store/registerImport.ts`, register `standing-asks`), and whose bytes every later operation checks against
 * what that import recorded. The strict read itself — one `O_NOFOLLOW` open, no link followed, the witness hashed
 * off the very bytes the lines come from — is `../store/witnessedJournal.ts`, shared with the steer measurements.
 */
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import type { ImportSource } from "../store/registerImport.js";
import { readWitnessedJournal } from "../store/witnessedJournal.js";

import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";
import type { StandingAskHomeFile } from "./standingAskPort.js";
import { type ImportedStandingAskEvent, importedStandingAskEvents } from "./standingAskRecords.js";

/**
 * Read the home journal: absent, or its nonblank lines and the witness of the bytes they came from.
 *
 * @param path the journal
 * @returns what the path holds, or why it would not read
 */
export function readStandingAskJournal({ path }: { path: string }): Result<StandingAskHomeFile, StandingAskError> {
  const read = readWitnessedJournal({ path });
  if (read.isErr()) {
    return err(StandingAskErrors.homeFileUnreadable(read.error));
  }
  return ok(read.value);
}

/**
 * Read the home journal under a home.
 *
 * @param home the Slopweaver home it lived under
 * @returns what the path holds, or why it would not read
 */
export function readHomeFileStandingAsks({ home }: { home: string }): Result<StandingAskHomeFile, StandingAskError> {
  return readStandingAskJournal({ path: stateHomePaths({ home }).judgement.standingAsksJsonl });
}

/**
 * What the one-time import writes from one read of the journal: nothing for an absent one, every event with its
 * witness for a present one — or nothing at all when the journal does not fold. Pure.
 *
 * @param file the read
 * @returns the import source, or the first line that breaks the register
 */
export function standingAskImportSource({
  file,
}: {
  file: StandingAskHomeFile;
}): Result<ImportSource<ImportedStandingAskEvent>, StandingAskError> {
  if (file.state === "absent") {
    return ok({ state: "absent" });
  }
  return importedStandingAskEvents({ lines: file.lines }).map((records): ImportSource<ImportedStandingAskEvent> => ({
    records,
    state: "present",
    witness: file.witness,
  }));
}
