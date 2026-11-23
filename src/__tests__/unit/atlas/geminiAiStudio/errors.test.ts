/**
 * The Gemini AI Studio atlas's typed failures: each factory's code and exact text, and the lines each one
 * prints.
 *
 * The envelope refusal is the case that matters most: it is variable-length — one line of its own, then one
 * per schema issue — and the CLI prints one line per element, so the lines helper must return the list rather
 * than the joined `message`.
 */
import { describe, expect, it } from "vitest";

import { GeminiAiStudioAtlasErrors, geminiAiStudioAtlasErrorLines } from "../../../../atlas/geminiAiStudio/errors.js";

describe("GeminiAiStudioAtlasErrors", () => {
  it("names the version whose document is not JSON", () => {
    const error = GeminiAiStudioAtlasErrors.documentNotJson({ cause: new Error("Unexpected token <"), version: "v1" });
    expect(error.code).toBe("DOCUMENT_NOT_JSON");
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "the Gemini v1 discovery document is not parseable JSON: Unexpected token <",
    ]);
  });

  it("prints the envelope refusal and then one line per schema issue, an empty path included", () => {
    const error = GeminiAiStudioAtlasErrors.envelopeMismatch({
      issues: [
        { message: "Invalid input", path: ["schemas", 0, "id"] },
        { message: "Unrecognized key", path: [] },
      ],
      version: "v1beta",
    });
    expect(error.code).toBe("ENVELOPE_MISMATCH");
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "the Gemini v1beta discovery document does not match the envelope this atlas requires, so nothing was published",
      "schemas.0.id: Invalid input",
      ": Unrecognized key",
    ]);
  });

  it("prints only the envelope refusal when there are no issues to list", () => {
    const error = GeminiAiStudioAtlasErrors.envelopeMismatch({ issues: [], version: "v1beta" });
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "the Gemini v1beta discovery document does not match the envelope this atlas requires, so nothing was published",
    ]);
  });

  it("prints a version mismatch and why nothing was published as two lines", () => {
    const error = GeminiAiStudioAtlasErrors.versionMismatch({ declared: "v1", version: "v1beta" });
    expect(error.code).toBe("VERSION_MISMATCH");
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "the document served for version v1beta declares itself version v1",
      "nothing was published — a version segment that answers a different document is a routing change, not a vendor update",
    ]);
  });

  it("names the one origin this atlas reads when a document points elsewhere", () => {
    const error = GeminiAiStudioAtlasErrors.rootUrlMismatch({ rootUrl: "https://elsewhere.test/", version: "v1" });
    expect(error.code).toBe("ROOT_URL_MISMATCH");
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "the Gemini v1 discovery document declares rootUrl https://elsewhere.test/, not https://generativelanguage.googleapis.com/",
      "nothing was published — this atlas reads exactly one origin and refuses a document pointing anywhere else",
    ]);
  });

  it("names a version this build does not compile", () => {
    const error = GeminiAiStudioAtlasErrors.versionUncompiled({ version: "v2" });
    expect(error.code).toBe("VERSION_UNCOMPILED");
    expect(error.message).toBe("this build compiles no Gemini discovery document for version v2");
  });

  it("prints the status and the computed address as two lines", () => {
    const error = GeminiAiStudioAtlasErrors.fetchRefused({
      status: 503,
      url: "https://example.test/discovery?version=v1",
      version: "v1",
    });
    expect(error.code).toBe("FETCH_REFUSED");
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "fetching the Gemini v1 discovery document returned HTTP 503",
      "the address is computed from a constant origin and is not configurable: https://example.test/discovery?version=v1",
    ]);
  });

  it("quotes the failure when a fetch throws", () => {
    const error = GeminiAiStudioAtlasErrors.fetchFailed({ cause: new Error("ECONNRESET"), version: "v1alpha" });
    expect(error.code).toBe("FETCH_FAILED");
    expect(error.message).toBe("fetching the Gemini v1alpha discovery document failed: ECONNRESET");
  });

  it("names the path a document could not be cached at", () => {
    const error = GeminiAiStudioAtlasErrors.cacheUnwritable({
      cause: new Error("ENOSPC"),
      path: "/tmp/spec/v1.json",
      version: "v1",
    });
    expect(error.code).toBe("CACHE_UNWRITABLE");
    expect(error.message).toBe("the Gemini v1 discovery document could not be cached at /tmp/spec/v1.json: ENOSPC");
  });

  it("counts and lists the unknown roots, then says how to add one", () => {
    const error = GeminiAiStudioAtlasErrors.rootsUnknown({ unknownRoots: ["a", "b"], version: "v1" });
    expect(error.code).toBe("ROOTS_UNKNOWN");
    expect(geminiAiStudioAtlasErrorLines({ error })).toEqual([
      "the Gemini v1 discovery document declares 2 resource root(s) this build does not: a, b",
      "nothing was published — a new root is Google adding a product area, which is exactly the unknown unknown this atlas exists to surface. Add it to GEMINI_AI_STUDIO_KINDS and to atlasHome.ts, then run again",
    ]);
  });
});
