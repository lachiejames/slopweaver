/**
 * The grade that decides whether an atlas may answer at all.
 *
 * Every case here is a state that used to project to `entities: []` and exit 0 — the sentence a reader
 * mistakes for "this organisation holds none". The fixtures are plain views rather than real generations,
 * because the grading is pure over what an adapter already built.
 */
import { describe, expect, it } from "vitest";

import {
  type AtlasGeneratedView,
  gradeAtlasAnswerability,
  refuseUnanswerableAtlas,
} from "../../../../atlas/kit/answerable.js";
import type { AtlasEntityView, AtlasKindView, AtlasReadSnapshot } from "../../../../atlas/kit/read.js";
import { unwrapErr } from "../../../../lib/result.js";

/**
 * One entity view, defaulted so a test names only what it is about.
 *
 * @param id the entity's own id, so a kind can hold more than one
 * @returns the entity view
 */
function entity({ id }: { id: string }): AtlasEntityView {
  return {
    detail: null,
    id,
    kind: "control",
    observations: [],
    providerId: id,
    scope: "tenant",
  };
}

/**
 * One kind view.
 *
 * @param kind the kind's name
 * @param published what the manifest vouches for
 * @param held how many entities the reader actually projected
 * @returns the kind view
 */
function kindView({ kind, published, held }: { kind: string; published: number; held: number }): AtlasKindView {
  return {
    coverage: [],
    entities: Array.from({ length: held }, (_unused, index) => entity({ id: `${kind}-${String(index)}` })),
    gaps: [],
    kind,
    lastSuccessAt: "2026-09-05T00:00:00.000Z",
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: published,
  };
}

/**
 * A generation view.
 *
 * @param updatedAt when it was published, or `null` for an atlas nobody has ever synced
 * @param kinds the kind views it carries
 * @param missing kinds the manifest vouches for whose file is gone
 * @param mismatched kinds whose file is not the one the manifest published
 * @param superseded kinds whose records are on disk under the pre-`.jsonl` name
 * @returns the half of a snapshot the grading reads
 */
function view({
  updatedAt,
  kinds,
  missing = [],
  mismatched = [],
  superseded = [],
}: {
  updatedAt: string | null;
  kinds: readonly AtlasKindView[];
  missing?: readonly string[];
  mismatched?: readonly string[];
  superseded?: readonly string[];
}): AtlasGeneratedView {
  return {
    generation: {
      mismatched,
      missing,
      platform: "vanta",
      schemaVersion: 3,
      superseded,
      unpublished: [],
      updatedAt,
    },
    kinds,
  };
}

describe("gradeAtlasAnswerability", () => {
  it("grades a generation whose entities all read back as answerable", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [kindView({ held: 3, kind: "control", published: 3 })],
        updatedAt: "2026-09-05T00:00:00.000Z",
      }),
    });
    expect(graded.grade).toBe("answerable");
    expect(graded.readable).toBe(3);
    expect(graded.vouchedFor).toBe(3);
    expect(graded.darkKinds).toEqual([]);
  });

  it("grades an atlas nobody has ever published as unpublished, never as an empty organisation", () => {
    const graded = gradeAtlasAnswerability({ snapshot: view({ kinds: [], updatedAt: null }) });
    expect(graded.grade).toBe("unpublished");
    expect(graded.because).toBe("no generation has been published, so the vanta atlas has never held anything");
  });

  it("grades a manifest that vouches for a kind whose file is gone as dark", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [kindView({ held: 0, kind: "control", published: 228 })],
        missing: ["control"],
        updatedAt: "2026-09-04T10:29:44.744Z",
      }),
    });
    expect(graded.grade).toBe("dark");
    expect(graded.darkKinds).toEqual(["control"]);
    expect(graded.vouchedFor).toBe(228);
    expect(graded.readable).toBe(0);
  });

  it("grades a file that is not the one the manifest published as dark", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [kindView({ held: 2, kind: "policy", published: 2 })],
        mismatched: ["policy"],
        updatedAt: "2026-09-04T10:29:44.744Z",
      }),
    });
    expect(graded.grade).toBe("dark");
    expect(graded.darkKinds).toEqual(["policy"]);
  });

  it("grades a kind the manifest vouches for and the reader produced none of as dark, with no store field saying so", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [
          kindView({ held: 10, kind: "host", published: 10 }),
          kindView({ held: 0, kind: "console-page", published: 907 }),
        ],
        updatedAt: "2026-09-06T02:20:00.000Z",
      }),
    });
    expect(graded.grade).toBe("dark");
    expect(graded.darkKinds).toEqual(["console-page"]);
    expect(graded.readable).toBe(10);
    expect(graded.vouchedFor).toBe(917);
  });

  // THE HOLE this file is here to keep shut. `entityCount: 0` in the manifest cell is the only shape that
  // falls out of every other arm at once: the store grades the kind `superseded` rather than `missing`, so
  // the missing arm never sees it, and `publishedCount` is 0, so the published-vs-projected arm has nothing
  // to be short of. Without `superseded` in the union an atlas holding a whole generation in the old layout
  // grades ANSWERABLE and answers nothing — the exact sentence the guard exists to prevent.
  it("grades a superseded kind the manifest vouches for NO entities of as dark, not answerable", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [kindView({ held: 0, kind: "control", published: 0 })],
        superseded: ["control"],
        updatedAt: "2026-09-05T13:36:09.670Z",
      }),
    });
    expect(graded.grade).toBe("dark");
    expect(graded.darkKinds).toEqual(["control"]);
    expect(graded.supersededKinds).toEqual(["control"]);
    expect(graded.vouchedFor).toBe(0);
  });

  it("carries a superseded kind into darkKinds when the manifest does vouch for entities", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [kindView({ held: 0, kind: "vault", published: 12449 })],
        superseded: ["vault"],
        updatedAt: "2026-08-29T05:44:23.607Z",
      }),
    });
    expect(graded.grade).toBe("dark");
    expect(graded.darkKinds).toEqual(["vault"]);
    expect(graded.supersededKinds).toEqual(["vault"]);
  });

  it("reports no superseded kinds for a generation that is dark some other way", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [kindView({ held: 0, kind: "control", published: 228 })],
        missing: ["control"],
        updatedAt: "2026-09-04T10:29:44.744Z",
      }),
    });
    expect(graded.supersededKinds).toEqual([]);
  });

  it("counts a kind the manifest vouches for none of as neither dark nor readable", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [
          kindView({ held: 0, kind: "audit", published: 0 }),
          kindView({ held: 1, kind: "control", published: 1 }),
        ],
        updatedAt: "2026-09-05T00:00:00.000Z",
      }),
    });
    expect(graded.grade).toBe("answerable");
    expect(graded.darkKinds).toEqual([]);
  });

  it("names every dark kind once, sorted, when the store and the arithmetic both flag one", () => {
    const graded = gradeAtlasAnswerability({
      snapshot: view({
        kinds: [
          kindView({ held: 0, kind: "risk", published: 4 }),
          kindView({ held: 0, kind: "control", published: 1 }),
        ],
        missing: ["control"],
        updatedAt: "2026-09-05T00:00:00.000Z",
      }),
    });
    expect(graded.darkKinds).toEqual(["control", "risk"]);
  });
});

describe("refuseUnanswerableAtlas", () => {
  /**
   * A whole snapshot, built by widening a generated view with the descriptor a refusal never reads.
   *
   * @param generated the generation and kinds under test
   * @returns the snapshot shape the guard takes
   */
  function snapshotOf({ generated }: { generated: AtlasGeneratedView }): AtlasReadSnapshot {
    return {
      descriptor: {
        excludes: [],
        kinds: ["control"],
        platform: "vanta",
        question: "what does this tenant hold",
        resyncCommand: "slopweaver atlas vanta sync",
        surfaces: [],
        visibilityScope: "this tenant",
        writePolicy: "refuse-every-write",
      },
      ...generated,
    };
  }

  it("hands back an answerable snapshot unchanged", () => {
    const generated = view({
      kinds: [kindView({ held: 1, kind: "control", published: 1 })],
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
    const guarded = refuseUnanswerableAtlas({ snapshot: snapshotOf({ generated }) });
    expect(guarded.isOk()).toBe(true);
  });

  it("refuses an unpublished atlas with the code a sweep grades on", () => {
    const guarded = refuseUnanswerableAtlas({
      snapshot: snapshotOf({ generated: view({ kinds: [], updatedAt: null }) }),
    });
    expect(guarded.isErr()).toBe(true);
    expect(unwrapErr(guarded).code).toBe("ATLAS_GENERATION_UNPUBLISHED");
  });

  it("refuses a dark generation and names the kinds the reader cannot see", () => {
    const guarded = refuseUnanswerableAtlas({
      snapshot: snapshotOf({
        generated: view({
          kinds: [kindView({ held: 0, kind: "control", published: 228 })],
          missing: ["control"],
          updatedAt: "2026-09-04T10:29:44.744Z",
        }),
      }),
    });
    expect(guarded.isErr()).toBe(true);
    const error = unwrapErr(guarded);
    expect(error.code).toBe("ATLAS_GENERATION_DARK");
    expect(error.message).toContain("vouches for 228 entities and the store produced 0");
    expect(error.message).toContain("run `slopweaver atlas doctor` to see the whole estate");
  });

  // The message exists because a refusal that only says "the reader cannot see
  // these" sends a reader to a second verb to learn which of two states they are in, and the state where
  // the bytes are intact is the one nobody guesses.
  it("tells a reader whose records are in the previous format that nothing was lost, and names the repair", () => {
    const guarded = refuseUnanswerableAtlas({
      snapshot: snapshotOf({
        generated: view({
          kinds: [kindView({ held: 0, kind: "control", published: 228 })],
          superseded: ["control"],
          updatedAt: "2026-09-04T10:29:44.744Z",
        }),
      }),
    });
    expect(guarded.isErr()).toBe(true);
    const error = unwrapErr(guarded);
    expect(error.code).toBe("ATLAS_GENERATION_DARK");
    expect(error.message).toContain(
      "1 of them are on disk RIGHT NOW under the pre-`.jsonl` name this build no longer reads (control), " +
        "so nothing has been lost and nothing needs fetching again — run `slopweaver atlas doctor --repair`",
    );
    expect(error.message).toContain("would understate the atlas as silently as answering zero would");
  });
});
