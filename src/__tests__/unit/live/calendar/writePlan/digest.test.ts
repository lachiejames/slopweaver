/*
 * `buildCalendarWritePlan` — the digest's sensitivity: it moves for the attendees and the time a write sends, and
 * never for what the intent records about its own approval. It moved here when the write plan's one test file was
 * split by behaviour.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../../lib/result.js";
import { buildCalendarWritePlan } from "../../../../../live/calendar/writePlan.js";
import { BOOK, intentFor, ZONE } from "./harness.js";

describe("buildCalendarWritePlan", () => {
  it("moves the digest when the attendees change, and when the time changes, and not otherwise", () => {
    const base = unwrap(buildCalendarWritePlan({ intent: intentFor({ form: BOOK }), zone: ZONE }));
    const same = unwrap(buildCalendarWritePlan({ intent: intentFor({ form: BOOK }), zone: ZONE }));
    const withGuest = unwrap(
      buildCalendarWritePlan({ intent: intentFor({ form: { ...BOOK, attendees: ["a@x.test"] } }), zone: ZONE }),
    );
    const moved = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({ form: { ...BOOK, span: { ...BOOK.span, start: "2026-09-20T11:00" } } }),
        zone: ZONE,
      }),
    );
    expect(same.digest).toBe(base.digest);
    expect(withGuest.digest).not.toBe(base.digest);
    expect(moved.digest).not.toBe(base.digest);
  });

  it("does not move the digest for what the intent RECORDS about its approval, only for what it sends", () => {
    // An anchored commit compares the rebuilt digest with the stored preview's; were these fields digested, writing
    // them would itself be the drift that refuses the send.
    const base = unwrap(buildCalendarWritePlan({ intent: intentFor({ form: BOOK }), zone: ZONE }));
    const recorded = unwrap(
      buildCalendarWritePlan({
        intent: {
          ...intentFor({ form: BOOK }),
          approvedBy: { anchor: "talk-call:c1#s1", atIso: "2026-10-12T00:19:00.000Z" },
          previewDigest: "0000000000000000",
        },
        zone: ZONE,
      }),
    );
    expect(recorded.digest).toBe(base.digest);
  });
});
