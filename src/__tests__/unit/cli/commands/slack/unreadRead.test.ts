/**
 * `slack unread`'s two live reads over plain fake seams: which conversations the DM half asks a read marker for,
 * what it does with a private channel the `is:mpim` search also matched, what a spent deadline leaves in the
 * residue, and which threads the activity half opens — `slack tagged`'s own judgement of its two searches.
 */
import { describe, expect, it } from "vitest";

import { dmThreadCandidates, readUnreadDms } from "../../../../../cli/commands/slack/unreadDms.js";
import {
  halvesOf,
  type SlackUnreadSeams,
  threadCandidates,
  underDeadline,
} from "../../../../../cli/commands/slack/unreadRead.js";
import { parseSlackUnreadOptions } from "../../../../../cli/commands/slack/unreadRun.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { ok, okAsync, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { slackTsToIso } from "../../../../../lib/slackTs.js";
import type { SlackSearchMatch, SlackSearchMessages } from "../../../../../live/slack/searchMessages.js";

const OWNER = "U0SYNOWNER1234";
const ROSA = "U0SYNROSA123";
const NOW_MS = Date.parse("2026-10-06T05:00:00.000Z");
const PLENTY = { remainingMs: () => 10_000 };
const APP = "U0SYNAPP12345";

/** Everyone is a person but {@link APP}. */
const AUTHOR = ({ authorId }: { authorId: string }): { name: string; isHuman: boolean; known: boolean } => ({
  isHuman: authorId !== APP,
  known: true,
  name: authorId,
});

/** One search hit; a reply's permalink carries its thread's root, exactly as Slack's search returns it. */
function hit({
  channelId,
  ts,
  userId,
  text,
  threadTs,
}: {
  channelId: string;
  ts: string;
  userId: string;
  text: string;
  threadTs?: string;
}): SlackSearchMatch {
  const query = threadTs === undefined ? "" : `?thread_ts=${threadTs}&cid=${channelId}`;
  return {
    channelId,
    channelName: channelId.startsWith("D") ? "" : "iso",
    permalink: `https://acme.slack.com/archives/${channelId}/p${ts.replace(".", "")}${query}`,
    text,
    ts,
    tsIso: slackTsToIso({ ts })!,
    userId,
  };
}

/** A search seam answering each query from a fixed table, one page each. */
function searchServing({
  byQuery,
}: {
  byQuery: Readonly<Record<string, readonly SlackSearchMatch[]>>;
}): SlackSearchMessages {
  return async ({ query }) => {
    const matches = byQuery[query];
    if (matches === undefined) {
      throw new Error(`no search should have been made for ${query}`);
    }
    return ok({ matches, pageCount: 1, total: matches.length });
  };
}

/** Seams over a fixed set of `conversations.info` bodies, DM histories and threads keyed `channel:rootTs`. */
function seamsOver({
  search,
  infos,
  histories,
  threads = {},
}: {
  search: SlackSearchMessages;
  infos: Readonly<Record<string, unknown>>;
  histories: Readonly<Record<string, readonly unknown[]>>;
  threads?: Readonly<Record<string, readonly unknown[]>>;
}): SlackUnreadSeams {
  const history: SlackApi["history"] = async ({ channel }) => ({ hasMore: false, messages: histories[channel]! });
  const replies: SlackApi["replies"] = async ({ channel, ts }) => {
    const messages = threads[`${channel}:${ts}`];
    if (messages === undefined) {
      throw new Error(`no thread should have been read at ${channel}:${ts}`);
    }
    return { hasMore: false, messages };
  };
  return {
    api: { history, replies },
    info: ({ channel }) => okAsync(infos[channel]),
    search,
    workspace: "https://acme.slack.com",
  };
}

const DM_QUERIES = { "is:dm after:2026-09-28": [], "is:mpim after:2026-09-28": [] } as const;

describe("readUnreadDms", () => {
  it("asks a read marker of every conversation with traffic, reads past it where Slack counts unread, and passes a private channel over", async () => {
    const search = searchServing({
      byQuery: {
        ...DM_QUERIES,
        "is:dm after:2026-09-28": [
          hit({ channelId: "D0SYNUNREAD12", text: "option A or B?", ts: "1791000200.000100", userId: ROSA }),
          hit({ channelId: "D0SYNREAD1234", text: "thanks", ts: "1791000100.000100", userId: ROSA }),
        ],
        "is:mpim after:2026-09-28": [
          hit({ channelId: "C0SYNPRIV1234", text: "x", ts: "1791000050.000100", userId: ROSA }),
        ],
      },
    });
    const seams = seamsOver({
      histories: { D0SYNUNREAD12: [{ text: "option A or B?", ts: "1791000200.000100", user: ROSA }] },
      infos: {
        C0SYNPRIV1234: {
          channel: { id: "C0SYNPRIV1234", is_im: false, is_mpim: false, last_read: "1791000000.000000" },
        },
        D0SYNREAD1234: {
          channel: {
            id: "D0SYNREAD1234",
            is_im: true,
            last_read: "1791000100.000100",
            unread_count_display: 0,
            user: ROSA,
          },
        },
        D0SYNUNREAD12: {
          channel: {
            id: "D0SYNUNREAD12",
            is_im: true,
            last_read: "1791000000.000000",
            unread_count_display: 1,
            user: ROSA,
          },
        },
      },
      search,
    });
    const leg = await readUnreadDms({
      author: AUTHOR,
      deadline: PLENTY,
      nowMs: NOW_MS,
      ownerId: OWNER,
      seams,
      sinceIso: "2026-09-29T05:00:00.000Z",
    });
    expect(leg.read.map((read) => [read.marker.channelId, read.messages.map((message) => message.text)])).toEqual([
      ["D0SYNUNREAD12", ["option A or B?"]],
    ]);
    expect(leg.checked).toBe(2);
    expect([...leg.channels]).toEqual(["D0SYNUNREAD12", "D0SYNREAD1234"]);
    expect(leg.incomplete).toBe(false);
    expect(leg.residue).toEqual([
      "a DM is checked only when it has a message since 2026-09-29T05:00:00.000Z; one unread from before then is not seen",
    ]);
  });

  it("checks a DM ahead of newer private channels `is:mpim` matched, and calls a run past the cap incomplete", async () => {
    // Sixty-four private channels busier than the owner's one DM: by recency alone they would spend the whole cap of 64.
    const privates = Array.from({ length: 64 }, (_, index) => `C0PRIV${String(index).padStart(4, "0")}`);
    const search = searchServing({
      byQuery: {
        ...DM_QUERIES,
        "is:dm after:2026-09-28": [
          hit({ channelId: "D0SYNQUIET123", text: "ping", ts: "1790990000.000100", userId: ROSA }),
        ],
        "is:mpim after:2026-09-28": privates.map((channelId, index) =>
          hit({ channelId, text: "x", ts: `${String(1791000000 + index)}.000100`, userId: ROSA }),
        ),
      },
    });
    const privateInfos = Object.fromEntries(
      privates.map((id) => [id, { channel: { id, is_im: false, is_mpim: false, last_read: "1791000000.000000" } }]),
    );
    const seams = seamsOver({
      histories: {},
      infos: {
        ...privateInfos,
        D0SYNQUIET123: {
          channel: {
            id: "D0SYNQUIET123",
            is_im: true,
            last_read: "1790990000.000100",
            unread_count_display: 0,
            user: ROSA,
          },
        },
      },
      search,
    });
    const leg = await readUnreadDms({
      author: AUTHOR,
      deadline: PLENTY,
      nowMs: NOW_MS,
      ownerId: OWNER,
      seams,
      sinceIso: "2026-09-29T05:00:00.000Z",
    });
    expect(leg.checked).toBe(1);
    expect([...leg.channels]).toEqual(["D0SYNQUIET123"]);
    expect(leg.incomplete).toBe(true);
    expect(leg.residue).toEqual([
      "1 quieter DM(s) were not checked for unread messages",
      "a DM is checked only when it has a message since 2026-09-29T05:00:00.000Z; one unread from before then is not seen",
    ]);
  });

  it("calls a conversation whose answer names no DM flags a short read, never a private channel passed over", async () => {
    const search = searchServing({
      byQuery: {
        ...DM_QUERIES,
        "is:dm after:2026-09-28": [
          hit({ channelId: "D0SYNODD12345", text: "hi", ts: "1791000100.000100", userId: ROSA }),
        ],
      },
    });
    const seams = seamsOver({ histories: {}, infos: { D0SYNODD12345: { ok: true } }, search });
    const leg = await readUnreadDms({
      author: AUTHOR,
      deadline: PLENTY,
      nowMs: NOW_MS,
      ownerId: OWNER,
      seams,
      sinceIso: "2026-09-29T05:00:00.000Z",
    });
    expect(leg.checked).toBe(0);
    expect(leg.incomplete).toBe(true);
    expect(leg.residue[0]).toBe("a conversation's kind could not be told: Slack's answer named no DM flags");
  });

  it("never calls a group DM clear past a row it could not read, and names the row", async () => {
    const search = searchServing({
      byQuery: {
        ...DM_QUERIES,
        "is:mpim after:2026-09-28": [
          hit({ channelId: "G0SYNGROUP123", text: "noted", ts: "1791000200.000100", userId: OWNER }),
        ],
      },
    });
    const seams = seamsOver({
      // The owner's own message, and a row with no ts that may have been somebody else's.
      histories: { G0SYNGROUP123: [{ text: "noted", ts: "1791000200.000100", user: OWNER }, { text: "lost" }] },
      infos: { G0SYNGROUP123: { channel: { id: "G0SYNGROUP123", is_mpim: true, last_read: "1791000000.000000" } } },
      search,
    });
    const leg = await readUnreadDms({
      author: AUTHOR,
      deadline: PLENTY,
      nowMs: NOW_MS,
      ownerId: OWNER,
      seams,
      sinceIso: "2026-09-29T05:00:00.000Z",
    });
    expect(leg.read.map((read) => read.marker.channelId)).toEqual(["G0SYNGROUP123"]);
    expect(leg.incomplete).toBe(true);
    expect(leg.residue).toEqual([
      "1 message(s) past a DM's read marker could not be read",
      "a DM is checked only when it has a message since 2026-09-29T05:00:00.000Z; one unread from before then is not seen",
    ]);
  });

  it("counts every DM a spent deadline left unchecked into the residue, never as read", async () => {
    const search = searchServing({ byQuery: DM_QUERIES });
    const seams = seamsOver({ histories: {}, infos: {}, search });
    const leg = await readUnreadDms({
      author: AUTHOR,
      deadline: { remainingMs: () => 0 },
      nowMs: NOW_MS,
      ownerId: OWNER,
      seams,
      sinceIso: "2026-09-29T05:00:00.000Z",
    });
    expect(leg.incomplete).toBe(true);
    expect(leg.checked).toBe(0);
    expect(leg.residue).toEqual([
      "the search `is:dm after:2026-09-28` did not answer in time, so what it would have found is not listed",
      "the search `is:mpim after:2026-09-28` did not answer in time, so what it would have found is not listed",
      "a DM is checked only when it has a message since 2026-09-29T05:00:00.000Z; one unread from before then is not seen",
    ]);
  });

  it("reads a reply under a DM message whole, though the DM's read marker counts nothing unread", async () => {
    const root = "1791000100.000100";
    const search = searchServing({
      byQuery: {
        ...DM_QUERIES,
        "is:dm after:2026-09-28": [
          hit({
            channelId: "D0SYNREAD1234",
            text: "done, A or B?",
            threadTs: root,
            ts: "1791000300.000100",
            userId: ROSA,
          }),
          hit({ channelId: "D0SYNREAD1234", text: "can you check?", ts: root, userId: OWNER }),
        ],
      },
    });
    const seams = seamsOver({
      histories: {},
      infos: {
        D0SYNREAD1234: {
          channel: { id: "D0SYNREAD1234", is_im: true, last_read: root, unread_count_display: 0, user: ROSA },
        },
      },
      search,
      threads: {
        [`D0SYNREAD1234:${root}`]: [
          { text: "can you check?", thread_ts: root, ts: root, user: OWNER },
          { text: "done, A or B?", thread_ts: root, ts: "1791000300.000100", user: ROSA },
        ],
      },
    });
    const leg = await readUnreadDms({
      author: AUTHOR,
      deadline: PLENTY,
      nowMs: NOW_MS,
      ownerId: OWNER,
      seams,
      sinceIso: "2026-09-29T05:00:00.000Z",
    });
    expect(leg.read).toEqual([]);
    expect(
      leg.threads.map((thread) => [
        thread.channelId,
        thread.direct,
        thread.taggedFromTs,
        thread.messages.map((message) => message.text),
      ]),
    ).toEqual([["D0SYNREAD1234", true, root, ["can you check?", "done, A or B?"]]]);
    expect(leg.incomplete).toBe(false);
  });
});

describe("dmThreadCandidates", () => {
  it("takes one candidate per DM thread a person replied in after the owner, newest first — never an app's, a top-level message, a channel, or one the owner answered last", () => {
    const matches = [
      hit({
        channelId: "D0SYNDMA12345",
        text: "first",
        threadTs: "1791000000.000100",
        ts: "1791000100.000100",
        userId: ROSA,
      }),
      hit({
        channelId: "D0SYNDMA12345",
        text: "later",
        threadTs: "1791000000.000100",
        ts: "1791000500.000100",
        userId: ROSA,
      }),
      hit({
        channelId: "D0SYNDMB12345",
        text: "mine",
        threadTs: "1791000000.000200",
        ts: "1791000900.000100",
        userId: OWNER,
      }),
      hit({ channelId: "D0SYNDMB12345", text: "top level", ts: "1791000800.000100", userId: ROSA }),
      hit({
        channelId: "D0SYNDMC12345",
        text: "other",
        threadTs: "1791000000.000300",
        ts: "1791000600.000100",
        userId: ROSA,
      }),
      hit({
        channelId: "C0SYNPRIV1234",
        text: "private",
        threadTs: "1791000000.000400",
        ts: "1791000700.000100",
        userId: ROSA,
      }),
      // An app's reply could never make a row.
      hit({
        channelId: "D0SYNDMD12345",
        text: "PR landed",
        threadTs: "1791000000.000500",
        ts: "1791000950.000100",
        userId: APP,
      }),
      // A person replied, then the owner answered last.
      hit({
        channelId: "D0SYNDME12345",
        text: "A or B?",
        threadTs: "1791000000.000600",
        ts: "1791000960.000100",
        userId: ROSA,
      }),
      hit({
        channelId: "D0SYNDME12345",
        text: "B",
        threadTs: "1791000000.000600",
        ts: "1791000970.000100",
        userId: OWNER,
      }),
    ];
    const candidates = dmThreadCandidates({
      author: AUTHOR,
      channels: new Set(["D0SYNDMA12345", "D0SYNDMB12345", "D0SYNDMC12345", "D0SYNDMD12345", "D0SYNDME12345"]),
      matches,
      ownerId: OWNER,
    });
    expect(candidates.map((candidate) => [candidate.channelId, candidate.threadTs, candidate.latest])).toEqual([
      ["D0SYNDMC12345", "1791000000.000300", 1791000600.0001],
      ["D0SYNDMA12345", "1791000000.000100", 1791000500.0001],
    ]);
  });
});

describe("threadCandidates", () => {
  const author = AUTHOR;
  const window = { nowIso: "2026-10-06T05:00:00.000Z", sinceIso: "2026-10-03T05:00:00.000Z" };

  it("opens every thread the owner spoke in and every one a person tagged them in that they did not, newest first, never a DM", () => {
    const theirs = [
      hit({ channelId: "C0SYNISO12345", text: "I'll take it", ts: "1791100000.000100", userId: OWNER }),
      hit({ channelId: "D0SYNDM12345", text: "ok", ts: "1791200000.000100", userId: OWNER }),
    ];
    const tags = [
      hit({ channelId: "C0SYNENG12345", text: `<@${OWNER}> sign off?`, ts: "1791150000.000100", userId: ROSA }),
      // A reply in the thread the owner started: already theirs, so never a second candidate.
      hit({
        channelId: "C0SYNISO12345",
        text: `<@${OWNER}> and this?`,
        threadTs: "1791100000.000100",
        ts: "1791100500.000100",
        userId: ROSA,
      }),
      hit({
        channelId: "C0SYNALERT123",
        text: `<@${OWNER}> DLP alert`,
        ts: "1791160000.000100",
        userId: "U0SYNAPP12345",
      }),
      hit({ channelId: "C0SYNALERT123", text: `<@${OWNER}> webhook post`, ts: "1791170000.000100", userId: "" }),
    ];
    const found = threadCandidates({ author, ownerMatches: theirs, ownerId: OWNER, tagMatches: tags, ...window });
    expect(found.candidates.map((candidate) => [candidate.channelId, candidate.taggedFromTs])).toEqual([
      ["C0SYNENG12345", "1791150000.000100"],
      ["C0SYNISO12345", undefined],
    ]);
    expect(found.authorless).toBe(1);
  });
});

describe("halvesOf", () => {
  it("splits a thread key at its first colon into the conversation and the root ts", () => {
    expect(halvesOf({ key: "D0SYNDMA12345:1791000000.000100" })).toEqual({
      channelId: "D0SYNDMA12345",
      threadTs: "1791000000.000100",
    });
  });
});

describe("underDeadline", () => {
  it("runs nothing once the deadline is spent, and names a thrown error with time left", async () => {
    const neverRun = async (): Promise<string> => {
      throw new Error("a spent deadline must not run its task");
    };
    expect(await underDeadline({ deadline: { remainingMs: () => 0 }, task: neverRun })).toEqual({ kind: "late" });
    const failing = async (): Promise<string> => {
      throw new Error("channel_not_found");
    };
    expect(await underDeadline({ deadline: PLENTY, task: failing })).toEqual({
      kind: "failed",
      why: "channel_not_found",
    });
  });
});

describe("parseSlackUnreadOptions", () => {
  it("defaults to three days of activity and refuses more than seven", () => {
    expect(unwrap(parseSlackUnreadOptions({ defaultHome: "/h", rest: [] }))).toEqual({
      days: 3,
      home: "/h",
      json: false,
    });
    expect(unwrapErr(parseSlackUnreadOptions({ defaultHome: "/h", rest: ["--days", "9"] }))).toEqual([
      "--days must be at most 7, got 9",
    ]);
  });
});
