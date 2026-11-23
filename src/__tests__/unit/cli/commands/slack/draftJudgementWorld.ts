/**
 * The register, the owner's words and the locks `./draftJudgementRun.test.ts` drives `slack draft approve`, `hold` and
 * `drop` over, as plain fakes: one row held, the words that bind it, and a world recording every append, every printed
 * line and the order the locks were taken in.
 */
import type { SlackDraftDeps } from "../../../../../cli/commands/slack/draftRun.js";
import type { RawWords } from "../../../../../handover/hisWordsResolve.js";
import { err, ok } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import { type SlackDraftEvent, slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import { WHOLE_ENDS } from "../../../../rawWordsFixture.js";
import { draftItem, KNOCK } from "../../../supervisor/draftItemFixture.js";

/** A home no fake reads. */
export const HOME = "/tmp/no-home";
/** The instant every judgement is stamped at. */
export const NOW = "2026-10-08T00:20:00.000Z";
/** The held row every case judges. */
export const ID = "sd-c57b4ade";

/** The row parked with no approval. */
export const PARK = slackDraftEventLine({
  event: {
    draft: draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" }).draft,
    id: ID,
    kind: "parked",
    tsIso: "2026-10-08T00:10:00.000Z",
  },
});
/** The row parked already carrying {@link KNOCK}. */
export const APPROVED_PARK = slackDraftEventLine({
  event: {
    draft: draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" }).draft,
    id: ID,
    kind: "parked",
    tsIso: "2026-10-08T00:10:00.000Z",
  },
});
/** The row's author, whose message at a `sent …` ref is what proves the send. */
export const AUTHOR = "U0SYN000001";
/** The approved park, recorded under {@link AUTHOR}. */
export const AUTHORED_PARK = slackDraftEventLine({
  event: {
    draft: { ...draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" }).draft, authorId: AUTHOR },
    id: ID,
    kind: "parked",
    tsIso: "2026-10-08T00:10:00.000Z",
  },
});

/** A relay anchor, as the incident's approvals named one. */
export const RELAY = "talk:a0000025-0000-4000-8000-000000000028";

/** The owner's whole words over the row's card. */
export const WORDS: RawWords = {
  atIso: KNOCK.atIso,
  context: { cardKey: `post:${ID}`, draftIds: undefined, draftIdsUnread: undefined, kind: "card-landing" },
  ...WHOLE_ENDS,
  text: "Yes, send it today",
  where: "call",
};

/** The landing anchor {@link WORDS} is read at: a card landing is only ever read off a `call:` stretch. */
export const LANDING = "call:f9e9277d-0000-4000-8000-000000000001#12";
/** {@link KNOCK}, bound at {@link LANDING}. */
export const LANDED_YES = { ...KNOCK, anchor: LANDING };

/** Approve the row at the landing. */
export const APPROVE = { anchor: LANDING, home: HOME, id: ID, json: false, mode: "approve" } as const;

/** A release of the row, landing as another process's write. */
export const RELEASED = slackDraftEventLine({
  event: { channel: "C0123", id: ID, kind: "released", ts: "1.2", tsIso: NOW },
});

/** The edges the judgement verbs read and write through. */
export type JudgementWorldDeps = Pick<
  SlackDraftDeps,
  | "appendEvent"
  | "botToken"
  | "fenceCallWrites"
  | "lockRegister"
  | "nowIso"
  | "out"
  | "readApprovalLaterRelays"
  | "readOwnerWords"
  | "readLandedDrafts"
  | "readLog"
  | "threadReplies"
  | "userToken"
>;

/**
 * The call fence and the register lock, each recording its take and its release in `order`.
 *
 * @param fenceTaken the call's append lock cannot be taken
 * @param lockTaken the register lock is held by a live writer
 * @param order where each take and release is recorded, in turn
 * @returns the two lock deps
 */
function heldLocks({
  fenceTaken,
  lockTaken,
  order,
}: {
  fenceTaken: boolean;
  lockTaken: boolean;
  order: string[];
}): Pick<JudgementWorldDeps, "fenceCallWrites" | "lockRegister"> {
  return {
    fenceCallWrites: () => {
      if (fenceTaken) {
        return err("the call could not be held still");
      }
      order.push("fence");
      return ok({
        recheck: () => undefined,
        release: () => {
          order.push("unfence");
        },
      });
    },
    lockRegister: () => {
      if (lockTaken) {
        return err(SlackDraftErrors.writeFailed({ cause: new Error("a live writer holds the lock"), path: "/x.lock" }));
      }
      order.push("lock");
      return ok(() => {
        order.push("unlock");
      });
    },
  };
}

/**
 * A world whose register holds these lines, recording every append and every printed line. Each append is read back
 * by the next read; `meanwhile` lands just before it and `after` just behind it, as another process's writes racing
 * the verb's own.
 *
 * @param appendFails every register append fails, as a write the disk refused
 * @param fenceTaken the call's append lock cannot be taken
 * @param lockTaken the register lock is held by a live writer
 * @param slack the thread's replies, as Slack holds them
 * @returns the deps, and what the verb appended, printed and locked, in order
 */
export function world({
  lines,
  after = [],
  appendFails = false,
  fenceTaken = false,
  lockTaken = false,
  meanwhile = [],
  slack = [],
}: {
  lines: readonly string[];
  after?: readonly string[];
  appendFails?: boolean;
  fenceTaken?: boolean;
  lockTaken?: boolean;
  meanwhile?: readonly string[];
  slack?: readonly unknown[];
}): { appended: SlackDraftEvent[]; deps: JudgementWorldDeps; order: string[]; printed: string[] } {
  const appended: SlackDraftEvent[] = [];
  const printed: string[] = [];
  const order: string[] = [];
  const log = [...lines];
  const deps: JudgementWorldDeps = {
    appendEvent: ({ event }) => {
      if (appendFails) {
        return err(SlackDraftErrors.writeFailed({ cause: new Error("EACCES"), path: "/x" }));
      }
      order.push(`append ${event.kind}`);
      appended.push(event);
      log.push(...meanwhile, slackDraftEventLine({ event }), ...after);
      return ok(true as const);
    },
    botToken: () => undefined,
    ...heldLocks({ fenceTaken, lockTaken, order }),
    nowIso: () => NOW,
    out: (line) => {
      printed.push(line);
    },
    readApprovalLaterRelays: () => ok([]),
    readOwnerWords: () => ok(WORDS),
    readLandedDrafts: () => ({
      bindings: { bound: [], unreadable: [] },
      kind: "read" as const,
      ledgerRows: 4,
      vanished: [],
    }),
    readLog: () => log,
    threadReplies: async () => ok(slack),
    userToken: () => "xoxp-test",
  };
  return { appended, deps, order, printed };
}
