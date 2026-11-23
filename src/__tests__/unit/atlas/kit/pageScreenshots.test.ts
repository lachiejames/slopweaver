import { describe, expect, it } from "vitest";

import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";
import { atlasPageScreenshots } from "../../../../atlas/kit/pageScreenshots.js";
import type { AtlasEntityView, AtlasObservationView } from "../../../../atlas/kit/read.js";

/** One artifact, addressed by a digest built from one repeated character. */
function artifact({ digit, byteLength, kind }: { digit: string; byteLength: number; kind: AtlasArtifactRef["kind"] }) {
  return {
    byteLength,
    kind,
    mediaType: "image/png",
    relativePath: `artifacts/${digit}.png`,
    sha256: digit.repeat(64),
  } satisfies AtlasArtifactRef;
}

/** One observation carrying the given artifacts. */
function observation({
  artifacts,
  surface,
  deepLink,
}: {
  artifacts: readonly AtlasArtifactRef[];
  surface: string;
  deepLink: string | null;
}): AtlasObservationView {
  return {
    artifacts,
    deepLink,
    deepLinkStatus: "browser-discovered",
    endpoint: "/settings",
    observedAt: "2026-10-12T00:00:00.000Z",
    state: "observed",
    surface,
  };
}

/** One entity holding the given observations. */
function entity({
  providerId,
  observations,
}: {
  providerId: string;
  observations: readonly AtlasObservationView[];
}): AtlasEntityView {
  return { detail: null, id: `id-${providerId}`, kind: "page", observations, providerId, scope: "acme" };
}

describe("atlasPageScreenshots", () => {
  it("holds each page picture once, named by the first entity citing it, smallest first", () => {
    const big = artifact({ byteLength: 900, digit: "a", kind: "page-png" });
    const small = artifact({ byteLength: 100, digit: "b", kind: "page-png" });
    const entities = [
      entity({
        observations: [observation({ artifacts: [big], deepLink: "https://console.example.com/a", surface: "walk" })],
        providerId: "/a",
      }),
      entity({
        observations: [
          observation({ artifacts: [big, small], deepLink: null, surface: "dashboard" }),
          observation({ artifacts: [small], deepLink: null, surface: "walk" }),
        ],
        providerId: "/b",
      }),
    ];

    expect(atlasPageScreenshots({ entities })).toEqual([
      {
        byteLength: 100,
        deepLink: null,
        mediaType: "image/png",
        providerId: "/b",
        relativePath: "artifacts/b.png",
        sha256: "b".repeat(64),
        surface: "dashboard",
      },
      {
        byteLength: 900,
        deepLink: "https://console.example.com/a",
        mediaType: "image/png",
        providerId: "/a",
        relativePath: "artifacts/a.png",
        sha256: "a".repeat(64),
        surface: "walk",
      },
    ]);
  });

  it("holds no artifact that is not a page picture", () => {
    const payload = artifact({ byteLength: 50, digit: "c", kind: "api-json" });
    const entities = [
      entity({
        observations: [observation({ artifacts: [payload], deepLink: null, surface: "api" })],
        providerId: "/c",
      }),
    ];

    expect(atlasPageScreenshots({ entities })).toEqual([]);
  });

  it("holds nothing for an atlas with no entities", () => {
    expect(atlasPageScreenshots({ entities: [] })).toEqual([]);
  });
});
