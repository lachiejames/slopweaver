/**
 * One imported row against the live store: new, identical or conflicting, and which live row it meets — a memory
 * by its import key as well as its id. Pure.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { StoreTransferErrors } from "../../../../store/transfer/errors.js";
import { type RetainedEntry, retainedEntry } from "../../../../store/transfer/retained.js";
import { byImportKey, byKey, classify, indexedSides } from "../../../../store/transfer/rowClassify.js";

/** One memory entry under an id, an import key and a word of content. */
function memory({ key, importKey, content }: { key: string; importKey: string; content: string }): RetainedEntry {
  return { ...retainedEntry({ content, key, summary: `${key} says ${content}` }), importKey };
}

/** The live part's two indexes over these entries. */
function liveOf({ entries }: { entries: readonly RetainedEntry[] }): {
  readonly current: ReadonlyMap<string, RetainedEntry>;
  readonly importKeys: ReadonlyMap<string, RetainedEntry>;
} {
  const current = unwrap(byKey({ entries, part: "memories", side: "live store" }));
  return { current, importKeys: unwrap(byImportKey({ keyed: current, part: "memories", side: "live store" })) };
}

describe("classify", () => {
  it("meets a memory new under its id by the live memory holding its import key, binding both", () => {
    const holder = memory({ content: "b", importKey: "acme-import-1", key: "m-2" });
    const row = memory({ content: "a", importKey: "acme-import-1", key: "m-1" });
    const met = classify({ ...liveOf({ entries: [holder] }), part: "memories", row });

    expect(met.status).toBe("conflicting");
    expect(met.liveSide!.shown.map((entry) => entry.key)).toEqual(["m-2"]);
    expect(met.liveSide!.identity).toEqual({ importKey: "acme-import-1", key: "m-2", live: holder.fingerprint });
  });

  it("meets a memory the store holds under its id by that row alone, whatever holds its import key", () => {
    const same = memory({ content: "a", importKey: "acme-import-1", key: "m-1" });
    const met = classify({ ...liveOf({ entries: [same] }), part: "memories", row: same });

    expect([met.status, met.liveSide!.shown.map((entry) => entry.key)]).toEqual(["identical", ["m-1"]]);
  });

  it("leaves a memory whose import key no live row holds new", () => {
    const row = memory({ content: "a", importKey: "acme-import-9", key: "m-1" });
    const live = liveOf({ entries: [memory({ content: "b", importKey: "acme-import-1", key: "m-2" })] });

    expect(classify({ ...live, part: "memories", row })).toEqual({ liveSide: undefined, status: "new" });
  });
});

describe("indexedSides", () => {
  const twins = [
    memory({ content: "a", importKey: "acme-import-1", key: "m-1" }),
    memory({ content: "b", importKey: "acme-import-1", key: "m-2" }),
  ];

  it("refuses an export holding one import key twice, naming both rows, whatever the live store holds", () => {
    const refused = indexedSides({ fromExport: twins, fromLive: [], part: "memories" });

    expect(unwrapErr(refused)).toEqual(
      StoreTransferErrors.duplicateImportKey({
        importKey: "acme-import-1",
        keys: ["m-1", "m-2"],
        part: "memories",
        side: "export",
      }),
    );
  });

  it("refuses a live store holding one import key twice, naming the side", () => {
    const refused = indexedSides({ fromExport: [], fromLive: twins, part: "memories" });

    expect(unwrapErr(refused).message).toBe(
      "memories: the live store holds two rows under import key acme-import-1 (m-1, m-2), which the register holds unique, so neither can be imported",
    );
  });

  it("indexes the live side by import key, the export's only checked", () => {
    const sides = unwrap(indexedSides({ fromExport: [twins[0]!], fromLive: [twins[1]!], part: "memories" }));

    expect([[...sides.exported.keys()], [...sides.current.keys()], [...sides.importKeys.keys()]]).toEqual([
      ["m-1"],
      ["m-2"],
      ["acme-import-1"],
    ]);
  });
});
