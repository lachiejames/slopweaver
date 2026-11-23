import { describe, expect, it } from "vitest";

import { initialLinearAtlasManifest } from "../../../../atlas/linear/model.js";
import { guardWorkspace } from "../../../../atlas/linear/store.js";

const manifest = ({ workspaceId }: { workspaceId: string | null }) =>
  initialLinearAtlasManifest({ updatedAt: "2026-09-05T00:00:00.000Z", workspaceId });

describe("guardWorkspace", () => {
  it("allows the first publish, when nothing has been published before", () => {
    expect(guardWorkspace({ next: manifest({ workspaceId: "w1" }), prior: null }).isOk()).toBe(true);
  });

  it("allows a republish of the same workspace", () => {
    const result = guardWorkspace({ next: manifest({ workspaceId: "w1" }), prior: manifest({ workspaceId: "w1" }) });
    expect(result.isOk()).toBe(true);
  });

  it("REFUSES a publish that would accumulate a second workspace into one store", () => {
    const result = guardWorkspace({ next: manifest({ workspaceId: "w2" }), prior: manifest({ workspaceId: "w1" }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("workspace w1");
    expect(result._unsafeUnwrapErr()[0]).toContain("workspace w2");
  });

  it("names the reset as the remedy rather than leaving a reader stuck", () => {
    const result = guardWorkspace({ next: manifest({ workspaceId: "w2" }), prior: manifest({ workspaceId: "w1" }) });
    expect(result._unsafeUnwrapErr().at(-1)).toContain("slopweaver atlas linear reset --confirm archive");
  });

  it("prints the crossing, why it is refused and the reset that clears it, one per line", () => {
    const result = guardWorkspace({ next: manifest({ workspaceId: "w2" }), prior: manifest({ workspaceId: "w1" }) });
    expect(result._unsafeUnwrapErr()).toEqual([
      "this generation was published from workspace w1 and this run read workspace w2",
      "the store accumulates, so publishing across workspaces would leave the first one's configuration marked stale — which reads as Linear having deleted it",
      "run: slopweaver atlas linear reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write",
    ]);
  });

  it("does not refuse when this run could not establish a workspace", () => {
    const result = guardWorkspace({ next: manifest({ workspaceId: null }), prior: manifest({ workspaceId: "w1" }) });
    expect(result.isOk()).toBe(true);
  });

  it("does not refuse when the stored generation records no workspace", () => {
    const result = guardWorkspace({ next: manifest({ workspaceId: "w2" }), prior: manifest({ workspaceId: null }) });
    expect(result.isOk()).toBe(true);
  });
});
