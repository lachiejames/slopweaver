/**
 * The ruling manifest is the proof's denominator, so it is parsed strictly and WHOLE: an entry that is not
 * right rejects the manifest rather than quietly leaving the proof one ruling short.
 */
import { describe, expect, it } from "vitest";

import { parseRulingManifest } from "../../../handover/rulingManifest.js";
import { RulingManifestErrors, rulingManifestErrorLines } from "../../../handover/rulingManifestErrors.js";
import { unwrap } from "../../../lib/result.js";

const SOURCE = "2026-09-04T12:38:57.414Z";

/** A manifest with the given entries, as text. */
function manifest({ entries, extra = {} }: { entries: readonly unknown[]; extra?: Record<string, unknown> }): string {
  return JSON.stringify({ entries, schemaVersion: 1, ...extra });
}

/** One well-formed entry, with any field overridden. */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { anchor: "https://example.invalid/p9", slug: "a-row", sourceAtIso: SOURCE, words: "yes, ship it", ...over };
}

/** The problems a text is refused with. */
function problems({ text }: { text: string }): readonly string[] {
  const parsed = parseRulingManifest({ text });
  expect(parsed.isErr()).toBe(true);
  return rulingManifestErrorLines({ error: parsed._unsafeUnwrapErr() });
}

describe("parseRulingManifest", () => {
  it("parses a valid manifest and keeps words and anchor exactly as written", () => {
    const words = '  OWNER RULED:\nship it — ✓ "quoted"  ';
    const parsed = unwrap(
      parseRulingManifest({
        text: manifest({
          entries: [
            entry({ words }),
            entry({ anchor: `journal:runs/a-row.jsonl#${SOURCE}`, sourceAtIso: "2026-09-05T00:00:00.000Z" }),
          ],
        }),
      }),
    );
    expect(parsed).toEqual({
      entries: [
        { anchor: "https://example.invalid/p9", slug: "a-row", sourceAtIso: SOURCE, words },
        {
          anchor: `journal:runs/a-row.jsonl#${SOURCE}`,
          slug: "a-row",
          sourceAtIso: "2026-09-05T00:00:00.000Z",
          words: "yes, ship it",
        },
      ],
      schemaVersion: 1,
    });
  });

  it("accepts an empty manifest, which states that nothing is expected", () => {
    expect(unwrap(parseRulingManifest({ text: manifest({ entries: [] }) }))).toEqual({ entries: [], schemaVersion: 1 });
  });

  it("refuses text that is not JSON", () => {
    expect(problems({ text: "{ not json" })).toEqual(["not JSON: invalid JSON"]);
    expect(parseRulingManifest({ text: "{ not json" })._unsafeUnwrapErr()).toEqual(
      RulingManifestErrors.notJson({ detail: "invalid JSON" }),
    );
  });

  it("refuses the private evidence file's raw array, which is not this schema", () => {
    expect(problems({ text: JSON.stringify([entry()]) }).length).toBeGreaterThan(0);
  });

  it("refuses a wrong schema version", () => {
    expect(problems({ text: JSON.stringify({ entries: [], schemaVersion: 2 }) })[0]).toContain("schemaVersion");
  });

  it("refuses an unknown key on the manifest or on an entry", () => {
    expect(problems({ text: manifest({ entries: [], extra: { note: "x" } }) })[0]).toContain("note");
    expect(problems({ text: manifest({ entries: [entry({ pagePct: 88 })] }) })[0]).toContain("pagePct");
  });

  it("refuses a missing or blank field", () => {
    const { words: _dropped, ...withoutWords } = entry();
    expect(problems({ text: manifest({ entries: [withoutWords] }) })[0]).toContain("entries.0.words");
    expect(problems({ text: manifest({ entries: [entry({ anchor: "   " })] }) })).toEqual([
      "entries.0.anchor: must not be blank",
    ]);
  });

  it("refuses a slug that could escape the runs directory", () => {
    expect(problems({ text: manifest({ entries: [entry({ slug: "../escape" })] }) })).toEqual([
      "entries.0.slug: is not a safe row slug",
    ]);
  });

  it.each([
    ["an offset", "2026-09-04T22:38:57.414+10:00"],
    ["no milliseconds", "2026-09-04T12:38:57Z"],
    ["sub-millisecond digits", "2026-09-04T12:38:57.4140Z"],
    ["an extended year", "+002026-09-04T12:38:57.414Z"],
    ["a calendar date that does not exist", "2026-02-30T12:00:00.000Z"],
    ["a space for the T", "0001-01-01 00:00:00.000Z"],
  ])("refuses a source instant with %s, which no source answer could match", (_label, sourceAtIso) => {
    expect(problems({ text: manifest({ entries: [entry({ sourceAtIso })] }) })[0]).toContain(
      "entries.0.sourceAtIso: is not a canonical toISOString() instant",
    );
  });

  it("refuses two entries naming one source, even when they agree", () => {
    expect(problems({ text: manifest({ entries: [entry(), entry()] }) })).toEqual([
      `entries.1: names the same source as entries.0 (a-row#${SOURCE})`,
    ]);
  });

  it("reports every invalid entry, not just the first", () => {
    expect(problems({ text: manifest({ entries: [entry({ words: "" }), entry({ anchor: "" })] }) })).toEqual([
      "entries.0.words: must not be blank",
      "entries.1.anchor: must not be blank",
    ]);
  });
});

describe("a key written twice loses a value silently, so the text is scanned for one", () => {
  /**
   * A review finding: `{"entries":[<one reviewed ruling>],"entries":[]}` parses as the empty list, and the
   * audit then reported a complete, clean run over a manifest that had lost its only entry.
   */
  it("refuses a repeated key on the manifest itself", () => {
    const text = `{"schemaVersion":1,"entries":[${JSON.stringify(entry())}],"entries":[]}`;
    expect(problems({ text })).toEqual(['the key "entries" appears twice in one object, so one of its values is lost']);
  });

  it("refuses a repeated key inside an entry", () => {
    const text = `{"schemaVersion":1,"entries":[{"slug":"a-row","slug":"other-row","sourceAtIso":"${SOURCE}","words":"w","anchor":"p1"}]}`;
    expect(problems({ text })).toEqual(['the key "slug" appears twice in one object, so one of its values is lost']);
    expect(parseRulingManifest({ text })._unsafeUnwrapErr()).toEqual(
      RulingManifestErrors.keysRepeated({ keys: ["slug"] }),
    );
  });

  it("is not fooled by a key name appearing inside the owner's words, or by an escaped quote", () => {
    const words = 'the owner said "entries": twice, and \\ once';
    const parsed = parseRulingManifest({ text: `{"schemaVersion":1,"entries":[${JSON.stringify(entry({ words }))}]}` });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).entries[0]!.words).toBe(words);
  });
});

describe("a repeated key spelled differently is still the same key", () => {
  /** A review finding: `"entries"` is `entries` to JSON.parse, and was a different key to the scanner. */
  it("refuses a duplicate written with a Unicode escape", () => {
    const text = `{"schemaVersion":1,"entries":[${JSON.stringify(entry())}],"\\u0065ntries":[]}`;
    expect(problems({ text })).toEqual(['the key "entries" appears twice in one object, so one of its values is lost']);
  });

  it("still accepts a manifest whose keys differ only after decoding", () => {
    const parsed = parseRulingManifest({ text: `{"schemaVersion":1,"entries":[${JSON.stringify(entry())}]}` });
    expect(parsed.isOk()).toBe(true);
  });
});
