/*
 * The owner's priorities on the Queue: which workstreams are a priority and in what order, the section each card
 * draws in, the fact each card ranks by, and the ONE order the page, its triage pass and the voice share.
 */

import { describe, expect, it } from "vitest";

import type { LiveState } from "../../components/live/useLive";
import {
  focusGap,
  type QueueFocus,
  type QueueFocusRow,
  queueFactOf,
  queueFocuses,
  queueOrdered,
  queueSectionOf,
} from "../../lib/queueFocus";
import type { CardTag } from "../../lib/queueTagsInherited";
import { readWorkstreamTiles, type WorkstreamsView } from "../../lib/workstreamTiles";

import { abandoned, outcome } from "./workstreamOutcomeFixture";
import { closing, documentWith, linked, local, withDetail } from "./workstreamTilesFixture";

/**
 * The register's reading, arrived.
 *
 * @returns the ready state over the given entries
 */
function registerOf({ workstreams }: { workstreams: readonly unknown[] }): LiveState<WorkstreamsView> {
  const value = readWorkstreamTiles({ payload: documentWith({ workstreams }) });
  if (value === undefined) {
    throw new Error("the fixture register did not read");
  }
  return {
    fixture: undefined,
    observedAtIso: "2026-10-16T00:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

const URGENT = { anchor: "talk-call:anchor#turn_EXx", because: "the owner's ISO week", level: "urgent" };

/** The ISO gauge, urgent, naming the board tag its cards carry. */
const ISO = withDetail({ detail: { priority: URGENT, queueWorkstream: "iso-certification" }, row: linked });

const ISO_FOCUS: QueueFocus = {
  anchor: URGENT.anchor,
  because: URGENT.because,
  id: "iso",
  name: "ISO controls",
  queueWorkstream: "iso-certification",
};

const NAG_FOCUS: QueueFocus = { ...ISO_FOCUS, id: "nag", name: "Onboarding flow", queueWorkstream: "onboarding-flow" };

type Row = QueueFocusRow & { readonly key: string };

/**
 * One card, whole-read unless said otherwise.
 *
 * @returns the row
 */
function card({
  key,
  tier = "team-blocked",
  tags = [],
  tagsRead = "whole",
  deferredIso,
  stopping,
}: {
  key: string;
  tier?: Row["tier"];
  tags?: readonly CardTag[];
  tagsRead?: Row["tagsRead"];
  deferredIso?: string;
  stopping?: Row["stopping"];
}): Row {
  return {
    key,
    tags,
    tagsRead,
    tier,
    ...(deferredIso === undefined ? {} : { deferredIso }),
    ...(stopping === undefined ? {} : { stopping }),
  };
}

const ISO_TAG: readonly CardTag[] = [{ key: "workstream", value: "iso-certification" }];
const NAG_TAG: readonly CardTag[] = [{ key: "workstream", value: "onboarding-flow" }];

/**
 * A Vanta action card, in the ISO priority, on board band `band`, resolving `controls` when stated.
 *
 * @returns the row
 */
function vanta({ key, band, controls }: { key: string; band: string; controls?: string }): Row {
  const counted: readonly CardTag[] = controls === undefined ? [] : [{ key: "controls-resolved", value: controls }];
  return card({ key, tags: [...ISO_TAG, { key: "priority", value: band }, ...counted], tier: "fleet-blocked" });
}

describe("queueFocuses", () => {
  it("names each live story at urgent that states its board tag, in register order when none is ranked", () => {
    const deps = { ...withDetail({ detail: { queueWorkstream: "dependencies" }, row: outcome }), id: "deps" };
    expect(queueFocuses({ workstreams: registerOf({ workstreams: [ISO, deps] }) })).toEqual([
      ISO_FOCUS,
      {
        anchor: "transcript:a#b",
        because: "a customer asked",
        id: "deps",
        name: "Logs scrub",
        queueWorkstream: "dependencies",
      },
    ]);
  });

  it("puts the owner's first-ranked priority first and an unranked one after every ranked one", () => {
    const iso = withDetail({ detail: { priority: { ...URGENT, rank: 2 } }, row: ISO });
    const nag = {
      ...withDetail({ detail: { priority: { ...URGENT, rank: 1 }, queueWorkstream: "onboarding-flow" }, row: ISO }),
      id: "nag",
    };
    const deps = { ...withDetail({ detail: { queueWorkstream: "dependencies" }, row: outcome }), id: "deps" };
    const focuses = queueFocuses({ workstreams: registerOf({ workstreams: [deps, iso, nag] }) });
    expect(focuses.map((focus) => focus.id)).toEqual(["nag", "iso", "deps"]);
  });

  it("names none that is not urgent, states no tag, has ended, or is kept here or handed over", () => {
    const high = withDetail({ detail: { priority: { ...URGENT, level: "high" } }, row: ISO });
    const ended = withDetail({ detail: { queueWorkstream: "previews" }, row: abandoned });
    const workstreams = registerOf({ workstreams: [high, outcome, ended, local, closing] });
    expect(workstreams.phase).toBe("ready");
    expect(queueFocuses({ workstreams })).toEqual([]);
  });

  it("names none until the register reads", () => {
    expect(queueFocuses({ workstreams: { phase: "loading" } })).toEqual([]);
    expect(queueFocuses({ workstreams: { phase: "not-measured", why: "the verb exited 1" } })).toEqual([]);
  });
});

describe("queueSectionOf", () => {
  const focuses = [ISO_FOCUS];

  it("draws a blocker, a priority's card, a stopped automation and every other card in their own sections", () => {
    expect([
      queueSectionOf({ focuses, row: card({ key: "ask:b", stopping: { priorityRank: 0, reason: "blocks" } }) }),
      queueSectionOf({ focuses, row: card({ key: "ask:iso-policy", tags: ISO_TAG }) }),
      queueSectionOf({ focuses, row: card({ key: "hand:held", stopping: { reason: "marked" } }) }),
      queueSectionOf({ focuses, row: card({ key: "ask:other" }) }),
    ]).toEqual(["blocker", "focus", "stopping", "team-blocked"]);
  });

  it("leaves a card whose tags read only in part, a check-in and a put-off card where their tier puts them", () => {
    expect([
      queueSectionOf({ focuses, row: card({ key: "ask:part", tags: ISO_TAG, tagsRead: "partial" }) }),
      queueSectionOf({ focuses, row: card({ key: "hand:try", tags: ISO_TAG, tier: "check-in" }) }),
      queueSectionOf({
        focuses,
        row: card({ deferredIso: "2026-10-15T00:00:00.000Z", key: "ask:later", tags: ISO_TAG }),
      }),
    ]).toEqual(["team-blocked", "check-in", "team-blocked"]);
  });

  it("lifts a stamped card put off or not, with no priority standing, but never a check-in", () => {
    const marked = { reason: "marked" } as const;
    expect([
      queueSectionOf({ focuses: [], row: card({ key: "hand:held", stopping: marked }) }),
      queueSectionOf({
        focuses: [],
        row: card({ deferredIso: "2026-10-18T00:00:00.000Z", key: "hand:held", stopping: marked }),
      }),
      queueSectionOf({ focuses: [], row: card({ key: "hand:try", stopping: marked, tier: "check-in" }) }),
    ]).toEqual(["stopping", "stopping", "check-in"]);
  });
});

describe("queueFactOf", () => {
  const focuses = [NAG_FOCUS, ISO_FOCUS];

  it("reads a priority card's rank, board band and controls resolved off its tags", () => {
    expect(queueFactOf({ focuses, row: vanta({ band: "p1", controls: "8", key: "ask:v" }) })).toEqual({
      band: "priority",
      boardBand: 1,
      controlsResolved: 8,
      priorityRank: 1,
    });
  });

  it("states no count it cannot read, nor a band the board does not have", () => {
    expect(queueFactOf({ focuses, row: vanta({ band: "urgent", controls: "08", key: "ask:v" }) })).toEqual({
      band: "priority",
      priorityRank: 1,
    });
  });

  it("carries a blocker's priority rank, and nothing but a band for a stopped or other card", () => {
    expect([
      queueFactOf({ focuses, row: card({ key: "ask:b", stopping: { priorityRank: 0, reason: "blocks" } }) }),
      queueFactOf({ focuses, row: card({ key: "hand:held", stopping: { reason: "marked" } }) }),
      queueFactOf({ focuses, row: card({ key: "ask:other", tier: "check-in" }) }),
    ]).toEqual([{ band: "blocker", priorityRank: 0 }, { band: "stopped" }, { band: "rest" }]);
  });
});

describe("queueOrdered — the one order", () => {
  const rows: readonly Row[] = [
    card({ key: "ask:colleague" }),
    card({ key: "hand:try", tags: ISO_TAG, tier: "check-in" }),
    vanta({ band: "p1", controls: "3", key: "ask:vanta-3" }),
    card({ key: "hand:held-error-tracking", stopping: { reason: "marked" }, tier: "fleet-blocked" }),
    card({ deferredIso: "2026-10-18T00:00:00.000Z", key: "ask:put-off" }),
    vanta({ band: "p1", key: "ask:vanta-uncounted" }),
    card({ key: "ask:nag-proposal", tags: NAG_TAG, tier: "fleet-blocked" }),
    vanta({ band: "p1", controls: "8", key: "ask:vanta-8" }),
    card({ key: "ask:blocks-vanta", stopping: { priorityRank: 1, reason: "blocks" } }),
    card({ key: "ask:fleet", tier: "fleet-blocked" }),
    card({ key: "ask:blocks-nag", stopping: { priorityRank: 0, reason: "blocks" } }),
  ];

  it("leads with what blocks a priority, then the nag proposal, then Vanta by controls, then the held automation", () => {
    expect(queueOrdered({ focuses: [NAG_FOCUS, ISO_FOCUS], rows }).map((row) => row.key)).toEqual([
      "ask:blocks-nag",
      "ask:blocks-vanta",
      "ask:nag-proposal",
      "ask:vanta-8",
      "ask:vanta-3",
      "ask:vanta-uncounted",
      "hand:held-error-tracking",
      "ask:colleague",
      "ask:fleet",
      "hand:try",
      "ask:put-off",
    ]);
  });

  it("still leads with a blocker and a stopped automation when no priority stands", () => {
    expect(
      queueOrdered({ focuses: [], rows })
        .map((row) => row.key)
        .slice(0, 3),
    ).toEqual(["ask:blocks-nag", "ask:blocks-vanta", "hand:held-error-tracking"]);
  });

  it("hands the same list back when nothing moves", () => {
    const already = queueOrdered({ focuses: [NAG_FOCUS, ISO_FOCUS], rows });
    expect(queueOrdered({ focuses: [NAG_FOCUS, ISO_FOCUS], rows: already })).toBe(already);
  });
});

describe("focusGap", () => {
  it("marks a register that could not be read, and says every card stands by its tier", () => {
    expect(focusGap({ workstreams: { phase: "not-measured", why: "the verb exited 1" } })).toEqual({
      subject: "your priorities, which decide what leads your Queue",
      why: "the verb exited 1. Every card stands by its tier",
    });
  });

  it("marks nothing while the first read is in flight or once it arrived", () => {
    expect([
      focusGap({ workstreams: { phase: "loading" } }),
      focusGap({ workstreams: registerOf({ workstreams: [ISO] }) }),
    ]).toEqual([undefined, undefined]);
  });
});
