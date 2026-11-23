/*
 * How a finished frontier walk publishes its merged generation: the merged rows and their counts, nothing at all on a
 * failed merge, and the publish's own reasons when the write is refused.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { publishWalkedGeneration } from "../../../../../atlas/kit/frontierPublish.js";

describe("publishWalkedGeneration", () => {
  it("publishes the merged rows with the counts the merge produced", () => {
    const published: unknown[] = [];

    const result = publishWalkedGeneration({
      filesFor: ({ methods, pages }) => ({ method: [...methods], page: [...pages] }),
      manifestFor: ({ methodCount, pageCount }) => `manifest ${String(methodCount)}/${String(pageCount)}`,
      merge: () => ok({ methods: ["m1"], pages: ["p1", "p2"] }),
      publish: ({ files, manifest }) => {
        published.push({ files, manifest });
        return ok(["method.jsonl", "page.jsonl", "manifest.json"]);
      },
    });

    expect(unwrap(result)).toEqual({
      methodCount: 1,
      pageCount: 2,
      written: ["method.jsonl", "page.jsonl", "manifest.json"],
    });
    expect(published).toEqual([{ files: { method: ["m1"], page: ["p1", "p2"] }, manifest: "manifest 1/2" }]);
  });

  it("writes nothing when the merge fails, and returns the publish's reasons when the write is refused", () => {
    const published: unknown[] = [];
    const publish = ({ files }: { files: string; manifest: string }): Result<readonly string[]> => {
      published.push(files);
      return ok([]);
    };

    expect(
      unwrapErr(
        publishWalkedGeneration({
          filesFor: () => "files",
          manifestFor: () => "manifest",
          merge: () => err(["the held generation is unreadable"]),
          publish,
        }),
      ),
    ).toEqual(["the held generation is unreadable"]);
    expect(published).toEqual([]);
    expect(
      unwrapErr(
        publishWalkedGeneration({
          filesFor: () => "files",
          manifestFor: () => "manifest",
          merge: () => ok({ methods: [], pages: [] }),
          publish: () => err(["the generation moved"]),
        }),
      ),
    ).toEqual(["the generation moved"]);
  });
});
