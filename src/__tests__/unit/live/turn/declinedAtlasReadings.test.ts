/**
 * Grading the atlases an answer's blind spots name, over an injected platform list and lookup: only a named
 * atlas is read at all, each reading is in registry order, a read that fails grades the atlas unanswerable
 * with no kinds, and the home reaches the read exactly as given — `{}` when there is none.
 */
import { describe, expect, it } from "vitest";

import { type AtlasKindView, AtlasReadErrors, type AtlasReadSnapshot } from "../../../../atlas/kit/read.js";
import type { AtlasPlatformRegistration } from "../../../../atlas/kit/registration.js";
import { err, ok } from "../../../../lib/result.js";
import { declinedAtlasReadings } from "../../../../live/turn/declinedAtlasReadings.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";

/** The incident's blind spot, naming two atlases ("google admin" spelled with a space). */
const DECLINED_BOTH =
  "the jumpcloud and google admin atlases, so i can't say where else a password rule is already enforced";

const PLATFORMS = ["google-admin", "jumpcloud", "vanta"] as const;

/** An answer whose only interesting field is its blind spots. */
function answer({ blindSpots }: { blindSpots: readonly string[] }): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [...blindSpots] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:133 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: ["slack read-thread"],
      },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the answer's lead, which these readings never read",
    measurements: [],
  };
}

/** One empty kind view named `kind`. */
function kindView({ kind }: { kind: string }): AtlasKindView {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    lastSuccessAt: "2026-09-05T00:00:00.000Z",
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: 0,
  };
}

/** A snapshot of `platform` holding the given kinds. */
function snapshot({ platform, kinds }: { platform: string; kinds: readonly string[] }): AtlasReadSnapshot {
  return {
    descriptor: {
      excludes: [],
      kinds: [...kinds],
      platform,
      question: "what does this tenant hold",
      resyncCommand: `slopweaver atlas ${platform} sync`,
      surfaces: [],
      visibilityScope: "this tenant",
      writePolicy: "refuse-every-write",
    },
    generation: {
      mismatched: [],
      missing: [],
      platform,
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    kinds: kinds.map((kind) => kindView({ kind })),
  };
}

/**
 * A lookup where jumpcloud answers with three kinds and google-admin's read fails, recording every lookup
 * and every read; any platform outside `registered` has no registration at all.
 */
function lookup({ registered }: { registered: readonly string[] }): {
  find: (args: { platform: string }) => Pick<AtlasPlatformRegistration, "readSnapshot"> | null;
  looked: string[];
  reads: { platform: string; args: { home?: string } }[];
} {
  const looked: string[] = [];
  const reads: { platform: string; args: { home?: string } }[] = [];
  return {
    find: ({ platform }) => {
      looked.push(platform);
      if (!registered.includes(platform)) {
        return null;
      }
      return {
        readSnapshot: async (args) => {
          reads.push({ args, platform });
          if (platform === "jumpcloud") {
            return ok(snapshot({ kinds: ["policies", "systems", "usergroups"], platform }));
          }
          return err(AtlasReadErrors.storeUnreadable({ platform, reasons: ["manifest.json is not JSON"] }));
        },
      };
    },
    looked,
    reads,
  };
}

describe("declinedAtlasReadings", () => {
  it("reads nothing and returns no readings when no blind spot names an atlas", async () => {
    const { find, looked, reads } = lookup({ registered: PLATFORMS });

    const readings = await declinedAtlasReadings({
      answer: answer({ blindSpots: ["no screenshot of the control page"] }),
      find,
      home: "/h",
      platforms: () => PLATFORMS,
    });

    expect(readings).toEqual([]);
    expect(looked).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("grades each named atlas in registry order: a readable one with its kinds, an unreadable one as dark", async () => {
    const { find, looked, reads } = lookup({ registered: PLATFORMS });

    const readings = await declinedAtlasReadings({
      answer: answer({ blindSpots: [DECLINED_BOTH] }),
      find,
      home: "/h",
      platforms: () => PLATFORMS,
    });

    expect(readings).toEqual([
      { answerable: false, kinds: [], platform: "google-admin" },
      { answerable: true, kinds: ["policies", "systems", "usergroups"], platform: "jumpcloud" },
    ]);
    expect(looked).toEqual(["google-admin", "jumpcloud"]);
    expect(reads).toEqual([
      { args: { home: "/h" }, platform: "google-admin" },
      { args: { home: "/h" }, platform: "jumpcloud" },
    ]);
  });

  it("skips a named platform the lookup has no registration for, rather than grading it", async () => {
    const { find, looked, reads } = lookup({ registered: ["jumpcloud"] });

    const readings = await declinedAtlasReadings({
      answer: answer({ blindSpots: [DECLINED_BOTH] }),
      find,
      home: "/h",
      platforms: () => PLATFORMS,
    });

    expect(readings).toEqual([
      { answerable: true, kinds: ["policies", "systems", "usergroups"], platform: "jumpcloud" },
    ]);
    expect(looked).toEqual(["google-admin", "jumpcloud"]);
    expect(reads).toEqual([{ args: { home: "/h" }, platform: "jumpcloud" }]);
  });

  it("reads with an empty argument, carrying no home key, when the caller has no home", async () => {
    const { find, reads } = lookup({ registered: ["jumpcloud"] });

    await declinedAtlasReadings({
      answer: answer({ blindSpots: [DECLINED_BOTH] }),
      find,
      home: undefined,
      platforms: () => PLATFORMS,
    });

    expect(reads).toEqual([{ args: {}, platform: "jumpcloud" }]);
    expect(Object.keys(reads[0]!.args)).toEqual([]);
  });
});
