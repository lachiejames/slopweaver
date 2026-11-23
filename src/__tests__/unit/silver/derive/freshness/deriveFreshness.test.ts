/*
 * What counts as moved: an artefact absent or carrying no stamp, every witness matching, a cursor, a member roster
 * or an override roster that moved, and a pre-store stamp that no row can settle.
 */
import { describe, expect, it } from "vitest";
import {
  deriveFreshness,
  EMPTY_WITNESS,
  emptyObservation,
  type FreshnessObservation,
  type FreshnessStamp,
  type SourceWitness,
  settledForAsk,
} from "../../../../../silver/derive/freshness.js";
import { UNWITNESSED_REVISION } from "../../../../../silver/derive/stampedRevision.js";
import { stampOf } from "./harness.js";

/** An observation whose `slack` source carries the given witness and whose others are empty. */
function observationWith({
  slack,
  overrideRevision = null,
}: {
  slack: Partial<SourceWitness>;
  overrideRevision?: number | null;
}): FreshnessObservation {
  const base = emptyObservation();
  return {
    ...base,
    overrideRevision,
    sources: { ...base.sources, slack: { ...EMPTY_WITNESS, ...slack } },
  };
}

describe("deriveFreshness — what counts as moved", () => {
  it("is absent when the artefact was never derived", () => {
    const verdict = deriveFreshness({
      artefactPresent: false,
      observed: emptyObservation(),
      stamp: undefined,
    });
    expect(verdict).toEqual({ kind: "absent", why: "it has never been derived" });
  });

  it("is absent when the artefact exists but carries no stamp", () => {
    const verdict = deriveFreshness({ artefactPresent: true, observed: emptyObservation(), stamp: undefined });
    expect(verdict.kind).toBe("absent");
  });

  it("is fresh when every witness matches the stamp", () => {
    const observation = observationWith({
      slack: { bronzeBytes: 900, bronzeFiles: 3, cursorIso: "2026-08-22T10:58:40Z" },
    });
    expect(deriveFreshness({ artefactPresent: true, observed: observation, stamp: stampOf({ observation }) })).toEqual({
      kind: "fresh",
    });
  });

  it("is fresh after a refresh that ingested nothing — the same cursor and the same bytes", () => {
    const before = observationWith({ slack: { bronzeBytes: 900, bronzeFiles: 3, cursorIso: "2026-08-22T10:58:40Z" } });
    const after = observationWith({ slack: { bronzeBytes: 900, bronzeFiles: 3, cursorIso: "2026-08-22T10:58:40Z" } });
    expect(
      deriveFreshness({ artefactPresent: true, observed: after, stamp: stampOf({ observation: before }) }),
    ).toEqual({
      kind: "fresh",
    });
  });

  it("is stale when the resume cursor advanced, and names the source and the move", () => {
    const before = observationWith({ slack: { cursorIso: "2026-08-20T00:00:00Z" } });
    const after = observationWith({ slack: { cursorIso: "2026-08-22T10:58:40Z" } });
    const verdict = deriveFreshness({
      artefactPresent: true,
      observed: after,
      stamp: stampOf({ observation: before }),
    });
    expect(verdict).toEqual({
      changed: [{ reasons: ["resume cursor 2026-08-20T00:00:00Z → 2026-08-22T10:58:40Z"], source: "slack" }],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });

  it("is stale when a member roster grew, even though bronze did not", () => {
    const before = observationWith({ slack: { bronzeBytes: 900, bronzeFiles: 3, memberBytes: 100 } });
    const after = observationWith({ slack: { bronzeBytes: 900, bronzeFiles: 3, memberBytes: 420 } });
    const verdict = deriveFreshness({
      artefactPresent: true,
      observed: after,
      stamp: stampOf({ observation: before }),
    });
    expect(verdict).toEqual({
      changed: [{ reasons: ["member roster 100B → 420B"], source: "slack" }],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });

  it("is stale when the human override roster was edited", () => {
    const before = observationWith({ overrideRevision: null, slack: {} });
    const after = observationWith({ overrideRevision: 1, slack: {} });
    const verdict = deriveFreshness({
      artefactPresent: true,
      observed: after,
      stamp: stampOf({ observation: before }),
    });
    expect(verdict).toEqual({
      changed: [{ reasons: ["override roster revision (none) → 1"], source: "identity roster" }],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });

  it("is fresh when the stamp and the store both say no row", () => {
    const observation = observationWith({ overrideRevision: null, slack: {} });
    expect(deriveFreshness({ artefactPresent: true, observed: observation, stamp: stampOf({ observation }) })).toEqual({
      kind: "fresh",
    });
  });

  it("reads a pre-store stamp as stale even against no row, because its derive may have read the retired file", () => {
    const stamp: FreshnessStamp = {
      ...stampOf({ observation: emptyObservation() }),
      overrideRevision: UNWITNESSED_REVISION,
    };
    expect(deriveFreshness({ artefactPresent: true, observed: emptyObservation(), stamp })).toEqual({
      changed: [
        {
          reasons: [
            "override roster revision (unwitnessed: a stamp from before the roster moved into the store) → (none)",
          ],
          source: "identity roster",
        },
      ],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });

  it("never settles a moved roster revision by time, however late the derive observed", () => {
    const stamp = stampOf({
      observation: observationWith({ overrideRevision: 2, slack: {} }),
      observedAtIso: "2026-08-21T00:00:00.000Z",
    });
    const observed = observationWith({ overrideRevision: 3, slack: {} });
    const freshness = deriveFreshness({ artefactPresent: true, observed, stamp });
    expect(settledForAsk({ askedAtIso: "2026-08-20T00:00:00.000Z", freshness, observed, stamp }).kind).toBe("stale");
  });
});
