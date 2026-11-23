/**
 * REPLAY LANE, SYNTHETIC — an approved reply that would have landed in a thread the people in it had already moved
 * past. The owner's words: V1 "answered from a
 * snapshot an hour or two old" after people had already found and fixed the issue.
 *
 * No turn of that shape was ever frozen: a parked as-me draft's record set is the draft register, which `turn
 * freeze` does not cut, and the V1 incident predates the register. So this builds the stopped world by hand, from
 * the SHIPPED writers rather than a hand-typed row: the reply is composed by `composeParkedDraft` over the thread as
 * the recording read it (`readThroughOf`), appended to a throwaway home's register by `appendSlackDraftEvent`, read
 * back by `readSlackDraftLines` through `heldRowOf` — the hand validator in `draftLog.ts` included — and released
 * through `releaseFreshness`, the gate both release lanes run. The thread then moves exactly as in the incident:
 * the asker says it is fixed and edits the question.
 *
 * **The falsifiable witness.** The refusal names both changes by `ts`; the binding below reddens if the stored row
 * ever stops carrying the read-through, because a row without one never sees a removal and would miss an edit stamped before the recording.
 * The owner's ruling is the other half: the approval is a day old and still sends once the change set is judged.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent, readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { composeParkedDraft } from "../../../cli/commands/slack/draftCompose.js";
import type { DraftRecordOptions } from "../../../cli/commands/slack/draftCore.js";
import { releaseFreshness } from "../../../cli/commands/slack/releaseFreshnessGate.js";
import { heldRowOf } from "../../../cli/commands/slack/releaseHeldRow.js";
import { markDraftReleased } from "../../../cli/commands/slack/releaseRow.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import { readThroughOf } from "../../../outbound/slack/releaseFreshness.js";
import { storeAnnotatedShot } from "../../annotatedShotFixture.js";

const CHANNEL = "CFIXTUREAA";
const ROOT = "1790000000.000100";

/** The thread as the recording read it: a question, a guess, and the bot's own acknowledgement. */
const RECORDED = [
  { text: "is the booking page down for anyone else?", ts: ROOT, user: "UFIXTUREAB" },
  { text: "looks like the pool again", thread_ts: ROOT, ts: "1790000060.000100", user: "UFIXTUREAC" },
  { bot_id: "BFIXTURE", text: ":eyes:", thread_ts: ROOT, ts: "1790000061.000100", user: "UFIXTUREBOT" },
];

/** An hour later: the asker found and fixed it, and edited the question to say so. */
const FIXED = {
  text: "found it, bad deploy, rolled back",
  thread_ts: ROOT,
  ts: "1790003600.000100",
  user: "UFIXTUREAB",
};
const MOVED = [
  { ...RECORDED[0]!, edited: { ts: "1790003601.000000", user: "UFIXTUREAB" }, text: "[resolved] booking page down" },
  RECORDED[1]!,
  RECORDED[2]!,
  FIXED,
];

/** `auth.test` of the owner's token, the one the release posts under: a user, and no bot. */
const AS_ME = { userId: "UFIXTUREME" };

/** The recording's own options, as `slack draft record --thread-ts` parses them. */
const RECORD: DraftRecordOptions = {
  actor: "me",
  askedBefore: "undeclared",
  channel: CHANNEL,
  formSource: '{"sections":[{"kind":"prose","text":"it is the connection pool"}]}',
  home: "/unused",
  json: false,
  media: [],
  mode: "record",
  receipts: { kind: "undeclared" },
  supersedes: [],
  threadTs: ROOT,
  why: "answer the booking-page question",
};

/** A recording that mentioned nobody. */
const NO_MENTIONS: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-replay-moved-thread-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Park the reply into the throwaway register exactly as the recorder writes it, and read it back.
 *
 * @returns the held row as a release resolves it
 */
function parkAndResolve(): ReturnType<typeof heldRowOf> {
  const draft = composeParkedDraft({
    advisory: [],
    authorId: "UFIXTUREME",
    botCannotPost: undefined,
    channelName: "eng-help",
    form: RECORD.formSource,
    groupDm: undefined,
    id: "sd-0c0ffee0",
    kind: undefined,
    media: [],
    options: RECORD,
    payload: { form: "plain", text: "it is the connection pool", unfurl_links: false, unfurl_media: false },
    readThrough: readThroughOf({ rawMessages: RECORDED }),
    resolution: NO_MENTIONS,
    threadParent: { text: RECORDED[0]!.text, userId: "UFIXTUREAB" },
    tsIso: "2026-10-03T05:00:00.000Z",
    workspaceUrl: "https://fixture.slack.com/",
  });
  unwrap(appendSlackDraftEvent({ event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso }, home }));
  return heldRowOf({ deps: { readDraftLog: () => readSlackDraftLines({ home }) }, draftId: draft.id, home });
}

describe("replay (synthetic): an approved reply into a thread its people already resolved", () => {
  it("binds: the stored row survives the register with what the recording saw, edit stamps included", () => {
    const held = unwrap(parkAndResolve());
    expect(held.row.draft.readThrough).toEqual({
      seen: [{ ts: ROOT }, { ts: "1790000060.000100" }, { ts: "1790000061.000100" }],
      throughTs: "1790000061.000100",
    });
  });

  it("stops the release, naming the fix and the edit, and the three remedies — never a fresh approval", async () => {
    const { draft } = unwrap(parkAndResolve()).row;
    const reads: string[] = [];
    const fresh = await releaseFreshness({
      cleared: undefined,
      deps: {
        readReleaseConversation: async ({ channel, threadTs }) => {
          reads.push(`${channel} ${String(threadTs)}`);
          return ok(MOVED);
        },
        whoAmI: async () => AS_ME,
      },
      draft,
      home,
      token: "xoxp-fixture",
    });
    expect(reads).toEqual([`${CHANNEL} ${ROOT}`]);
    expect(unwrapErr(fresh).message).toBe(
      `draft sd-0c0ffee0: the conversation moved since this draft read it (new: ${FIXED.ts}; edited: ${ROOT}). ` +
        "The owner's approval still stands; judge whether these change what the message means, then: send it as is with " +
        `--thread-moved-cleared ${ROOT},${FIXED.ts}; or withdraw it once the owner's word says so (\`slopweaver slack draft ` +
        'hold sd-0c0ffee0 --reason not-owner-yes --why "<what the owner said>"` then `slopweaver slack draft drop sd-0c0ffee0 ' +
        '--note "<why>"`); ' +
        'or, when it is no longer needed, send only thanks for the review in its place with `--thanks-instead "<one line>"` ' +
        "(an as-me row), which closes the row. Nothing was sent.",
    );
  });

  it("sends a day-old approval once the exact change set is cleared, and journals what it sent past", async () => {
    const { draft } = unwrap(parkAndResolve()).row;
    const fresh = await releaseFreshness({
      cleared: [FIXED.ts, ROOT],
      deps: { readReleaseConversation: async () => ok(MOVED), whoAmI: async () => AS_ME },
      draft,
      home,
      token: "xoxp-fixture",
    });
    const cleared = unwrap(fresh);
    const code = markDraftReleased({
      deps: { appendDraftEvent: ({ event }) => appendSlackDraftEvent({ event, home }) },
      draft,
      heldCuts: [],
      home,
      permalink: undefined,
      threadMovedCleared: cleared,
      ts: "1790003700.000100",
    });
    expect(code).toBe(0);
    const released = parseSlackDraftLog({ lines: readSlackDraftLines({ home }) }).events.at(-1)!;
    expect(released).toMatchObject({ kind: "released", threadMovedClearedTs: [ROOT, FIXED.ts] });
  });

  it("names a person's reply posted through an app, which carries the app's bot_id beside their own user", async () => {
    const { draft } = unwrap(parkAndResolve()).row;
    const viaApp = { ...FIXED, bot_id: "BFIXTUREAPP" };
    const fresh = await releaseFreshness({
      cleared: undefined,
      deps: { readReleaseConversation: async () => ok([...RECORDED, viaApp]), whoAmI: async () => AS_ME },
      draft,
      home,
      token: "xoxp-fixture",
    });
    expect(unwrapErr(fresh).message).toContain(`(new: ${FIXED.ts})`);
  });

  it("refuses to send when auth.test fails, because who is posting decides what the snapshot left out", async () => {
    const { draft } = unwrap(parkAndResolve()).row;
    const reads: string[] = [];
    const fresh = await releaseFreshness({
      cleared: undefined,
      deps: {
        readReleaseConversation: async ({ channel }) => {
          reads.push(channel);
          return ok(RECORDED);
        },
        whoAmI: async () => {
          throw new Error("invalid_auth");
        },
      },
      draft,
      home,
      token: "xoxp-fixture",
    });
    expect(unwrapErr(fresh).message).toBe(
      "draft sd-0c0ffee0: could not re-read where it lands before sending (auth.test: invalid_auth) — nothing was sent.",
    );
    expect(reads).toEqual([]);
  });

  it("refuses to send where it cannot see: an unreadable thread sends nothing", async () => {
    const { draft } = unwrap(parkAndResolve()).row;
    const fresh = await releaseFreshness({
      cleared: undefined,
      deps: {
        readReleaseConversation: async () => err("slack.conversations.replies: ratelimited"),
        whoAmI: async () => AS_ME,
      },
      draft,
      home,
      token: "xoxp-fixture",
    });
    expect(unwrapErr(fresh).message).toBe(
      "draft sd-0c0ffee0: could not re-read where it lands before sending " +
        "(slack.conversations.replies: ratelimited) — nothing was sent.",
    );
  });
});

/** A group DM nobody has spoken in yet, so the recording's read found no message at all. */
const EMPTY_GROUP_DM = "CFIXTUREGD";

/**
 * `conversations.history` as Slack answers it for this case: `oldest` is a ts or `0`, and the zero ts spelled whole
 * is refused — the exact refusal a draft met on the owner's yes.
 */
const historyAsSlackReadsOldest = async ({ oldest }: { oldest: string }) =>
  oldest === "0000000000.000000" ? err("An API error occurred: invalid_ts_oldest") : ok([]);

describe("replay (synthetic): an approved top-level message into a group DM nobody has spoken in", () => {
  it("re-reads from Slack's own start and sends, rather than refusing with invalid_ts_oldest", async () => {
    const { threadTs: _reply, ...topLevel } = RECORD;
    const options: DraftRecordOptions = { ...topLevel, channel: EMPTY_GROUP_DM };
    const parked = composeParkedDraft({
      advisory: [],
      authorId: "UFIXTUREME",
      botCannotPost: undefined,
      channelName: "mpdm-fixture-1",
      form: options.formSource,
      // Unstamped, as a row recorded before the group-DM stamp is: the id cannot tell it from a channel, so it owes
      // its receipts.
      groupDm: undefined,
      id: "sd-0e0e0e0e",
      kind: "message",
      media: [storeAnnotatedShot({ home })],
      options,
      payload: {
        form: "plain",
        text: "it is the <https://fixture.example/pool|connection pool>",
        unfurl_links: false,
        unfurl_media: false,
      },
      readThrough: readThroughOf({ rawMessages: [] }),
      resolution: NO_MENTIONS,
      threadParent: undefined,
      tsIso: "2026-10-06T17:18:31.017Z",
      workspaceUrl: "https://fixture.slack.com/",
    });
    unwrap(
      appendSlackDraftEvent({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso }, home }),
    );
    const { draft } = unwrap(
      heldRowOf({ deps: { readDraftLog: () => readSlackDraftLines({ home }) }, draftId: parked.id, home }),
    ).row;
    expect(draft.readThrough).toEqual({ seen: [], throughTs: "0000000000.000000" });
    const oldests: string[] = [];
    const fresh = await releaseFreshness({
      cleared: undefined,
      deps: {
        readReleaseConversation: async ({ oldest }) => {
          oldests.push(oldest);
          return historyAsSlackReadsOldest({ oldest });
        },
        whoAmI: async () => AS_ME,
      },
      draft,
      home,
      token: "xoxp-fixture",
    });
    expect(oldests).toEqual(["0"]);
    expect(unwrap(fresh)).toEqual([]);
  });
});
