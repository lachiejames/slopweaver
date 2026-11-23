/*
 * The containment layer, driven by the values that actually break a `catch`.
 *
 * `run.test.ts` reaches this module through the whole supersession and proves the ORDERING it buys — an
 * unwritten intent row refusing the delete, an unwritten result row still reporting it. What it cannot
 * reach is the set of thrown values `causeOf`'s header names as its counterexamples, because a journal seam
 * inside a supersession test throws an ordinary `Error`. Each of the three below made an earlier version of
 * this code throw while describing a throw, which is the one failure a containment layer cannot have.
 */
import { describe, expect, it } from "vitest";

import { supersessionSettled } from "../../../../../live/turn/supersession/journal.js";
import { causeOf, record, withUnwritten } from "../../../../../live/turn/supersession/journalWrite.js";

const ROW = supersessionSettled({
  outcome: "deleted",
  targetTs: "1790054484.916599",
  tsIso: "2026-09-22T05:40:00.000Z",
  turnId: "turn-1790055912004",
});

describe("record", () => {
  it("answers undefined and hands the built row to the seam when the append lands", () => {
    const written: unknown[] = [];
    const unwritten = record({
      build: () => ROW,
      journal: ({ event }) => {
        written.push(event);
      },
    });

    expect(unwritten).toBeUndefined();
    expect(written).toEqual([ROW]);
  });

  it("answers the throw's own sentence rather than raising it", () => {
    const unwritten = record({
      build: () => ROW,
      journal: () => {
        throw new Error("EROFS: read-only file system, mkdir '/live/slack'");
      },
    });

    expect(unwritten).toBe("EROFS: read-only file system, mkdir '/live/slack'");
  });

  it("contains a throw from BUILD too, so the clock is inside the try", () => {
    // The reason the row is built in here rather than at the call site: `nowIso` is a seam, and a seam that
    // throws while the row is being constructed is exactly as fatal as one that throws while writing it.
    const unwritten = record({
      build: (): never => {
        throw new Error("the clock seam is broken");
      },
      journal: () => undefined,
    });

    expect(unwritten).toBe("the clock seam is broken");
  });
});

describe("causeOf — the three values that break a naive describe-the-throw", () => {
  it("prints a value with no prototype, which String() alone raises on", () => {
    expect(causeOf({ thrown: Object.create(null) })).toBe(
      "the thrown value (a object) could not be inspected or printed",
    );
  });

  it("prints a REVOKED proxy, which `instanceof` alone raises on", () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(causeOf({ thrown: revocable.proxy })).toBe("the thrown value (a object) could not be inspected or printed");
  });

  it("prints an Error whose `message` is a symbol at runtime despite its type", () => {
    const lying = new Error("replaced");
    Object.defineProperty(lying, "message", { value: Symbol("the real message") });

    expect(causeOf({ thrown: lying })).toBe("Symbol(the real message)");
  });

  it("prints an ordinary Error's own message, and a non-Error value as it prints", () => {
    expect(causeOf({ thrown: new Error("ENOSPC: no space left on device") })).toBe("ENOSPC: no space left on device");
    expect(causeOf({ thrown: 404 })).toBe("404");
  });
});

describe("withUnwritten", () => {
  it("returns the detail unchanged when the row landed", () => {
    expect(withUnwritten({ detail: "the reviewer judged it additive", unwritten: undefined })).toBe(
      "the reviewer judged it additive",
    );
  });

  it("returns undefined when there was neither a detail nor a failed append", () => {
    expect(withUnwritten({ detail: undefined, unwritten: undefined })).toBeUndefined();
  });

  it("speaks the failed append alone when the supersession itself had nothing to say", () => {
    expect(withUnwritten({ detail: undefined, unwritten: "EROFS" })).toBe(
      "the journal row recording this supersession could not be written: EROFS",
    );
  });

  it("carries both, so a clean delete with an unwritten row does not read as a clean delete", () => {
    expect(withUnwritten({ detail: "the answer was removed", unwritten: "EROFS" })).toBe(
      "the answer was removed — and the journal row recording it could not be written: EROFS",
    );
  });
});
