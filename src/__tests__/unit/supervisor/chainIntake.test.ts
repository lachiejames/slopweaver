/**
 * The chain walk over the throwaway `~/.claude` in `./chainReadHarness.ts`.
 *
 * The case that matters is the measured one — a predecessor and a successor, a floor spanning both, and a
 * turn typed into the predecessor that the single-session read could not see. Coverage and unreadable chairs are
 * `./chainIntakeCoverage.test.ts`; the light owner-turns read is `./chainTurns.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { readSupervisorChain } from "../../../supervisor/chainStore.js";
import { readSupervisorChainIntake, readSupervisorIntake } from "../../../supervisor/intakeRead.js";
import {
  CHAIN,
  claudeHome,
  cleanScratch,
  inboundRead,
  NEW,
  NEW_ASK,
  NO_DOCS,
  NOW,
  OLD,
  OLD_ASK,
  PEER_LATE,
  PEER_PLAIN,
  PLAIN,
  read,
  stateHome,
} from "./chainReadHarness.js";

afterEach(cleanScratch);

describe("readSupervisorChainIntake", () => {
  it("reads the PREDECESSOR's turn, which the single-session read could not see", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    const finding = read({ report });

    expect(finding.turns.map((item) => item.turn.turnUuid)).toEqual([OLD_ASK, NEW_ASK]);
    expect(finding.legs.map((leg) => leg.sessionId)).toEqual([OLD, NEW]);
  });

  it("carries a report that landed on the predecessor after the pin moved, and clears one the successor answered", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    const inbound = inboundRead({ report });

    expect(inbound.carried.map((item) => item.pointer)).toEqual([`transcript:${OLD}#${PEER_LATE}`]);
    expect(inbound.carried[0]!.message.delivery).toBe("queued");
    expect(inbound.answered).toBe(1);
    expect(inbound.unanswered).toEqual([]);
  });

  it("still carries a late report on a chair a --since floor dropped from the owner window", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    // The floor sits after OLD handed over and before the report landed on it.
    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-09-05T03:00:00.000Z",
    });

    expect(read({ report }).legs.map((leg) => leg.sessionId)).toEqual([NEW]);
    expect(inboundRead({ report }).carried.map((item) => item.pointer)).toEqual([`transcript:${OLD}#${PEER_LATE}`]);
  });

  it("carries the same late report when that retired chair is read alone with --session", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const report = readSupervisorIntake({
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sessionId: OLD,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(inboundRead({ report }).carried.map((item) => item.pointer)).toEqual([`transcript:${OLD}#${PEER_LATE}`]);
  });

  it("carries a message on a session the journal never recorded, because an unplaceable chair fails closed", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const report = readSupervisorIntake({
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sessionId: PLAIN,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(inboundRead({ report }).carried.map((item) => item.pointer)).toEqual([`transcript:${PLAIN}#${PEER_PLAIN}`]);
  });
});
