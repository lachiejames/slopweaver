import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { validCandidates } from "./candidatesFixture.js";

/**
 * Every candidate in a document, respelt with one workspace word, as a seat on a build from before
 * the rename writes them into the shared home.
 *
 * @returns the document with each row's `workspace` replaced
 */
function respelt({
  document,
  key,
  word,
}: {
  document: Record<string, unknown>;
  key: "candidates";
  word: string;
}): Record<string, unknown> {
  const rows = document[key] as readonly Record<string, unknown>[];
  return { ...document, [key]: rows.map((row) => ({ ...row, workspace: word })) };
}

describe("a stored workspace written in the old spelling", () => {
  it("reads a candidates file's acme rows as team and its slopweaver rows as self", () => {
    const acme = unwrap(
      parseCandidatesFile({ value: respelt({ document: validCandidates(), key: "candidates", word: "acme" }) }),
    );
    const slopweaver = unwrap(
      parseCandidatesFile({ value: respelt({ document: validCandidates(), key: "candidates", word: "slopweaver" }) }),
    );

    expect(acme.candidates.length).toBeGreaterThan(0);
    expect(new Set(acme.candidates.map((row) => row.workspace))).toEqual(new Set(["team"]));
    expect(new Set(slopweaver.candidates.map((row) => row.workspace))).toEqual(new Set(["self"]));
    expect(acme.candidates.map((row) => row.workspace)).toEqual(acme.candidates.map(() => "team"));
    expect(slopweaver.candidates.map((row) => row.workspace)).toEqual(slopweaver.candidates.map(() => "self"));
  });

  it("writes the role back, never the old spelling, once a row has been read", () => {
    const read = unwrap(
      parseCandidatesFile({ value: respelt({ document: validCandidates(), key: "candidates", word: "acme" }) }),
    );
    const written = JSON.parse(JSON.stringify(read)) as { candidates: { workspace: string }[] };

    expect(written.candidates[0]!.workspace).toBe("team");
  });

  it("still refuses a word that names neither role nor an old spelling", () => {
    const value = respelt({ document: validCandidates(), key: "candidates", word: "taem" });

    expect(unwrapErr(parseCandidatesFile({ value })).message).toContain("workspace");
  });
});
