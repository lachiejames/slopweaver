/**
 * `silverCurrency` — when a refresh may skip its whole-corpus derive, and every reason it may not.
 */
import { describe, expect, it } from "vitest";
import type { CorpusSource } from "../../../../corpus/types.js";
import { silverCurrency } from "../../../../silver/derive/currency.js";
import {
  type ArtefactWitness,
  type CorpusWitness,
  deriveFreshness,
  EMPTY_WITNESS,
  emptyObservation,
  type FreshnessObservation,
  type FreshnessStamp,
  parseFreshnessStamp,
  type SourceWitness,
} from "../../../../silver/derive/freshness.js";

const DERIVED_AT = "2026-10-01T00:00:00.000Z";

/** The corpus tree a home derive walks: its bronze root, two files, 100 bytes. */
const CORPUS: CorpusWitness = { bytes: 100, files: 2, root: "/h/corpus/bronze", unreadable: 0 };

/** An observation with one source's witness overridden, and optionally the roster revision and the exclusion size. */
function observation({
  source = "slack",
  witness = {},
  overrideRevision = null,
  exclusionBytes = 0,
  corpus = CORPUS,
}: {
  source?: CorpusSource;
  witness?: Partial<SourceWitness>;
  overrideRevision?: number | null;
  exclusionBytes?: number;
  corpus?: CorpusWitness | null;
} = {}): FreshnessObservation {
  const base = emptyObservation();
  return {
    corpus,
    exclusionBytes,
    overrideRevision,
    sources: { ...base.sources, [source]: { ...EMPTY_WITNESS, ...witness } },
  };
}

/** The two content artefacts these cases carry, exactly as the stamped derive wrote them. */
const WRITTEN: Readonly<Record<string, ArtefactWitness>> = {
  "/h/directory.json": { bytes: 40, mtimeMs: 1_000.25 },
  "/h/identities.json": { bytes: 70, mtimeMs: 1_000.5 },
};

/** The stamp a derive over `observed` would have written. */
function stampOf({ observed }: { observed: FreshnessObservation }): FreshnessStamp {
  return {
    ...observed,
    artefacts: WRITTEN,
    derivedAtIso: DERIVED_AT,
    observedAtIso: "2026-09-30T23:59:00.000Z",
    version: 1,
  };
}

/** The verdict for silver stamped over `stamped` and observed now as `now`, every artefact on disk. */
function verdict({
  stamped,
  now,
  missingArtefacts = [],
  onDisk = WRITTEN,
}: {
  stamped: FreshnessObservation;
  now: FreshnessObservation;
  missingArtefacts?: readonly string[];
  onDisk?: Readonly<Record<string, ArtefactWitness>>;
}): ReturnType<typeof silverCurrency> {
  const stamp = stampOf({ observed: stamped });
  return silverCurrency({
    freshness: deriveFreshness({ artefactPresent: true, observed: now, stamp }),
    missingArtefacts,
    observed: now,
    onDisk,
    stamp,
  });
}

const BASE = observation({ witness: { bronzeBytes: 100, bronzeFiles: 2, cursorIso: "2026-09-30T00:00:00Z" } });

describe("silverCurrency — skipping is allowed only when a rebuild would change nothing", () => {
  it("is current when every input is exactly as stamped", () => {
    expect(verdict({ now: BASE, stamped: BASE })).toEqual({ derivedAtIso: DERIVED_AT, kind: "current" });
  });

  it("rebuilds when a NON-roster source's bronze moved, which the send gate alone would call fresh", () => {
    const now = { ...BASE, sources: { ...BASE.sources, fathom: { ...EMPTY_WITNESS, bronzeBytes: 9, bronzeFiles: 1 } } };
    expect(deriveFreshness({ artefactPresent: true, observed: now, stamp: stampOf({ observed: BASE }) })).toEqual({
      kind: "fresh",
    });
    expect(verdict({ now, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "bronze, members or structures moved for fathom",
    });
  });

  it("stays current when only a non-roster source's cursor advanced, since derive never reads it", () => {
    const now = { ...BASE, sources: { ...BASE.sources, calendar: { ...EMPTY_WITNESS, cursorIso: "2026-10-01Z" } } };
    expect(verdict({ now, stamped: BASE })).toEqual({ derivedAtIso: DERIVED_AT, kind: "current" });
  });

  it("rebuilds when a ROSTER source's cursor advanced, so the next send does not pay for the derive itself", () => {
    const now = observation({ witness: { bronzeBytes: 100, bronzeFiles: 2, cursorIso: "2026-10-01T00:00:00Z" } });
    expect(verdict({ now, stamped: BASE })).toEqual({
      kind: "rebuild",
      why:
        "the derived identity roster (corpus/silver/index/identities.json) was built 2026-10-01T00:00:00.000Z " +
        "and its sources have moved since: " +
        "slack (resume cursor 2026-09-30T00:00:00Z → 2026-10-01T00:00:00Z)",
    });
  });

  it("rebuilds when a member roster or structures file grew", () => {
    const members = { ...BASE, sources: { ...BASE.sources, gmail: { ...EMPTY_WITNESS, memberBytes: 4 } } };
    const structures = { ...BASE, sources: { ...BASE.sources, calendar: { ...EMPTY_WITNESS, structureBytes: 4 } } };
    expect(verdict({ now: members, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "bronze, members or structures moved for gmail",
    });
    expect(verdict({ now: structures, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "bronze, members or structures moved for calendar",
    });
  });

  it("rebuilds when the sync-author denylist changed size", () => {
    expect(verdict({ now: { ...BASE, exclusionBytes: 12 }, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "the sync-author denylist moved 0B → 12B",
    });
  });

  it("rebuilds when any artefact derive writes is missing, naming it", () => {
    expect(verdict({ missingArtefacts: ["/h/structures.json"], now: BASE, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "silver is incomplete: /h/structures.json absent",
    });
  });

  it("rebuilds when there is no stamp at all", () => {
    expect(
      silverCurrency({
        freshness: deriveFreshness({ artefactPresent: true, observed: BASE, stamp: undefined }),
        missingArtefacts: [],
        observed: BASE,
        onDisk: WRITTEN,
        stamp: undefined,
      }),
    ).toEqual({
      kind: "rebuild",
      why:
        "the derived identity roster (corpus/silver/index/identities.json) cannot be trusted: it carries no " +
        "freshness stamp, so what it was derived from is unknowable",
    });
  });

  it("rebuilds once over a stamp written before the artefacts, the denylist and the corpus tree were witnessed", () => {
    const old = parseFreshnessStamp({
      // `overrideRevision: null` keeps the roster out of it: a stamp with no roster witness at all re-derives on
      // that alone (`freshness/deriveFreshness.test.ts`), which would mask the three witnesses this case is about.
      content: JSON.stringify({ derivedAtIso: DERIVED_AT, overrideRevision: null, sources: {}, version: 1 }),
    })!;
    expect(old.artefacts).toBeNull();
    expect(old.exclusionBytes).toBe(0);
    expect(old.corpus).toBeNull();
    const against = ({ stamp, now }: { stamp: FreshnessStamp; now: FreshnessObservation }) =>
      silverCurrency({
        freshness: deriveFreshness({ artefactPresent: true, observed: now, stamp }),
        missingArtefacts: [],
        observed: now,
        onDisk: WRITTEN,
        stamp,
      });
    const now = { ...emptyObservation(), corpus: CORPUS };
    expect(against({ now, stamp: old })).toEqual({
      kind: "rebuild",
      why: "the stamp does not record the artefacts its derive wrote",
    });
    const withArtefacts = { ...old, artefacts: WRITTEN };
    expect(against({ now: { ...now, exclusionBytes: 30 }, stamp: withArtefacts })).toEqual({
      kind: "rebuild",
      why: "the sync-author denylist moved 0B → 30B",
    });
    expect(against({ now, stamp: withArtefacts })).toEqual({
      kind: "rebuild",
      why: "the stamp does not witness the corpus tree derive reads",
    });
  });

  it("round-trips the artefact record through the persisted stamp, dropping an entry that is not a witness", () => {
    const parsed = parseFreshnessStamp({
      content: JSON.stringify({
        artefacts: { ...WRITTEN, "/h/people.json": { bytes: "big" } },
        derivedAtIso: DERIVED_AT,
        version: 1,
      }),
    })!;
    expect(parsed.artefacts).toEqual(WRITTEN);
  });

  it("rebuilds when the corpus tree grew where no per-source witness looks — a nested or a loose file", () => {
    const now = observation({
      corpus: { ...CORPUS, bytes: 140, files: 3 },
      witness: { bronzeBytes: 100, bronzeFiles: 2, cursorIso: "2026-09-30T00:00:00Z" },
    });
    expect(verdict({ now, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "the corpus tree moved: 2 file(s) 100B, 0 unlistable → 3 file(s) 140B, 0 unlistable",
    });
  });

  it("rebuilds when a corpus path became unlistable, even with the same files and bytes", () => {
    const now = { ...BASE, corpus: { ...CORPUS, unreadable: 1 } };
    expect(verdict({ now, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "the corpus tree moved: 2 file(s) 100B, 0 unlistable → 2 file(s) 100B, 1 unlistable",
    });
  });

  it("rebuilds when silver was derived from a --corpus override rather than this home's bronze", () => {
    const stamped = { ...BASE, corpus: { ...CORPUS, root: "/elsewhere/bronze" } };
    expect(verdict({ now: BASE, stamped })).toEqual({
      kind: "rebuild",
      why: "silver was derived from /elsewhere/bronze, not /h/corpus/bronze",
    });
  });

  it("rebuilds when an artefact is not the file the stamped derive wrote — a killed derive's leftover", () => {
    // Derive B wrote directory.json and stamped; derive A rewrote directory.json between and was killed.
    // Same size, a later mtime: only the exact record tells the two apart.
    const onDisk = { ...WRITTEN, "/h/directory.json": { bytes: 40, mtimeMs: 1_000.3 } };
    expect(verdict({ now: BASE, onDisk, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "/h/directory.json is not what the stamped derive wrote, so silver may mix two derives' output",
    });
  });

  it("rebuilds when an artefact on disk is one the stamp never recorded", () => {
    const onDisk = { ...WRITTEN, "/h/people.json": { bytes: 9, mtimeMs: 999 } };
    expect(verdict({ now: BASE, onDisk, stamped: BASE })).toEqual({
      kind: "rebuild",
      why: "/h/people.json is not what the stamped derive wrote, so silver may mix two derives' output",
    });
  });
});
