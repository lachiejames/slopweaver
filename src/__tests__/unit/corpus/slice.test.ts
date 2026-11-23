/**
 * The slice pin and the seven conservation identities.
 *
 * Every test here is written to be FALSIFIABLE, because the failure this whole capability exists to prevent
 * is a green check sitting over a lossy corpus. So each identity is exercised twice — once on input that
 * satisfies it, and once on input that breaks it — and the second half is the half that matters. A check
 * that has never been seen to go red has not been shown to work.
 */
import { describe, expect, it } from "vitest";
import {
  buildSlicePin,
  comparePins,
  FIELD_DISPOSITIONS,
  parseSliceManifest,
  SLICE_MANIFEST_VERSION,
} from "../../../corpus/slice.js";
import {
  anyBroken,
  checkCaptureWrite,
  checkDiscovery,
  checkIdempotence,
  checkKeyInjectivity,
  checkProjection,
  checkReconstruction,
  checkRetrievalHandoff,
  provedNothing,
  renderSliceReport,
} from "../../../corpus/sliceChecks.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { MAX_RECORD_CHARS, shardRecordFrom } from "../../../retrieval/fanout.js";

/** A record with everything a real one carries, overridable per test. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    author: "me",
    container: "notes/daily",
    kind: "document",
    refs: [],
    source: "self",
    sourceId: "notes/daily/monday.md#0.0:body",
    text: "the decision was to keep the cursor held back",
    tsIso: "2026-08-05T00:00:00.000Z",
    url: "/dev/notes/daily/monday.md",
    ...over,
  };
}

const FAULTS: ReadonlySet<string> = new Set(["unreadable", "binary-content"]);

describe("buildSlicePin", () => {
  it("is stable across input ORDER, so two walks of the same files pin identically", () => {
    const a = record({ sourceId: "a" });
    const b = record({ sourceId: "b" });

    expect(buildSlicePin({ records: [a, b] }).digest).toBe(buildSlicePin({ records: [b, a] }).digest);
  });

  it("moves when CONTENT changes even though identity and count do not", () => {
    const before = buildSlicePin({ records: [record()] });
    const after = buildSlicePin({ records: [record({ text: "the decision was reversed" })] });

    expect(after.digest).not.toBe(before.digest);
    expect(after.records).toBe(before.records);
  });

  // The gap that made a new pin necessary: the existing corpus manifest stores identity SETS, so this exact
  // pair compares equal there with zero findings. Naming the case keeps the reason for this module visible.
  it("names a content-only change rather than reporting no difference", () => {
    const before = buildSlicePin({ records: [record()] });
    const after = buildSlicePin({ records: [record({ text: "different" })] });

    const findings = comparePins({ after, before });

    expect(findings.length).toBe(1);
    expect(findings[0]!).toContain("content changed with no change in shape");
  });

  // The writer's fingerprint blanks `tsIso` so an unchanged re-observation deduplicates. Correct for a
  // writer, wrong for a pin: `askPrompt` renders that date INTO the prompt, so a changed date is a changed
  // thing the model is shown. Touching a non-git note is the concrete case.
  it("moves when only the model-visible DATE changes, which the writer fingerprint alone would miss", () => {
    const before = buildSlicePin({ records: [record()] });
    const after = buildSlicePin({ records: [record({ tsIso: "2026-08-09T00:00:00.000Z" })] });

    expect(after.digest).not.toBe(before.digest);
  });

  it("counts distinct identities separately from records, so a duplicated identity is visible", () => {
    const pin = buildSlicePin({ records: [record(), record({ text: "second version" })] });

    expect(pin.records).toBe(2);
    expect(pin.identities).toBe(1);
  });

  it("agrees with itself on an empty slice rather than throwing", () => {
    expect(buildSlicePin({ records: [] }).records).toBe(0);
  });
});

describe("parseSliceManifest", () => {
  const valid = {
    capturedAtIso: "2026-08-08T00:00:00.000Z",
    declinedByReason: { "unsupported-extension": 3 },
    entriesSeen: 10,
    exclude: ["reference/vendored"],
    name: "self-daily",
    pin: { digest: "abc", identities: 7, records: 7 },
    roots: ["/dev/notes"],
    sentinels: [{ query: "what did we decide", text: "SENTINEL-ONE" }],
    source: "self",
    version: SLICE_MANIFEST_VERSION,
  };

  it("accepts a complete manifest", () => {
    expect(parseSliceManifest({ value: valid })?.name).toBe("self-daily");
  });

  // The existing corpus-manifest parser accepts `{"version":1}` and fills collections with empties, which
  // turns a truncated file into a manifest that compares clean against anything. This one must not.
  it("refuses a manifest carrying only its version", () => {
    expect(parseSliceManifest({ value: { version: SLICE_MANIFEST_VERSION } })).toBe(undefined);
  });

  it("refuses a manifest whose pin lost its digest", () => {
    expect(parseSliceManifest({ value: { ...valid, pin: { identities: 7, records: 7 } } })).toBe(undefined);
  });

  it("refuses a sentinel missing its query", () => {
    expect(parseSliceManifest({ value: { ...valid, sentinels: [{ text: "S" }] } })).toBe(undefined);
  });

  it("refuses a sentinel that is not an object", () => {
    expect(parseSliceManifest({ value: { ...valid, sentinels: ["not an object"] } })).toBe(undefined);
  });

  it("refuses declinedByReason carrying a non-number value", () => {
    expect(parseSliceManifest({ value: { ...valid, declinedByReason: { "unsupported-extension": "three" } } })).toBe(
      undefined,
    );
  });

  // A pin is only reproducible if the re-walk sees the same subtree, so the exclusions travel WITH it.
  // Verifying under different exclusions than were captured compares two different slices and calls the
  // difference loss.
  it("carries the capture's exclusions, so a re-walk sees the same subtree", () => {
    expect(parseSliceManifest({ value: valid })?.exclude).toEqual(["reference/vendored"]);
  });

  // A pin captured before `--exclude` existed excluded nothing, so reading it as an empty list is faithful.
  // Refusing it would orphan every pin on disk the moment the field was added — which is exactly what
  // happened when this first shipped, and two live pins stopped parsing.
  it("reads a pin captured before --exclude existed as excluding nothing", () => {
    const { exclude: _dropped, ...without } = valid;
    expect(parseSliceManifest({ value: without })?.exclude).toEqual([]);
  });

  it("still refuses an exclude field that is present and malformed", () => {
    expect(parseSliceManifest({ value: { ...valid, exclude: "reference/vendored" } })).toBe(undefined);
  });

  it("refuses a version it does not know", () => {
    expect(parseSliceManifest({ value: { ...valid, version: 99 } })).toBe(undefined);
  });
});

describe("checkDiscovery", () => {
  it("holds when every entry seen was read or named", () => {
    const result = checkDiscovery({
      declinedByReason: { "unsupported-extension": 3 },
      entriesSeen: 10,
      faultReasons: FAULTS,
      filesRead: 7,
    });

    expect(result.status).toBe("held");
  });

  // The measured defect: three files vanished from a real root while every printed number stayed balanced,
  // because `ingested` only ever counted rows that were READ.
  it("breaks when entries were seen and neither read nor named", () => {
    const result = checkDiscovery({
      declinedByReason: { "unsupported-extension": 1 },
      entriesSeen: 6,
      faultReasons: FAULTS,
      filesRead: 2,
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("3 unaccounted");
  });

  it("breaks on a FAULT decline even when the arithmetic balances", () => {
    const result = checkDiscovery({
      declinedByReason: { unreadable: 2 },
      entriesSeen: 5,
      faultReasons: FAULTS,
      filesRead: 3,
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("fault rather than a policy");
  });

  it("is vacuous rather than passing when the walk saw nothing", () => {
    const result = checkDiscovery({ declinedByReason: {}, entriesSeen: 0, faultReasons: FAULTS, filesRead: 0 });

    expect(result.status).toBe("vacuous");
  });
});

describe("checkCaptureWrite", () => {
  it("holds when every projected record is in bronze by identity and content", () => {
    const records = [record({ sourceId: "a" }), record({ sourceId: "b" })];

    expect(checkCaptureWrite({ physical: records, projected: records, stored: records }).status).toBe("held");
  });

  it("breaks when a record is absent from bronze", () => {
    const a = record({ sourceId: "a" });
    const result = checkCaptureWrite({ physical: [a], projected: [a, record({ sourceId: "b" })], stored: [a] });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("absent from bronze");
  });

  // The reason this is not the arithmetic check: an identity that is present but holds DIFFERENT content is
  // a silent overwrite, and `projected = written + deduped` balances straight through it.
  it("breaks when the identity survived but its content did not", () => {
    const result = checkCaptureWrite({
      physical: [record({ text: "something else entirely" })],
      projected: [record({ text: "the real decision" })],
      stored: [record({ text: "something else entirely" })],
    });

    expect(result.status).toBe("broken");
  });

  // Found by running this against the real corpus: 22 records of the owner's own memory files were reported
  // ABSENT while sitting on disk the whole time. Bronze is append-only and `supersedes` breaks a timestamp
  // tie by preferring the LONGER serialisation, so editing a note to say something shorter writes a row that
  // loses to its own stale predecessor. Written, and never read. A different failure with a different fix.
  it("distinguishes a record that never landed from one written but SHADOWED in the latest view", () => {
    const current = record({ text: "the decision, restated concisely" });
    const stale = record({ text: "the decision, restated concisely, at considerably greater length than needed" });

    const result = checkCaptureWrite({ physical: [stale, current], projected: [current], stored: [stale] });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("written but never read");
    expect(result.detail).toContain("1 written but SHADOWED");
  });
});

describe("checkProjection", () => {
  it("holds when every field a record carries is classified", () => {
    expect(checkProjection({ records: [record()] }).status).toBe("held");
  });

  it("breaks when a record carries a field nobody has classified", () => {
    const rogue = { ...record(), summary: "an unclassified field" } as unknown as CorpusRecord;
    const result = checkProjection({ records: [rogue] });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("`summary`");
  });

  it("classifies raw as non-indexable, which is a decision rather than an oversight", () => {
    expect(FIELD_DISPOSITIONS.raw).toBe("non-indexable");
  });

  // An adversarial pass caught this as a FALSE declaration and it was: BM25 tokenises `title + text + refs`,
  // but `askPrompt` renders title, text, date and author — never refs. A unique string living only in `refs`
  // is findable and unreachable, which is exactly the silent loss this capability is about. Calling it
  // "indexed" under a definition meaning "can reach a prompt" was the harness lying in its own vocabulary.
  it("classifies refs as searchable-only, because the ranker reads it and the prompt never renders it", () => {
    expect(FIELD_DISPOSITIONS.refs).toBe("searchable-only");
  });
});

describe("checkReconstruction", () => {
  // A slice where nothing exceeds the budget compares every body to ITSELF, so the check cannot fail. That
  // is `self` exactly — 0 of its 54,987 records exceed the 1,200-char cap — and calling it held would be the
  // harness flattering itself on the identity the owner is most confident about.
  it("is VACUOUS when every body already fits the budget, because then it examined nothing", () => {
    const result = checkReconstruction({
      budget: 1200,
      pairs: [{ body: "short", label: "a", selected: "short" }],
    });

    expect(result.status).toBe("vacuous");
    expect(result.detail).toContain("cannot exercise reconstruction");
  });

  it("reconstructs a body exactly from the text selected out of it", () => {
    const result = checkReconstruction({
      budget: 4,
      pairs: [{ body: "the whole body", label: "a", selected: "the whole body" }],
    });

    expect(result.status).toBe("held");
  });

  // The defect the identity exists for: chunks cut at one size, a consumer clipping at a smaller one.
  it("breaks when the selected text is shorter than the body it came from", () => {
    const result = checkReconstruction({
      budget: 20,
      pairs: [
        {
          body: "the whole body, including the decision at the end",
          label: "notes/a.md#0.0",
          selected: "the whole body",
        },
      ],
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("35 lost");
  });

  // The SYNTHETIC OVER-BUDGET FIXTURE the owner authorised, and it is deliberately not something the `self`
  // projector can produce — that projector budgets every section to fit, which is exactly why `self` cannot
  // exercise this identity. The body is run through the REAL shard renderer at the REAL per-record budget
  // rather than having its `selected` half hand-written, because a hand-written one proves only that the
  // comparator branches on unequal strings. Measured on the live corpus, 37,926 records are in this shape.
  it("goes red on a body the REAL shard renderer genuinely cannot fit", () => {
    const body = [
      "SENTINEL-OVERBUDGET the decision is recorded at the very end of this record.",
      "filler. ".repeat(1200),
      "and the decision itself, which the budget will cut away: HOLD THE CURSOR BACK.",
    ].join("\n\n");
    expect(body.length).toBeGreaterThan(MAX_RECORD_CHARS);

    const selected = shardRecordFrom({
      record: {
        container: "fixture",
        kind: "message",
        refs: [],
        source: "slack",
        sourceId: "over-budget",
        text: body,
        tsIso: "2026-09-01T00:00:00.000Z",
        url: "https://example.invalid/over-budget",
      },
    }).text;
    const result = checkReconstruction({
      budget: MAX_RECORD_CHARS,
      pairs: [{ body, label: "fixture/over-budget.md#0.0", selected }],
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("lost");
  });

  it("names the corpus-wide exposure so a vacuous result is a fact rather than a shrug", () => {
    const result = checkReconstruction({
      budget: 1200,
      corpusExposure: { ofRecords: 369_759, overBudget: 37_926 },
      pairs: [{ body: "short", label: "a", selected: "short" }],
    });

    expect(result.status).toBe("vacuous");
    expect(result.detail).toContain("corpus-wide 37926 of 369759 record(s) EXCEED the budget");
  });

  it("is vacuous rather than passing when there is nothing to reconstruct", () => {
    expect(checkReconstruction({ budget: 1200, pairs: [] }).status).toBe("vacuous");
  });
});

describe("checkRetrievalHandoff", () => {
  const sentinel = { query: "what did we decide", text: "SENTINEL-ONE" };

  it("holds when every sentinel is retrieved and survives into the prompt", () => {
    const result = checkRetrievalHandoff({
      droppedChars: 0,
      observations: [{ inPrompt: true, retrieved: true, sentinel }],
    });

    expect(result.status).toBe("held");
  });

  it("breaks when a sentinel is not retrievable at all", () => {
    const result = checkRetrievalHandoff({
      droppedChars: 0,
      observations: [{ inPrompt: false, retrieved: false, sentinel }],
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("not retrievable");
  });

  // The interesting failure: found, then clipped away before the model ever saw it.
  it("breaks when a sentinel is retrieved and then clipped before the prompt", () => {
    const result = checkRetrievalHandoff({
      droppedChars: 4210,
      observations: [{ inPrompt: false, retrieved: true, sentinel }],
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("CLIPPED");
  });

  // Dropped characters are REPORTED, never required to be zero — driving them to zero is another doc's job,
  // and a harness that refuses to run until an unrelated defect is fixed is useless.
  it("still holds while reporting a non-zero dropped-character count", () => {
    const result = checkRetrievalHandoff({
      droppedChars: 4210,
      observations: [{ inPrompt: true, retrieved: true, sentinel }],
    });

    expect(result.status).toBe("held");
    expect(result.detail).toContain("4210 char(s) dropped");
  });
});

describe("checkIdempotence", () => {
  // An empty pin reproduces an empty pin, always. Left as `held`, that one true-by-construction result was
  // enough to stop an entirely vacuous run reading as a pass: a slice over a missing root and an absent
  // corpus exited 0 saying "nothing was lost".
  it("is VACUOUS for two empty pins, because reproducing nothing proves nothing", () => {
    const empty = buildSlicePin({ records: [] });

    expect(checkIdempotence({ after: empty, before: empty }).status).toBe("vacuous");
  });

  it("holds when an unchanged rerun reproduces the pin", () => {
    const pin = buildSlicePin({ records: [record()] });

    expect(checkIdempotence({ after: pin, before: pin }).status).toBe("held");
  });

  it("breaks when the fixture changed under the pin", () => {
    const before = buildSlicePin({ records: [record()] });
    const after = buildSlicePin({ records: [record(), record({ sourceId: "b" })] });
    const result = checkIdempotence({ after, before });

    expect(result.status).toBe("broken");
    expect(result.detail).toContain("not comparable");
  });
});

describe("checkKeyInjectivity", () => {
  // `self` has no bare-sourceId collisions at all, so on a self slice this check examines nothing. Reporting
  // that as a pass is exactly how a green harness comes to sit over a corpus with 2,097 colliding keys.
  it("is VACUOUS, not held, on a slice with no collisions to examine", () => {
    const result = checkKeyInjectivity({ records: [record({ sourceId: "a" }), record({ sourceId: "b" })] });

    expect(result.status).toBe("vacuous");
    expect(result.detail).toContain("cannot exercise the collapse");
  });

  it("breaks when one bare sourceId is shared by two different composite identities", () => {
    const result = checkKeyInjectivity({
      records: [
        record({ container: "repo-one", sourceId: "#123" }),
        record({ container: "repo-two", sourceId: "#123" }),
      ],
    });

    expect(result.status).toBe("broken");
    expect(result.residue[0]!).toContain("shared by 2 distinct records");
  });
});

describe("provedNothing", () => {
  it("is true when every identity was vacuous, however many there are", () => {
    const results = [checkKeyInjectivity({ records: [record()] }), checkReconstruction({ budget: 1200, pairs: [] })];

    expect(provedNothing({ results })).toBe(true);
    expect(anyBroken({ results })).toBe(false);
  });

  it("is false as soon as one identity actually held", () => {
    const results = [checkKeyInjectivity({ records: [record()] }), checkProjection({ records: [record()] })];

    expect(provedNothing({ results })).toBe(false);
  });

  it("reports INCONCLUSIVE rather than a pass, so the two sentences stay apart", () => {
    const lines = renderSliceReport({ results: [checkReconstruction({ budget: 1200, pairs: [] })] });

    expect(lines[lines.length - 1]!).toContain("INCONCLUSIVE");
    expect(lines[lines.length - 1]!).toContain("proved nothing");
  });
});

describe("anyBroken and renderSliceReport", () => {
  it("does not fail a run for a vacuous identity", () => {
    const results = [checkKeyInjectivity({ records: [record()] })];

    expect(anyBroken({ results })).toBe(false);
  });

  it("fails a run for a broken identity", () => {
    const results = [checkReconstruction({ budget: 4, pairs: [{ body: "abcdef", label: "a", selected: "abc" }] })];

    expect(anyBroken({ results })).toBe(true);
  });

  it("prints the residue beneath a broken identity, so a failure says what was lost", () => {
    const lines = renderSliceReport({
      results: [checkReconstruction({ budget: 4, pairs: [{ body: "abcdef", label: "notes/a.md", selected: "abc" }] })],
    });

    expect(lines[0]!).toContain("BROKEN  reconstruction");
    expect(lines[1]!).toContain("notes/a.md");
    expect(lines[2]!).toContain("1 identity(ies) BROKEN");
  });

  it("counts vacuous identities separately in the summary rather than folding them into the pass", () => {
    const lines = renderSliceReport({
      results: [checkKeyInjectivity({ records: [record()] }), checkProjection({ records: [record()] })],
    });

    expect(lines[lines.length - 1]!).toContain("1 vacuous");
  });
});
