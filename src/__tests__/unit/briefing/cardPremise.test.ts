import { describe, expect, it } from "vitest";

import {
  premiseAgeHours,
  premiseAgeLine,
  premiseInstant,
  premiseRefusal,
  stillAsks,
  unusablePremiseInstant,
} from "../../../briefing/cardPremise.js";

const NOW = "2026-09-11T21:18:59Z";

describe("premiseInstant", () => {
  it("dates an artifact card from when the page LANDED, not from when it last moved", () => {
    const premise = {
      kind: "artifact" as const,
      landedIso: "2026-09-10T20:03:23Z",
      updatedIso: "2026-09-11T20:00:00Z",
    };

    expect(premiseInstant({ premise })).toBe("2026-09-10T20:03:23Z");
  });

  it("dates a pull-request card from when its state was read", () => {
    expect(premiseInstant({ premise: { kind: "pull-request", observedIso: "2026-09-11T09:00:00Z" } })).toBe(
      "2026-09-11T09:00:00Z",
    );
  });

  it("dates a hand-written card from when its composer checked the world", () => {
    expect(premiseInstant({ premise: { kind: "composed", readIso: "2026-09-11T21:12:00Z" } })).toBe(
      "2026-09-11T21:12:00Z",
    );
  });
});

describe("premiseAgeHours", () => {
  it("measures the Eight-Hour Clock card the owner called stale at the age they saw it", () => {
    const premise = { kind: "artifact" as const, landedIso: "2026-09-10T20:03:23Z" };

    expect(premiseAgeHours({ nowIso: NOW, premise })).toBe(25);
  });

  it("measures the oldest card on that page, the page the owner had deferred", () => {
    const premise = { kind: "artifact" as const, landedIso: "2026-09-01T00:00:00Z" };

    expect(premiseAgeHours({ nowIso: NOW, premise })).toBe(261);
  });

  it("floors to zero for a premise read in the same hour", () => {
    const premise = { kind: "composed" as const, readIso: "2026-09-11T20:30:00Z" };

    expect(premiseAgeHours({ nowIso: NOW, premise })).toBe(0);
  });
});

describe("premiseAgeLine", () => {
  it("says nothing but the hour for a premise read this hour", () => {
    expect(premiseAgeLine({ nowIso: NOW, premise: { kind: "composed", readIso: "2026-09-11T20:45:00Z" } })).toBe(
      "premise read this hour",
    );
  });

  it("says one hour in the singular", () => {
    expect(premiseAgeLine({ nowIso: NOW, premise: { kind: "composed", readIso: "2026-09-11T20:00:00Z" } })).toBe(
      "premise 1 hour old",
    );
  });

  it("says hours up to two days", () => {
    expect(premiseAgeLine({ nowIso: NOW, premise: { kind: "artifact", landedIso: "2026-09-10T20:03:23Z" } })).toBe(
      "premise 25 hours old",
    );
  });

  it("says whole days past that, because 261 hours is a number the owner has to convert", () => {
    expect(premiseAgeLine({ nowIso: NOW, premise: { kind: "artifact", landedIso: "2026-09-01T00:00:00Z" } })).toBe(
      "premise 10 days old",
    );
  });
});

describe("unusablePremiseInstant", () => {
  it("refuses an instant no clock can parse", () => {
    expect(unusablePremiseInstant({ instant: "yesterday", nowIso: NOW })).toBe(
      '"yesterday" is not an instant a clock can parse, so the card\'s age cannot be computed.',
    );
  });

  it("refuses an instant in the future, which claims to have read a world that has not happened", () => {
    expect(unusablePremiseInstant({ instant: "2026-09-12T00:00:00Z", nowIso: NOW })).toBe(
      '"2026-09-12T00:00:00Z" is in the future, so the card claims to have read a world that has not happened yet.',
    );
  });

  it("passes an instant in the past", () => {
    expect(unusablePremiseInstant({ instant: "2026-09-10T20:03:23Z", nowIso: NOW })).toBeUndefined();
  });

  it("passes the exact instant of the render, which is a premise read this moment", () => {
    expect(unusablePremiseInstant({ instant: NOW, nowIso: NOW })).toBeUndefined();
  });
});

describe("stillAsks", () => {
  it("keeps a page nothing of the owner's has touched", () => {
    expect(stillAsks({ validity: { mark: "valid" } })).toBe(true);
  });

  it("stops a page a ruling of the owner's still holds over from carrying a question", () => {
    expect(
      stillAsks({ validity: { mark: "partly-ruled" as const, outcome: "edited", ruledIso: "2026-09-11T22:25:49Z" } }),
    ).toBe(false);
  });

  it("stops a page the owner pointed somewhere else from carrying a question", () => {
    const validity = { mark: "superseded" as const, by: "https://claude.ai/code/artifact/abc12345" };

    expect(stillAsks({ validity })).toBe(false);
  });
});

describe("premiseRefusal", () => {
  it("names the card, the problem and what a premise is for", () => {
    expect(premiseRefusal({ card: 3, reason: "the card carries no age line." })).toBe(
      "card 3 carries no usable premise instant — the card carries no age line. Every card says when the world " +
        "it describes was last read, so the page can show its age and the next tick can tell whether anything " +
        "has moved since.",
    );
  });
});
