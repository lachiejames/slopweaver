/**
 * The witnessed-thread snapshot on disk: missing reads as empty, corrupt refuses, a write round-trips, and the
 * gate answers only after its snapshot saved.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { WitnessStateErrors } from "../../../../live/listen/witnessErrors.js";
import { emptyWitnessState, type WitnessState } from "../../../../live/listen/witnessState.js";
import {
  openWitnessGate,
  parseWitnessState,
  readWitnessState,
  witnessGateOver,
  writeWitnessState,
} from "../../../../live/listen/witnessStateStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const ROOT = "1790000000.000100";
const ROOT_MS = 1_790_000_000_000;
const TAGGED = { activatesFor: "U0PEER", channel: "C0OPS", messageTs: ROOT, tagsSelf: false, threadTs: ROOT };

/** A snapshot holding one thread row, as JSON text. */
function snapshotText({ row }: { row: Record<string, unknown> }): string {
  return JSON.stringify({
    threads: { k: { channel: "C", dayCounts: { "2026-09-21": 1 }, lastObservedTs: ROOT, threadTs: ROOT, ...row } },
    version: 1,
  });
}

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "witness-state-"));
  homes.push(home);
  return home;
}

describe("readWitnessState / writeWitnessState", () => {
  it("reads a missing snapshot as witnessing nothing", () => {
    expect(unwrap(readWitnessState({ home: freshHome() }))).toEqual(emptyWitnessState());
  });

  it("round-trips a written snapshot", () => {
    const home = freshHome();
    const state: WitnessState = {
      threads: {
        [`C0OPS:${ROOT}`]: {
          channel: "C0OPS",
          dayCounts: { "2026-09-20": 40, "2026-09-21": 3 },
          lastObservedTs: ROOT,
          threadTs: ROOT,
          witnessUserId: "U0PEER",
        },
      },
      version: 1,
    };
    unwrap(writeWitnessState({ home, state }));

    expect(unwrap(readWitnessState({ home }))).toEqual(state);
  });

  it("refuses a corrupt snapshot rather than reading it as empty", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.witnessStateJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");

    const error = unwrapErr(readWitnessState({ home }));
    expect(error.code).toBe("WITNESS_STATE_MALFORMED");
    expect(error.message).toContain("refusing to treat a corrupt snapshot as no threads");
  });
});

describe("parseWitnessState", () => {
  it("refuses an unknown version", () => {
    const error = unwrapErr(parseWitnessState({ path: "/x", text: '{"threads":{},"version":2}' }));

    expect(error.code).toBe("WITNESS_STATE_MALFORMED");
  });

  it("refuses a thread with a negative day count", () => {
    const text = JSON.stringify({
      threads: {
        k: { channel: "C", dayCounts: { "2026-09-21": -1 }, lastObservedTs: ROOT, threadTs: ROOT, witnessUserId: "U" },
      },
      version: 1,
    });

    expect(unwrapErr(parseWitnessState({ path: "/x", text })).code).toBe("WITNESS_STATE_MALFORMED");
  });

  it("parses a row written before the own watch existed, peer only", () => {
    const state = unwrap(parseWitnessState({ path: "/x", text: snapshotText({ row: { witnessUserId: "U0PEER" } }) }));

    expect(state.threads["k"]!.witnessUserId).toBe("U0PEER");
    expect(state.threads["k"]!.ownTaggedTs).toBe(undefined);
  });

  it("parses an own-only row", () => {
    const state = unwrap(parseWitnessState({ path: "/x", text: snapshotText({ row: { ownTaggedTs: ROOT } }) }));

    expect(state.threads["k"]!.ownTaggedTs).toBe(ROOT);
    expect(state.threads["k"]!.witnessUserId).toBe(undefined);
  });

  it("refuses a row carrying neither watch", () => {
    const error = unwrapErr(parseWitnessState({ path: "/x", text: snapshotText({ row: {} }) }));

    expect(error.code).toBe("WITNESS_STATE_MALFORMED");
    expect(error.message).toContain("names a peer bot (witnessUserId) or this bot's own tag (ownTaggedTs)");
  });
});

describe("witnessGateOver", () => {
  it("saves the activated thread before answering admitted", () => {
    const saved: WitnessState[] = [];
    const gate = witnessGateOver({
      initial: emptyWitnessState(),
      now: () => ROOT_MS,
      save: ({ state }) => {
        saved.push(state);
        return ok(undefined);
      },
    });

    expect(unwrap(gate.observe({ handOff: true, observation: TAGGED })).kind).toBe("admitted");
    expect(Object.keys(saved[0]!.threads)).toEqual([`C0OPS:${ROOT}`]);
  });

  it("saves nothing for a message in an unwitnessed thread", () => {
    const saved: WitnessState[] = [];
    const gate = witnessGateOver({
      initial: emptyWitnessState(),
      now: () => ROOT_MS,
      save: ({ state }) => {
        saved.push(state);
        return ok(undefined);
      },
    });

    expect(unwrap(gate.observe({ handOff: true, observation: { ...TAGGED, activatesFor: undefined } })).kind).toBe(
      "inactive",
    );
    expect(saved).toEqual([]);
  });

  it("answers the write failure, and keeps believing what the disk holds", () => {
    let failing = true;
    const gate = witnessGateOver({
      initial: emptyWitnessState(),
      now: () => ROOT_MS,
      save: () => (failing ? err(WitnessStateErrors.writeFailed({ cause: "disk full", path: "/x" })) : ok(undefined)),
    });
    const failed = gate.observe({ handOff: true, observation: TAGGED });
    failing = false;
    const untagged = gate.observe({ handOff: true, observation: { ...TAGGED, activatesFor: undefined } });

    expect(unwrapErr(failed).code).toBe("WITNESS_STATE_WRITE_FAILED");
    expect(unwrap(untagged).kind).toBe("inactive");
  });
});

describe("openWitnessGate", () => {
  it("persists through the home, so a second gate opened there sees the thread", () => {
    const home = freshHome();
    // 2030: the live gate runs on the wall clock, and a thread in the future is inside retention whenever
    // this runs — a past instant would fall out of the window as the calendar moved on.
    const future = "1900000000.000100";
    const observation = { ...TAGGED, messageTs: future, threadTs: future };
    unwrap(unwrap(openWitnessGate({ home })).observe({ handOff: true, observation }));

    expect(Object.keys(unwrap(readWitnessState({ home })).threads)).toEqual([`C0OPS:${future}`]);
  });
});
