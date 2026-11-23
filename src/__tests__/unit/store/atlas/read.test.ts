/**
 * The bounded reader — that a kind file read in slices loses nothing and repeats nothing.
 *
 * This is the property the whole import rests on: a kind file's size is a property of the TENANT, and
 * one Cloudflare `pages-project` document measured over a hundred MiB, and the reader is what keeps the heap bounded by
 * a chunk rather than by the file. A resume cursor that stepped over a line would lose rows silently —
 * `../../../../store/ingestRead.ts`'s own header records that exact trap on the bronze side — so the test
 * that matters is the one that reassembles a whole file out of its slices and compares.
 *
 * Filesystem only for a genuine round trip, into a `mkdtempSync` directory removed in `afterEach`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readEntitySlice, readKindEnvelope } from "../../../../store/atlas/read.js";

let dir = "";

afterEach(() => {
  if (dir !== "") {
    rmSync(dir, { force: true, recursive: true });
    dir = "";
  }
});

/** One pre-`channels` entity line, numbered so a reassembled read is comparable to the input. */
function entityLine({ index }: { index: number }): string {
  return JSON.stringify({
    firstSeenAt: "2026-09-06T10:07:33.492Z",
    id: `id-${String(index)}`,
    providerId: `provider-${String(index)}`,
    source: { endpoint: "/v1/things", observedAt: "2026-09-19T00:06:27.556Z", surface: "falcon-api" },
    state: "observed",
  });
}

/** Write a kind file with `count` entity lines after its envelope, and answer its path. */
function writeKindFile({ count }: { count: number }): string {
  dir = mkdtempSync(join(tmpdir(), "atlas-read-"));
  const path = join(dir, "things.jsonl");
  const envelope = JSON.stringify({
    coverage: [],
    entities: [],
    gaps: [],
    kind: "thing",
    platform: "crowdstrike",
    schemaVersion: 1,
    updatedAt: "2026-09-19T00:06:27.556Z",
  });
  const lines = [envelope, ...Array.from({ length: count }, (_unused, index) => entityLine({ index }))];
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

/** Read a whole file through repeated bounded slices, exactly as `replaceKindSlice` does. */
function readAllSlices({ path, limit, from }: { path: string; limit: number; from: number }) {
  const ids: string[] = [];
  let slices = 0;
  let at = from;
  for (;;) {
    const slice = readEntitySlice({
      from: at,
      generationAt: new Date("2026-09-19T00:06:27.556Z"),
      kind: "thing",
      limit,
      linesBefore: 0,
      path,
      platform: "crowdstrike",
    });
    slices += 1;
    ids.push(...slice.entities.map((row) => row.entityId));
    if (slice.resumeByteOffset <= at || slice.linesRead === 0) {
      break;
    }
    at = slice.resumeByteOffset;
  }
  return { ids, slices };
}

describe("readKindEnvelope", () => {
  it("reads line 1 and says where the entities begin", () => {
    const path = writeKindFile({ count: 3 });
    const read = readKindEnvelope({ path, platform: "crowdstrike" });
    expect("envelope" in read).toBe(true);
    const found = read as { envelope: { envelope: { kind: string }; entitiesFrom: number } };
    expect(found.envelope.envelope.kind).toBe("thing");
    expect(found.envelope.entitiesFrom).toBeGreaterThan(0);
  });

  it("refuses a file with no lines at all rather than reading it as empty", () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-read-"));
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "");
    const read = readKindEnvelope({ path, platform: "crowdstrike" });
    expect("error" in read).toBe(true);
  });

  it("refuses a file that is not there rather than throwing", () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-read-"));
    const read = readKindEnvelope({ path: join(dir, "absent.jsonl"), platform: "crowdstrike" });
    expect("error" in read).toBe(true);
  });
});

describe("readEntitySlice", () => {
  it("never re-reads the envelope, so line 1 becomes no entity", () => {
    const path = writeKindFile({ count: 4 });
    const found = readKindEnvelope({ path, platform: "crowdstrike" }) as {
      envelope: { entitiesFrom: number };
    };
    const read = readAllSlices({ from: found.envelope.entitiesFrom, limit: 100, path });
    expect(read.ids.length).toBe(4);
  });

  it("reassembles the whole file out of many slices, in order, losing and repeating nothing", () => {
    const path = writeKindFile({ count: 250 });
    const found = readKindEnvelope({ path, platform: "crowdstrike" }) as {
      envelope: { entitiesFrom: number };
    };
    const whole = readAllSlices({ from: found.envelope.entitiesFrom, limit: 1000, path });
    const sliced = readAllSlices({ from: found.envelope.entitiesFrom, limit: 7, path });
    expect(sliced.ids).toEqual(whole.ids);
    expect(sliced.ids.length).toBe(250);
    expect(new Set(sliced.ids).size).toBe(250);
  });

  it("counts a line that will not project and keeps reading the rest", () => {
    const path = writeKindFile({ count: 2 });
    writeFileSync(
      path,
      `${[
        JSON.stringify({
          coverage: [],
          entities: [],
          gaps: [],
          kind: "thing",
          platform: "crowdstrike",
          updatedAt: "2026-09-19T00:06:27.556Z",
        }),
        entityLine({ index: 0 }),
        JSON.stringify({ id: "no-provider-id", source: { surface: "falcon-api" }, state: "observed" }),
        entityLine({ index: 1 }),
      ].join("\n")}\n`,
    );
    const found = readKindEnvelope({ path, platform: "crowdstrike" }) as {
      envelope: { entitiesFrom: number };
    };
    const slice = readEntitySlice({
      from: found.envelope.entitiesFrom,
      generationAt: new Date("2026-09-19T00:06:27.556Z"),
      kind: "thing",
      limit: 100,
      linesBefore: 0,
      path,
      platform: "crowdstrike",
    });
    expect(slice.entities.length).toBe(2);
    expect(slice.refusalCount).toBe(1);
    expect(slice.refusals[0]!.code).toBe("MISSING_FIELD");
  });

  it("answers an empty slice for a file that holds only an envelope", () => {
    const path = writeKindFile({ count: 0 });
    const found = readKindEnvelope({ path, platform: "crowdstrike" }) as {
      envelope: { entitiesFrom: number };
    };
    const read = readAllSlices({ from: found.envelope.entitiesFrom, limit: 100, path });
    expect(read.ids).toEqual([]);
  });

  it("strips a U+0000 only where the raw line carries one", () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-read-"));
    const path = join(dir, "things.jsonl");
    const dirty = JSON.stringify({
      detail: { note: "poli\u0000cy" },
      firstSeenAt: "2026-09-06T10:07:33.492Z",
      id: "id-nul",
      providerId: "provider-nul",
      source: { endpoint: "/v1", observedAt: "2026-09-19T00:06:27.556Z", surface: "falcon-api" },
      state: "observed",
    });
    writeFileSync(
      path,
      `${[
        JSON.stringify({
          coverage: [],
          entities: [],
          gaps: [],
          kind: "thing",
          updatedAt: "2026-09-19T00:06:27.556Z",
        }),
        dirty,
        entityLine({ index: 9 }),
      ].join("\n")}\n`,
    );
    const found = readKindEnvelope({ path, platform: "crowdstrike" }) as {
      envelope: { entitiesFrom: number };
    };
    const slice = readEntitySlice({
      from: found.envelope.entitiesFrom,
      generationAt: new Date("2026-09-19T00:06:27.556Z"),
      kind: "thing",
      limit: 100,
      linesBefore: 0,
      path,
      platform: "crowdstrike",
    });
    expect(slice.nulsStripped).toBe(1);
    expect(slice.entities.length).toBe(2);
    expect(slice.channels[0]!.detail).toEqual({ note: "policy" });
  });
});

describe("refusal line numbers survive a resumed slice", () => {
  it("names the ABSOLUTE line of a bad row, not the line within its slice", () => {
    dir = mkdtempSync(join(tmpdir(), "atlas-read-"));
    const path = join(dir, "things.jsonl");
    const envelope = JSON.stringify({
      coverage: [],
      entities: [],
      gaps: [],
      kind: "thing",
      updatedAt: "2026-09-19T00:06:27.556Z",
    });
    const bad = JSON.stringify({ id: "no-provider-id", source: { surface: "falcon-api" }, state: "observed" });
    const lines = [envelope, ...Array.from({ length: 5 }, (_unused, index) => entityLine({ index })), bad];
    writeFileSync(path, `${lines.join("\n")}\n`);
    const found = readKindEnvelope({ path, platform: "crowdstrike" }) as { envelope: { entitiesFrom: number } };

    // Resume as `replaceKindSlice` does: a slice of 3, then the rest, carrying the running line count.
    const first = readEntitySlice({
      from: found.envelope.entitiesFrom,
      generationAt: new Date("2026-09-19T00:06:27.556Z"),
      kind: "thing",
      limit: 3,
      linesBefore: 0,
      path,
      platform: "crowdstrike",
    });
    const second = readEntitySlice({
      from: first.resumeByteOffset,
      generationAt: new Date("2026-09-19T00:06:27.556Z"),
      kind: "thing",
      limit: 100,
      linesBefore: first.linesRead,
      path,
      platform: "crowdstrike",
    });
    expect(first.refusalCount).toBe(0);
    expect(second.refusalCount).toBe(1);
    // The bad row is the 7th physical line: one envelope plus five good entities before it.
    expect(second.refusals[0]!.message).toContain("line 7");
  });
});
