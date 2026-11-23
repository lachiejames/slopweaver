/*
 * The tick row's per-source facts slice: the shared instant and text shapes, a strict listener reading, a
 * friction reading journalled before `isStale` existed, and both arms of a landing.
 */
import { describe, expect, it } from "vitest";

import {
  frictionFacts,
  isoInstant,
  landingsFacts,
  listenerFacts,
  text,
} from "../../../supervisor/tickSourceFactsSchema.js";

/** A complete listener reading, as the tick records it. */
const LISTENER = { armId: "arm-1", grade: "LIVE", pid: 4242, socketState: "open", why: "socket answered" };

describe("isoInstant and text", () => {
  it("reads an instant carrying an offset and a non-empty string unchanged", () => {
    expect(isoInstant.parse("2026-11-08T05:00:00.000Z")).toBe("2026-11-08T05:00:00.000Z");
    expect(text.parse("acme")).toBe("acme");
  });

  it("refuses an instant with no offset and an empty string", () => {
    expect(isoInstant.safeParse("2026-11-08T05:00:00").error!.issues.map((issue) => issue.code)).toStrictEqual([
      "invalid_format",
    ]);
    expect(text.safeParse("").error!.issues.map((issue) => issue.code)).toStrictEqual(["too_small"]);
  });
});

describe("listenerFacts", () => {
  it("reads a complete listener reading unchanged", () => {
    expect(listenerFacts.parse(LISTENER)).toStrictEqual(LISTENER);
  });

  it("refuses a key nobody declared", () => {
    expect(listenerFacts.safeParse({ ...LISTENER, uptime: 3 }).error!.issues.map((issue) => issue.code)).toStrictEqual([
      "unrecognized_keys",
    ]);
  });
});

describe("frictionFacts", () => {
  it("still reads a row journalled before isStale existed", () => {
    const legacy = { hasGap: true, newestReport: null };

    expect(frictionFacts.parse(legacy)).toStrictEqual(legacy);
  });
});

describe("landingsFacts", () => {
  it("reads a pull-request landing and a handover landing unchanged", () => {
    const facts = {
      landings: [
        {
          kind: "pull-request",
          landedAtIso: "2026-11-08T04:00:00.000Z",
          landingId: "landing-1",
          mergeCommitSha: "abc123",
          number: 12,
          repo: "acme/widgets",
          title: "fix the widget",
          url: "https://github.com/acme/widgets/pull/12",
        },
        {
          kind: "handover",
          label: "widget cleanup",
          landedAtIso: "2026-11-08T04:30:00.000Z",
          landingId: "landing-2",
          slug: "widget-cleanup",
          witness: "handover finish",
        },
      ],
    };

    expect(landingsFacts.parse(facts)).toStrictEqual(facts);
  });
});
