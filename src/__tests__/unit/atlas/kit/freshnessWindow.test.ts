/**
 * The per-atlas window and its three verdicts.
 *
 * Every case is built from a subject literal rather than a descriptor, because the judgement is what these
 * tests are about and the descriptor read has its own two cases below.
 */
import { describe, expect, it } from "vitest";

import { CLOUDFLARE_ATLAS_DESCRIPTOR } from "../../../../atlas/cloudflare/descriptor.js";
import { GITHUB_ATLAS_DESCRIPTOR } from "../../../../atlas/github/descriptor.js";
import {
  type AtlasFreshnessSubject,
  atlasFreshnessWindowMs,
  atlasFreshnessWindowProblem,
  DEFAULT_ATLAS_FRESHNESS_WINDOW_MS,
  judgeAtlasEstate,
  judgeAtlasFreshness,
} from "../../../../atlas/kit/freshnessWindow.js";
import { VANTA_ATLAS_DESCRIPTOR } from "../../../../atlas/vanta/descriptor.js";

const NOW_ISO = "2026-09-08T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_MS = 60 * 60 * 1000;

/** One subject with the four-hour window and a live read available, overridable field by field. */
function subject(over: Partial<AtlasFreshnessSubject> = {}): AtlasFreshnessSubject {
  return {
    liveReadAt: null,
    liveReadCommand: "slopweaver atlas demo live-read --id <id>",
    platform: "demo",
    resyncCommand: "slopweaver atlas demo sync",
    updatedAt: new Date(NOW_MS - HOUR_MS).toISOString(),
    windowMs: DEFAULT_ATLAS_FRESHNESS_WINDOW_MS,
    ...over,
  };
}

describe("judgeAtlasFreshness", () => {
  it("is current inside the window and owes nothing", () => {
    const verdict = judgeAtlasFreshness({ nowIso: NOW_ISO, subject: subject() });
    expect(verdict.behind).toBe(false);
    expect(verdict.action).toBe("current");
    expect(verdict.remedy).toBeNull();
    expect(verdict.line).toBe("atlas demo · current · generation is 1.0h old, inside 4h");
  });

  it("is behind past the window and names the bounded live read first", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({ updatedAt: new Date(NOW_MS - 9 * HOUR_MS).toISOString() }),
    });
    expect(verdict.behind).toBe(true);
    expect(verdict.action).toBe("live-read");
    expect(verdict.remedy).toBe("slopweaver atlas demo live-read --id <id>");
    expect(verdict.line).toBe(
      "atlas demo · BEHIND · generation is 9.0h old, past 4h — slopweaver atlas demo live-read --id <id>",
    );
  });

  it("falls to the resync when the atlas has no bounded live read", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({ liveReadCommand: null, updatedAt: new Date(NOW_MS - 9 * HOUR_MS).toISOString() }),
    });
    expect(verdict.action).toBe("resync");
    expect(verdict.remedy).toBe("slopweaver atlas demo sync");
  });

  it("counts a bounded live read inside the window as fresh, however old the generation is", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({
        liveReadAt: new Date(NOW_MS - 5 * 60 * 1000).toISOString(),
        updatedAt: new Date(NOW_MS - 30 * 24 * HOUR_MS).toISOString(),
      }),
    });
    expect(verdict.behind).toBe(false);
    expect(verdict.action).toBe("current");
    expect(verdict.line).toBe("atlas demo · current · a bounded live read 5.0m ago is inside 4h");
    expect(verdict.ageMs).toBe(30 * 24 * HOUR_MS);
  });

  it("ignores a live read that is itself past the window", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({
        liveReadAt: new Date(NOW_MS - 6 * HOUR_MS).toISOString(),
        updatedAt: new Date(NOW_MS - 9 * HOUR_MS).toISOString(),
      }),
    });
    expect(verdict.behind).toBe(true);
    expect(verdict.action).toBe("live-read");
  });

  it("is behind at any window when no generation has been published", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({ updatedAt: null, windowMs: 365 * 24 * HOUR_MS }),
    });
    expect(verdict.behind).toBe(true);
    expect(verdict.ageMs).toBeNull();
    expect(verdict.line).toBe(
      "atlas demo · BEHIND · no generation has been published — slopweaver atlas demo live-read --id <id>",
    );
  });

  it("is behind when the generation clock cannot be read", () => {
    const verdict = judgeAtlasFreshness({ nowIso: NOW_ISO, subject: subject({ updatedAt: "not-a-date" }) });
    expect(verdict.behind).toBe(true);
    expect(verdict.line).toBe(
      "atlas demo · BEHIND · generation clock not-a-date is unreadable — slopweaver atlas demo live-read --id <id>",
    );
  });

  it("clamps a generation stamped ahead of the clock rather than printing a negative age", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({ updatedAt: new Date(NOW_MS + HOUR_MS).toISOString() }),
    });
    expect(verdict.ageMs).toBe(0);
    expect(verdict.behind).toBe(false);
  });

  it("judges against the atlas's own window rather than the default", () => {
    const verdict = judgeAtlasFreshness({
      nowIso: NOW_ISO,
      subject: subject({ updatedAt: new Date(NOW_MS - 9 * HOUR_MS).toISOString(), windowMs: 2 * 24 * HOUR_MS }),
    });
    expect(verdict.behind).toBe(false);
    expect(verdict.line).toBe("atlas demo · current · generation is 9.0h old, inside 2d");
  });
});

describe("judgeAtlasEstate", () => {
  it("returns one verdict per subject, current ones included, in the order given", () => {
    const verdicts = judgeAtlasEstate({
      nowIso: NOW_ISO,
      subjects: [
        subject({ platform: "one" }),
        subject({ platform: "two", updatedAt: new Date(NOW_MS - 9 * HOUR_MS).toISOString() }),
      ],
    });
    expect(verdicts.map((verdict) => verdict.platform)).toEqual(["one", "two"]);
    expect(verdicts.map((verdict) => verdict.behind)).toEqual([false, true]);
  });

  it("returns nothing for an empty estate", () => {
    expect(judgeAtlasEstate({ nowIso: NOW_ISO, subjects: [] })).toEqual([]);
  });
});

describe("atlasFreshnessWindowMs", () => {
  // Vanta is the most-read atlas and keeps the default on purpose; it also has a bounded live read.
  it("gives an atlas that declares nothing the four-hour default", () => {
    expect(atlasFreshnessWindowMs({ descriptor: VANTA_ATLAS_DESCRIPTOR })).toBe(DEFAULT_ATLAS_FRESHNESS_WINDOW_MS);
    expect(atlasFreshnessWindowProblem({ descriptor: VANTA_ATLAS_DESCRIPTOR })).toBeNull();
  });

  it("gives an atlas that declares its own window that one", () => {
    expect(atlasFreshnessWindowMs({ descriptor: CLOUDFLARE_ATLAS_DESCRIPTOR })).toBe(2 * 24 * HOUR_MS);
    expect(atlasFreshnessWindowMs({ descriptor: GITHUB_ATLAS_DESCRIPTOR })).toBe(36 * HOUR_MS);
  });

  it("falls back to the default and says so when a declaration cannot be parsed", () => {
    const descriptor = { ...GITHUB_ATLAS_DESCRIPTOR, freshnessWindow: "4" };
    expect(atlasFreshnessWindowMs({ descriptor })).toBe(DEFAULT_ATLAS_FRESHNESS_WINDOW_MS);
    expect(atlasFreshnessWindowProblem({ descriptor })).toContain("declares freshnessWindow `4`");
  });
});

describe("the descriptor field the ladder rests on", () => {
  it("declares Vanta's bounded live read, which is the worked example of a bounded live read", () => {
    expect(VANTA_ATLAS_DESCRIPTOR.liveReadCommand).toBe("slopweaver atlas vanta control-evidence --control <id>");
  });
});
