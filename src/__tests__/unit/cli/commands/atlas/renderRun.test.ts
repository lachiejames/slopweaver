/**
 * The render verb's shell: how a screenshot budget is spent, and the three ways a stored screenshot can
 * fail to be what the atlas said it was.
 *
 * Every edge is a plain injected function, so nothing here touches a filesystem or a registry.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AtlasPageScreenshot } from "../../../../../atlas/kit/pageModel.js";
import {
  type AtlasRenderDeps,
  confinedArtifactPath,
  readEmbeddedShots,
} from "../../../../../cli/commands/atlas/renderRun.js";

/** The bytes every fixture is built around, so a shot's declared digest and length always agree. */
const SHOT_BYTES = new Uint8Array([0, 0, 0]);

/** The digest of {@link SHOT_BYTES}, computed rather than typed so the two cannot drift. */
const SHOT_DIGEST = createHash("sha256").update(Buffer.from(SHOT_BYTES)).digest("hex");

/** One screenshot row, matching {@link SHOT_BYTES} unless a test says otherwise. */
function shot(over: Partial<AtlasPageScreenshot> = {}): AtlasPageScreenshot {
  return {
    byteLength: SHOT_BYTES.byteLength,
    deepLink: null,
    mediaType: "image/png",
    providerId: "policies-collection",
    relativePath: "artifacts/pages/aa.png",
    sha256: SHOT_DIGEST,
    surface: "browser",
    ...over,
  };
}

/** A reader that answers {@link SHOT_BYTES} for every path it is given. */
function reader(): AtlasRenderDeps["readArtifact"] {
  return () => SHOT_BYTES;
}

describe("confinedArtifactPath", () => {
  it("resolves a path that stays inside the atlas's own directory", () => {
    expect(confinedArtifactPath({ directory: "/atlas/example", relativePath: "artifacts/pages/aa.png" })).toBe(
      "/atlas/example/artifacts/pages/aa.png",
    );
  });

  it("refuses a stored path that climbs out of the directory", () => {
    expect(confinedArtifactPath({ directory: "/atlas/example", relativePath: "../../secrets.json" })).toBe(null);
  });

  it("refuses one that climbs out through a subdirectory, because the check is on the RESOLVED path", () => {
    expect(confinedArtifactPath({ directory: "/atlas/example", relativePath: "a/../../../etc/passwd" })).toBe(null);
  });

  it("refuses an absolute stored path", () => {
    expect(confinedArtifactPath({ directory: "/atlas/example", relativePath: "/etc/passwd" })).toBe(null);
  });

  it("refuses the directory itself", () => {
    expect(confinedArtifactPath({ directory: "/atlas/example", relativePath: "." })).toBe(null);
  });
});

describe("readEmbeddedShots", () => {
  it("embeds nothing when the budget is zero, which is what --no-screenshots asks for", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 0,
      directory: "/atlas/example",
      readArtifact: reader(),
      screenshots: [shot()],
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("budget-held");
    expect(outcomes[0]!.dataUri).toBe(null);
  });

  it("embeds nothing when the atlas directory could not be resolved", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: null,
      readArtifact: reader(),
      screenshots: [shot()],
    });
    expect(outcomes[0]!.status).toBe("budget-held");
  });

  it("reads each screenshot from under the atlas's own directory", () => {
    const seen: string[] = [];
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: "/atlas/example",
      readArtifact: ({ path }) => {
        seen.push(path);
        return SHOT_BYTES;
      },
      screenshots: [shot()],
    });
    expect(seen).toEqual(["/atlas/example/artifacts/pages/aa.png"]);
    expect(outcomes[0]!.status).toBe("embedded");
    expect(outcomes[0]!.dataUri).toBe("data:image/png;base64,AAAA");
    expect(outcomes[0]!.sha256).toBe(SHOT_DIGEST);
  });

  it("refuses a stored path that points outside the atlas, rather than reading it", () => {
    const seen: string[] = [];
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: "/atlas/example",
      readArtifact: ({ path }) => {
        seen.push(path);
        return SHOT_BYTES;
      },
      screenshots: [shot({ relativePath: "../../secrets.json" })],
    });
    expect(seen).toEqual([]);
    expect(outcomes[0]!.status).toBe("path-refused");
  });

  it("reports a screenshot whose bytes do not match the digest this atlas recorded", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: "/atlas/example",
      readArtifact: () => new Uint8Array([1, 2, 3]),
      screenshots: [shot()],
    });
    expect(outcomes[0]!.status).toBe("integrity-failed");
    expect(outcomes[0]!.dataUri).toBe(null);
  });

  it("reports a screenshot whose length does not match, even when nothing else is wrong", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: "/atlas/example",
      readArtifact: reader(),
      screenshots: [shot({ byteLength: 99 })],
    });
    expect(outcomes[0]!.status).toBe("integrity-failed");
  });

  it("reports a screenshot whose file is gone rather than calling it held", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: "/atlas/example",
      readArtifact: () => null,
      screenshots: [shot()],
    });
    expect(outcomes[0]!.status).toBe("unreadable");
  });

  it("keeps going after a failure rather than stopping at it", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 1000,
      directory: "/atlas/example",
      readArtifact: ({ path }) => (path.endsWith("missing.png") ? null : SHOT_BYTES),
      screenshots: [
        shot({ relativePath: "artifacts/pages/missing.png" }),
        shot({ relativePath: "artifacts/pages/here.png" }),
      ],
    });
    expect(outcomes[0]!.status).toBe("unreadable");
    expect(outcomes[1]!.status).toBe("embedded");
  });

  it("stops embedding at the budget and holds the rest, rather than overrunning it", () => {
    const outcomes = readEmbeddedShots({
      budgetBytes: 8,
      directory: "/atlas/example",
      readArtifact: reader(),
      screenshots: [shot(), shot(), shot()],
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["embedded", "embedded", "budget-held"]);
  });
});
