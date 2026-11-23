import { describe, expect, it } from "vitest";

import { holdQuiet, openQuietGate, tickRuns } from "../../lib/liveQuiet";

describe("the fast lane's quiet gate", () => {
  it("runs every tick while nobody holds it, and remembers none", () => {
    const gate = openQuietGate();
    expect(tickRuns({ gate, key: "hands|" })).toBe(true);
    expect([...gate.held]).toEqual([]);
  });

  it("holds a tick while a call holds the gate, and hands each held channel back once on release", () => {
    const gate = openQuietGate();
    const release = holdQuiet({ gate });
    expect(tickRuns({ gate, key: "hands|" })).toBe(false);
    expect(tickRuns({ gate, key: "drafts|" })).toBe(false);
    expect(tickRuns({ gate, key: "hands|" })).toBe(false);
    expect(release()).toEqual(["hands|", "drafts|"]);
    expect(tickRuns({ gate, key: "hands|" })).toBe(true);
  });

  it("releases nothing until the LAST holder lets go", () => {
    const gate = openQuietGate();
    const first = holdQuiet({ gate });
    const second = holdQuiet({ gate });
    tickRuns({ gate, key: "slack-drafts|" });
    expect(first()).toEqual([]);
    expect(tickRuns({ gate, key: "hands|" })).toBe(false);
    expect(second()).toEqual(["slack-drafts|", "hands|"]);
  });

  it("lets go once when a cleanup runs its release twice", () => {
    const gate = openQuietGate();
    const other = holdQuiet({ gate });
    const release = holdQuiet({ gate });
    release();
    release();
    expect(gate.holds).toBe(1);
    tickRuns({ gate, key: "hands|" });
    expect(other()).toEqual(["hands|"]);
  });
});
