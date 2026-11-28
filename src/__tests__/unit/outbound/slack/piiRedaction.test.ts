import { describe, expect, it } from "vitest";

import { safeJsonStringify } from "../../../../lib/safeJson.js";
import { renderAssistantMessage } from "../../../../outbound/assistant/answerMessage.js";
import { carriesPii, redactionLine, redactPayload, redactPii } from "../../../../outbound/slack/piiRedaction.js";
import { renderRecipeResponse } from "../../../../outbound/slack/recipeResponse.js";
import { NO_MENTIONS, renderUpdateCard } from "../../../../outbound/slack/render.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";

/** One chrome, so a rendered card is a value a test can assert rather than a profile read. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "slopweaver",
  bannerColor: "#3B3A8C",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_update_v1",
};

describe("redactPii — the narrow class, and the line it deliberately does not cross", () => {
  it("redacts an email address", () => {
    expect(redactPii({ text: "raised by a.person@example.com today" }).text).toBe("raised by [email] today");
  });

  it("redacts an IPv4 address", () => {
    expect(redactPii({ text: "from 203.0.113.7 at 14:02" }).text).toBe("from [ip] at 14:02");
  });

  it("redacts an IPv6 address", () => {
    expect(redactPii({ text: "from 2001:db8:85a3::8a2e:370:7334 ok" }).text).toBe("from [ip] ok");
  });

  it("redacts an IPv4-mapped IPv6 address WHOLE, which ordering the passes the other way would half-do", () => {
    expect(redactPii({ text: "peer ::ffff:203.0.113.7 closed" }).text).toBe("peer [ip] closed");
  });

  it("leaves a UUID alone — it is routinely the answer, and the owner's IP-to-uid move ends in one", () => {
    const text = "the uid is 01d0a8c3-1c3e-4cc4-956b-9b1c6e2fefe3";
    expect(redactPii({ text }).text).toBe(text);
  });

  it("leaves a version string alone, which an unbounded three-digit pattern would have eaten", () => {
    expect(redactPii({ text: "node 24.11.1 and 1.2.300.4" }).text).toBe("node 24.11.1 and 1.2.300.4");
  });

  it("leaves a job name alone — its class is contact data, never a name the reader already shares", () => {
    expect(redactPii({ text: "acme-nightly-job-sync-partners is red" }).text).toBe(
      "acme-nightly-job-sync-partners is red",
    );
  });

  it("counts what it replaced, per kind", () => {
    const done = redactPii({ text: "a@b.com and c@d.com from 203.0.113.7" });
    expect(done.redactions).toEqual([
      { count: 2, kind: "email" },
      { count: 1, kind: "ipv4" },
    ]);
  });

  it("reports no redactions on clean text", () => {
    expect(redactPii({ text: "nothing to see" }).redactions).toEqual([]);
  });
});

describe("redactPii — an email address whose local part is quoted", () => {
  const ONE_EMAIL = [{ count: 1, kind: "email" }];

  it("redacts a quoted local part carrying a space, whole", () => {
    expect(redactPii({ text: 'raised by "jane doe"@example.com today' })).toEqual({
      redactions: ONE_EMAIL,
      text: "raised by [email] today",
    });
  });

  it("redacts a quoted local part carrying a dot, leaving no quoted fragment behind", () => {
    expect(redactPii({ text: '"jane.doe"@example.com' })).toEqual({ redactions: ONE_EMAIL, text: "[email]" });
  });

  it("redacts a quoted local part carrying an at-sign as ONE address", () => {
    expect(redactPii({ text: '"a@b"@example.com' })).toEqual({ redactions: ONE_EMAIL, text: "[email]" });
  });

  it("redacts a quoted local part carrying an escaped quote", () => {
    expect(redactPii({ text: '"jane\\"doe"@example.com' })).toEqual({ redactions: ONE_EMAIL, text: "[email]" });
  });

  it("redacts an empty quoted local part, which the RFC grammar admits", () => {
    expect(redactPii({ text: '""@example.com' })).toEqual({ redactions: ONE_EMAIL, text: "[email]" });
  });

  it("is seen by carriesPii, so the pull request quote slot refuses it too", () => {
    expect(carriesPii({ text: '"jane doe"@example.com' })).toBe(true);
  });

  it("redacts both halves of a Slack mailto link", () => {
    expect(redactPii({ text: '<mailto:"jane doe"@example.com|"jane doe"@example.com>' })).toEqual({
      redactions: [{ count: 2, kind: "email" }],
      text: "<mailto:[email]|[email]>",
    });
  });

  it("leaves ordinary quoted prose alone, since no domain follows the closing quote", () => {
    expect(redactPii({ text: 'they said "hi" and left' })).toEqual({
      redactions: [],
      text: 'they said "hi" and left',
    });
  });

  it("never lets a quote cross a line ending", () => {
    const text = 'before "first line\nsecond"@example.com after';
    expect(redactPii({ text })).toEqual({ redactions: [], text });
  });

  it("redacts a quoted local part at the 62-character cap", () => {
    expect(redactPii({ text: `"${"a".repeat(62)}"@example.com` })).toEqual({ redactions: ONE_EMAIL, text: "[email]" });
  });

  it("stops one character past the cap, so a stray quote pair cannot swallow a sentence", () => {
    const text = `"${"a".repeat(63)}"@example.com`;
    expect(redactPii({ text })).toEqual({ redactions: [], text });
  });
});

describe("carriesPii — the same answer twice, which a shared g-flagged regex would not give", () => {
  it("answers true both times for the same string", () => {
    const text = "from 203.0.113.7";
    expect(carriesPii({ text })).toBe(true);
    expect(carriesPii({ text })).toBe(true);
  });

  it("answers false for clean text", () => {
    expect(carriesPii({ text: "no identity here" })).toBe(false);
  });
});

describe("redactPayload — the walk every send path's rendered payload crosses", () => {
  it("redacts a string nested inside blocks and leaves the structure alone", () => {
    const done = redactPayload({
      value: { attachments: [{ blocks: [{ text: "seen from 203.0.113.7", type: "section" }] }], text: "" },
    });
    expect(done.value).toEqual({
      attachments: [{ blocks: [{ text: "seen from [ip]", type: "section" }] }],
      text: "",
    });
  });

  it("never redacts an object KEY, only a value", () => {
    const done = redactPayload({ value: { "a@b.com": "clean" } });
    expect(Object.keys(done.value as Record<string, unknown>)).toEqual(["a@b.com"]);
  });

  it("leaves numbers and booleans untouched", () => {
    expect(redactPayload({ value: { count: 3, on: true } }).value).toEqual({ count: 3, on: true });
  });

  it("totals the redactions across the whole payload", () => {
    const done = redactPayload({ value: ["a@b.com", { deep: "c@d.com" }] });
    expect(done.redactions).toEqual([{ count: 2, kind: "email" }]);
  });
});

describe("redactionLine", () => {
  it("names what it replaced", () => {
    expect(redactionLine({ redactions: [{ count: 2, kind: "email" }] })).toContain("2 email");
  });

  it("says nothing when it replaced nothing", () => {
    expect(redactionLine({ redactions: [] })).toBe(null);
  });
});

describe("redactPii — the false positives a pass on EVERY outbound message must not have", () => {
  it("leaves an ISO timestamp alone", () => {
    const text = "at 2026-09-13T20:09:04.503Z the job ran";
    expect(redactPii({ text }).text).toBe(text);
  });

  it("leaves a bare clock time alone", () => {
    expect(redactPii({ text: "the rollup was read at 18:15Z" }).text).toBe("the rollup was read at 18:15Z");
  });

  it("leaves a Slack ts alone", () => {
    const text = "c-random:1000000000.000001";
    expect(redactPii({ text }).text).toBe(text);
  });

  it("leaves a URL with a port alone", () => {
    const text = "http://localhost:5432/db";
    expect(redactPii({ text }).text).toBe(text);
  });

  it("leaves a Datadog query alone", () => {
    const text = 'env:production service:core-api "[sessionTypeForBooking]"';
    expect(redactPii({ text }).text).toBe(text);
  });
});

describe("the answer path crosses the pass — the half that was BROKEN when review first asked", () => {
  it("redacts an email inside a rendered assistant answer, which never calls renderUpdateCard", () => {
    const payload = renderAssistantMessage({
      artifact: {
        citations: [],
        detail: [],
        index: [],
        kind: "update",
        media: [],
        tldr: "a.person@example.com was seen from 203.0.113.7",
      },
      chrome: CHROME,
      mentions: NO_MENTIONS,
    });
    const rendered = safeJsonStringify({ label: "answer", value: payload });
    expect(rendered).toContain("[email]");
    expect(rendered).toContain("[ip]");
    expect(rendered).not.toContain("a.person@example.com");
    expect(rendered).not.toContain("203.0.113.7");
  });

  it("redacts an email inside the operator card too, which is the path that already crossed it", () => {
    const artifact = {
      citations: [],
      detail: [],
      index: [],
      kind: "update",
      media: [],
      tldr: "mailed b.person@example.com",
    } as const;
    const payload = renderUpdateCard({ artifact, artifactFingerprint: "abc", chrome: CHROME, mentions: NO_MENTIONS });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(safeJsonStringify({ label: "artifact", value: artifact })).toContain("b.person@example.com");
    expect(safeJsonStringify({ label: "card", value: payload })).not.toContain("b.person@example.com");
  });

  it("leaves the card's structural literals alone — an empty text and a one-element attachments tuple", () => {
    const payload = renderUpdateCard({
      artifact: { citations: [], detail: [], index: [], kind: "update", media: [], tldr: "clean" },
      artifactFingerprint: "abc",
      chrome: CHROME,
      mentions: NO_MENTIONS,
    });
    expect(payload.text).toBe("");
    expect(payload.attachments.length).toBe(1);
    expect(payload.attachments[0].color).toBe(CHROME.bannerColor);
  });
});

describe("renderRecipeResponse — a wrapper read off disk crosses the pass too", () => {
  it("redacts an email and an IP in a card `recipe slot-post` was handed, never having rendered it", () => {
    const payload = renderRecipeResponse({
      anchor: {
        idempotencyKey: "key-1",
        runId: "run-1",
        slotHash: "slot-1",
        targetChannel: "C1",
        targetThreadTs: undefined,
      },
      wrapper: {
        blocks: [
          {
            text: { text: "a.person@example.com hit from 203.0.113.7", type: "mrkdwn" },
            type: "section",
          },
        ],
        color: "#8B5CF6",
        fallback: "reply to a.person@example.com",
      },
    });
    const written = safeJsonStringify({ label: "recipe response", value: payload });
    expect(written).not.toContain("a.person@example.com");
    expect(written).not.toContain("203.0.113.7");
    expect(written).toContain("[email]");
    expect(written).toContain("[ip]");
  });

  it("leaves the recipe response's structural literals alone", () => {
    const payload = renderRecipeResponse({
      anchor: {
        idempotencyKey: "key-1",
        runId: "run-1",
        slotHash: "slot-1",
        targetChannel: "C1",
        targetThreadTs: undefined,
      },
      wrapper: { blocks: [], color: "#8B5CF6", fallback: "clean" },
    });
    expect(payload.text).toBe("");
    expect(payload.attachments.length).toBe(1);
    expect(payload.attachments[0].color).toBe("#8B5CF6");
    expect(payload.metadata.event_payload.idempotencyKey).toBe("key-1");
  });
});
