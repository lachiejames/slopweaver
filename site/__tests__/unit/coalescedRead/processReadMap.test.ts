import { describe, expect, it, vi } from "vitest";
import { processReadMap } from "../../../lib/coalescedRead";

describe("processReadMap", () => {
  it("hands a re-evaluated module the SAME map, so a dev reload cannot empty the reads still running", async () => {
    const before = processReadMap<string>({ name: "reload-witness" });
    before.set("C0ONE", { answer: Promise.resolve("C0ONE read"), settledAtMs: undefined });
    vi.resetModules();
    const reloaded = await import("../../../lib/coalescedRead");

    const after = reloaded.processReadMap<string>({ name: "reload-witness" });

    expect(reloaded.processReadMap).not.toBe(processReadMap);
    expect(after).toBe(before);
    expect([...after.keys()]).toEqual(["C0ONE"]);
    before.clear();
  });

  it("keeps two routes' reads apart", () => {
    expect(processReadMap<string>({ name: "route-a" })).not.toBe(processReadMap<string>({ name: "route-b" }));
  });
});
