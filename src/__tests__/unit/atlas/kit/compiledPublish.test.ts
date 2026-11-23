import { describe, expect, it } from "vitest";

import { publishCompiledGeneration } from "../../../../atlas/kit/compiledPublish.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

/** The generation the caller read, standing in for a platform's snapshot. */
const SNAPSHOT = { manifestDigest: "held-digest" };

interface Compiled {
  readonly compiledOn: string;
  readonly count: number;
}

/**
 * The three seams after `compile`, each recording what it was handed, so a test sees both whether a step ran
 * and exactly what reached it.
 */
function seams({ publishes }: { publishes: Result<readonly string[]> }): {
  calls: unknown[][];
  filesFor: (input: { compiled: Compiled; snapshot: typeof SNAPSHOT }) => string;
  manifestFor: (input: { compiled: Compiled; snapshot: typeof SNAPSHOT }) => string;
  publish: (input: { files: string; manifest: string }) => Result<readonly string[]>;
} {
  const calls: unknown[][] = [];
  return {
    calls,
    filesFor: (input) => {
      calls.push(["filesFor", input]);
      return `files(${String(input.compiled.count)})`;
    },
    manifestFor: (input) => {
      calls.push(["manifestFor", input]);
      return `manifest(${input.compiled.compiledOn})`;
    },
    publish: (input) => {
      calls.push(["publish", input]);
      return publishes;
    },
  };
}

const COMPILED: Compiled = { compiledOn: "held-digest", count: 3 };

describe("publishCompiledGeneration", () => {
  it("publishes exactly what filesFor and manifestFor built from the compile, against the snapshot read", () => {
    const run = seams({ publishes: ok(["kinds/thing.jsonl", "manifest.json"]) });

    const result = publishCompiledGeneration({
      ...run,
      compile: ({ snapshot }) => ok({ compiledOn: snapshot.manifestDigest, count: 3 }),
      snapshot: SNAPSHOT,
    });

    expect(unwrap(result)).toEqual({ compiled: COMPILED, written: ["kinds/thing.jsonl", "manifest.json"] });
    expect(run.calls).toEqual([
      ["filesFor", { compiled: COMPILED, snapshot: SNAPSHOT }],
      ["manifestFor", { compiled: COMPILED, snapshot: SNAPSHOT }],
      ["publish", { files: "files(3)", manifest: "manifest(held-digest)" }],
    ]);
  });

  it("builds and writes nothing when the compile fails, and returns the compile's own reasons", () => {
    const run = seams({ publishes: ok([]) });

    const result = publishCompiledGeneration({
      ...run,
      compile: () => err(["definitions unreadable"]),
      snapshot: SNAPSHOT,
    });

    expect(unwrapErr(result)).toEqual(["definitions unreadable"]);
    expect(run.calls).toEqual([]);
  });

  it("returns the publish's own reasons when the write is refused, after handing it the built generation", () => {
    const run = seams({ publishes: err(["the generation moved under this run"]) });

    const result = publishCompiledGeneration({ ...run, compile: () => ok(COMPILED), snapshot: SNAPSHOT });

    expect(unwrapErr(result)).toEqual(["the generation moved under this run"]);
    expect(run.calls.at(-1)).toEqual(["publish", { files: "files(3)", manifest: "manifest(held-digest)" }]);
  });
});
