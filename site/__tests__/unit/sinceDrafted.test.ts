/*
 * The words a held draft's card says about the world moving since the draft was written, over the measurement the
 * verb hands it (`src/live/slack/draftContextSince.ts`).
 */

import { describe, expect, it } from "vitest";

import type { ContextMessage, DraftSinceDrafted } from "../../components/live/readDraftContext";
import type { DraftRun } from "../../components/live/readSlackDraftsRuns";
import { SINCE_DRAFTED_WORDS, sinceDraftedView } from "../../lib/sinceDrafted";
import type { SlackPeople } from "../../lib/slackPeople";

const PEOPLE: SlackPeople = new Map([
  ["U0KYLE", { handle: "kyle", name: "Kyle Ng" }],
  ["U0ARI", { handle: "ari", name: "Ari Shepard" }],
]);

/** A plain text run. */
function text({ words }: { words: string }): DraftRun {
  return { bold: false, code: false, italic: false, kind: "text", text: words };
}

/** One message of the conversation; `over` replaces any field. */
function message({ ts, over = {} }: { ts: string; over?: Partial<ContextMessage> }): ContextMessage {
  return {
    bot: false,
    edited: false,
    fileCount: 0,
    lines: [{ frame: undefined, marker: undefined, runs: [text({ words: `said at ${ts}` })] }],
    permalink: `https://acme.slack.com/archives/C0CHAN/p${ts.replace(".", "")}`,
    replyCount: 0,
    ts,
    tsIso: "2026-10-04T01:00:00.000Z",
    userId: "U0KYLE",
    username: undefined,
    ...over,
  };
}

/** A measurement; `over` replaces any field. */
function measured({
  over = {},
}: { over?: Partial<Extract<DraftSinceDrafted, { kind: "measured" }>> } = {}): DraftSinceDrafted {
  return {
    added: [],
    draftedIso: "2026-10-04T01:00:00.000Z",
    edited: [],
    kind: "measured",
    limits: [],
    removed: [],
    ...over,
  };
}

describe("sinceDraftedView", () => {
  it("says plainly that nothing changed when the read covers everything since", () => {
    expect(sinceDraftedView({ age: "10.3h ago", messages: [], people: PEOPLE, reading: measured() })).toEqual({
      changed: false,
      changes: [],
      kind: "measured",
      limits: [],
      removedLine: undefined,
      summary: "Nothing has changed here since this was drafted 10.3h ago",
    });
  });

  it("never claims nothing changed when the read said what it could not see", () => {
    const limits = ["Only the newest messages were read, so an edit or removal further back would not show here."];
    const view = sinceDraftedView({
      age: "10.3h ago",
      messages: [],
      people: PEOPLE,
      reading: measured({ over: { limits } }),
    });
    expect(view).toEqual({
      changed: false,
      changes: [],
      kind: "measured",
      limits,
      removedLine: undefined,
      summary: "No changes found in this read since this was drafted 10.3h ago",
    });
  });

  it("counts each kind of change and lists the new and edited messages in the order they happened", () => {
    const messages = [
      message({ over: { userId: "U0ARI" }, ts: "1790000100.000100" }),
      message({ ts: "1790000200.000200" }),
      message({
        over: {
          lines: [
            {
              frame: undefined,
              marker: undefined,
              runs: [{ kind: "user", userId: "U0ARI" }, text({ words: "  can you   look again" })],
            },
          ],
        },
        ts: "1790000300.000300",
      }),
    ];
    const view = sinceDraftedView({
      age: "2.0h ago",
      messages,
      people: PEOPLE,
      reading: measured({
        over: {
          added: ["1790000200.000200", "1790000300.000300"],
          edited: ["1790000100.000100"],
          removed: ["1790000050.000050"],
        },
      }),
    });
    expect(view).toEqual({
      changed: true,
      changes: [
        {
          kind: "edited",
          line: "Ari Shepard edited: said at 1790000100.000100",
          permalink: "https://acme.slack.com/archives/C0CHAN/p1790000100000100",
          ts: "1790000100.000100",
        },
        {
          kind: "added",
          line: "Kyle Ng wrote: said at 1790000200.000200",
          permalink: "https://acme.slack.com/archives/C0CHAN/p1790000200000200",
          ts: "1790000200.000200",
        },
        {
          kind: "added",
          line: "Kyle Ng wrote: @Ari Shepard can you look again",
          permalink: "https://acme.slack.com/archives/C0CHAN/p1790000300000300",
          ts: "1790000300.000300",
        },
      ],
      kind: "measured",
      limits: [],
      removedLine: "1 message was removed",
      summary: "Since this was drafted 2.0h ago: 2 new messages, 1 edited, 1 removed",
    });
  });

  it("says one new message in the singular, marks a partial read, and names an app and a message with no text", () => {
    const words = Array.from({ length: SINCE_DRAFTED_WORDS + 3 }, (_, at) => `w${String(at)}`).join(" ");
    const messages = [
      message({ over: { userId: undefined, username: "deploy-bot" }, ts: "1790000100.000100" }),
      message({ over: { lines: [], userId: undefined }, ts: "1790000200.000200" }),
      message({
        over: { lines: [{ frame: undefined, marker: undefined, runs: [text({ words })] }] },
        ts: "1790000300.000300",
      }),
    ];
    const view = sinceDraftedView({
      age: "5m ago",
      messages,
      people: PEOPLE,
      reading: measured({
        over: {
          added: ["1790000300.000300"],
          edited: ["1790000100.000100", "1790000200.000200"],
          limits: ["partial"],
          removed: ["1", "2"],
        },
      }),
    });
    expect(view).toEqual({
      changed: true,
      changes: [
        {
          kind: "edited",
          line: "deploy-bot edited: said at 1790000100.000100",
          permalink: "https://acme.slack.com/archives/C0CHAN/p1790000100000100",
          ts: "1790000100.000100",
        },
        {
          kind: "edited",
          line: "an app edited: a message with no text Slack could give",
          permalink: "https://acme.slack.com/archives/C0CHAN/p1790000200000200",
          ts: "1790000200.000200",
        },
        {
          kind: "added",
          line: `Kyle Ng wrote: ${words.split(" ").slice(0, SINCE_DRAFTED_WORDS).join(" ")}…`,
          permalink: "https://acme.slack.com/archives/C0CHAN/p1790000300000300",
          ts: "1790000300.000300",
        },
      ],
      kind: "measured",
      limits: ["partial"],
      removedLine: "2 messages were removed",
      summary: "Since this was drafted 5m ago: 1 new message, 2 edited, 2 removed (partial read)",
    });
  });

  it("says it could not tell, with the verb's reason, when nothing could be measured", () => {
    const reading: DraftSinceDrafted = { kind: "not-measured", why: "its recording instant x is not a date" };
    expect(sinceDraftedView({ age: "1.0h ago", messages: [], people: PEOPLE, reading })).toEqual({
      kind: "not-measured",
      summary: "Could not tell what changed since this was drafted",
      why: "its recording instant x is not a date",
    });
  });
});
