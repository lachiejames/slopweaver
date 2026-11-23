/**
 * The claim one `gmail draft --board` press holds on a `(slug, digest)` while it talks to Gmail.
 *
 * ## Why a receipt alone is not enough
 *
 * The receipt is written AFTER Gmail answers, so two presses that overlap both read "no receipt" and both
 * create a draft (reproduced: exit codes `[0, 0]`, two draft ids, one receipt). The claim closes
 * that window: it is created with `O_EXCL` BEFORE the Gmail call, so exactly one press holds it, and the
 * receipt is checked again once it is held, because a press that finished between our first check and our
 * claim has already written its receipt.
 *
 * ## A claim whose holder died is REFUSED, never taken over
 *
 * A press that crashed mid-call leaves its claim behind, and it may or may not have created the draft first —
 * nothing here can tell. Taking the claim over would risk the very duplicate this file exists to prevent, and
 * two presses taking over the same dead claim can each delete the other's fresh one. So a claim naming a pid
 * no longer in the process table is refused as ABANDONED, naming the file and saying to look in Gmail's drafts
 * before removing it.
 *
 * ## Release moves the claim aside, then judges it: never judge, then delete by path
 *
 * A claim carries a random `claimId`, and the press holds a {@link BoardDraftClaim} handle naming it. A release
 * first renames the claim file to an aside name no other process uses — an atomic move of whichever claim is there at
 * that instant — and only deletes it when the aside file carries this press's own id. Anything else goes back with
 * `link`, which never overwrites: a newer claim that took the path meanwhile supersedes it, as an atomic replace
 * would. The pattern and its residue are `../../../outbound/notion/reservationRelease.ts`'s: while a claim that is
 * NOT this press's own is out of place, its path is empty, so a press in that instant could take a fresh claim.
 */
import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { createFileExclusive, ensureDirectory } from "../../../lib/writeAtomic.js";

import { boardDraftsDir, draftedBefore, type GmailBoardDraftError, GmailBoardDraftErrors } from "./boardDraft.js";

/** The claim one press holds: where it is, and the id only this press wrote into it. */
export interface BoardDraftClaim {
  readonly home: string;
  readonly slug: string;
  readonly digest: string;
  readonly claimId: string;
}

/** The two points a test may place a concurrent claim write at. */
export type ClaimReleaseStage = "before-claim" | "after-claim";

/** Where the claim on one row's mail lives while a press holds it. */
function claimPath({ home, slug, digest }: { home: string; slug: string; digest: string }): string {
  return join(boardDraftsDir({ home }), `${slug}.${digest}.claim`);
}

/** Whether a thrown filesystem error is the one `O_EXCL` raises when the file is already there. */
function alreadyExists({ error }: { error: unknown }): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

/** The parsed claim file, or `undefined` when it cannot be read or parsed. */
function readClaim({ path }: { path: string }): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // Unreadable or half-written: the caller decides what an unknown claim means.
    return undefined;
  }
}

/** The pid a claim file names, or `undefined` when it names none a reader can use. */
function claimHolder({ path }: { path: string }): number | undefined {
  const pid = readClaim({ path })?.["pid"];
  return typeof pid === "number" ? pid : undefined;
}

/**
 * Claim one row's mail for this press, or say who already holds it.
 *
 * @param home the Slopweaver home
 * @param slug the board row
 * @param digest the mail's digest
 * @param pid this press's process id, written into the claim
 * @param alive whether a pid is still in the process table; injected so a test can name a dead holder
 * @returns the handle a release names once this press holds the claim, or why it does not
 */
export function claimBoardDraft({
  home,
  slug,
  digest,
  pid,
  alive,
}: {
  home: string;
  slug: string;
  digest: string;
  pid: number;
  alive: (args: { pid: number }) => boolean;
}): Result<BoardDraftClaim, GmailBoardDraftError> {
  const path = claimPath({ digest, home, slug });
  const claim: BoardDraftClaim = { claimId: randomUUID(), digest, home, slug };
  const claimed = takeClaim({ claimId: claim.claimId, path, pid });
  if (claimed !== "taken") {
    return err(claimFailure({ alive, digest, outcome: claimed, path, slug }));
  }
  const earlier = draftedBefore({ digest, home, slug });
  if (earlier !== undefined) {
    releaseBoardDraft({ claim });
    return err(GmailBoardDraftErrors.alreadyDrafted({ digest, draftId: earlier, slug }));
  }
  return ok(claim);
}

/**
 * Put a claim moved aside back at its path unless a newer one has taken it, then drop the aside copy. A link that
 * fails for any other reason leaves the aside copy on disk rather than losing a claim.
 *
 * @param aside the name the claim was moved to
 * @param path the claim path it came from
 */
function restoreClaim({ aside, path }: { aside: string; path: string }): void {
  try {
    linkSync(aside, path);
  } catch (error: unknown) {
    if (!alreadyExists({ error })) {
      return;
    }
  }
  rmSync(aside, { force: true });
}

/**
 * Release a claim this press holds, and only that one. A claim already gone, or one another press now holds, is left
 * as it is: releasing is idempotent and never removes a claim this press did not write.
 *
 * @param claim the handle {@link claimBoardDraft} returned
 * @param interleave a test's seam, called before and after the claim is moved aside, where a concurrent write goes
 * @returns true when this press's own claim was removed; false when nothing of its own was there
 */
export function releaseBoardDraft({
  claim,
  interleave,
}: {
  claim: BoardDraftClaim;
  interleave?: ((input: { readonly stage: ClaimReleaseStage }) => void) | undefined;
}): boolean {
  const path = claimPath(claim);
  const aside = `${path}.releasing-${randomUUID()}`;
  interleave?.({ stage: "before-claim" });
  try {
    renameSync(path, aside);
  } catch {
    return false;
  }
  interleave?.({ stage: "after-claim" });
  if (readClaim({ path: aside })?.["claimId"] !== claim.claimId) {
    restoreClaim({ aside, path });
    return false;
  }
  rmSync(aside, { force: true });
  return true;
}

/** One exclusive-create attempt: taken, already held by someone, or failed for another reason. */
function takeClaim({
  path,
  pid,
  claimId,
}: {
  path: string;
  pid: number;
  claimId: string;
}): "taken" | "held" | { readonly cause: string } {
  try {
    ensureDirectory({ directory: join(path, "..") });
    createFileExclusive({ contents: `${JSON.stringify({ claimId, pid })}\n`, path });
    return "taken";
  } catch (error: unknown) {
    if (alreadyExists({ error })) {
      return "held";
    }
    return { cause: error instanceof Error ? error.message : String(error) };
  }
}

/** Why a claim attempt did not take: a live press holds it, a dead one left it, or the write failed. */
function claimFailure({
  alive,
  outcome,
  path,
  slug,
  digest,
}: {
  alive: (args: { pid: number }) => boolean;
  outcome: "held" | { readonly cause: string };
  path: string;
  slug: string;
  digest: string;
}): GmailBoardDraftError {
  if (outcome === "held") {
    const holder = claimHolder({ path });
    if (holder === undefined) {
      return GmailBoardDraftErrors.claimUnwritten({
        cause: `another press is taking the claim right now; press again, and if this repeats, ${path} was left half-written by a press that died`,
      });
    }
    if (!alive({ pid: holder })) {
      return GmailBoardDraftErrors.claimAbandoned({ path, pid: holder, slug });
    }
    return GmailBoardDraftErrors.inFlight({ digest, pid: holder, slug });
  }
  return GmailBoardDraftErrors.claimUnwritten({ cause: outcome.cause });
}
