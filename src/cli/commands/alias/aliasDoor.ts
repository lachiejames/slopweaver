/**
 * What an alias write says to the door, and how a write the door did not perform ends: the request both
 * `alias provision` and `alias catch-all` hand `throughDoor`, and the exit code each picks when nothing was
 * performed. Both are pure; `run.ts` is the shell that routes each write through the door.
 */

import type { NotPerformed } from "../../../admit/doorRefusal.js";
import type { DoorRequest } from "../../../admit/types.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";

/**
 * The exit code a not-performed write ends on: a policy refusal is expected-empty, a store that cannot record is an error.
 *
 * @returns `EXIT_ERROR` when the store refused to record the decision, else `EXIT_EXPECTED_EMPTY`
 */
export function notPerformedExit({ through }: { through: NotPerformed }): number {
  return through.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * The door request one alias write makes.
 *
 * `artifact.destination` is the ZONE rather than the mailbox: the zone is what the write actually lands on,
 * and it is the thing a reader of the ledger needs to recognise if it was the wrong one.
 *
 * @returns an external-write `alias <verb>` request whose artifact is the address, landing on the zone
 */
export function aliasDoorRequest({
  home,
  verb,
  zone,
  address,
}: {
  home: string;
  verb: string;
  zone: string;
  address: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "alias", verb },
    artifact: { address, destination: zone, id: `alias:${address}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
