/**
 * `draftCompareBrief.ts` and `draftCompareRun.ts` — the lines A's session wrote or chose are held to the quote check
 * before a pass is handed them, and the composing host is read off the recording session's environment.
 */
import { describe, expect, it } from "vitest";

import { authoredQuotesDraft } from "../../../../../cli/commands/slack/draftCompareBrief.js";
import { draftComposerOf } from "../../../../../cli/commands/slack/draftCompareRun.js";
import type { ParkedPriorAsk } from "../../../../../outbound/slack/draftRegister.js";

const PAYLOAD = { form: "plain" as const, text: "When can we ship?", unfurl_links: false, unfurl_media: false };

/** An earlier ask whose own message is `text`, with nobody replying. */
function priorAsk({ text }: { text: string }): ParkedPriorAsk {
  return {
    answerCount: 0,
    answers: [],
    kind: "prior",
    notAnswered: "nobody replied",
    ours: { text, ts: "1790000000.000100", userId: "U0HIM" },
    permalink: "https://acme.slack.com/archives/C1/p1790000000000100",
    readThroughTs: "1790000000.000100",
  };
}

/** A top-level row in one channel, carrying {@link PAYLOAD}. */
const AT = { channel: "C0SYNRELEASE", payload: PAYLOAD };

describe("authoredQuotesDraft", () => {
  it("catches the original carried in the re-ask declaration, where the purpose is clean", () => {
    const draft = { ...AT, priorAsk: priorAsk({ text: "When can we ship?" }), why: "follow up on timing" };
    expect(authoredQuotesDraft({ draft })).toBe(true);
  });

  it("catches a purpose quoting the original with no declaration", () => {
    expect(authoredQuotesDraft({ draft: { ...AT, why: "ask: when can we ship" } })).toBe(true);
  });

  it("passes clean lines, and a declaration of never asked", () => {
    const earlier = priorAsk({ text: "is the release on track?" });
    expect(authoredQuotesDraft({ draft: { ...AT, priorAsk: earlier, why: "follow up on timing" } })).toBe(false);
    const none: ParkedPriorAsk = { kind: "none" };
    expect(authoredQuotesDraft({ draft: { ...AT, priorAsk: none, why: "follow up on timing" } })).toBe(false);
  });

  it("catches an A that is only the act word, since the prompt states the act too", () => {
    const reply = { ...PAYLOAD, text: "reply" };
    expect(authoredQuotesDraft({ draft: { ...AT, act: "reply", payload: reply, why: "acknowledge request" } })).toBe(
      true,
    );
    expect(authoredQuotesDraft({ draft: { ...AT, act: "reply", why: "acknowledge request" } })).toBe(false);
  });

  it("catches an A the destination line carries: its channel, name or thread", () => {
    const only = ({ text }: { text: string }): typeof PAYLOAD => ({ ...PAYLOAD, text });
    const why = "announce status";
    expect([
      authoredQuotesDraft({ draft: { channel: "C0SYN1234567", payload: only({ text: "C0SYN1234567" }), why } }),
      authoredQuotesDraft({
        draft: { ...AT, channelName: "release-train", payload: only({ text: "release train" }), why },
      }),
      authoredQuotesDraft({
        draft: { ...AT, payload: only({ text: "1790000000.000100" }), threadTs: "1790000000.000100", why },
      }),
      authoredQuotesDraft({ draft: { ...AT, channelName: "release-train", why } }),
    ]).toEqual([true, true, true, false]);
  });
});

describe("draftComposerOf", () => {
  it("names the one host the recording session ran on, and undetected when none or both leaked in", () => {
    expect([
      draftComposerOf({ env: { CLAUDE_CODE_SESSION_ID: "c1" } }),
      draftComposerOf({ env: { CODEX_THREAD_ID: "t1" } }),
      draftComposerOf({ env: {} }),
      draftComposerOf({ env: { CLAUDE_CODE_SESSION_ID: "c1", CODEX_THREAD_ID: "t1" } }),
    ]).toEqual(["claude-code", "codex", "undetected", "undetected"]);
  });
});
