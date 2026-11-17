/*
 * Which sources can make the derived roster stale: the exclusions, each pinned to the resolver fact that makes it
 * true, and the human override roster that refuses whatever the sources did.
 */
import { describe, expect, it } from "vitest";
import { type CorpusRecord, type CorpusSource } from "../../../../../corpus/types.js";
import { ALL_CORPUS_SOURCES } from "../../../../../integrations/corpusSources.js";
import {
  deriveFreshness,
  EMPTY_WITNESS,
  emptyObservation,
  type FreshnessObservation,
  ROSTER_SOURCES,
} from "../../../../../silver/derive/freshness.js";
import { identityCandidatesForRecord } from "../../../../../silver/personResolver.js";
import { stampOf } from "./harness.js";

/** One record of a source, authored by a value that source's own connector would supply. */
function recordFrom({ source, author }: { source: CorpusSource; author: string }): CorpusRecord {
  return {
    author,
    container: "c",
    kind: "message",
    raw: {},
    refs: [],
    source,
    sourceId: "s1",
    text: "t",
    tsIso: "2026-08-28T00:00:00.000Z",
    url: "https://example.invalid/1",
  };
}

describe("ROSTER_SOURCES — which sources can make the roster stale", () => {
  it("excludes exactly the sources that can mint no identity, and no others", () => {
    const excluded = ALL_CORPUS_SOURCES.filter((source) => !ROSTER_SOURCES.includes(source));
    expect(excluded.toSorted()).toEqual([
      "calendar",
      "chatgpt",
      "fathom",
      "gmail",
      "gold",
      "outlook",
      "outlook-calendar",
    ]);
  });

  it("pins each exclusion to the resolver fact that makes it true", () => {
    // The exclusions are not a taste call: a mail record's author is a display name (bronze scrubs every
    // address), a calendar record's organiser is scrubbed the same way, and `gold` is synthetic. None can
    // become a `nativeId`, so none can move the roster. A source that later gains a native-id shape mints a
    // candidate here and fails this test.
    expect(identityCandidatesForRecord({ record: recordFrom({ author: "Ada Lovelace", source: "gmail" }) })).toEqual(
      [],
    );
    expect(identityCandidatesForRecord({ record: recordFrom({ author: "Ada Lovelace", source: "calendar" }) })).toEqual(
      [],
    );
    expect(identityCandidatesForRecord({ record: recordFrom({ author: "Ada Lovelace", source: "fathom" }) })).toEqual(
      [],
    );
    // A chat's author is its ROLE — `user` or `assistant` — never a person's id.
    expect(identityCandidatesForRecord({ record: recordFrom({ author: "user", source: "chatgpt" }) })).toEqual([]);
    expect(identityCandidatesForRecord({ record: recordFrom({ author: "someone", source: "gold" }) })).toEqual([]);
    // The control: a Slack id IS native-shaped, which is why slack stays in the set.
    expect(identityCandidatesForRecord({ record: recordFrom({ author: "U123ABC", source: "slack" }) })).toEqual([
      { name: "U123ABC", nativeId: "U123ABC", source: "slack" },
    ]);
  });

  it("a gmail ingest alone leaves the roster FRESH — the as-me outage", () => {
    // 2.4 MB of mail landed and every `slack post --as me` refused on roster staleness. Nothing gmail
    // carries can address anyone, so the send had nothing to be wrong about.
    const stamp = stampOf({ observation: emptyObservation() });
    const base = emptyObservation();
    const observed: FreshnessObservation = {
      ...base,
      sources: { ...base.sources, gmail: { ...EMPTY_WITNESS, bronzeBytes: 2_400_000, bronzeFiles: 1 } },
    };
    expect(deriveFreshness({ artefactPresent: true, observed, stamp })).toEqual({ kind: "fresh" });
  });

  it("still refuses on the human override roster, whatever the sources did", () => {
    // The morning's SECOND trigger: a hand edit to the authoritative roster, now a new revision of its row.
    const stamp = stampOf({ observation: { ...emptyObservation(), overrideRevision: 4 } });
    const verdict = deriveFreshness({
      artefactPresent: true,
      observed: { ...emptyObservation(), overrideRevision: 5 },
      stamp,
    });
    expect(verdict).toEqual({
      changed: [{ reasons: ["override roster revision 4 → 5"], source: "identity roster" }],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });
});
