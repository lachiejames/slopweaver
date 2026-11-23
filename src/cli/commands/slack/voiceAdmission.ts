/**
 * The voice half of admitting a bot card: the operator's voice rules over the prose a reader meets first.
 *
 * Split out of `./runAdmit.ts`, whose no-fold and update-card paths both judge a card this way and returned
 * the same three answers inline: a corrupt profile, a refusing verdict recorded to the door ledger, or
 * warnings and a pass.
 */
import { randomUUID } from "node:crypto";

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { recordPreDoorRefusal } from "../../../admit/ledger.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { type AboveFoldVerdict, aboveFoldRefusalRow, voiceWarningLines } from "../../aboveFoldDoor.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * Report the advisory half of a voice verdict, which this lane returns a `Result` rather than printing.
 *
 * MEASURED: both Slack admit paths read only `refusals`, so every below-fold voice warning on
 * the bot's own card lane went to nobody. `logger.warn` is the channel this file's siblings already use for
 * advisory output, and a warning must never change what the caller returns.
 *
 * @param verdict what the gate decided
 */
function warnVoice({ verdict }: { verdict: AboveFoldVerdict }): void {
  for (const warning of voiceWarningLines({ verdict })) {
    logger.warn({ msg: warning });
  }
}

/**
 * The voice half of admission, shared by the no-fold and update-card paths.
 *
 * A corrupt profile stops the send with its own message and no ledger row, because it is a fact about the
 * install rather than a rule that fired. A refusing verdict is recorded and stops it. Anything else warns
 * and passes.
 *
 * @param read the gate's verdict, or why the profile it needed cannot be trusted
 * @param home the state home whose store records a refusal
 * @param ledger the door ledger a live refusal is recorded through
 * @param dryRun whether this invocation stops before every effect
 * @returns the refusal lines, or `undefined` when the voice rules let the card through
 */
export async function voiceRefusalsOrWarned({
  read,
  home,
  ledger,
  dryRun,
}: {
  read: Result<AboveFoldVerdict, ProfileReadError>;
  home: string;
  ledger: DoorLedgerPort;
  dryRun: boolean;
}): Promise<readonly string[] | undefined> {
  if (read.isErr()) {
    return [read.error.message];
  }
  if (read.value.refusals.length > 0) {
    return recordedVoiceRefusal({ dryRun, home, ledger, verdict: read.value });
  }
  warnVoice({ verdict: read.value });
  return undefined;
}

/**
 * Record a refused body in the door ledger, then hand the refusals back as the `Result` failure.
 *
 * This lane returns rather than prints, so it cannot reach `printedAboveFoldRefusals` — the one seam that
 * records for every other surface. It is one of exactly two such sites (the other is
 * `./lifecycleRunGuards.ts`), and both are the bot's own card lane, which is where the gap the refusal row
 * closes was actually measured: a refused card left no row at all, so "did that card ever try to go out,
 * and what stopped it" cost a code read.
 *
 * A DRY RUN writes nothing. The voice gate runs here, before `./run.ts` reaches its `--dry-run` branch, so
 * without this the ledger would record a refusal for an invocation that never tried to send — and that file
 * states plainly that a dry run leaves no reservation, ledger entry or network call.
 *
 * @param verdict what the gate decided, with at least one refusal
 * @param home the state home whose store records the refusal
 * @param ledger the door ledger the refusal row is written through
 * @param dryRun whether this invocation stops before every effect
 * @returns the refusal lines, as the caller's failure
 */
async function recordedVoiceRefusal({
  verdict,
  home,
  ledger,
  dryRun,
}: {
  verdict: AboveFoldVerdict;
  home: string;
  ledger: DoorLedgerPort;
  dryRun: boolean;
}): Promise<readonly string[]> {
  if (dryRun) {
    return verdict.refusals;
  }
  const row = aboveFoldRefusalRow({
    runId: randomUUID(),
    tsIso: new Date().toISOString(),
    verdict,
  });
  if (row !== undefined) {
    await recordPreDoorRefusal({ home, ledger, refusal: row });
  }
  return verdict.refusals;
}

/**
 * Stop a Slack write whose voice rules could not be read, before its door is entered.
 *
 * A corrupt `profile.json` is a fact about the install, not a rule that fired, so it writes no door row and
 * names no override: read as "no rules", it once let every voice check pass silently.
 *
 * @param error why the profile the voice rules live in cannot be trusted
 * @param nothingHappened the verb's own sentence saying what it did not do
 * @returns the error exit code
 */
export function unreadableProfileExit({
  error,
  nothingHappened,
}: {
  error: ProfileReadError;
  nothingHappened: string;
}): number {
  logger.error({ msg: `refused: ${error.message}. ${nothingHappened}` });
  return EXIT_ERROR;
}
