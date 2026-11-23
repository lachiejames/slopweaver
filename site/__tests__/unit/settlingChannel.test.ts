import { describe, expect, it } from "vitest";

import {
  acceptsHidden,
  actsOnceHeard,
  hiddenAcross,
  hiddenAfterPress,
  parseSettlingMessage,
  postedHidden,
  pressedKeys,
  SETTLING_HANDSHAKE_MS,
  settlingHeard,
  withoutPress,
} from "../../lib/settlingChannel";

// A press in the console window must hide its act everywhere, or the voice overlay — another document —
// could open an act the owner had just settled. Every document now posts its hidden rows and keeps every other's.
describe("parseSettlingMessage", () => {
  it("reads an ask and a writer's hidden rows, whether they are all of them, and their number", () => {
    expect(parseSettlingMessage({ data: { kind: "ask" } })).toEqual({ kind: "ask" });
    const data = { complete: false, keys: ["act:acme-1"], kind: "hidden", seq: 3, writer: "w1" };
    expect(parseSettlingMessage({ data })).toEqual(data);
  });

  it("drops anything that is not exactly one, a runaway list, an unsaid completeness and a bad number included", () => {
    const ok = { complete: true, keys: ["act:acme-1"], kind: "hidden", seq: 1, writer: "w1" };
    const dropped = [
      null,
      "ask",
      { complete: true, kind: "hidden", seq: 1, writer: "w1" },
      { ...ok, writer: "" },
      { ...ok, keys: [7] },
      { ...ok, keys: [""] },
      { ...ok, keys: ["x".repeat(257)] },
      { ...ok, keys: Array.from({ length: 513 }, (_, index) => `act:${index}`) },
      { keys: ["act:acme-1"], kind: "hidden", seq: 1, writer: "w1" },
      { ...ok, complete: "yes" },
      { complete: true, keys: ["act:acme-1"], kind: "hidden", writer: "w1" },
      { ...ok, seq: -1 },
      { ...ok, seq: 1.5 },
      { ...ok, kind: "shown" },
    ].map((data) => parseSettlingMessage({ data }));
    expect(dropped).toEqual(Array.from({ length: 14 }, () => undefined));
  });
});

// A surviving document relays every list it holds to a late opener, so a relayed copy can arrive
// after its writer's own newer post — only a higher number replaces what is held.
describe("acceptsHidden", () => {
  it("keeps the first list heard for a writer, and a higher-numbered one after it", () => {
    expect([acceptsHidden({ held: undefined, seq: 0 }), acceptsHidden({ held: 2, seq: 3 })]).toEqual([true, true]);
  });

  it("never rolls a writer's list back to an older or equal copy", () => {
    expect([acceptsHidden({ held: 3, seq: 2 }), acceptsHidden({ held: 3, seq: 3 })]).toEqual([false, false]);
  });
});

// The answers to a document's opening ask arrive as later tasks, so a check inside the handshake
// window could open an act another window had just settled.
describe("settlingHeard", () => {
  it("has not heard inside the handshake window, and has once it passes", () => {
    const openedAtMs = 1_000_000;
    expect(
      [0, SETTLING_HANDSHAKE_MS - 1, SETTLING_HANDSHAKE_MS].map((after) =>
        settlingHeard({ nowMs: openedAtMs + after, openedAtMs, partial: false }),
      ),
    ).toEqual([false, false, true]);
  });

  // A list cut short must not leave out a row the owner settled, which then read as open after the handshake.
  it("has not heard while another document's latest list was cut short, however long ago it opened", () => {
    expect(settlingHeard({ nowMs: 10 * SETTLING_HANDSHAKE_MS, openedAtMs: 0, partial: true })).toBe(false);
  });

  it("has heard where there is no channel to hear from", () => {
    expect(settlingHeard({ nowMs: 0, openedAtMs: undefined, partial: false })).toBe(true);
  });
});

describe("actsOnceHeard", () => {
  it("resolves no act and names the settled acts unread before every list is heard whole", () => {
    expect(actsOnceHeard({ acts: ["act:acme-1"], heard: false })).toEqual({
      acts: [],
      unread: [{ source: "settled acts", why: "not yet heard in full from the owner's other console windows" }],
    });
  });

  it("resolves every act, naming nothing unread, once it has", () => {
    expect(actsOnceHeard({ acts: ["act:acme-1"], heard: true })).toEqual({ acts: ["act:acme-1"], unread: [] });
  });
});

// A list past the reader's cap was dropped whole, so the newest settle never arrived; the list cut to the cap says it was cut, so no reader trusts it as whole.
describe("postedHidden", () => {
  it("posts the newest rows a reader accepts, the newest settle included, and says rows were left out", () => {
    const hidden = Array.from({ length: 513 }, (_, index) => `act:${String(index + 1)}`);
    const posted = postedHidden({ hidden });
    const message = parseSettlingMessage({ data: { ...posted, kind: "hidden", seq: 1, writer: "w1" } });
    expect([posted.complete, posted.keys.length, posted.keys[0], posted.keys.at(-1)]).toEqual([
      false,
      512,
      "act:2",
      "act:513",
    ]);
    expect(message).toEqual({ ...posted, kind: "hidden", seq: 1, writer: "w1" });
  });

  it("posts a list at the cap or under whole, and says so", () => {
    const atCap = Array.from({ length: 512 }, (_, index) => `act:${String(index + 1)}`);
    expect(postedHidden({ hidden: ["act:acme-1"] })).toEqual({ complete: true, keys: ["act:acme-1"] });
    expect(postedHidden({ hidden: atCap })).toEqual({ complete: true, keys: atCap });
  });
});

// Settling the newest act of a pattern settles its earlier ones, which an older snapshot in another
// document still draws as rows of their own.
describe("pressedKeys", () => {
  it("hides the row and every earlier act folded under it, once each", () => {
    expect(pressedKeys({ aliases: ["act:acme-e", "act:acme-n", "act:acme-e"], key: "act:acme-n" })).toEqual([
      "act:acme-n",
      "act:acme-e",
    ]);
  });

  it("hides the row alone when it folds nothing", () => {
    expect(pressedKeys({ aliases: undefined, key: "act:acme-n" })).toEqual(["act:acme-n"]);
  });
});

// A refused press took back every occurrence of its keys, an earlier press's settle included.
describe("withoutPress", () => {
  it("takes back only the refused press's own occurrence, leaving an earlier settle of a folded act hidden", () => {
    const hidden = ["act:acme-old", "act:acme-new", "act:acme-old"];
    expect(withoutPress({ hidden, pressed: ["act:acme-new", "act:acme-old"] })).toEqual(["act:acme-old"]);
  });

  it("takes back a lone press whole, and ignores a key it never held", () => {
    expect(withoutPress({ hidden: ["act:acme-1"], pressed: ["act:acme-1", "act:acme-2"] })).toEqual([]);
  });
});

// An unknown press may have landed, and putting its row back let a stale window open the act.
describe("hiddenAfterPress", () => {
  const hidden = ["act:acme-old", "act:acme-new", "act:acme-old"];
  const pressed = ["act:acme-new", "act:acme-old"];

  it("takes back a refused press's own occurrences, since a refusal wrote nothing", () => {
    expect(hiddenAfterPress({ hidden, phase: "refused", pressed })).toEqual(["act:acme-old"]);
  });

  it("keeps every row hidden after a done press and after an unknown one alike", () => {
    expect([
      hiddenAfterPress({ hidden, phase: "done", pressed }),
      hiddenAfterPress({ hidden, phase: "unknown", pressed }),
    ]).toEqual([hidden, hidden]);
  });
});

describe("hiddenAcross", () => {
  it("names this document's rows first, then every other document's once each", () => {
    const remote = new Map([
      ["w1", { keys: ["act:acme-2", "act:acme-1"] }],
      ["w2", { keys: ["act:acme-3", "act:acme-2"] }],
    ]);
    expect(hiddenAcross({ local: ["act:acme-1"], remote })).toEqual(["act:acme-1", "act:acme-2", "act:acme-3"]);
  });

  it("puts a row back everywhere once its writer's latest list no longer names it", () => {
    const remote = new Map([["w1", { keys: [] }]]);
    expect(hiddenAcross({ local: [], remote })).toEqual([]);
  });
});
