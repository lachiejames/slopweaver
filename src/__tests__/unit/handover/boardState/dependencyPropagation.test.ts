/*
 * How a row's `blockedBy` resolves — a missing, unfinished, done, cancelled, rejected, cyclic or archived dependency
 * — and `dependencyClosures` on its own. It moved here when `boardState.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { dependencyClosures } from "../../../../handover/boardDependencies.js";
import { compose, doc } from "./harness.js";

describe("composeBoardModels — precedence", () => {
  describe("dependency propagation", () => {
    it("blocks on a missing dependency", () => {
      const models = compose({ roots: [doc({ blockedBy: ["ghost"], slug: "a", status: "ready" })] });
      expect(models[0]?.section).toBe("NOT YET");
    });

    it("blocks on an unfinished dependency", () => {
      const models = compose({
        roots: [doc({ slug: "a", status: "ready" }), doc({ blockedBy: ["a"], slug: "b", status: "ready" })],
      });
      expect(models[0]?.section).toBe("RUN NOW");
      expect(models[1]?.section).toBe("NOT YET");
    });

    it("resolves once the dependency reaches DONE", () => {
      const models = compose({
        roots: [doc({ slug: "a", status: "done" }), doc({ blockedBy: ["a"], slug: "b", status: "ready" })],
      });
      expect(models[1]?.section).toBe("RUN NOW");
    });

    it("propagates a direct cancelled dependency with its exact reason", () => {
      const models = compose({
        roots: [
          doc({ slug: "a", status: "cancelled", statusSummary: "not worth it" }),
          doc({ blockedBy: ["a"], slug: "b", status: "ready" }),
        ],
      });
      expect(models[1]?.section).toBe("NOT YET");
      expect(models[1]?.dependencyClosures).toEqual([
        { leaf: "a", reason: "not worth it", status: "cancelled", via: ["b", "a"] },
      ]);
    });

    it("propagates a transitive rejected dependency through an intermediate doc", () => {
      const models = compose({
        roots: [
          doc({ slug: "a", status: "rejected", statusSummary: "owner declined" }),
          doc({ blockedBy: ["a"], slug: "b", status: "ready" }),
          doc({ blockedBy: ["b"], slug: "c", status: "ready" }),
        ],
      });
      const c = models[2]!;
      expect(c.section).toBe("NOT YET");
      expect(c.dependencyClosures).toEqual([
        { leaf: "a", reason: "owner declined", status: "rejected", via: ["c", "b", "a"] },
      ]);
    });

    it("never auto-cancels the dependant, and never infinitely recurses on a dependency cycle", () => {
      const models = compose({
        roots: [
          doc({ blockedBy: ["b"], slug: "a", status: "ready" }),
          doc({ blockedBy: ["a"], slug: "b", status: "ready" }),
        ],
      });
      expect(models[0]?.doc.status).not.toBe("cancelled");
      expect(models[0]?.section).toBe("NOT YET");
      expect(models[1]?.section).toBe("NOT YET");
    });

    it("resolves an archived terminal prerequisite via resolutionDocs, without exposing it as a root", () => {
      const archived = doc({ slug: "archived-a", status: "cancelled", statusSummary: "superseded" });
      const models = compose({
        resolutionDocs: [doc({ blockedBy: ["archived-a"], slug: "b", status: "ready" }), archived],
        roots: [doc({ blockedBy: ["archived-a"], slug: "b", status: "ready" })],
      });
      expect(models).toHaveLength(1);
      expect(models[0]?.dependencyClosures).toEqual([
        { leaf: "archived-a", reason: "superseded", status: "cancelled", via: ["b", "archived-a"] },
      ]);
    });

    it("also satisfies a dependency on an archived DONE doc — the more common archival case", () => {
      const archivedDone = doc({ slug: "archived-done", status: "done" });
      const dependant = doc({ blockedBy: ["archived-done"], slug: "b", status: "ready" });
      const models = compose({ resolutionDocs: [dependant, archivedDone], roots: [dependant] });
      expect(models).toHaveLength(1);
      expect(models[0]?.section).toBe("RUN NOW");
      expect(models[0]?.dependencyClosures).toEqual([]);
    });
  });
});

describe("dependencyClosures", () => {
  it("returns nothing for a doc with no blockedBy", () => {
    expect(dependencyClosures({ all: new Map(), doc: doc({ slug: "a" }) })).toEqual([]);
  });

  it("is silent about a satisfied (done) dependency", () => {
    const a = doc({ slug: "a", status: "done" });
    const b = doc({ blockedBy: ["a"], slug: "b" });
    expect(
      dependencyClosures({
        all: new Map([
          ["a", a],
          ["b", b],
        ]),
        doc: b,
      }),
    ).toEqual([]);
  });
});
