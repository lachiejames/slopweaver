/**
 * A pinned vendor document whose bytes moved is an OBSERVATION, never a refusal, and one document that cannot
 * be fetched or compiled never stops the rest of the catalogue.
 *
 * `fetchPinnedText` is the module's bare network edge and is not exercised here: the unit lane has no network.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "#lib/result.js";
import { compilePinnedCatalogue, digestDrift, type SpecDrift } from "../../../../atlas/kit/pinnedSpec.js";

const PINNED_TEXT = '{"openapi":"3.1.0"}';
// Measured with `shasum -a 256` over the exact bytes; the moved text holds one two-byte character.
const PINNED_SHA = "1f7b61c52c664d551376cf25d7c387f8c0832ba9fe00995f7d12dd1909ea0de5";
const MOVED_TEXT = '{"openapi":"3.1.0","info":{"title":"Café"}}';
const MOVED_SHA = "d78e922b79fb9639ca5b4741c9300319d824a2be95a37e382ea4705730cd3a20";

const pin = ({ id }: { id: string }) => ({
  byteLength: 19,
  id,
  sha256: PINNED_SHA,
  url: `https://example.test/${id}.json`,
});

describe("digestDrift", () => {
  it("reports nothing when the bytes are the reviewed ones", () => {
    expect(digestDrift({ pin: pin({ id: "a" }), text: PINNED_TEXT })).toBe(null);
  });

  it("records a moved document with both digests and both byte lengths, counting bytes rather than characters", () => {
    expect(MOVED_TEXT.length).toBe(43);
    expect(digestDrift({ pin: pin({ id: "a" }), text: MOVED_TEXT })).toEqual({
      actualByteLength: 44,
      actualSha256: MOVED_SHA,
      expectedByteLength: 19,
      expectedSha256: PINNED_SHA,
      specId: "a",
    });
  });
});

describe("compilePinnedCatalogue", () => {
  it("compiles every document it can, collects every failure and drift, and never stops the batch", async () => {
    const texts: Record<string, Result<string, string>> = {
      a: ok(PINNED_TEXT),
      b: err("b: HTTP 503"),
      c: ok("not json"),
      d: ok(MOVED_TEXT),
    };
    const catalogue = await compilePinnedCatalogue({
      compile: ({ pin: held, text }): Result<{ drift: SpecDrift | null; surface: string }, string> => {
        if (text === "not json") {
          return err(`${held.id}: does not parse`);
        }
        return ok({ drift: digestDrift({ pin: held, text }), surface: `${held.id}-surface` });
      },
      countOperations: ({ surface }) => surface.length,
      pins: [pin({ id: "a" }), pin({ id: "b" }), pin({ id: "c" }), pin({ id: "d" })],
      transport: async ({ pin: held }) => texts[held.id]!,
    });

    expect(catalogue).toEqual({
      drifts: [
        {
          actualByteLength: 44,
          actualSha256: MOVED_SHA,
          expectedByteLength: 19,
          expectedSha256: PINNED_SHA,
          specId: "d",
        },
      ],
      failures: ["b: HTTP 503", "c: does not parse"],
      operationCount: 18,
      surfaces: ["a-surface", "d-surface"],
    });
  });

  it("answers an empty catalogue with nothing", async () => {
    const catalogue = await compilePinnedCatalogue({
      compile: () => ok({ drift: null, surface: "never" }),
      countOperations: () => 1,
      pins: [],
      transport: async () => ok(""),
    });

    expect(catalogue).toEqual({ drifts: [], failures: [], operationCount: 0, surfaces: [] });
  });
});
