/**
 * The REAL seams `ensureLiveCard` drives — `cli/commands/turn/liveCardWiring.ts`.
 *
 * Three of the five are pure file work against an explicit `home`, and those are what this file pins: the
 * lifecycle read of an ask that has no `checklist-posted` event, the brief write-back that every card verb
 * downstream reads, and the durable append that lets a LATER dispatch recover the ref instead of posting a
 * second card. `postCard` is the fourth and it reaches Slack, so it is not exercised here — what matters
 * about it is asserted where it can be: `liveCardDeps` is infallible, and a home with no bot token at all
 * still builds, because resolving the token eagerly is the defect that made every token-less dispatch refuse
 * about the wrong thing. `advanceCard` is the fifth and reaches Slack the same way, so it is pinned the same
 * way: it must be present (a deps object missing it silently restores the stale-frame defect) and it must
 * resolve its token lazily rather than at build time.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveCardDeps } from "../../../../../cli/commands/turn/liveCardWiring.js";
import { unwrap } from "../../../../../lib/result.js";
import { askIdentityOf } from "../../../../../live/ask/identity.js";
import { ensureCapturedAskLifecycle, readAskLifecycleText } from "../../../../../live/ask/store.js";
import { buildTurnRoutingBrief } from "../../../../../live/turn/brief.js";
import { readBrief } from "../../../../../live/turn/briefStore.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "why did the staging pool exhaust?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

const BRIEF = buildTurnRoutingBrief({
  channel: "C0SYN000006",
  messageTs: "1789952379.135579",
  question: "why did the staging pool exhaust?",
  routingInput: ROUTING_INPUT,
  surface: "channel",
  threadTs: "1789952379.135579",
  unavailableCapabilities: [],
  userId: "U0OWNER",
});

const CARD = { turnId: "turn-1789952400000", workingTs: "1789952400.000100" } as const;

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with this ask's brief already written, and the deps pointed at both. */
function wired(): {
  readonly briefPath: string;
  readonly deps: ReturnType<typeof liveCardDeps>;
  readonly home: string;
} {
  const home = mkdtempSync(join(tmpdir(), "slop-live-card-wiring-"));
  homes.push(home);
  const briefPath = join(home, "brief.json");
  const deps = liveCardDeps({ brief: BRIEF, briefPath, home });
  deps.persistStarted({ started: CARD });
  return { briefPath, deps, home };
}

describe("liveCardDeps", () => {
  it("builds against a home carrying no Slack config at all, rather than refusing up front", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-live-card-wiring-bare-"));
    homes.push(home);

    const deps = liveCardDeps({ brief: BRIEF, briefPath: join(home, "brief.json"), home });

    expect(deps.recordedStarted({ askIdentity: askIdentityOf({ source: BRIEF }) })).toBe(undefined);
  });

  it("writes the proven ref onto the brief, which is what every card verb downstream reads", () => {
    const { briefPath } = wired();

    expect(unwrap(readBrief({ path: briefPath })).started).toEqual(CARD);
  });

  it("rejects a card advance on a token-less home with the reason, rather than throwing at build time", async () => {
    const { deps } = wired();

    // `ensureLiveCard` catches exactly this and reports it on the dispatch's own line; the dispatch itself
    // survives, because a card wearing the wrong frame is still a card standing in the thread.
    await expect(deps.advanceCard({ brief: BRIEF, started: CARD })).rejects.toThrow("no Slack bot token");
  });

  it("mints a turn id of the shape `turn-<epoch ms>`", () => {
    const { deps } = wired();

    expect(deps.mintTurnId()).toMatch(/^turn-\d{13}$/);
  });

  it("appends a durable checklist-posted event a LATER dispatch recovers the ref from", () => {
    const { deps, home } = wired();
    const askIdentity = askIdentityOf({ source: BRIEF });
    // The `captured` row the listener writes first: the fold keys an ask off it, so a `checklist-posted`
    // standing alone belongs to no ask and is recovered by nothing — which is the real arrival order.
    ensureCapturedAskLifecycle({ askIdentity, home, surface: "channel", userId: "U0OWNER" });

    expect(deps.recordedStarted({ askIdentity })).toBe(undefined);
    deps.recordChecklistPosted({ askIdentity, started: CARD });

    expect(deps.recordedStarted({ askIdentity })).toEqual(CARD);
    // The ONE row, on disk, in the file `turn dispatch --sweep` and every card verb read it back out of.
    const rows = readAskLifecycleText({ home })
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { kind: string; workingTs: string });
    expect(rows.map((row) => row.kind)).toEqual(["captured", "checklist-posted"]);
    expect(rows[1]!.workingTs).toBe(CARD.workingTs);
  });
});
