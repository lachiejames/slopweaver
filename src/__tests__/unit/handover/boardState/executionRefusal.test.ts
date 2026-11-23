/*
 * `executionRefusal` — which board sections refuse a run starting and which permit it, a paused row naming who and
 * the verb that unpauses it. It moved here when `boardState.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { executionRefusal } from "../../../../handover/boardRefusal.js";
import { compose, doc, journal, NOW } from "./harness.js";

describe("executionRefusal", () => {
  it("refuses execution on every closed/contradictory/pending section", () => {
    const closed = doc({ slug: "a", status: "done" });
    const models = compose({ roots: [closed] });
    expect(executionRefusal({ model: models[0]! })).toBeDefined();
  });

  /** Unpausing is a decision somebody types — never a side effect of `start` or `cmux spawn`. */
  it("refuses execution on a paused row, naming who and the verb that changes it", () => {
    const paused = compose({
      roots: [doc({ pausedOn: "a reviewer", slug: "a-daily-post", status: "paused" })],
    })[0]!;

    expect(executionRefusal({ model: paused })).toBe(
      "refused — paused on a reviewer — no deadline, never overdue. " +
        "Unpausing is a decision: `slopweaver handover unpause a-daily-post`",
    );
  });

  it("permits execution on RUN NOW, IN FLIGHT, and WAITING ON OWNER", () => {
    const runNow = compose({ roots: [doc({ slug: "a", status: "ready" })] })[0]!;
    expect(executionRefusal({ model: runNow })).toBeUndefined();

    const inFlight = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      roots: [doc({ slug: "a", status: "ready" })],
    })[0]!;
    expect(executionRefusal({ model: inFlight })).toBeUndefined();
  });
});
