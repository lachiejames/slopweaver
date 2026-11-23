import { describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../../live/ask/identity.js";
import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  minimalAnswer,
  NO_ROW,
  PROVENANCE,
  READY,
  REPLY,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("liveTurnPoster — postAnswer's identity guard", () => {
  it("refuses before any effect when called with an askIdentity the poster was not built for", async () => {
    const log: Recorded[] = [];
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: fakeTransport({ log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });
    const otherAsk: AskIdentity = { ...DM_MENTION, messageTs: "1700000000.000999" };

    await expect(
      poster.postAnswer({
        answer: minimalAnswer(),
        askIdentity: otherAsk,
        documents: [],
        reply: REPLY,
        uploads: [],
      }),
    ).rejects.toThrow(
      "postAnswer was called with an askIdentity that does not match the poster it was called on — refused before any effect",
    );
    expect(log).toEqual([]);
  });

  /**
   * `liveTurnPoster` closes over a fresh copy of the CALLER's `askIdentity`, never the
   * object by reference rather than a fresh copy, so a caller that mutated the very object it constructed
   * the poster with — then called `postAnswer` with the mutated value — could make the guard compare the
   * poster's own (now-mutated) closure against itself and pass, even though the poster's ORIGINAL scope no
   * longer matches. Snapshotting at construction closes this: the poster's scope is fixed the moment it is
   * built, independent of anything the caller does to the object afterward.
   */
  it("keeps its ORIGINAL construction-time scope even when the caller mutates the object it passed in", async () => {
    const log: Recorded[] = [];
    const scoped = { ...DM_MENTION };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: scoped,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: fakeTransport({ log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    // The caller mutates the SAME object it just constructed the poster with, then calls postAnswer with an
    // identity matching that mutation — the exact shape of the counterexample this closes.
    scoped.messageTs = "1700000000.000999";

    await expect(
      poster.postAnswer({
        answer: minimalAnswer(),
        askIdentity: scoped,
        documents: [],
        reply: REPLY,
        uploads: [],
      }),
    ).rejects.toThrow(
      "postAnswer was called with an askIdentity that does not match the poster it was called on — refused before any effect",
    );
    expect(log).toEqual([]);
  });
});
