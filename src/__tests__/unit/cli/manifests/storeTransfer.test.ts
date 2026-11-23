/**
 * The `store` noun's transfer-family metadata, checked on the fields a gate reads.
 *
 * None of the four leaves the machine, so none is door-routed. The import and the resolve write the local
 * store (a staged batch, one answer), which is what `local-state` says; listing open questions writes nothing.
 */
import { describe, expect, it } from "vitest";

import {
  exportMeta,
  importMeta,
  importQuestionsMeta,
  importResolveMeta,
} from "../../../../cli/manifests/storeTransfer.js";

describe("the store transfer family's metadata", () => {
  it("declares the export, import and resolve local writes and the questions list a read, none through the door", () => {
    expect([exportMeta.effect, importMeta.effect, importResolveMeta.effect, importQuestionsMeta.effect]).toEqual([
      "local-state",
      "local-state",
      "local-state",
      "none",
    ]);
    expect([
      exportMeta.doorRouted,
      importMeta.doorRouted,
      importResolveMeta.doorRouted,
      importQuestionsMeta.doorRouted,
    ]).toEqual([false, false, false, false]);
  });

  it("gives each row a usage line naming its own verb", () => {
    expect(exportMeta.usage.startsWith("usage: slopweaver store export ")).toBe(true);
    expect(importMeta.usage.startsWith("usage: slopweaver store import ")).toBe(true);
    expect(importResolveMeta.usage.startsWith("usage: slopweaver store import-resolve ")).toBe(true);
    expect(importQuestionsMeta.usage.startsWith("usage: slopweaver store import-questions ")).toBe(true);
  });

  it("offers staging and applying a staged batch as the import's two writes", () => {
    expect(importMeta.usage).toContain("[--approve <sha256:digest>]");
    expect(importMeta.usage).toContain("--apply <batch-id> [--stop-on-conflict]");
  });
});
