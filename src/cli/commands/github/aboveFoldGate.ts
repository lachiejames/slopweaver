/**
 * The above-the-fold gate on a pull-request description.
 *
 * Everything general lives in `../../aboveFoldDoor.ts`, which four surfaces share. What is specific to a
 * pull request is only WHICH regions a reviewer reads before expanding anything, and that is
 * `prAboveFoldCells`.
 */
import type { Result } from "#lib/result.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { prAboveFoldCells, prBelowFoldCells } from "../../../outbound/github/aboveFold.js";
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import type { PrBody } from "../../../outbound/github/types.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { type AboveFoldVerdict, aboveFoldVerdictFor, printedAboveFoldRefusals } from "../../aboveFoldDoor.js";

/**
 * Check one pull-request form's above-the-fold cells against the voice and packing rules.
 *
 * @param form the validated form or draft, after any edit has been merged into it
 * @param env the injected environment reader, so the override is a decision a test can make
 * @param home the state home the operator's private rules are loaded from
 * @returns the refusals to print and every finding the override may have admitted, or why a corrupt
 *   `profile.json` leaves the rules unknown
 */
export function aboveFoldVerdict({
  form,
  env,
  home,
}: {
  form: PrBody;
  env: (args: { name: string }) => string | undefined;
  home: string;
}): Result<AboveFoldVerdict, ProfileReadError> {
  return aboveFoldVerdictFor({
    surface: "github",
    belowFoldCells: prBelowFoldCells({ form }),
    cells: prAboveFoldCells({ form }),
    env,
    home,
  });
}

/**
 * {@link aboveFoldVerdict} for a verb that reports as it goes, so the caller only has to stop.
 *
 * A corrupt `profile.json` is printed as a refusal here and nothing else happens: it is a fact about the install,
 * not a rule that fired, so it writes no door row and names no override, because none lifts it. With
 * `refuseFindings`, a verdict that refuses is printed and recorded too; without it, as for a dry run or a verb
 * that previews before it refuses, the verdict is handed back for the caller to judge.
 *
 * @param out where each refusal line is printed
 * @param ledger the door ledger a refusal row is recorded through
 * @param refuseFindings whether a verdict carrying refusals stops the verb here
 * @returns the verdict to carry forward, or `undefined` once a refusal has been printed
 */
export async function aboveFoldVerdictOrReported({
  form,
  env,
  home,
  out,
  ledger,
  refuseFindings,
}: {
  form: PrBody;
  env: (args: { name: string }) => string | undefined;
  home: string;
  out: (args: { line: string }) => void;
  ledger: DoorLedgerPort;
  refuseFindings: boolean;
}): Promise<AboveFoldVerdict | undefined> {
  // A refusal quotes the cell it judged, so a line carrying a credential shape prints withheld.
  const withheldOut = ({ line }: { line: string }): void => {
    out({ line: withholdingCredentialLines({ lines: [line] }).join("") });
  };
  const verdict = aboveFoldVerdict({ env, form, home });
  if (verdict.isErr()) {
    withheldOut({ line: `refused: ${verdict.error.message}` });
    return undefined;
  }
  if (refuseFindings && (await printedAboveFoldRefusals({ home, ledger, out: withheldOut, verdict: verdict.value }))) {
    return undefined;
  }
  return verdict.value;
}
