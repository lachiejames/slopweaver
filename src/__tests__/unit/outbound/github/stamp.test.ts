/**
 * The one check a write makes against the door's own clock. A C3 description carries no write stamp, so the
 * property that matters is that accepting a draft changes nothing in it: a `--pull` then `--file` round trip with no
 * edits renders the same bytes on any day, and stays a no-op on its own.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { PrBodyErrors } from "../../../../outbound/github/errors.js";
import { renderPrBody } from "../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../outbound/github/stamp.js";
import type { PrForm } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, formOf, t } from "./fixtures.js";

/** The fix form, its problem seen on the fixture's own day. */
const FIX: PrForm = formOf({ body: FIX_BODY });

describe("stampForWrite — accepting a draft changes nothing in it", () => {
  it("returns the draft unchanged on the day it was seen and on a later day", () => {
    expect([
      unwrap(stampForWrite({ draft: FIX, today: "2026-11-16" })),
      unwrap(stampForWrite({ draft: FIX, today: "2027-01-01" })),
    ]).toStrictEqual([FIX, FIX]);
  });

  it("renders the same bytes whatever day the write happens, so a no-edit round trip is a no-op", () => {
    const earlier = unwrap(renderPrBody({ form: unwrap(stampForWrite({ draft: FIX, today: "2026-11-16" })) }));
    const later = unwrap(renderPrBody({ form: unwrap(stampForWrite({ draft: FIX, today: "2026-12-25" })) }));
    expect(later).toBe(earlier);
  });

  it("accepts a problem not seen yet on any day, since it names no day to judge", () => {
    const feature = formOf({ body: FEATURE_BODY });
    expect(unwrap(stampForWrite({ draft: feature, today: "2000-01-01" }))).toStrictEqual(feature);
  });

  it("accepts a seen day that exists only in a leap year", () => {
    const draft: PrForm = { ...FIX, problemSeen: { by: "owner", kind: "seen", on: "2024-02-29", what: "it broke" } };
    expect(unwrap(stampForWrite({ draft, today: "2026-11-18" }))).toStrictEqual(draft);
  });
});

describe("stampForWrite — a real change is written as it stands, and is not a no-op", () => {
  const UNCHANGED = unwrap(renderPrBody({ form: FIX }));

  it("carries a changed section through, and the description it renders differs", () => {
    const draft: PrForm = { ...FIX, explainer: t({ text: "A different explainer." }) };
    const accepted = unwrap(stampForWrite({ draft, today: "2026-11-18" }));
    expect(accepted).toStrictEqual(draft);
    expect(unwrap(renderPrBody({ form: accepted }))).not.toBe(UNCHANGED);
  });

  it("carries a changed title through, while the description it renders is untouched by it", () => {
    const accepted = unwrap(stampForWrite({ draft: { ...FIX, title: "A new title" }, today: "2026-11-18" }));
    expect(accepted.title).toBe("A new title");
    expect(unwrap(renderPrBody({ form: accepted }))).toBe(UNCHANGED);
  });

  it("accepts a seen day moved earlier, which changes the description", () => {
    const draft: PrForm = {
      ...FIX,
      problemSeen: { by: "agent", kind: "seen", on: "2026-11-02", what: "the store accepted the default password" },
    };
    const accepted = unwrap(stampForWrite({ draft, today: "2026-11-18" }));
    expect(accepted).toStrictEqual(draft);
    expect(unwrap(renderPrBody({ form: accepted }))).not.toBe(UNCHANGED);
  });
});

describe("stampForWrite — a seen day the clock cannot accept is refused", () => {
  it("refuses a problem seen after the day it would be written, naming both days", () => {
    const error = unwrapErr(stampForWrite({ draft: FIX, today: "2026-11-15" }));
    expect([error.code, error.message]).toStrictEqual([
      "SEEN_AFTER_TODAY",
      "the problem is marked seen on 2026-11-16, after today (2026-11-15). A problem seen today is seen today, never later",
    ]);
  });

  it("refuses a seen day that is not a real calendar day", () => {
    const draft: PrForm = { ...FIX, problemSeen: { by: "agent", kind: "seen", on: "2026-02-30", what: "it broke" } };
    const error = unwrapErr(stampForWrite({ draft, today: "2026-11-18" }));
    expect([error.code, error.message]).toStrictEqual([
      "INVALID_DAY",
      'problemSeen.on is "2026-02-30", which is not a real YYYY-MM-DD calendar day',
    ]);
  });

  it("carries both days on the refusal as fields, not only in its message", () => {
    expect(unwrapErr(stampForWrite({ draft: FIX, today: "2026-11-15" }))).toStrictEqual(
      PrBodyErrors.seenAfterToday({ on: "2026-11-16", today: "2026-11-15" }),
    );
  });

  it("refuses an unreal seen day before consulting the clock, even when today is far earlier", () => {
    const draft: PrForm = { ...FIX, problemSeen: { by: "agent", kind: "seen", on: "2026-13-01", what: "it broke" } };
    expect(unwrapErr(stampForWrite({ draft, today: "2000-01-01" }))).toStrictEqual(
      PrBodyErrors.invalidDay({ field: "problemSeen.on", value: "2026-13-01" }),
    );
  });

  it("refuses a seen day that is not zero-padded YYYY-MM-DD", () => {
    const draft: PrForm = { ...FIX, problemSeen: { by: "agent", kind: "seen", on: "2026-1-5", what: "it broke" } };
    expect(unwrapErr(stampForWrite({ draft, today: "2026-11-18" }))).toStrictEqual(
      PrBodyErrors.invalidDay({ field: "problemSeen.on", value: "2026-1-5" }),
    );
  });
});
