import { describe, expect, it } from "vitest";

import { queueScreenBreaks, sameKeys } from "../../../desktop/e2eQueueScreen.js";

/** Every card the tab's rows hold: each drawn card in these tests, and one more another view draws. */
const ROWS = ["ABC-1", "ABC-2", "ABC-3", "ABC-9", "ABC-1\nABC-2", "ABC-7"];

/**
 * A served bridge answer carrying one snapshot.
 *
 * @param snapshot the snapshot's fields, serialised as the wire carries them
 * @returns what `requestVoiceQueue` resolves for it
 */
function served({ snapshot }: { snapshot: Record<string, unknown> }): unknown {
  return { kind: "served", snapshot: JSON.stringify(snapshot) };
}

/**
 * A snapshot taken on the Queue, saying it drew `keys`.
 *
 * @param keys the keys the snapshot says the Queue drew, in order
 * @returns the snapshot's fields
 */
function onQueue({ keys }: { keys: readonly string[] }): Record<string, unknown> {
  return { cards: { rows: ROWS.map((key) => ({ key })) }, drawnKeys: keys, path: "/queue" };
}

describe("sameKeys", () => {
  it("tells a newline inside a key from two keys, where a joined string would not", () => {
    expect(sameKeys({ left: ["ABC-1\nABC-2"], right: ["ABC-1", "ABC-2"] })).toBe(false);
  });

  it("holds for the same keys in the same order, and not for another order", () => {
    expect([
      sameKeys({ left: ["ABC-1", "ABC-2"], right: ["ABC-1", "ABC-2"] }),
      sameKeys({ left: ["ABC-2", "ABC-1"], right: ["ABC-1", "ABC-2"] }),
    ]).toEqual([true, false]);
  });
});

describe("queueScreenBreaks", () => {
  it("finds nothing when the snapshot is the Queue the owner sees, in its order", () => {
    const answer = served({ snapshot: onQueue({ keys: ["ABC-1", "ABC-2"] }) });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1", "ABC-2"] } })).toEqual([]);
  });

  it("names a drawn card the card tools could not resolve in the snapshot's rows", () => {
    const answer = served({ snapshot: { ...onQueue({ keys: ["ABC-1"] }), cards: { rows: [{ key: "ABC-9" }] } } });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1"] } })).toEqual([
      "the card tools could not resolve the drawn card(s) [ABC-1] in the snapshot's rows",
    ]);
  });

  it("names drawn keys in another order than the tab's rows", () => {
    const answer = served({ snapshot: onQueue({ keys: ["ABC-2", "ABC-1"] }) });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1", "ABC-2"] } })).toEqual([
      "the snapshot says the Queue drew [ABC-2, ABC-1] where its rows carry [ABC-1, ABC-2]",
    ]);
  });

  it("names one key carrying a newline against two drawn keys", () => {
    const answer = served({ snapshot: onQueue({ keys: ["ABC-1\nABC-2"] }) });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1", "ABC-2"] } })).toEqual([
      "the snapshot says the Queue drew [ABC-1\nABC-2] where its rows carry [ABC-1, ABC-2]",
    ]);
  });

  it("names a snapshot carrying no drawn keys, and one taken off the Queue", () => {
    const answer = served({ snapshot: { cards: { rows: [] }, path: "/fleet" } });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1"] } })).toEqual([
      'the snapshot was taken on "/fleet", not the Queue',
      "the snapshot carries no list of the keys the Queue drew",
    ]);
  });

  it("accepts the Queue's path with a query on it", () => {
    const answer = served({ snapshot: { ...onQueue({ keys: ["ABC-1"] }), path: "/queue?card=ABC-1" } });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1"] } })).toEqual([]);
  });

  it("refuses a path that only starts with the Queue's", () => {
    const answer = served({ snapshot: { ...onQueue({ keys: ["ABC-1"] }), path: "/queued" } });
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1"] } })).toEqual([
      'the snapshot was taken on "/queued", not the Queue',
    ]);
  });

  it("names an unreached answer by its reason", () => {
    const answer = { kind: "unreached", why: "no console tab answered" };
    expect(queueScreenBreaks({ seen: { answer, drawnKeys: ["ABC-1"] } })).toEqual([
      "the console tab's Queue did not reach the voice's window: no console tab answered",
    ]);
  });

  it("names an answer that is not an object, one of neither kind, and a snapshot that is not JSON", () => {
    expect(queueScreenBreaks({ seen: { answer: undefined, drawnKeys: [] } })).toEqual([
      "the bridge answered undefined, not an answer",
    ]);
    expect(queueScreenBreaks({ seen: { answer: { kind: "other" }, drawnKeys: [] } })).toEqual([
      "the bridge's answer was neither served nor unreached",
    ]);
    expect(queueScreenBreaks({ seen: { answer: { kind: "served", snapshot: "{" }, drawnKeys: [] } })).toEqual([
      "the served snapshot is not JSON",
    ]);
    expect(queueScreenBreaks({ seen: { answer: { kind: "served", snapshot: "[]" }, drawnKeys: [] } })).toEqual([
      "the served snapshot is not an object",
    ]);
  });
});
