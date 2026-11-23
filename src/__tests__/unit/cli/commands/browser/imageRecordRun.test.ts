import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runImageRecord } from "../../../../../cli/commands/browser/imageRecordRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { writeCaptureRecord } from "../../../../../visualEvidence/captureRecord.js";
import { readImageRecords } from "../../../../../visualEvidence/store.js";
import { recordedCassette } from "../../../../attachEvidenceFixture.js";

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "image-record-run-"));
  home = join(root, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Every path under `dir`, with each file's bytes, in path order. */
function snapshot({ dir }: { dir: string }): readonly { readonly path: string; readonly bytes: string | null }[] {
  const entries: { path: string; bytes: string | null }[] = [];
  const walk = ({ at }: { at: string }): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        entries.push({ bytes: null, path });
        walk({ at: path });
        continue;
      }
      entries.push({ bytes: readFileSync(path).toString("base64"), path });
    }
  };
  walk({ at: dir });
  return entries.toSorted((left, right) => left.path.localeCompare(right.path));
}

/** A form that passes the schema and its coherence rules, naming `path` as its image. */
function validForm({ path }: { path: string }): string {
  return JSON.stringify({
    contextRetained: true,
    crop: { kind: "already-framed", reason: "the panel fills the viewport" },
    observedContent: "the latency panel shows three spikes",
    observerSession: "session-1",
    path,
    targetState: "data",
    verdict: "passed",
  });
}

describe("runImageRecord", () => {
  it("answers 1, not the usage code, for a form file that does not exist", async () => {
    expect(await runImageRecord({ form: join(root, "absent.json"), home, json: false })).toBe(1);
  });

  it("answers 2 for a form that is not JSON, and the fixture directory is byte-identical afterwards", async () => {
    const form = join(root, "form.json");
    writeFileSync(form, "{ not json");
    const before = snapshot({ dir: root });

    const code = await runImageRecord({ form, home, json: false });

    expect(code).toBe(2);
    expect(snapshot({ dir: root })).toEqual(before);
  });

  it("answers 2 for JSON that the form schema refuses", async () => {
    const form = join(root, "form.json");
    writeFileSync(form, JSON.stringify({ verdict: "passed" }));

    expect(await runImageRecord({ form, home, json: false })).toBe(2);
  });

  it("answers 1 for a valid form naming an image that is not there, and the fixture directory is byte-identical afterwards", async () => {
    const form = join(root, "form.json");
    writeFileSync(form, validForm({ path: join(root, "missing.png") }));
    const before = snapshot({ dir: root });

    const code = await runImageRecord({ form, home, json: false });

    expect(code).toBe(1);
    expect(snapshot({ dir: root })).toEqual(before);
  });

  it("records a recording proof cassette wrote, identified by its receipt since no image decoder reads it", async () => {
    const cassette = recordedCassette();
    unwrap(writeCaptureRecord({ home, record: cassette.receipt }));
    const video = join(root, "demo.mp4");
    writeFileSync(video, cassette.bytes);
    const form = join(root, "form.json");
    writeFileSync(form, validForm({ path: video }));
    expect(await runImageRecord({ form, home, json: false })).toBe(0);
    const records = unwrap(readImageRecords({ digest: cassette.receipt.final.artifact.digest, home }));
    expect(records.map((record) => record.artifact)).toStrictEqual([cassette.receipt.final.artifact]);
  });

  it("answers 1 for a video no capture receipt names, recording nothing", async () => {
    const cassette = recordedCassette();
    const video = join(root, "demo.mp4");
    writeFileSync(video, cassette.bytes);
    const form = join(root, "form.json");
    writeFileSync(form, validForm({ path: video }));
    expect(await runImageRecord({ form, home, json: false })).toBe(1);
    expect(unwrap(readImageRecords({ digest: cassette.receipt.final.artifact.digest, home }))).toStrictEqual([]);
  });
});
