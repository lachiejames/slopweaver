/**
 * The already-landed verdict on `github stack push`'s creation door: whether a head whose every commit is
 * already patch-identical to the base may open a pull request, and the lines to print either way.
 *
 * The measurement it judges (`AlreadyLanded`), the acknowledgement it reads and the shared refusal shape
 * (`acknowledgedLines`) all live in `./baseFreshnessCore.ts`, beside the base-freshness verdict they serve too.
 */
import { ok, type Result } from "../../../lib/result.js";
import {
  ALREADY_LANDED_ACK,
  type AlreadyLanded,
  acknowledgedLines,
  type BaseFreshnessAcknowledgement,
  type BaseFreshnessPermit,
} from "./baseFreshnessCore.js";
import type { GithubBaseFreshnessRefusedError } from "./errors.js";

/** The manual remedy for a head that is already on the base — never an automatic anything. */
const ALREADY_LANDED_REMEDY = [
  "remedy: check whether the work you meant to open already merged; if it did, close this branch instead of " +
    "opening a second pull request for it",
];

/**
 * The verdict on a head whose commits may already be on the base, and the lines to print either way.
 *
 * @param acknowledgement what the caller accepted
 * @param measurement the patch-id measurement, already reduced to landed/not-landed/skipped by its runner
 * @returns ok with the lines to print when this may proceed, or err with the refusal
 */
export function alreadyLandedPermit({
  acknowledgement,
  measurement,
}: {
  acknowledgement: BaseFreshnessAcknowledgement;
  measurement: AlreadyLanded;
}): Result<BaseFreshnessPermit, GithubBaseFreshnessRefusedError> {
  if (measurement.kind === "skipped") {
    return ok({ lines: [`already-landed check SKIPPED: ${measurement.why}`] });
  }
  if (measurement.kind === "not-landed") {
    return ok({ lines: [] });
  }
  return acknowledgedLines({
    acknowledgement,
    detail:
      `every commit on ${measurement.headBranch} is already patch-identical to something on ` +
      `${measurement.baseBranch}, so this pull request would open on work that has already landed — a squash ` +
      "merge rewrote it under a new SHA, which is why plain ancestry still calls the branch unmerged",
    remedy: ALREADY_LANDED_REMEDY,
    requireReason: true,
    subject: ALREADY_LANDED_ACK,
  });
}

/**
 * Print an already-landed permit's lines and report whether the caller must refuse.
 *
 * @param acknowledgement what the caller accepted
 * @param measurement the patch-id measurement
 * @param out where to print each line
 * @returns `true` when the caller must refuse, `false` when it may proceed
 */
export function printAlreadyLandedPermit({
  acknowledgement,
  measurement,
  out,
}: {
  acknowledgement: BaseFreshnessAcknowledgement;
  measurement: AlreadyLanded;
  out: (args: { line: string }) => void;
}): boolean {
  const permit = alreadyLandedPermit({ acknowledgement, measurement });
  for (const line of permit.isOk() ? permit.value.lines : permit.error.reasons) {
    out({ line });
  }
  return permit.isErr();
}
