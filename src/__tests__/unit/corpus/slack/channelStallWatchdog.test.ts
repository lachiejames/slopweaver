/**
 * A conversation that stops making progress must skip ITSELF, and the pass must carry on.
 *
 * The crawl was measured freezing inside one channel with every signal at zero — 0.0% CPU, byte-flat RSS,
 * no open socket — roughly one channel in fifteen to twenty (`slack-crawl-intermittent-silent-hang`). That
 * turned a 603-channel backfill into a babysat one: a human noticed each hang, killed the pass, rebuilt the
 * channel allowlist without the hung id, and relaunched. These tests pin the watchdog that removes the human,
 * and — the half that matters more — pin that an abandoned conversation claims NOTHING, so the next pass
 * retries it with no exclusion list to maintain.
 *
 * The deadline is driven by a VIRTUAL clock the fake Slack API advances, so both halves are exact rather than
 * timed: a channel that answers just inside the window every time must survive an arbitrarily long crawl, and
 * a channel that answers not at all must be abandoned. A test that slept would prove the first only weakly.
 */
import { describe, expect, it } from "vitest";
import type { SourceProgressEvent } from "../../../../corpus/progress.js";
import {
  type ChannelDeadlineFactory,
  channelProgressDeadline,
  type DeadlineTimer,
} from "../../../../corpus/slack/channelDeadline.js";
import {
  fetchSlackActivity,
  SLACK_CHANNEL_FLUSH_ITEMS,
  type SlackApi,
  type SlackChannelCommit,
  type SlackChannelPartialCommit,
  type SlackMessagesPage,
} from "../../../../corpus/slack/fetch.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import { ok, unwrap } from "../../../../lib/result.js";

const window: ExportWindow = { since: "1970-01-01", until: "2026-08-24" };

/** The stall window every test here judges against — a round number so the advances read plainly. */
const STALL_MS = 10_000;

/** Rows per history page. */
const PAGE = 1_000;

/** `conversations.history` is NEWEST-first, so page 0 carries the newest timestamp. */
const tsAt = ({ index }: { index: number }): string => `${1_800_000_000 - index}.000100`;

/**
 * A watchdog factory on a clock the test moves by hand.
 *
 * `advance` fires any armed deadline whose window has elapsed, exactly as `setTimeout` would — so a channel
 * that keeps answering keeps re-arming and never fires, and one that goes quiet does.
 */
function virtualDeadlines(): { factory: ChannelDeadlineFactory; advance: (args: { byMs: number }) => void } {
  let at = 0;
  const armed = new Set<{ dueAt: number; fire: () => void }>();
  const timer: DeadlineTimer = ({ onExpiry, timeoutMs }) => {
    const entry = { dueAt: at + timeoutMs, fire: onExpiry };
    armed.add(entry);
    return {
      release: () => {
        armed.delete(entry);
      },
      reset: () => {
        entry.dueAt = at + timeoutMs;
      },
    };
  };
  return {
    advance: ({ byMs }) => {
      at += byMs;
      // Deleting the current entry mid-iteration is safe on a Set, and `fire` only resolves a promise, so
      // nothing is armed while this runs.
      for (const entry of armed) {
        if (entry.dueAt <= at) {
          armed.delete(entry);
          entry.fire();
        }
      }
    },
    factory: () => channelProgressDeadline({ nowMs: () => at, timeoutMs: STALL_MS, timer }),
  };
}

/** How each conversation in a test workspace behaves. */
interface ChannelPlan {
  readonly id: string;
  /** Total rows its history holds. */
  readonly rows: number;
  /** Page index at which it stops answering forever; absent ⇒ it always answers. */
  readonly hangsAtPage?: number;
  /** Virtual milliseconds each page takes. */
  readonly perPageMs: number;
}

/** A workspace of planned conversations, on the virtual clock. */
function plannedApi({
  plans,
  advance,
}: {
  plans: readonly ChannelPlan[];
  advance: (args: { byMs: number }) => void;
}): SlackApi {
  const planFor = ({ id }: { id: string }): ChannelPlan => plans.find((plan) => plan.id === id)!;
  return {
    filesInfo: async ({ fileId }) => {
      throw new Error(`the crawl must not call files.info, but it did for ${fileId}`);
    },
    grantedScopes: async () => [],
    history: async ({ channel, cursor }) => {
      const plan = planFor({ id: channel });
      const page = cursor === undefined ? 0 : Number(cursor);
      if (plan.hangsAtPage === page) {
        // The measured signature: the crawl waits on a call that never answers and never opens a socket.
        advance({ byMs: STALL_MS + 1 });
        return new Promise<SlackMessagesPage>(() => undefined);
      }
      advance({ byMs: plan.perPageMs });
      const start = page * PAGE;
      const end = Math.min(start + PAGE, plan.rows);
      const messages = Array.from({ length: end - start }, (_unused, offset) => ({
        text: `${plan.id} row ${start + offset}`,
        ts: tsAt({ index: start + offset }),
        user: "U1",
      }));
      return end >= plan.rows ? { messages } : { messages, nextCursor: String(page + 1) };
    },
    listChannels: async () => ({
      channels: plans.map((plan) => ({ id: plan.id, is_member: true, name: plan.id.toLowerCase() })),
    }),
    listUsers: async () => ({ members: [{ id: "U1", profile: {}, real_name: "Ada" }] }),
    replies: async ({ ts }) => ({ messages: [{ text: "parent", ts, user: "U1" }] }),
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

/** What one crawl of a planned workspace produced. */
interface CrawlOutcome {
  readonly activity: Awaited<ReturnType<typeof fetchSlackActivity>>;
  readonly committed: string[];
  readonly prefixes: { channel: string; items: number }[];
  readonly events: SourceProgressEvent[];
}

/** Crawl a planned workspace, recording every commit, every prefix flush and every progress event. */
async function crawlPlanned({ plans }: { plans: readonly ChannelPlan[] }): Promise<CrawlOutcome> {
  const committed: string[] = [];
  const prefixes: { channel: string; items: number }[] = [];
  const events: SourceProgressEvent[] = [];
  const { advance, factory } = virtualDeadlines();
  const onChannelCommit: SlackChannelCommit = ({ channel, items }) => {
    committed.push(channel.id);
    return ok({ written: items.messages.length });
  };
  const onChannelPartialCommit: SlackChannelPartialCommit = ({ channel, items }) => {
    prefixes.push({ channel: channel.id, items: items.messages.length + items.replies.length });
    return ok({ written: items.messages.length });
  };
  const activity = await fetchSlackActivity({
    api: plannedApi({ advance, plans }),
    channelDeadline: factory,
    onChannelCommit,
    onChannelPartialCommit,
    onProgress: (event) => {
      events.push(event);
    },
    window,
  });
  return { activity, committed, events, prefixes };
}

/** The abandonment lines one crawl raised. */
const stallLines = ({ outcome }: { outcome: CrawlOutcome }): readonly string[] =>
  unwrap(outcome.activity).warnings.filter((warning) => warning.includes("ABANDONED"));

describe("a conversation that never answers its FIRST history call", () => {
  const plans: readonly ChannelPlan[] = [
    { id: "C_FIRST", perPageMs: 10, rows: PAGE },
    { hangsAtPage: 0, id: "C_HANG", perPageMs: 10, rows: PAGE * 4 },
    { id: "C_LAST", perPageMs: 10, rows: PAGE },
  ];

  it("is abandoned, and the crawl carries on to the next conversation", async () => {
    const outcome = await crawlPlanned({ plans });
    expect(outcome.committed).toEqual(["C_FIRST", "C_LAST"]);
  });

  it("claims NOTHING, so the next pass offers it a full backfill again", async () => {
    const activity = unwrap((await crawlPlanned({ plans })).activity);
    expect(activity.visitedChannels).toEqual(["C_FIRST", "C_LAST"]);
    expect(activity.fullHistoryChannels).toEqual(["C_FIRST", "C_LAST"]);
    expect(activity.channelSummaries.map((summary) => summary.channelId)).toEqual(["C_FIRST", "C_LAST"]);
    expect(activity.retainedChannels).toEqual([]);
  });

  it("logs exactly one structured line, naming the channel and the phase it froze in", async () => {
    const lines = stallLines({ outcome: await crawlPlanned({ plans }) });
    expect(lines).toEqual([
      "slack channel C_HANG ABANDONED: no page, thread or flush for 10001ms (window 10000ms) while " +
        "awaiting first-page — elapsed=10001ms pages=0 threads=0 rows=0; no watermark and no fullHistory " +
        "recorded, so the next pass retries it whole",
    ]);
  });

  it("names it as ABANDONED on the activity, so the refresh reports a coverage gap rather than exiting 0", async () => {
    const activity = unwrap((await crawlPlanned({ plans })).activity);
    expect(activity.abandonedChannels.map((channel) => channel.id)).toEqual(["C_HANG"]);
  });

  it("publishes the skip live, so a seven-hour pass is legible while it runs", async () => {
    const outcome = await crawlPlanned({ plans });
    const stall = outcome.events.find((event) => event.currentItem?.title.includes("ABANDONED") === true)!;
    expect(stall.metrics).toEqual({ messages: PAGE, skipped: 1, threads: 0 });
    expect(stall.done).toBe(2);
    expect(stall.total).toBe(3);
  });
});

describe("a conversation that freezes PART WAY through", () => {
  /** One flush (25,000 items) lands, then the very next page never answers. */
  const flushPages = SLACK_CHANNEL_FLUSH_ITEMS / PAGE;
  const plans: readonly ChannelPlan[] = [
    { hangsAtPage: flushPages, id: "C_PART", perPageMs: 10, rows: SLACK_CHANNEL_FLUSH_ITEMS * 4 },
    { id: "C_AFTER", perPageMs: 10, rows: PAGE },
  ];

  it("keeps the rows an earlier flush already banked", async () => {
    const outcome = await crawlPlanned({ plans });
    expect(outcome.prefixes).toEqual([{ channel: "C_PART", items: SLACK_CHANNEL_FLUSH_ITEMS }]);
  });

  it("still records no completion of any kind for it", async () => {
    const activity = unwrap((await crawlPlanned({ plans })).activity);
    expect(activity.visitedChannels).toEqual(["C_AFTER"]);
    expect(activity.fullHistoryChannels).toEqual(["C_AFTER"]);
  });

  it("names history-page rather than first-page, and reports what it got through", async () => {
    const lines = stallLines({ outcome: await crawlPlanned({ plans }) });
    expect(lines).toEqual([
      `slack channel C_PART ABANDONED: no page, thread or flush for 10001ms (window 10000ms) while ` +
        `awaiting history-page — elapsed=${String(flushPages * 10 + 10_001)}ms pages=${String(flushPages)} ` +
        `threads=0 rows=${String(SLACK_CHANNEL_FLUSH_ITEMS)}; no watermark and no fullHistory recorded, so ` +
        `the next pass retries it whole`,
    ]);
  });

  it("drops what it still HELD, so a hung conversation cannot pin a flush batch for the rest of the pass", async () => {
    const activity = unwrap((await crawlPlanned({ plans })).activity);
    expect(activity.retainedChannels).toEqual([]);
  });
});

describe("a slow but PROGRESSING conversation", () => {
  /** Every page lands with 1ms of the window to spare, over far more total time than the window itself. */
  const plans: readonly ChannelPlan[] = [
    { id: "C_SLOW", perPageMs: STALL_MS - 1, rows: PAGE * 8 },
    { id: "C_NEXT", perPageMs: 10, rows: PAGE },
  ];

  it("is never abandoned, however long the whole conversation takes", async () => {
    const outcome = await crawlPlanned({ plans });
    expect(stallLines({ outcome })).toEqual([]);
    expect(outcome.committed).toEqual(["C_SLOW", "C_NEXT"]);
  });

  it("is read in FULL — every page, not a prefix that a deadline cut short", async () => {
    const activity = unwrap((await crawlPlanned({ plans })).activity);
    const slow = activity.channelSummaries.find((summary) => summary.channelId === "C_SLOW")!;
    expect(slow.itemCount).toBe(PAGE * 8);
    expect(activity.fullHistoryChannels).toEqual(["C_SLOW", "C_NEXT"]);
  });
});

describe("a workspace where nothing hangs", () => {
  it("raises no skip line at all — a reported zero has to be a real zero", async () => {
    const outcome = await crawlPlanned({
      plans: [
        { id: "C_A", perPageMs: 5, rows: PAGE * 3 },
        { id: "C_B", perPageMs: 5, rows: PAGE },
      ],
    });
    expect(stallLines({ outcome })).toEqual([]);
    expect(unwrap(outcome.activity).abandonedChannels).toEqual([]);
    expect(outcome.committed).toEqual(["C_A", "C_B"]);
  });
});
