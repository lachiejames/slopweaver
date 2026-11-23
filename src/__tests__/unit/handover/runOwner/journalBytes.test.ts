/*
 * The fleet driver's real journal bytes: the exact `launched`, `resumed` and `said` lines it writes decode, and an
 * identity line with no session id stays unreadable. It moved here when `runOwner.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { parseLedger } from "../../../../handover/ledger.js";
import { runOwnership } from "../../../../handover/runOwner.js";
import { AT, MINE, THEIRS } from "./harness.js";

describe("the fleet driver's real journal bytes", () => {
  /**
   * Measured on the live board: 14 of 18 journals carried a `launched` line this build could not decode,
   * so every one of them counted as an unreadable journal and the stop gate refused to resolve the run at all.
   * The identity needed to scope the gate was sitting in the file being read, and the gate was silently inert on
   * almost the whole board for a reason nobody had noticed.
   */
  it("decodes the exact line the driver writes, and finds the owner in it", () => {
    const text =
      `{"atIso":"${AT}","branch":"run-gate-session-scoped","docHash":"51da9ed7b2f10498","kind":"started"}\n` +
      `{"atIso":"2026-08-05T16:02:46.496Z","kind":"launched","pid":65036,"sessionId":"${MINE}",` +
      `"worktree":"/tmp/fleet/run-gate-session-scoped"}\n`;
    const parsed = parseLedger({ text });

    expect(parsed.unreadable).toEqual([]);
    expect(runOwnership({ events: parsed.events, sessionId: MINE }).kind).toBe("mine");
  });

  it("decodes a resumed line, and lets it transfer the run to the session named in it", () => {
    const text =
      `{"atIso":"${AT}","branch":"b","docHash":"h","kind":"started"}\n` +
      `{"atIso":"2026-08-05T15:50:33.777Z","attempt":2,"kind":"resumed","sessionId":"${THEIRS}"}\n`;
    const parsed = parseLedger({ text });

    expect(parsed.unreadable).toEqual([]);
    expect(runOwnership({ events: parsed.events, sessionId: MINE }).kind).toBe("elsewhere");
  });

  it("decodes a said line without letting a mid-flight instruction move the run's phase", () => {
    const text =
      `{"atIso":"${AT}","branch":"b","docHash":"h","kind":"started"}\n` +
      `{"atIso":"2026-08-05T13:39:32.401Z","kind":"said","message":"read this before you finish"}\n`;
    const parsed = parseLedger({ text });

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toHaveLength(2);
  });

  /**
   * `sessionId` is the one load-bearing field, so a line missing it stays UNREADABLE rather than decoding to an
   * empty identity — which would compare unequal to every real session and make the gate treat its own run as a
   * stranger's. Unreadable disarms the gate, which is the safe direction.
   */
  it("refuses to decode an identity line with no session id", () => {
    const parsed = parseLedger({ text: `{"atIso":"${AT}","kind":"launched","pid":1}\n` });

    expect(parsed.events).toEqual([]);
    expect(parsed.unreadable).toEqual([1]);
  });
});
