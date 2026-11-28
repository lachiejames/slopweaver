import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bucketRecordsBySource } from "../../../corpus/bronzeAppend.js";
import { emptyBronzeDedupIndex } from "../../../corpus/bronzeDedupIndex.js";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import { freshRecordsForBucket, writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import { serialiseRecord } from "../../../corpus/recordSerialisation.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { ok, unwrap } from "../../../lib/result.js";
import { parseOwnJson } from "../../parseOwnJson.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const window: ExportWindow = { since: "2024-01-01", until: "2024-01-03" };
const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "hi",
  tsIso: "2024-01-02T00:00:00Z",
  url: "u",
  ...over,
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-writer-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("canonical serialisation", () => {
  it("gives a reordered set-valued attr the identical line, so a provider reshuffle cannot churn bronze", () => {
    const forward = serialiseRecord({ record: rec({ attrs: { labels: ["security", "backend", "api"] } }) });
    const shuffled = serialiseRecord({ record: rec({ attrs: { labels: ["api", "security", "backend"] } }) });

    expect(forward).toBe(shuffled);
  });

  it("gives reordered refs the identical line", () => {
    const forward = serialiseRecord({ record: rec({ refs: ["#9", "#2", "@ada"] }) });
    const shuffled = serialiseRecord({ record: rec({ refs: ["@ada", "#9", "#2"] }) });

    expect(forward).toBe(shuffled);
  });

  it("keeps a genuinely different label set distinguishable", () => {
    const one = serialiseRecord({ record: rec({ attrs: { labels: ["a", "b"] } }) });
    const two = serialiseRecord({ record: rec({ attrs: { labels: ["a", "c"] } }) });

    expect(one === two).toBe(false);
  });

  // Built from char codes, never typed literally: a raw line separator in a source file is the very
  // hazard this escape removes, and it would hide these lines from a diff.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);

  it("emits no raw U+2028, because readline would split the line in two", () => {
    const line = serialiseRecord({ record: rec({ text: `before${LS}after` }) });

    expect(line.includes(LS)).toBe(false);
    expect(line).toContain("\\u2028");
    expect(line.split("\n").length).toBe(1);
  });

  it("round-trips a U+2028 body back to the original string", () => {
    const text = `before${LS}after`;
    const parsed = parseOwnJson<{ text: string }>({ text: serialiseRecord({ record: rec({ text }) }) });

    expect(parsed.text).toBe(text);
  });

  it("emits no raw U+2029 either", () => {
    const line = serialiseRecord({ record: rec({ text: `a${PS}b` }) });

    expect(line.includes(PS)).toBe(false);
    expect(line).toContain("\\u2029");
  });
});

describe("writeCorpusRecords", () => {
  it("writes new records and redacts their text on disk", () => {
    const result = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ text: "ping a@b.co" })],
      window,
    });
    expect(unwrap(result).written).toBe(1);
    const back = readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES });
    expect(unwrap(back).records[0]!.text).toBe("ping [email]");
  });

  it("is idempotent — re-writing identical records dedups them", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec()], window });
    const again = writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec()], window });
    expect(unwrap(again)).toMatchObject({ deduped: 1, written: 0 });
  });

  it("writes a genuine update but drops a stale (older) re-fetch", () => {
    writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ text: "v1", tsIso: "2024-01-02T00:00:00Z" })],
      window,
    });
    const updated = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ text: "v2", tsIso: "2024-01-03T00:00:00Z" })],
      window,
    });
    expect(unwrap(updated).written).toBe(1);
    const stale = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ text: "v0", tsIso: "2024-01-01T00:00:00Z" })],
      window,
    });
    expect(unwrap(stale).written).toBe(0);
  });

  it("admits a Notion page keyed on an undashed id under the dashed id, so it dedups against its twin", () => {
    const page = ({ sourceId }: { sourceId: string }): CorpusRecord =>
      rec({ kind: "page", source: "notion", sourceId });
    const dashed = "page:0123abcd-4567-89ab-cdef-0123456789ab";
    writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [page({ sourceId: "page:0123abcd456789abcdef0123456789ab" })],
      window,
    });

    const twin = writeCorpusRecords({ home, protection: NO_ENTRIES, records: [page({ sourceId: dashed })], window });

    expect(unwrap(twin)).toMatchObject({ deduped: 1, written: 0 });
    const back = readCorpusDir({ dir: bronzeSourceDir({ home, source: "notion" }), home, protection: NO_ENTRIES });
    expect(unwrap(back).records.map((record) => record.sourceId)).toStrictEqual([dashed]);
  });

  it("serialises attrs with sorted keys (stable fingerprint regardless of insertion order)", () => {
    const line = serialiseRecord({ record: rec({ attrs: { alpha: "a", middle: 2, zebra: "z" } }) });
    expect(line).toContain('"attrs":{"alpha":"a","middle":2,"zebra":"z"}');
  });

  it("redacts string attr values before writing (a secret can hide in metadata)", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec({ attrs: { contact: "ping a@b.co" } })], window });
    const back = readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES });
    expect(unwrap(back).records[0]!.attrs).toEqual({ contact: "ping [email]" });
  });

  it("treats an attr-only change as a genuine update (attrs are in the fingerprint)", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec({ attrs: { state: "open" } })], window });
    const changed = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ attrs: { state: "closed" } })],
      window,
    });
    expect(unwrap(changed).written).toBe(1);
    const noChange = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ attrs: { state: "closed" } })],
      window,
    });
    expect(unwrap(noChange).written).toBe(0);
  });

  it("stays dedup-compatible with pre-attrs records (no forced re-fetch)", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec()], window }); // written without attrs
    const again = writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec()], window });
    expect(unwrap(again)).toMatchObject({ deduped: 1, written: 0 });
  });

  it("redacts string leaves ANYWHERE in the raw payload (nested + arrays), keeping all fields", () => {
    const raw = { author: { email: "a@b.co" }, notes: ["ping c@d.co", "clean"], number: 7 };
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec({ raw })], window });
    const back = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
    ).records[0]!;
    expect(back.raw).toEqual({ author: { email: "[email]" }, notes: ["ping [email]", "clean"], number: 7 });
  });

  it("writes an address whose local part is quoted as [email] in text and nested raw, never whole", () => {
    const raw = { thread: { notes: ['cc "jane doe"@example.com'] } };
    writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ raw, text: 'ping "jane.doe"@example.com' })],
      window,
    });
    const back = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
    ).records[0]!;
    expect(back.text).toBe("ping [email]");
    expect(back.raw).toEqual({ thread: { notes: ["cc [email]"] } });
  });

  it("scrubs an address out of author on the way to disk", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec({ author: "Pat <boss@example.test>" })], window });
    const back = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
    ).records[0]!;
    expect(back.author).toBe("Pat <[email]>");
  });

  it("RETAINS a SLACK payload's authenticated URLs in raw, in BOTH real shapes — the deliberate choice, pinned", () => {
    // Every URL here is synthesised; a real signed URL must never enter a fixture. Digits are kept under
    // nine in a row so the redactor's `\d{9,}` pass cannot rewrite them and mask what is being asserted.
    //
    // Two fixture choices are load-bearing, and BOTH were found by review passes rather than by design:
    //
    //  - `source: "slack"`. These are Slack key families, so a strip would plausibly read
    //    `if (record.source === "slack")`. Written on the `rec()` default of `github`, this test would have
    //    passed straight through exactly that change.
    //  - The two DIFFERENT raw shapes below. A `kind: "file"` record's raw IS the upstream file object, so
    //    its keys sit at the ROOT (`shapeFile` → `fileRecords`), while a message/comment record's raw nests
    //    them under `files[]`. Measured on a real corpus, both occur in bulk — about 5,100 rows at
    //    `raw.url_private` and 5,154 at `raw.files[].url_private`. A fixture carrying only the nested shape
    //    leaves a root-level strip untested, which is the hole this second record closes.
    const urls = {
      permalink_public: "https://slack-files.com/TAAAA-FBBBB-abcdef0a1b",
      thumb_360: "https://files.slack.com/files-tmb/TAAAA-FBBBB-abcd/shot_360.png",
      url_private: "https://files.slack.com/files-pri/TAAAA-FBBBB/shot.png",
      url_private_download: "https://files.slack.com/files-pri/TAAAA-FBBBB/download/shot.png",
    };
    const fileRaw = { id: "FBBBB", ...urls };
    const messageRaw = { files: [{ id: "FBBBB", ...urls }], text: "here you go" };
    // Snapshot the expectations BEFORE writing. Asserting against the same references that were handed to
    // the writer would be blind to an in-place strip: a recursive `delete` sanitiser is a plausible way to
    // write one, and it would mutate these fixtures too, leaving the stored objects equal to now-stripped
    // expectations. A review pass found exactly that hole here.
    const expectedFileRaw = structuredClone(fileRaw);
    const expectedMessageRaw = structuredClone(messageRaw);
    writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [
        rec({ container: "#general", kind: "file", raw: fileRaw, source: "slack", sourceId: "C1:1.2:file:FBBBB" }),
        rec({ container: "#general", kind: "message", raw: messageRaw, source: "slack", sourceId: "C1:1.2" }),
        rec({ container: "#general", kind: "comment", raw: messageRaw, source: "slack", sourceId: "C1:1.2:reply:1.3" }),
      ],
      window,
    });
    const back = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "slack" }), home, protection: NO_ENTRIES }),
    ).records;
    // Whole-object equality rather than key-by-key: a strip dropping ANY of the four, at EITHER depth, on ANY
    // of the three kinds that actually carry them, fails here. All three kinds are present in real bronze
    // (measured: file, message and comment all appear among the affected rows), so a strip keyed on `kind`
    // — the shape a real implementation would most likely take — cannot slip past by covering only one.
    expect(back.find((r) => r.kind === "file")!.raw).toEqual(expectedFileRaw);
    expect(back.find((r) => r.kind === "message")!.raw).toEqual(expectedMessageRaw);
    expect(back.find((r) => r.kind === "comment")!.raw).toEqual(expectedMessageRaw);
  });

  it("excludes raw from the dedup fingerprint — a raw-only change does NOT churn bronze", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec({ raw: { v: 1 } })], window });
    const rawChanged = writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec({ raw: { v: 2 } })], window });
    expect(unwrap(rawChanged)).toMatchObject({ deduped: 1, written: 0 }); // same content ⇒ no new line
  });

  it("round-trips a private record's visibility to disk and back", () => {
    writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ sourceId: "#dm", visibility: "private" })],
      window,
    });
    const back = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
    );
    expect(back.records[0]!.visibility).toBe("private");
  });

  it("stays dedup-compatible with a public record written before visibility existed (no churn)", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [rec()], window }); // legacy public line (no visibility byte)
    const again = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [rec({ visibility: "public" })],
      window,
    });
    expect(unwrap(again)).toMatchObject({ deduped: 1, written: 0 });
  });
});

describe("serialiseRecord (bronze byte-shape lock)", () => {
  it("serialises a base record with the fixed key order, byte-for-byte", () => {
    expect(serialiseRecord({ record: rec() })).toBe(
      '{"container":"o/r","kind":"pr","refs":[],"source":"github","sourceId":"#1","text":"hi","tsIso":"2024-01-02T00:00:00Z","url":"u"}',
    );
  });

  it("appends author, title, sorted attrs, then raw — in that order", () => {
    const line = serialiseRecord({
      record: rec({ attrs: { alpha: "a", zebra: "z" }, author: "alice", raw: { n: 1 }, title: "T" }),
    });
    expect(line).toBe(
      '{"container":"o/r","kind":"pr","refs":[],"source":"github","sourceId":"#1","text":"hi","tsIso":"2024-01-02T00:00:00Z","url":"u","author":"alice","title":"T","attrs":{"alpha":"a","zebra":"z"},"raw":{"n":1}}',
    );
  });

  it("omits visibility for a public record (byte-identical to pre-PR4.5 bronze)", () => {
    expect(serialiseRecord({ record: rec({ visibility: "public" }) })).toBe(
      '{"container":"o/r","kind":"pr","refs":[],"source":"github","sourceId":"#1","text":"hi","tsIso":"2024-01-02T00:00:00Z","url":"u"}',
    );
  });

  it("serialises visibility only when private, after title and before attrs", () => {
    const line = serialiseRecord({ record: rec({ attrs: { s: "x" }, title: "T", visibility: "private" }) });
    expect(line).toBe(
      '{"container":"o/r","kind":"pr","refs":[],"source":"github","sourceId":"#1","text":"hi","tsIso":"2024-01-02T00:00:00Z","url":"u","title":"T","visibility":"private","attrs":{"s":"x"}}',
    );
  });
});

describe("bucketRecordsBySource", () => {
  it("groups records under their source and omits empty sources", () => {
    const gh = rec({ source: "github", sourceId: "#1" });
    const slack = rec({ container: "slack/c", source: "slack", sourceId: "s1" });
    const buckets = bucketRecordsBySource({ records: [gh, slack] });
    expect([...buckets.keys()]).toEqual(["github", "slack"]);
    expect(buckets.get("github")).toEqual([gh]);
    expect(buckets.get("slack")).toEqual([slack]);
  });

  it("returns an empty map for no records", () => {
    expect(bucketRecordsBySource({ records: [] }).size).toBe(0);
  });
});

describe("freshRecordsForBucket", () => {
  it("accepts every record against an empty index", () => {
    const bucket = [rec({ sourceId: "#1" }), rec({ sourceId: "#2" })];
    expect(freshRecordsForBucket({ bucket, index: emptyBronzeDedupIndex() })).toEqual(bucket);
  });

  it("drops an exact duplicate within the same bucket (index is mutated as it accepts)", () => {
    const dup = rec({ sourceId: "#1" });
    const fresh = freshRecordsForBucket({ bucket: [dup, dup], index: emptyBronzeDedupIndex() });
    expect(fresh).toEqual([dup]);
  });

  it("drops a record already present in the index by fingerprint", () => {
    const index = emptyBronzeDedupIndex();
    freshRecordsForBucket({ bucket: [rec({ sourceId: "#1" })], index });
    expect(freshRecordsForBucket({ bucket: [rec({ sourceId: "#1" })], index })).toEqual([]);
  });

  it("drops a stale (older tsIso) re-fetch of a known id", () => {
    const index = emptyBronzeDedupIndex();
    freshRecordsForBucket({ bucket: [rec({ sourceId: "#1", text: "v2", tsIso: "2024-01-03T00:00:00Z" })], index });
    expect(
      freshRecordsForBucket({ bucket: [rec({ sourceId: "#1", text: "v0", tsIso: "2024-01-01T00:00:00Z" })], index }),
    ).toEqual([]);
  });
});
