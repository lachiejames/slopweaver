/**
 * The bot form-kind REGISTRY: that it is a set nothing can hide a kind from, that exactly one entry is the
 * fallback, that dispatch picks the right entry for every discriminant, and that every declared fixture
 * still parses and still provokes the derivation it exists to exercise.
 *
 * The last property is the one that keeps `derived-card-voice` honest. A gate that iterates this array
 * covers every kind by construction, but only if each fixture is still the SMALLEST form that makes its
 * derivation mint every sentence it mints — a gutted fixture narrows the gate silently, so it reddens here.
 *
 * The blocked-ask cases went with the kind itself: a run waiting on the owner is a Queue card.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../lib/result.js";
import { defaultIntro } from "../../../../live/automation/firstFiring.js";
import { BOT_FORM_KINDS, botFormKindFor } from "../../../../outbound/artifact/botFormKinds.js";
import type { NoFoldArtifact, UpdateArtifact } from "../../../../outbound/artifact/types.js";

/** One kind's derived CARD, from the fixture at `at`. Throws rather than branching. */
function derivedCard({ kind, at = 0 }: { kind: string; at?: number }): UpdateArtifact {
  const entry = BOT_FORM_KINDS.find((candidate) => candidate.kind === kind)!;
  const artifact = unwrap(entry.parse({ isKnownPerson: () => true, raw: entry.fixtures[at]! })).artifact;
  if (artifact.kind !== "update") {
    throw new Error(`the ${kind} fixture derived a ${artifact.kind} artifact, not a card`);
  }
  return artifact;
}

/** The no-fold fixture's own message, for the one kind that derives nothing at all. */
function derivedNoFold(): NoFoldArtifact {
  const entry = BOT_FORM_KINDS.find((candidate) => candidate.kind === "no-fold")!;
  const artifact = unwrap(entry.parse({ isKnownPerson: () => true, raw: entry.fixtures[0]! })).artifact;
  if (artifact.kind !== "no-fold") {
    throw new Error(`the no-fold fixture parsed as a ${artifact.kind} artifact`);
  }
  return artifact;
}

describe("BOT_FORM_KINDS — the declared set", () => {
  it("declares at least one kind", () => {
    expect(BOT_FORM_KINDS.length).toBeGreaterThan(0);
  });

  it("declares exactly one fallback, because two would give the set an ordering nobody declared", () => {
    expect(BOT_FORM_KINDS.filter((entry) => entry.fallback).map((entry) => entry.kind)).toEqual(["update"]);
  });

  it("names every kind exactly once", () => {
    const names = BOT_FORM_KINDS.map((entry) => entry.kind);
    expect(names).toEqual([...new Set(names)]);
  });

  it("gives every kind at least one canonical fixture, which is what the gate iterates", () => {
    expect(BOT_FORM_KINDS.length).toBeGreaterThan(0);
    expect(BOT_FORM_KINDS.filter((entry) => entry.fixtures.length === 0).map((entry) => entry.kind)).toEqual([]);
  });

  it("gives every kind a one-line description of what the posting IS", () => {
    expect(BOT_FORM_KINDS.length).toBeGreaterThan(0);
    expect(BOT_FORM_KINDS.filter((entry) => entry.what.trim().length === 0)).toEqual([]);
  });
});

describe("botFormKindFor — dispatch", () => {
  it("picks the entry whose discriminant the payload carries", () => {
    expect(botFormKindFor({ raw: { kind: "alert-summary" } }).kind).toBe("alert-summary");
    expect(botFormKindFor({ raw: { kind: "digest" } }).kind).toBe("digest");
    expect(botFormKindFor({ raw: { kind: "no-fold" } }).kind).toBe("no-fold");
  });

  it("no longer knows a blocked-ask kind — a run waiting on the owner is a Queue card, never a Slack post", () => {
    expect(BOT_FORM_KINDS.map((entry) => entry.kind)).not.toContain("blocked-ask");
    expect(botFormKindFor({ raw: { kind: "blocked-ask" } }).kind).toBe("update");
  });

  it("falls back to update for a payload naming no kind at all", () => {
    expect(botFormKindFor({ raw: { tldr: "a line" } }).kind).toBe("update");
  });

  it("falls back to update for an unrecognised kind, so its own schema names the violation", () => {
    expect(botFormKindFor({ raw: { kind: "release-note" } }).kind).toBe("update");
  });

  it("falls back to update for a payload that is not an object at all", () => {
    expect(botFormKindFor({ raw: "a string" }).kind).toBe("update");
    expect(botFormKindFor({ raw: null }).kind).toBe("update");
  });
});

describe("every canonical fixture parses", () => {
  it("parses each declared fixture through its own entry's parser", () => {
    expect(BOT_FORM_KINDS.length).toBeGreaterThan(0);
    const failed = BOT_FORM_KINDS.flatMap((entry) =>
      entry.fixtures.map((fixture, at) => ({
        at,
        entry,
        ok: entry.parse({ isKnownPerson: () => true, raw: fixture }),
      })),
    )
      .filter((row) => row.ok.isErr())
      .map((row) => `${row.entry.kind}[${String(row.at)}]`);
    expect(failed).toEqual([]);
  });

  it("routes each fixture to its own entry, so a fixture cannot be parsed by the wrong lane", () => {
    expect(BOT_FORM_KINDS.length).toBeGreaterThan(0);
    const misrouted = BOT_FORM_KINDS.flatMap((entry) =>
      entry.fixtures.map((fixture, at) => ({ at, entry, routed: botFormKindFor({ raw: fixture }).kind })),
    )
      .filter((row) => row.routed !== row.entry.kind)
      .map((row) => `${row.entry.kind}[${String(row.at)}]`);
    expect(misrouted).toEqual([]);
  });
});

describe("every fixture still provokes its own derivation", () => {
  it("makes the digest derive a TL;DR neither of its own fields carries", () => {
    expect(derivedCard({ kind: "digest" }).tldr).toBe(
      "Triage 7d · 1 red, 1 green. One of these wants a decision today.",
    );
  });

  it("makes the alert summary derive a total, a comparison clause and a separator of its own", () => {
    expect(derivedCard({ kind: "alert-summary" }).tldr).toBe(
      "Gateway 7d · P4 · 275 fired across 9 monitors. 6.9× the prior 3 windows. The top two are the same deploy.",
    );
  });

  it("derives that total from rows PLUS omitted, so the fixture's omitted tail is not decorative", () => {
    expect(derivedCard({ kind: "alert-summary" }).tldr).toContain("275 fired across 9 monitors");
  });

  it("writes the alert summary's skip coverage below the fold, so a non-zero skipped count is exercised", () => {
    const detail = JSON.stringify(derivedCard({ kind: "alert-summary" }).detail);
    expect(detail).toContain("4 messages in this window were not recognised as alert notifications");
  });

  it("carries the REAL day-one intro, so a reworded one is read here rather than on a channel", () => {
    // Reading `defaultIntro` rather than restating its lines is the whole point: a fixture holding a copy
    // would keep passing while the function it claims to cover said something else. Two cadences, because
    // the phrase interpolated into line one is itself composed.
    expect(derivedCard({ at: 3, kind: "alert-summary" }).intro).toEqual(defaultIntro({ cadence: "0 9 * * 1-5" }));
    expect(derivedCard({ at: 4, kind: "alert-summary" }).intro).toEqual(defaultIntro({ cadence: "*/7 3 1 * *" }));
  });

  it("picks two cadences whose derived first line actually differs, so the pair is not one test twice", () => {
    const named = derivedCard({ at: 3, kind: "alert-summary" }).intro!;
    const fallback = derivedCard({ at: 4, kind: "alert-summary" }).intro!;
    expect(named[0]).toContain("every weekday");
    expect(fallback[0]).toContain("on a regular schedule");
  });

  it("declares a fixture for each of the alert summary's THREE count sentences", () => {
    expect(derivedCard({ at: 0, kind: "alert-summary" }).tldr).toContain("275 fired across 9 monitors.");
    expect(derivedCard({ at: 1, kind: "alert-summary" }).tldr).toContain("18 messages read, none recognised.");
    expect(derivedCard({ at: 2, kind: "alert-summary" }).tldr).toContain("nothing fired.");
  });

  it("keeps the update fixture's own TL;DR, because that lane derives nothing", () => {
    expect(derivedCard({ kind: "update" }).tldr).toBe("One short line that leads the above-the-fold region.");
  });

  it("carries the no-fold fixture's whole body, since that form has no below-fold half to derive into", () => {
    expect(derivedNoFold().bullets.length).toBe(2);
  });
});
