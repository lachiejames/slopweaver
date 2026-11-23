/**
 * The receipt every `slopweaver talk unread-adopt` apply leaves — one JSON line per adopt, appended to
 * `$SLOPWEAVER_HOME/talk/unread-adopt-receipts.jsonl` beside the cursors it moved.
 *
 * An adopt marks words read that no reader printed, so the one thing that must survive it is a record of exactly what
 * was passed, why, and from where to where: every call's frontier before and after, the instant, the digest the
 * preview printed and the reason typed. A later reader asking "was this ever read?" finds the answer here rather than
 * in a cursor that only says where a reader stands now.
 */
import { dirname } from "node:path";

import { unsetFieldAsNull } from "#lib/absent.js";
import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { ensureDirectory } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";

import type { AdoptPlan } from "./unreadAdopt.js";
import { type UnreadError, UnreadErrors } from "./unreadErrors.js";
import type { CallFrontier } from "./unreadWords.js";

/** One adopt, as recorded. */
export interface AdoptReceipt {
  readonly recordedAtIso: string;
  readonly cursor: string;
  readonly beforeIso: string;
  readonly digest: string;
  readonly why: string;
  readonly stretches: number;
  readonly foreignStretches: number;
  readonly stretchesLeft: number;
  /** Every line the call schema refused that the adopt passed — printed whole first — by call and byte. */
  readonly unparseablePassed: readonly { readonly callId: string; readonly byteOffset: number }[];
  readonly calls: readonly {
    readonly callId: string;
    readonly from: CallFrontier | null;
    readonly to: CallFrontier;
    readonly lines: number;
    readonly stretches: number;
    readonly firstAtIso: string;
    readonly lastAtIso: string;
  }[];
}

/**
 * Where adopt receipts are kept: the `talk/` directory the cursors live under.
 *
 * @param home the Slopweaver home
 * @returns the receipts file
 */
export function adoptReceiptsPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).talkUnreadAdoptReceiptsJsonl;
}

/**
 * The receipt an applied plan leaves.
 *
 * @param plan the plan that was applied
 * @param cursor the reader whose cursor moved
 * @param why the reason typed with the apply
 * @returns the receipt
 */
export function adoptReceiptOf({ plan, cursor, why }: { plan: AdoptPlan; cursor: string; why: string }): AdoptReceipt {
  return {
    beforeIso: plan.beforeIso,
    calls: plan.calls.map((call) => ({
      callId: call.callId,
      firstAtIso: call.firstAtIso,
      // A call the reader never read has no frontier before, by design: the receipt records that as `null`.
      from: unsetFieldAsNull({ key: "from", record: call }),
      lastAtIso: call.lastAtIso,
      lines: call.lines,
      stretches: call.stretches,
      to: call.to,
    })),
    cursor,
    digest: plan.digest,
    foreignStretches: plan.foreignStretches,
    recordedAtIso: plan.cursor.recordedAtIso,
    stretches: plan.stretches,
    stretchesLeft: plan.stretchesLeft,
    unparseablePassed: plan.unparseablePassed.map((line) => ({ byteOffset: line.byteOffset, callId: line.callId })),
    why,
  };
}

/**
 * Append one receipt, durably, in an owner-only file. An apply runs this while its new cursor is only staged
 * (`writeUnreadCursorBehindRecord`), so a receipt that cannot be stored — a directory at the path, no permission, a
 * full disk — refuses the apply with the cursor unmoved.
 *
 * @param home the Slopweaver home
 * @param receipt what the adopt recorded
 * @returns the receipts file, or why it could not be written
 */
export function appendAdoptReceipt({
  home,
  receipt,
}: {
  home: string;
  receipt: AdoptReceipt;
}): Result<string, UnreadError> {
  const path = adoptReceiptsPath({ home });
  try {
    ensureDirectory({ directory: dirname(path) });
    appendLines({
      durable: true,
      mode: 0o600,
      path,
      text: safeJsonStringify({ label: "talk unread-adopt receipt", value: receipt }),
    });
  } catch (cause) {
    return err(UnreadErrors.pathFailed({ cause, path }));
  }
  return ok(path);
}
