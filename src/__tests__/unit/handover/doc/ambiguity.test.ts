import { describe, expect, it } from "vitest";

import { blockerFor, type HandoverDoc, parseHandoverDoc } from "../../../../handover/doc.js";
import { doc } from "./harness.js";

/**
 * Both counterexamples a review pass built against this file. Each was real.
 *
 * The shape they share: the board RESOLVING an ambiguity it should be reporting. Quietly picking a winner is
 * the overclaim the board exists to remove, so an ambiguity is now a blocker with the paths named.
 */
describe("ambiguity is reported, never resolved", () => {
  /**
   * `new Map(all.map(...))` keeps the LAST entry, and the scan sorts filenames — so `02-done.md` overwrote
   * `01-pending.md` and a dependent printed under RUN NOW while an unfinished doc held the same slug.
   */
  it("blocks every doc sharing a slug rather than letting filename order pick a winner", () => {
    const pending: HandoverDoc = { ...doc({ slug: "prerequisite" }), path: "/h/01-pending.md" };
    const finished: HandoverDoc = { ...doc({ slug: "prerequisite", status: "done" }), path: "/h/02-done.md" };
    const consumer = doc({ blockedBy: ["prerequisite"], slug: "consumer" });
    const all = [pending, finished, consumer];

    expect(blockerFor({ all, doc: pending })?.kind).toBe("duplicate-slug");
    expect(blockerFor({ all, doc: finished })?.kind).toBe("duplicate-slug");
    expect(blockerFor({ all, doc: consumer })).toEqual({ kind: "ambiguous-dependency", on: ["prerequisite"] });
  });

  it("names the competing files, so the duplicate can be found and fixed", () => {
    const one: HandoverDoc = { ...doc({ slug: "same" }), path: "/h/a.md" };
    const two: HandoverDoc = { ...doc({ slug: "same" }), path: "/h/b.md" };

    const blocker = blockerFor({ all: [one, two], doc: one });

    expect(blocker?.kind === "duplicate-slug" ? blocker.paths : []).toEqual(["/h/a.md", "/h/b.md"]);
  });

  it("leaves a unique slug alone", () => {
    const first = doc({ slug: "first", status: "done" });
    const second = doc({ blockedBy: ["first"], slug: "second" });

    expect(blockerFor({ all: [first, second], doc: second })).toBeUndefined();
  });

  it("tolerates a dependency listed twice", () => {
    const first = doc({ slug: "first", status: "ready" });
    const second = doc({ blockedBy: ["first", "first"], slug: "second" });

    expect(blockerFor({ all: [first, second], doc: second })).toEqual({ kind: "waiting", on: ["first"] });
  });
});

/**
 * The third counterexample a review pass built against this file, and the same shape as the first two:
 * a silent last-wins resolution where a report was needed.
 */
describe("a doc that did not parse cleanly is not runnable", () => {
  const REPEATED = `---
slug: consumer
status: ready
blockedBy: [prerequisite]
blockedBy:
---
`;

  it("reports a repeated key rather than letting the last one win", () => {
    const parsed = parseHandoverDoc({ path: "/h/consumer.md", text: REPEATED });

    expect(parsed.problems.length).toBe(1);
    expect(parsed.problems[0]).toContain('declares "blockedBy" more than once');
  });

  /** The exact failure: a blank duplicate erased a real dependency and the doc printed under RUN NOW. */
  it("keeps the FIRST value, so a blank duplicate cannot erase a real dependency", () => {
    expect(parseHandoverDoc({ path: "/h/consumer.md", text: REPEATED }).blockedBy).toEqual(["prerequisite"]);
  });

  it("blocks the doc outright, because a parse defect corrupts the very fields the board reads", () => {
    const parsed = parseHandoverDoc({ path: "/h/consumer.md", text: REPEATED });

    expect(blockerFor({ all: [parsed], doc: parsed })?.kind).toBe("malformed");
  });

  it("leaves a well-formed doc alone", () => {
    const parsed = parseHandoverDoc({ path: "/h/fine.md", text: "---\nslug: fine\nstatus: ready\n---\n" });

    expect(parsed.problems).toEqual([]);
    expect(blockerFor({ all: [parsed], doc: parsed })).toBeUndefined();
  });
});
