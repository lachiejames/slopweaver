/**
 * `landedCardTexts.ts` — the texts an ask or hand card drew when the owner's words landed on it, where a draft id it
 * named can sit. An ask once named a draft id in an option, and the question it showed was answered by the very
 * landing that took it off the owner's queue, so the question read is the one open AT the landing.
 */
import { describe, expect, it } from "vitest";

import {
  askCardTexts,
  handCardTexts,
  openedAskSlug,
  stepAtLanding,
} from "../../../../../cli/commands/supervisor/landedCardTexts.js";
import type { RunEvent } from "../../../../../handover/ledger.js";

const DOC = {
  blastRadius: undefined,
  lean: "A",
  options: [{ letter: "A", option: "send sd-e8de7674 as drafted", tradeoff: "it names the org" }],
  problem: "which organisation to ask",
  risk: undefined,
  slug: "organisation-hunt-2026-10-07",
  stillReal: undefined,
  summary: "the org hunt",
};

const LANDED = "2026-10-08T00:16:54.000Z";

describe("askCardTexts", () => {
  it("draws the doc's own shape when no question was ever open", () => {
    expect(askCardTexts({ doc: DOC, events: [], landedIso: LANDED })).toEqual([
      "organisation-hunt-2026-10-07",
      "the org hunt",
      "which organisation to ask",
      undefined,
      undefined,
      undefined,
      "send sd-e8de7674 as drafted",
      "it names the org",
      "A",
    ]);
  });

  it("keeps the question open at the landing even when the landing's own answer settles it the same instant", () => {
    const events: RunEvent[] = [
      { atIso: "2026-10-08T00:10:00.000Z", kind: "question", question: "send sd-c61d11e4 now?" },
      { answer: "Yes, send it today", atIso: LANDED, kind: "answered" },
    ];

    expect(askCardTexts({ doc: DOC, events, landedIso: LANDED })).toContain("send sd-c61d11e4 now?");
  });

  it("ignores a question asked after the card left the owner's queue — they never saw it", () => {
    const events: RunEvent[] = [{ atIso: "2026-10-08T00:20:00.000Z", kind: "question", question: "sd-c57b4ade?" }];

    expect(askCardTexts({ doc: DOC, events, landedIso: LANDED })).not.toContain("sd-c57b4ade?");
    expect(askCardTexts({ doc: DOC, events, landedIso: "2026-10-08T00:20:00.000Z" })).toContain("sd-c57b4ade?");
  });
});

describe("handCardTexts", () => {
  it("draws the step's own fields, in card order", () => {
    expect(
      handCardTexts({
        step: {
          unblocks: "sd-c57b4ade goes out",
          what: "say yes",
          where: "the Queue",
          witness: "w",
        },
      }),
    ).toEqual(["say yes", "the Queue", "sd-c57b4ade goes out", undefined, "w"]);
  });
});

describe("stepAtLanding", () => {
  const postings = [
    { postedIso: "2026-10-08T00:00:00.000Z", what: "approve sd-11112222" },
    { postedIso: "2026-10-08T00:10:00.000Z", what: "nothing to send now" },
  ];

  it("reads the posting the owner saw, not a repost after their yes", () => {
    expect(stepAtLanding({ landedIso: "2026-10-08T00:05:00.000Z", postings })!.what).toBe("approve sd-11112222");
    expect(stepAtLanding({ landedIso: "2026-10-08T00:10:00.000Z", postings })!.what).toBe("nothing to send now");
  });

  it("reads the earliest posting for a landing before every one, and nothing for none", () => {
    expect(stepAtLanding({ landedIso: "2026-10-07T23:59:00.000Z", postings })!.what).toBe("approve sd-11112222");
    expect(stepAtLanding({ landedIso: "2026-10-08T00:05:00.000Z", postings: [] })).toBe(undefined);
  });
});

describe("openedAskSlug", () => {
  it("reads the ask a step's link opens off its open parameter", () => {
    expect(openedAskSlug({ url: "http://127.0.0.1:4321/?open=ask:organisation-hunt-2026-10-07" })).toBe(
      "organisation-hunt-2026-10-07",
    );
  });

  it("answers undefined for no link, a link that does not parse, or one opening something else", () => {
    expect(
      [undefined, "not a url", "http://127.0.0.1:4321/?open=pr:1969", "http://127.0.0.1:4321/"].map((url) =>
        openedAskSlug({ url }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});
