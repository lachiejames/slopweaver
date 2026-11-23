/**
 * The bounded reader over a real bronze file in a temp directory: its two ceilings, its resume cursor, and
 * the cap on retained refusals while the count stays exact.
 *
 * Admission is a real one with both lists empty, so every parsed record is taken and only the projection
 * or the parse can refuse a line.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyIdentityExclusion } from "../../../corpus/identityExclusion.js";
import { emptySyncExclusion } from "../../../corpus/syncExclusion.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { openAdmission, type StoreAdmission } from "../../../store/admission.js";
import { StoreErrors } from "../../../store/errors.js";
import { MAX_RETAINED_REFUSALS, type ReadSlice, readSlice } from "../../../store/ingestRead.js";

/** One bronze line for a Slack message the projection stores, or refuses when its container names no channel. */
const line = ({ sourceId, container = "slack/c-random" }: { sourceId: string; container?: string }): string => {
  const value: CorpusRecord = {
    container,
    kind: "message",
    refs: [],
    source: "slack",
    sourceId,
    text: "hello",
    tsIso: "2026-09-05T11:59:13.000Z",
    url: "https://example.slack.com/archives/c-random/p1000000000000001",
  };
  return JSON.stringify(value);
};

/** A container that parses but names no channel, so no Slack row can be filled from it. */
const NO_CHANNEL = "slack/";

const NO_SLACK_ROW = 'its payload and container "slack/" fill no slack row';

/** A fresh admission that admits every record. */
const admission = (): StoreAdmission =>
  openAdmission({ exclusion: emptySyncExclusion(), identities: emptyIdentityExclusion() });

/** The projected source ids of a slice, in order. */
const projectedIds = ({ slice }: { slice: ReadSlice }): readonly string[] =>
  slice.projected.map((row) => row.content.sourceId);

describe("readSlice", () => {
  let dir = "";
  let path = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ingest-read-"));
    path = join(dir, "compact.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("resumes at the exact offset after a one-record slice, losing and repeating nothing", () => {
    const first = line({ sourceId: "c-random:1.000001" });
    const second = line({ sourceId: "c-random:1.000002" });
    writeFileSync(path, `\n${first}\n${second}\n`);
    const state = admission();

    const one = readSlice({ admission: state, limit: 1, path });
    const two = readSlice({ admission: state, from: one.resumeByteOffset, limit: 1, path });

    expect(projectedIds({ slice: one })).toEqual(["c-random:1.000001"]);
    expect(one.linesRead).toBe(1);
    expect(one.resumeByteOffset).toBe(1 + first.length + 1);
    expect(projectedIds({ slice: two })).toEqual(["c-random:1.000002"]);
    expect(two.linesRead).toBe(1);
    expect(two.resumeByteOffset).toBe(statSync(path).size);
  });

  it("counts a refused line against the examined-line ceiling and moves the cursor past it", () => {
    const refused = line({ container: NO_CHANNEL, sourceId: "c-random:1.000003" });
    const kept = line({ sourceId: "c-random:1.000004" });
    writeFileSync(path, `${refused}\n${kept}\n`);
    const state = admission();

    const one = readSlice({ admission: state, limit: 1, path });
    const two = readSlice({ admission: state, from: one.resumeByteOffset, limit: 1, path });

    expect(one).toEqual({
      // The whole file is one chunk, so the reader consumed all of it — which is why the cursor is not this.
      bytesRead: statSync(path).size,
      linesRead: 1,
      projected: [],
      refusalCount: 1,
      refusals: [StoreErrors.rowRefused({ reason: NO_SLACK_ROW, source: "slack", sourceId: "c-random:1.000003" })],
      resumeByteOffset: refused.length + 1,
    });
    expect(projectedIds({ slice: two })).toEqual(["c-random:1.000004"]);
  });

  it("counts all 203 refusals exactly while retaining only the first 200 as examples", () => {
    const lines = Array.from({ length: 203 }, (_, at) =>
      line({ container: NO_CHANNEL, sourceId: `bad-${String(at)}` }),
    );
    writeFileSync(path, `${lines.join("\n")}\n`);

    const slice = readSlice({ admission: admission(), limit: 1000, path });

    expect(slice.refusalCount).toBe(203);
    expect(slice.refusals.map((refusal) => refusal.sourceId)).toEqual(
      Array.from({ length: 200 }, (_, at) => `bad-${String(at)}`),
    );
    expect(slice.linesRead).toBe(203);
    expect(slice.projected).toEqual([]);
  });

  it("never reports a resume offset past the end of a file ending in a newline", () => {
    writeFileSync(path, `${line({ sourceId: "c-random:1.000005" })}\n`);

    const slice = readSlice({ admission: admission(), limit: 10, path });

    expect(slice.resumeByteOffset).toBe(statSync(path).size);
    expect(projectedIds({ slice })).toEqual(["c-random:1.000005"]);
  });

  it("refuses a line that is not JSON as an unparsed record named by its line number", () => {
    writeFileSync(path, `${line({ sourceId: "c-random:1.000006" })}\n{not json\n`);

    const slice = readSlice({ admission: admission(), limit: 10, path });

    expect(slice.refusalCount).toBe(1);
    expect(slice.refusals.map((refusal) => [refusal.code, refusal.source, refusal.sourceId])).toEqual([
      ["ROW_REFUSED", "unparsed", "line 2"],
    ]);
    expect(projectedIds({ slice })).toEqual(["c-random:1.000006"]);
  });

  it("keeps 200 refusal examples per run", () => {
    expect(MAX_RETAINED_REFUSALS).toBe(200);
  });
});
