/**
 * The board half of `gmail draft`'s shell: where the form comes from, the claim a board press drafts under,
 * and the receipt it leaves. The door and the Gmail call stay in `./composeRun.ts`, which hands the store
 * step in as a callback, so this file never reaches the mailbox itself.
 */
import { ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  type BoardDraftSource,
  boardDraftSource,
  boardMailAction,
  type GmailBoardDraftError,
  recordDrafted,
} from "./boardDraft.js";
import { claimBoardDraft, releaseBoardDraft } from "./boardDraftClaim.js";
import { type GmailDraftArgs, STDIN_SENTINEL } from "./composeCore.js";
import type { GmailComposeDeps } from "./composeRun.js";

/** How one store ended, and whether its board claim must outlive it: a draft Gmail holds with no receipt. */
export interface StoreEnding {
  readonly exit: number;
  readonly keepClaim: boolean;
}

/**
 * Draft a board row's mail under its claim. The row is read AGAIN once the claim is held: planning awaited
 * Gmail, and a row answered or re-asked in that window no longer offers the mail that was previewed.
 *
 * @param board the row's mail, as read before planning
 * @param store the door-routed Gmail create and its receipt, run only while the claim is held
 * @returns the exit code the invocation ends on
 */
export async function draftUnderClaim({
  board,
  deps,
  home,
  store,
}: {
  board: BoardDraftSource;
  deps: Pick<GmailComposeDeps, "pidAlive" | "writeDiagnostic">;
  home: string;
  store: () => Promise<StoreEnding>;
}): Promise<number> {
  const claimed = claimBoardDraft({
    alive: deps.pidAlive,
    digest: board.digest,
    home,
    pid: process.pid,
    slug: board.slug,
  });
  if (claimed.isErr()) {
    deps.writeDiagnostic(claimed.error.message);
    return EXIT_ERROR;
  }
  const claim = claimed.value;
  const still = boardMailAction({ expect: board.digest, home, slug: board.slug });
  if (still.isErr()) {
    releaseBoardDraft({ claim });
    deps.writeDiagnostic(still.error.message);
    return EXIT_ERROR;
  }
  const stored = await store();
  if (!stored.keepClaim) {
    releaseBoardDraft({ claim });
  }
  return stored.exit;
}

/**
 * After a draft is stored, write a board draft's receipt so a second press of the same mail is refused.
 *
 * @param board the row the mail came off, or `undefined` for a `--form` draft, which has no receipt
 * @param draftId the draft Gmail created
 * @returns the exit code, keeping the claim when the receipt did not write, so a second press is refused as
 *   abandoned rather than duplicating a draft that exists
 */
export function recordBoardReceipt({
  board,
  deps,
  draftId,
  home,
}: {
  board: BoardDraftSource | undefined;
  deps: Pick<GmailComposeDeps, "writeDiagnostic">;
  draftId: string;
  home: string;
}): StoreEnding {
  if (board === undefined) {
    return { exit: EXIT_OK, keepClaim: false };
  }
  const atIso = new Date().toISOString();
  const receipt = recordDrafted({ atIso, digest: board.digest, draftId, home, slug: board.slug });
  if (receipt.isErr()) {
    deps.writeDiagnostic(receipt.error.message);
    return { exit: EXIT_ERROR, keepClaim: true };
  }
  return { exit: EXIT_OK, keepClaim: false };
}

/** What one invocation drafts: the form as JSON, the message it answers, and the board row it came off. */
interface DraftSource {
  readonly formJson: string;
  /** The message the draft replies to — `--reply-to`, or the row's own recorded `replyTo`; undefined for a new mail. */
  readonly replyToId: string | undefined;
  readonly board: BoardDraftSource | undefined;
}

/**
 * The form one invocation drafts: `--form`'s text, stdin, or a board row's recorded mail action
 * (`./boardDraft.ts`, which refuses a mail already drafted before the plan ever runs).
 *
 * A board row's reply target comes off the row, never a flag: it is part of what the preview drew and the digest
 * covers, so the press drafts the reply the owner read, in the thread the owner read it in.
 *
 * @param home the state home the verb resolved once, which the claim, the door and the write all use
 * @returns the form as JSON, the message it answers, and the board row it came off when it came off one
 */
export async function draftSource({
  args,
  deps,
  home,
}: {
  args: GmailDraftArgs;
  deps: Pick<GmailComposeDeps, "readStdin">;
  home: string;
}): Promise<Result<DraftSource, GmailBoardDraftError>> {
  if (args.board !== undefined) {
    return boardDraftSource({ expect: args.board.expect, home, slug: args.board.slug }).map((board) => ({
      board,
      formJson: board.formJson,
      replyToId: board.action.replyTo?.messageId,
    }));
  }
  if (args.formSource !== undefined && args.formSource !== STDIN_SENTINEL) {
    return ok({ board: undefined, formJson: args.formSource, replyToId: args.replyToId });
  }
  return ok({ board: undefined, formJson: await deps.readStdin(), replyToId: args.replyToId });
}
