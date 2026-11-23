import { describe, expect, it } from "vitest";

import { firstArrival, forget, openRetained, retire, take } from "../../lib/liveRetained";

/** A reading is worth keeping; a transport failure is not. */
const keeps = (arrival: string): boolean => arrival.startsWith("reading");

describe("a torn-down channel's retained reading", () => {
  it("keeps a reading at teardown and hands it back exactly once", () => {
    const retained = openRetained<string>();
    retire({ keeps, key: "sessions|", last: "reading 1", retained });
    expect(take({ key: "sessions|", retained })).toBe("reading 1");
    expect(take({ key: "sessions|", retained })).toBe(undefined);
  });

  it("deletes an earlier entry when the channel was torn down after a press emptied it", () => {
    const retained = openRetained<string>();
    retire({ keeps, key: "board|", last: "reading before the press", retained });
    retire({ keeps, key: "board|", last: undefined, retained });
    expect([...retained.entries()]).toEqual([]);
  });

  it("deletes the older entry rather than keeping it when the last arrival is one it does not keep", () => {
    const retained = openRetained<string>();
    retire({ keeps, key: "workstreams|", last: "reading 1", retained });
    retire({ keeps, key: "workstreams|", last: "failed: fetch threw", retained });
    expect([...retained.entries()]).toEqual([]);
  });

  it("forgets an entry when no channel is alive for it", () => {
    const retained = openRetained<string>();
    retire({ keeps, key: "sessions|", last: "reading 1", retained });
    retire({ keeps, key: "depth|", last: "reading 2", retained });
    forget({ key: "sessions|", retained });
    expect([...retained.entries()]).toEqual([["depth|", "reading 2"]]);
  });

  it("holds one entry per key, the latest", () => {
    const retained = openRetained<string>();
    retire({ keeps, key: "watchers|", last: "reading 1", retained });
    retire({ keeps, key: "watchers|", last: "reading 2", retained });
    expect([...retained.entries()]).toEqual([["watchers|", "reading 2"]]);
  });

  it("keeps a fixture's reading apart from the live one of the same slug", () => {
    const retained = openRetained<string>();
    retire({ keeps, key: "prs|", last: "reading live", retained });
    retire({ keeps, key: "prs|busy", last: "reading frozen", retained });
    expect(take({ key: "prs|busy", retained })).toBe("reading frozen");
    expect(take({ key: "prs|", retained })).toBe("reading live");
  });
});

describe("what a mounting component draws first", () => {
  it("prefers the live channel's reading over a retained one", () => {
    const retained = openRetained<string>();
    retained.set("hands|", "reading retained");
    expect(firstArrival({ key: "hands|", live: { last: "reading live" }, retained })).toBe("reading live");
  });

  it("draws loading for a live channel a press emptied, even with a reading retained", () => {
    const retained = openRetained<string>();
    retained.set("hands|", "reading retained");
    expect(firstArrival({ key: "hands|", live: { last: undefined }, retained })).toBe(undefined);
  });

  it("falls back to the retained reading only when no channel is alive", () => {
    const retained = openRetained<string>();
    retained.set("hands|", "reading retained");
    expect(firstArrival({ key: "hands|", live: undefined, retained })).toBe("reading retained");
  });

  it("draws loading when nothing is alive and nothing was kept", () => {
    expect(firstArrival({ key: "hands|", live: undefined, retained: openRetained<string>() })).toBe(undefined);
  });

  it("only reads, so the entry is still there for the channel that takes it", () => {
    const retained = openRetained<string>();
    retained.set("hands|", "reading retained");
    firstArrival({ key: "hands|", live: undefined, retained });
    expect(take({ key: "hands|", retained })).toBe("reading retained");
  });
});
