/**
 * Put the copy-tray offer a relay carries on its board row — the effectful edge of `../../../talk/relayOfferRow.ts`.
 *
 * The row is registered first, through `handover register` exactly as before, with the offer nowhere in its argv or
 * its front-matter summary. Then this re-reads the row under the row's own lock (`../handover/boardRowLock.ts`, the
 * lock every row edit takes), checks the row is still this turn's by its front-matter anchor, and writes the section
 * in. Every outcome is idempotent: the exact section already there is success with nothing written, a different one is
 * a conflict, never a second copy. So a run killed between the registration and this write leaves the turn
 * `registering`, and its retry adopts the row and finishes the write (`./relayEnsureRow.ts`'s `ensureRow`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";
import type { RelayOffer } from "../../../talk/relayOffer.js";
import { relayOfferSectionState, rowWithRelayOffer } from "../../../talk/relayOfferRow.js";
import { withBoardRowLock } from "../handover/boardRowLock.js";
import { mirrorAfterWrite } from "../handover/mirrorAfterWrite.js";

/** The row could not be read, or is not valid UTF-8. */
interface RowUnreadableError {
  readonly code: "ROW_UNREADABLE";
  readonly message: string;
}

/** The row at the turn's slug does not carry the turn's anchor in its front matter, so it is not this turn's row. */
interface RowNotThisTurnError {
  readonly code: "ROW_NOT_THIS_TURN";
  readonly message: string;
}

/** The row has no `## How this ends` to place the section before — not a row `handover register` wrote. */
interface RowShapeUnknownError {
  readonly code: "ROW_SHAPE_UNKNOWN";
  readonly message: string;
}

/** The row already carries a relay-offer section, and it is not this offer's. */
interface OfferConflictError {
  readonly code: "OFFER_CONFLICT";
  readonly message: string;
}

/** The row's lock was never free, or the row was moved or hard-linked under it. */
interface RowLockedError {
  readonly code: "ROW_LOCKED";
  readonly message: string;
}

/** Every way putting an offer on a relay's row fails. */
type RelayOfferRowError =
  RowUnreadableError | RowNotThisTurnError | RowShapeUnknownError | OfferConflictError | RowLockedError;

/** The factories every {@link RelayOfferRowError} is built through. */
const RelayOfferRowErrors = {
  conflict: ({ path }: { path: string }): OfferConflictError => ({
    code: "OFFER_CONFLICT",
    message: `${path} already carries a copy-tray offer section that is not this relay's offer — refusing to write a second`,
  }),
  locked: ({ why }: { why: string }): RowLockedError => ({ code: "ROW_LOCKED", message: why }),
  notThisTurn: ({ path, anchor }: { path: string; anchor: string }): RowNotThisTurnError => ({
    code: "ROW_NOT_THIS_TURN",
    message: `${path} does not carry ${anchor} as its anchor, so it is not this relay's row`,
  }),
  shapeUnknown: ({ path }: { path: string }): RowShapeUnknownError => ({
    code: "ROW_SHAPE_UNKNOWN",
    message: `${path} has no "## How this ends" section to place the offer before`,
  }),
  unreadable: ({ path, why }: { path: string; why: string }): RowUnreadableError => ({
    code: "ROW_UNREADABLE",
    message: `cannot read ${path}: ${why}`,
  }),
} as const;

/**
 * Put the offer on the row, or confirm it is already there, re-reading the row under its lock.
 *
 * @internal Reached from outside only by its test; the verb goes through {@link carryRelayOffer}.
 * @param path the row's file on the board
 * @param anchor the turn's `talk:<turnId>`, which the row's front matter must carry
 * @param offered the offer, every byte of which the section carries
 * @returns `written` when this call wrote the section, `present` when the exact one was already there, or why neither
 */
export function attachRelayOffer({
  path,
  anchor,
  offered,
}: {
  path: string;
  anchor: string;
  offered: RelayOffer;
}): Result<"written" | "present", RelayOfferRowError> {
  const locked = withBoardRowLock({ path, write: ({ target }) => attachUnderLock({ anchor, offered, path, target }) });
  if (locked.isErr()) {
    return err(RelayOfferRowErrors.locked({ why: locked.error.message }));
  }
  return locked.value;
}

/** {@link attachRelayOffer}'s read, check and write, run once the row's lock is held. */
function attachUnderLock({
  path,
  target,
  anchor,
  offered,
}: {
  path: string;
  target: string;
  anchor: string;
  offered: RelayOffer;
}): Result<"written" | "present", RelayOfferRowError> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(target));
  } catch (cause: unknown) {
    return err(RelayOfferRowErrors.unreadable({ path, why: cause instanceof Error ? cause.message : String(cause) }));
  }
  if (parseHandoverDoc({ path, text }).anchor !== anchor) {
    return err(RelayOfferRowErrors.notThisTurn({ anchor, path }));
  }
  const state = relayOfferSectionState({ anchor, offered, row: text });
  if (state === "matching") {
    return ok("present");
  }
  if (state === "conflicting") {
    return err(RelayOfferRowErrors.conflict({ path }));
  }
  const next = rowWithRelayOffer({ anchor, offered, row: text });
  if (next === undefined) {
    return err(RelayOfferRowErrors.shapeUnknown({ path }));
  }
  try {
    writeFileAtomic({ contents: next, path: target });
  } catch (cause: unknown) {
    return err(RelayOfferRowErrors.unreadable({ path, why: cause instanceof Error ? cause.message : String(cause) }));
  }
  return ok("written");
}

/**
 * Carry a relay's offer onto its row, when it has one, saying on stderr why when it cannot. A mirror that fails after
 * the write is said and is not a failure: the board file, which every reader reads, carries the offer.
 *
 * @param dir the board directory the row is on
 * @param draft the relay, whose `offered` is carried and whose slug and anchor name the row
 * @param home the Slopweaver home the mirror reads
 * @returns `true` when the row carries the offer, or the relay carries none; `false` when it does not
 */
export async function carryRelayOffer({
  dir,
  draft,
  home,
}: {
  dir: string;
  draft: Pick<RelayDraft, "anchor" | "offered" | "slug">;
  home: string;
}): Promise<boolean> {
  if (draft.offered === undefined) {
    return true;
  }
  const path = join(dir, `${draft.slug}.md`);
  const attached = attachRelayOffer({ anchor: draft.anchor, offered: draft.offered, path });
  if (attached.isErr()) {
    logger.error({
      msg:
        `talk relay: the copy-tray offer is not on ${draft.slug} — ${attached.error.message}. The turn stays ` +
        "unfinished, so relaying it again retries this write",
    });
    return false;
  }
  if (attached.value === "written" && (await mirrorAfterWrite({ home, path, verb: "talk relay" }))) {
    logger.error({ msg: `talk relay: the copy-tray offer was written to ${draft.slug}, but its mirror failed` });
  }
  return true;
}
