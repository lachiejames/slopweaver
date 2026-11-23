/**
 * `draftComparisonReport.ts` — what `slack draft list` and `show` print about a row's comparison, state by state.
 */
import { describe, expect, it } from "vitest";

import { comparisonMark, comparisonShowLines } from "../../../../../cli/commands/slack/draftComparisonReport.js";
import type { ParkedDraftPayload, SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";

const AT = "2026-10-09T11:07:00.000Z";

/** A body renderer that prints the payload's own text, so a test reads which words were drawn. */
const bodyOf = ({ payload }: { payload: ParkedDraftPayload }): readonly string[] => [`body: ${payload.text}`];

/** A held as-me row carrying `fields` over its own words. */
function row({ fields = {} }: { fields?: Partial<SlackDraftItem> } = {}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel: "C0123456789",
      digest: "digest of claude words",
      form: "{}",
      id: "sd-11112222",
      mentions: [],
      payload: { form: "plain", text: "claude words", unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso: "2026-10-09T11:06:00.000Z",
      why: "reply to Seth",
    },
    id: "sd-11112222",
    state: "held",
    ...fields,
  };
}

const READY: SlackDraftItem["comparison"] = {
  atIso: AT,
  candidate: {
    advisory: [],
    digest: "digest of codex words",
    form: "{}",
    mentions: [],
    payload: { form: "plain", text: "codex words", unfurl_links: false, unfurl_media: false },
  },
  elapsedMs: 4200,
  requestedModel: "gpt-test",
  state: "ready",
};

describe("comparisonMark", () => {
  it("leads a row whose pick is owed, and nothing else", () => {
    expect(comparisonMark({ item: row({ fields: { comparison: READY } }) })).toBe("PICK OWED · ");
    expect(comparisonMark({ item: row({ fields: { comparison: { state: "pending" } } }) })).toBe("CODEX DRAFT OWED · ");
    expect(comparisonMark({ item: row() })).toBe("");
  });
});

describe("comparisonShowLines", () => {
  it("prints nothing for a row that never owed one", () => {
    expect(comparisonShowLines({ bodyOf, item: row() })).toEqual([]);
  });

  it("names the retry on a pending or unavailable row, and the reason on a skipped one", () => {
    expect(comparisonShowLines({ bodyOf, item: row({ fields: { comparison: { state: "pending" } } }) })).toEqual([
      "",
      "codex    a draft beside this one is owed, and neither is sent before it is shown: " +
        "slopweaver slack draft compare sd-11112222",
    ]);
    const unavailable = { atIso: AT, reason: "capped", state: "unavailable" } as const;
    expect(comparisonShowLines({ bodyOf, item: row({ fields: { comparison: unavailable } }) })).toEqual([
      "",
      "codex    no draft yet — capped. Retry: slopweaver slack draft compare sd-11112222",
    ]);
    const skipped = { reason: "has-media", state: "skipped" } as const;
    expect(comparisonShowLines({ bodyOf, item: row({ fields: { comparison: skipped } }) })).toEqual([
      "",
      "codex    no draft beside this one (has-media)",
    ]);
  });

  it("lists every reason a refused candidate failed on", () => {
    const refused = { atIso: AT, reasons: ["banned word: of"], stage: "voice-rules", state: "refused" } as const;
    expect(comparisonShowLines({ bodyOf, item: row({ fields: { comparison: refused } }) })).toEqual([
      "",
      "codex    its draft was refused at voice-rules:",
      "banned word: of",
    ]);
  });

  it("draws Codex's words and the choose-first refusal while the owner's pick is owed", () => {
    const lines = comparisonShowLines({ bodyOf, item: row({ fields: { comparison: READY } }) });
    expect(lines.slice(0, 3)).toEqual([
      "",
      "— Codex's draft beside it (gpt-test), digest digest of codex words —",
      "body: codex words",
    ]);
    expect(lines.at(-1)).toContain("choose first: slopweaver slack draft approve sd-11112222");
  });

  it("prints the pick, and the original it replaced on a Codex pick", () => {
    const original = {
      advisory: [],
      digest: "digest of claude words",
      form: "{}",
      mentions: [],
      payload: { form: "plain" as const, text: "claude words", unfurl_links: false, unfurl_media: false },
    };
    const voice = { anchor: "talk:abc#t1", atIso: AT, heard: "the second one" };
    const pick = { atIso: AT, model: "gpt-test", variant: "codex" as const, voice };
    expect(comparisonShowLines({ bodyOf, item: row({ fields: { comparison: READY, original, pick } }) })).toEqual([
      "",
      `picked   the codex draft at ${AT} over gpt-test — heard "the second one" (talk:abc#t1)`,
      "— the original it replaced on sd-11112222, digest digest of claude words —",
      "body: claude words",
    ]);
  });
});
