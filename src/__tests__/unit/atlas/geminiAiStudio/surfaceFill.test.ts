/**
 * Whether the Gemini AI Studio compiled surface is FILLED is read off the manifest, never off a literal.
 *
 * The invariant asserted is exact: EVERY applicable kind carries a recorded success — not "most", not "at
 * least one" — and `page`, which no compile ever writes, is outside the denominator.
 */
import { describe, expect, it } from "vitest";

import { GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR } from "../../../../atlas/geminiAiStudio/descriptor.js";
import {
  GEMINI_AI_STUDIO_KINDS,
  type GeminiAiStudioAtlasManifest,
  type GeminiAiStudioKind,
  initialGeminiAiStudioManifest,
} from "../../../../atlas/geminiAiStudio/model.js";
import {
  applicableCompiledKinds,
  geminiAiStudioCompiledFill,
  geminiAiStudioDescriptorFor,
} from "../../../../atlas/geminiAiStudio/surfaceFill.js";
import type { AtlasDescriptor } from "../../../../atlas/kit/contract.js";

const AT = "2026-10-01T00:00:00.000Z";

const SOURCE = GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR;

/** The 13 applicable kinds, sorted, written out from `GEMINI_AI_STUDIO_KINDS` minus `page`. */
const APPLICABLE_SORTED = [
  "auth_tokens",
  "batches",
  "cachedContents",
  "corpora",
  "dynamic",
  "environments",
  "fileSearchStores",
  "files",
  "generatedFiles",
  "media",
  "models",
  "operations",
  "tunedModels",
] as const;

/**
 * A manifest where every kind has a recorded success, each with its own distinct timestamp, digest and
 * entity count, except the named outstanding kinds and `page` (unless `pageSucceeded`).
 */
function manifestWith({
  outstanding,
  pageSucceeded,
}: {
  outstanding: readonly GeminiAiStudioKind[];
  pageSucceeded: boolean;
}): GeminiAiStudioAtlasManifest {
  const base = initialGeminiAiStudioManifest({ updatedAt: AT });
  const kinds = { ...base.kinds };
  for (const [index, kind] of GEMINI_AI_STUDIO_KINDS.entries()) {
    const skipped = kind === "page" ? !pageSucceeded : outstanding.includes(kind);
    if (!skipped) {
      const minutes = String(index).padStart(2, "0");
      kinds[kind] = {
        digest: `digest-${String(index)}`,
        entityCount: 100 + index,
        lastAttempt: null,
        lastSuccessAt: `2026-09-01T00:${minutes}:00.000Z`,
      };
    }
  }
  return { ...base, kinds };
}

/** The source descriptor with only its compiled surface's status and reason replaced. */
function expectedDescriptor({
  status,
  unfilledBecause,
}: {
  status: "filled" | "declared-unfilled";
  unfilledBecause: string | null;
}): AtlasDescriptor {
  return {
    ...SOURCE,
    surfaces: [{ ...SOURCE.surfaces[0]!, status, unfilledBecause }, SOURCE.surfaces[1]!, SOURCE.surfaces[2]!],
  };
}

describe("applicableCompiledKinds", () => {
  it("is every declared kind but the browser-only page kind", () => {
    expect(applicableCompiledKinds()).toEqual([
      "auth_tokens",
      "batches",
      "cachedContents",
      "corpora",
      "dynamic",
      "environments",
      "fileSearchStores",
      "files",
      "generatedFiles",
      "media",
      "models",
      "operations",
      "tunedModels",
    ]);
  });
});

describe("geminiAiStudioCompiledFill", () => {
  it("reports nothing filled when nothing has ever been published", () => {
    expect(geminiAiStudioCompiledFill({ manifest: null })).toEqual({
      applicable: 13,
      filled: false,
      outstanding: APPLICABLE_SORTED,
      succeeded: 0,
    });
  });

  it("refuses to call the surface filled when ONE applicable kind is outstanding", () => {
    const manifest = manifestWith({ outstanding: ["auth_tokens"], pageSucceeded: false });
    expect(geminiAiStudioCompiledFill({ manifest })).toEqual({
      applicable: 13,
      filled: false,
      outstanding: ["auth_tokens"],
      succeeded: 12,
    });
  });

  it.each(APPLICABLE_SORTED)("reports %s as the only outstanding kind when it alone has no success", (kind) => {
    const manifest = manifestWith({ outstanding: [kind], pageSucceeded: false });
    expect(geminiAiStudioCompiledFill({ manifest })).toEqual({
      applicable: 13,
      filled: false,
      outstanding: [kind],
      succeeded: 12,
    });
  });

  it("sorts the outstanding kinds however they were left outstanding", () => {
    const manifest = manifestWith({ outstanding: ["tunedModels", "batches", "media"], pageSucceeded: false });
    expect(geminiAiStudioCompiledFill({ manifest })).toEqual({
      applicable: 13,
      filled: false,
      outstanding: ["batches", "media", "tunedModels"],
      succeeded: 10,
    });
  });

  it("calls the surface filled once every applicable kind has a success, with page still unsuccessful", () => {
    const manifest = manifestWith({ outstanding: [], pageSucceeded: false });
    expect(manifest.kinds.page.lastSuccessAt).toBeNull();
    expect(geminiAiStudioCompiledFill({ manifest })).toEqual({
      applicable: 13,
      filled: true,
      outstanding: [],
      succeeded: 13,
    });
  });

  it("does not count a success on the page kind towards the compiled surface", () => {
    const manifest = manifestWith({ outstanding: APPLICABLE_SORTED, pageSucceeded: true });
    expect(geminiAiStudioCompiledFill({ manifest })).toEqual({
      applicable: 13,
      filled: false,
      outstanding: APPLICABLE_SORTED,
      succeeded: 0,
    });
  });
});

describe("geminiAiStudioDescriptorFor", () => {
  it("declares the three surfaces in the order these tests index them", () => {
    expect(SOURCE.surfaces.map((surface) => surface.acquisition)).toEqual(["compiled", "api", "driven-browser"]);
  });

  it("derives declared-unfilled with the first eight outstanding names and an ellipsis when nothing is published", () => {
    expect(geminiAiStudioDescriptorFor({ manifest: null })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "0 of 13 applicable kinds carry a recorded success; still outstanding: auth_tokens, batches, " +
          "cachedContents, corpora, dynamic, environments, fileSearchStores, files, …. " +
          "Run: slopweaver atlas gemini-ai-studio sync",
      }),
    );
  });

  it("names the one outstanding kind with no ellipsis", () => {
    const manifest = manifestWith({ outstanding: ["auth_tokens"], pageSucceeded: false });
    expect(geminiAiStudioDescriptorFor({ manifest })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "12 of 13 applicable kinds carry a recorded success; still outstanding: auth_tokens. " +
          "Run: slopweaver atlas gemini-ai-studio sync",
      }),
    );
  });

  it("shows exactly eight outstanding names without an ellipsis", () => {
    const manifest = manifestWith({
      outstanding: [
        "auth_tokens",
        "batches",
        "cachedContents",
        "corpora",
        "dynamic",
        "environments",
        "fileSearchStores",
        "files",
      ],
      pageSucceeded: false,
    });
    expect(geminiAiStudioDescriptorFor({ manifest })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "5 of 13 applicable kinds carry a recorded success; still outstanding: auth_tokens, batches, " +
          "cachedContents, corpora, dynamic, environments, fileSearchStores, files. " +
          "Run: slopweaver atlas gemini-ai-studio sync",
      }),
    );
  });

  it("elides the ninth outstanding name behind an ellipsis", () => {
    const manifest = manifestWith({
      outstanding: [
        "auth_tokens",
        "batches",
        "cachedContents",
        "corpora",
        "dynamic",
        "environments",
        "fileSearchStores",
        "files",
        "generatedFiles",
      ],
      pageSucceeded: false,
    });
    expect(geminiAiStudioDescriptorFor({ manifest })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "4 of 13 applicable kinds carry a recorded success; still outstanding: auth_tokens, batches, " +
          "cachedContents, corpora, dynamic, environments, fileSearchStores, files, …. " +
          "Run: slopweaver atlas gemini-ai-studio sync",
      }),
    );
  });

  it("flips the compiled surface to filled with no reason once every applicable kind succeeded", () => {
    const manifest = manifestWith({ outstanding: [], pageSucceeded: false });
    expect(geminiAiStudioDescriptorFor({ manifest })).toEqual(
      expectedDescriptor({ status: "filled", unfilledBecause: null }),
    );
  });
});
