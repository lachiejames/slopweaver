/**
 * The CLI's copy of the picture wire, as a `picture.read` request and its answer cross it: the request names one
 * handle, and the answer carries exactly the declared fields, within both caps, each call in the lane its status
 * says — and a full picture of the longest values still fits one socket line.
 */
import { describe, expect, it } from "vitest";

import {
  APP_HARNESS_MAX_LINE_BYTES,
  APP_HARNESS_PROTOCOL_VERSION,
  isAppHarnessRequestEnvelope,
  isAppHarnessResponseEnvelope,
} from "../../../sessionHarness/appProtocol.js";

const T0 = "2026-11-09T01:00:00.000Z";

/** A digest-shaped call id: `sha256:` and 64 hex digits, the index in the last ones so each is distinct. */
function digest({ index }: { index: number }): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

const COUNTS = {
  delegate: 0,
  delete: 0,
  edit: 0,
  execute: 1,
  fetch: 0,
  move: 0,
  other: 0,
  read: 1,
  search: 0,
  switch_mode: 0,
  think: 0,
};

const RUNNING = {
  lastObservedAtIso: T0,
  name: "Bash",
  startedAtIso: T0,
  status: "in_progress",
  toolCallId: digest({ index: 1 }),
  toolKind: "execute",
};
const ENDED = {
  lastObservedAtIso: T0,
  startedAtIso: T0,
  status: "completed",
  toolCallId: digest({ index: 2 }),
  toolKind: "read",
};

const PICTURE = {
  facts: {
    countsByKind: COUNTS,
    droppedActivityEvents: 0,
    firstActivityAtIso: T0,
    inFlight: [RUNNING],
    lastActivityAtIso: T0,
    lastCompleted: [ENDED],
  },
  readAtIso: T0,
  session: { handle: "app:0b5e", sessionId: "0b5e", state: "running", title: "abc-1", vendor: "claude" },
};

const EMPTY = {
  ...PICTURE,
  facts: {
    countsByKind: { ...COUNTS, execute: 0, read: 0 },
    droppedActivityEvents: 0,
    inFlight: [],
    lastCompleted: [],
  },
};

function answered({ picture }: { picture: unknown }): boolean {
  return isAppHarnessResponseEnvelope({
    outcome: "answered",
    protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
    requestId: "r1",
    response: { kind: "picture", picture },
  });
}

/** The populated picture with the given fact fields laid over its own. */
function withFacts(overrides: Record<string, unknown>): unknown {
  return { ...PICTURE, facts: { ...PICTURE.facts, ...overrides } };
}

describe("a picture.read request", () => {
  it("names one handle, and nothing else", () => {
    const envelope = (request: Record<string, unknown>) => ({
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      request,
      requestId: "r1",
    });
    expect(
      [{ handle: "app:0b5e", kind: "picture.read" }, { kind: "picture.read" }, { handle: 7, kind: "picture.read" }].map(
        (request) => isAppHarnessRequestEnvelope(envelope(request)),
      ),
    ).toEqual([true, false, false]);
  });
});

describe("a picture answer", () => {
  it("accepts an empty picture and a populated one", () => {
    expect([answered({ picture: EMPTY }), answered({ picture: PICTURE })]).toEqual([true, true]);
  });

  it("refuses a title, input or output smuggled onto a call, the picture or its session, and a name that is a command", () => {
    expect(
      [
        withFacts({ inFlight: [{ ...RUNNING, title: "cat notes.txt" }] }),
        withFacts({ lastCompleted: [{ ...ENDED, rawOutput: "the file" }] }),
        withFacts({ inFlight: [{ ...RUNNING, name: "cat notes.txt" }] }),
        { ...PICTURE, transcript: "hello" },
        { ...PICTURE, session: { ...PICTURE.session, lastAgentText: "hello" } },
        withFacts({ lastPrompt: "hello" }),
      ].map((picture) => answered({ picture })),
    ).toEqual([false, false, false, false, false, false]);
  });

  it("refuses an id or parent that is not a digest, even a bare identifier such as a one-word command", () => {
    expect(
      [
        withFacts({ inFlight: [{ ...RUNNING, toolCallId: "whoami" }] }),
        withFacts({ inFlight: [{ ...RUNNING, toolCallId: "cat notes.txt" }] }),
        withFacts({ lastCompleted: [{ ...ENDED, parentToolCallId: "README.md" }] }),
        withFacts({ lastCompleted: [{ ...ENDED, parentToolCallId: digest({ index: 3 }).toUpperCase() }] }),
        withFacts({ lastCompleted: [{ ...ENDED, parentToolCallId: digest({ index: 3 }) }] }),
      ].map((picture) => answered({ picture })),
    ).toEqual([false, false, false, false, true]);
  });

  it("refuses a call in the wrong lane, a count that is not whole, and a single first or last instant", () => {
    expect(
      [
        withFacts({ inFlight: [ENDED] }),
        withFacts({ lastCompleted: [RUNNING] }),
        withFacts({ countsByKind: { ...COUNTS, read: 1.5 } }),
        withFacts({ countsByKind: { ...COUNTS, browse: 1 } }),
        withFacts({ droppedActivityEvents: -1 }),
        { ...EMPTY, facts: { ...EMPTY.facts, firstActivityAtIso: T0 } },
        { ...PICTURE, session: { ...PICTURE.session, vendor: "gemini" } },
      ].map((picture) => answered({ picture })),
    ).toEqual([false, false, false, false, false, false, false]);
  });

  it("holds both caps: 64 in flight and 20 ended pass, 65 and 21 are refused", () => {
    const calls = ({ count, fact }: { count: number; fact: Record<string, unknown> }) =>
      Array.from({ length: count }, (_, index) => ({ ...fact, toolCallId: digest({ index }) }));
    expect(
      [
        withFacts({ inFlight: calls({ count: 64, fact: RUNNING }) }),
        withFacts({ inFlight: calls({ count: 65, fact: RUNNING }) }),
        withFacts({ lastCompleted: calls({ count: 20, fact: ENDED }) }),
        withFacts({ lastCompleted: calls({ count: 21, fact: ENDED }) }),
      ].map((picture) => answered({ picture })),
    ).toEqual([true, false, true, false]);
  });

  it("fits one socket line at its largest: every call at the cap, each with a parent and a 256-byte name", () => {
    const name = ({ index }: { index: number }) => `${String(index).padStart(3, "0")}${"n".repeat(253)}`;
    const fact = ({ index, lane }: { index: number; lane: Record<string, unknown> }) => ({
      ...lane,
      name: name({ index }),
      parentToolCallId: digest({ index: index + 500 }),
      toolCallId: digest({ index }),
    });
    const picture = withFacts({
      droppedActivityEvents: Number.MAX_SAFE_INTEGER,
      inFlight: Array.from({ length: 64 }, (_, index) => fact({ index, lane: RUNNING })),
      lastCompleted: Array.from({ length: 20 }, (_, index) => fact({ index: index + 100, lane: ENDED })),
    });
    expect(new TextEncoder().encode(name({ index: 1 })).length).toBe(256);
    expect(answered({ picture })).toBe(true);
    expect(answered({ picture: withFacts({ inFlight: [{ ...RUNNING, name: `${name({ index: 1 })}n` }] }) })).toBe(
      false,
    );
    const line = JSON.stringify({
      outcome: "answered",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r1",
      response: { kind: "picture", picture },
    });
    expect(new TextEncoder().encode(line).length).toBeLessThan(APP_HARNESS_MAX_LINE_BYTES);
  });
});
