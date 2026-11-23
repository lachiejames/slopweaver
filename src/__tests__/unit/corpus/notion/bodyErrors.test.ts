/**
 * `NotionBodyErrors`: each factory's literal code, the digest and the field that tells the four kinds apart,
 * and the exact message — including how an unparseable body renders an `Error` cause and a non-Error one.
 */
import { describe, expect, it } from "vitest";

import { NotionBodyErrors } from "../../../../corpus/notion/bodyErrors.js";

const DIGEST = "sha256-abc123";

describe("NotionBodyErrors", () => {
  it("missing is BODY_MISSING and names the digest and where it looked", () => {
    expect(NotionBodyErrors.missing({ digest: DIGEST, path: "/home/notion/bodies/abc123.json" })).toEqual({
      code: "BODY_MISSING",
      digest: DIGEST,
      message: "notion body sha256-abc123 is not in the store at /home/notion/bodies/abc123.json",
      path: "/home/notion/bodies/abc123.json",
    });
  });

  it("digestMismatch is BODY_DIGEST_MISMATCH and names both hashes", () => {
    expect(NotionBodyErrors.digestMismatch({ actual: "sha256-def456", digest: DIGEST })).toEqual({
      actual: "sha256-def456",
      code: "BODY_DIGEST_MISMATCH",
      digest: DIGEST,
      message: "notion body sha256-abc123 hashes to sha256-def456 — the stored bytes are not the ones it names",
    });
  });

  it("unparseable is BODY_UNPARSEABLE, carries an Error cause's message and keeps the cause", () => {
    const cause = new SyntaxError("Unexpected token } in JSON at position 4");
    const error = NotionBodyErrors.unparseable({ cause, digest: DIGEST });
    expect(error.code).toBe("BODY_UNPARSEABLE");
    expect(error.digest).toBe(DIGEST);
    expect(error.message).toBe("notion body sha256-abc123 did not parse: Unexpected token } in JSON at position 4");
    expect(error.cause).toBe(cause);
  });

  it("unparseable is BODY_UNPARSEABLE and stringifies a non-Error cause", () => {
    const error = NotionBodyErrors.unparseable({ cause: 404, digest: DIGEST });
    expect(error.code).toBe("BODY_UNPARSEABLE");
    expect(error.message).toBe("notion body sha256-abc123 did not parse: 404");
    expect(error.cause).toBe(404);
  });

  it("notATree is BODY_NOT_A_TREE and names the digest", () => {
    expect(NotionBodyErrors.notATree({ digest: DIGEST })).toEqual({
      code: "BODY_NOT_A_TREE",
      digest: DIGEST,
      message: "notion body sha256-abc123 is not a node array",
    });
  });
});
