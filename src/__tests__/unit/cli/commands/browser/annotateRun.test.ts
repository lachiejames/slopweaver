/**
 * `browser annotate` end to end over a throwaway home: it draws onto a real PNG, writes the picture and its pre-filled
 * record form and NO record, and the two-step readback it prints — `image-record` on that form — yields exactly the
 * record a first message in a channel admits (`vouchedAnnotations`).
 */

import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runBrowserAnnotate } from "../../../../../cli/commands/browser/annotateRun.js";
import { runImageRecord } from "../../../../../cli/commands/browser/imageRecordRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { vouchedAnnotations } from "../../../../../outbound/slack/firstMessageProof.js";
import { imageDigestOf } from "../../../../../visualEvidence/imageIo.js";
import { appendImageRecord, readImageRecords } from "../../../../../visualEvidence/store.js";
import { failedRecord } from "../../../../annotatedShotFixture.js";

let root: string;
let home: string;
let source: string;
let out: string;

const BOX = { height: 40, width: 80, x: 60, y: 60 };

beforeEach(async () => {
  // Real, because the verb binds every path to the real directories it passes through and darwin's temp is a link.
  root = realpathSync(mkdtempSync(join(tmpdir(), "annotate-run-")));
  home = join(root, "home");
  mkdirSync(home);
  source = join(root, "capture.png");
  out = join(root, "annotated.png");
  const image = new Jimp({ color: 0xffffffff, height: 200, width: 200 });
  writeFileSync(source, await image.getBuffer("image/png"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Write an annotate form naming `source` and `out`, with `over` replacing its fields. */
function writeForm({ over = {} }: { over?: Record<string, unknown> } = {}): string {
  const path = join(root, "annotate.json");
  writeFileSync(
    path,
    JSON.stringify({
      annotations: [{ note: "two checks overdue", rect: BOX }],
      contextRetained: true,
      crop: { kind: "already-framed", reason: "the table fills the viewport" },
      observedContent: "HRS-56: two background checks overdue",
      observerSession: "session-1",
      obstruction: "none",
      out,
      source,
      targetState: "data",
      ...over,
    }),
  );
  return path;
}

describe("runBrowserAnnotate", () => {
  it("writes the picture and a record form for its exact bytes, and records nothing", async () => {
    const code = await runBrowserAnnotate({ form: writeForm(), home, json: false });

    expect(code).toBe(0);
    const digest = imageDigestOf({ bytes: readFileSync(out) });
    const recordForm = JSON.parse(readFileSync(`${out}.image-record.json`, "utf8")) as Record<string, unknown>;
    expect(recordForm["expectDigest"]).toBe(digest);
    expect(recordForm["path"]).toBe(out);
    expect(recordForm["annotations"]).toEqual([{ note: "two checks overdue", rect: BOX }]);
    expect(unwrap(readImageRecords({ digest, home }))).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("hands image-record a form whose record a first message in a channel admits", async () => {
    await runBrowserAnnotate({ form: writeForm(), home, json: false });

    const recorded = await runImageRecord({ form: `${out}.image-record.json`, home, json: false });

    expect(recorded).toBe(0);
    const records = unwrap(readImageRecords({ digest: imageDigestOf({ bytes: readFileSync(out) }), home }));
    expect(records.map((record) => record.outcome)).toEqual(["passed"]);
    expect(vouchedAnnotations({ records })).toEqual([{ note: "two checks overdue", rect: BOX }]);
  });

  it("refuses a source already recorded unfit, writing nothing — it is retaken, never annotated around", async () => {
    const digest = imageDigestOf({ bytes: readFileSync(source) });
    unwrap(
      appendImageRecord({
        home,
        record: failedRecord({ correction: "dismiss the banner and retake", digest, reason: "obscured" }),
      }),
    );

    const code = await runBrowserAnnotate({ form: writeForm(), home, json: false });

    expect(code).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.image-record.json`)).toBe(false);
  });

  it("refuses an out naming the source, and the source is byte-identical afterwards", async () => {
    const before = readFileSync(source);

    const code = await runBrowserAnnotate({ form: writeForm({ over: { out: source } }), home, json: false });

    expect(code).toBe(2);
    expect(readFileSync(source).equals(before)).toBe(true);
  });

  it("refuses an out that is the source under another name, through a symlink or a hard link", async () => {
    const before = readFileSync(source);
    const viaSymlink = join(root, "alias.png");
    symlinkSync(source, viaSymlink);
    const viaHardLink = join(root, "hard.png");
    linkSync(source, viaHardLink);

    const symlinked = await runBrowserAnnotate({
      form: writeForm({ over: { out: source, source: viaSymlink } }),
      home,
      json: false,
    });
    const hardLinked = await runBrowserAnnotate({ form: writeForm({ over: { out: viaHardLink } }), home, json: false });

    expect([symlinked, hardLinked]).toEqual([2, 2]);
    expect(readFileSync(source).equals(before)).toBe(true);
  });

  it("refuses an out whose directory is a link to the source's own directory", async () => {
    const before = readFileSync(source);
    const linkedDirectory = join(root, "linked");
    symlinkSync(root, linkedDirectory);

    const code = await runBrowserAnnotate({
      form: writeForm({ over: { out: join(linkedDirectory, "capture.png") } }),
      home,
      json: false,
    });

    expect(code).toBe(2);
    expect(readFileSync(source).equals(before)).toBe(true);
  });

  it("names the real directory an out reaches through a link, never the link", async () => {
    const real = join(root, "real");
    mkdirSync(real);
    const linkedDirectory = join(root, "linked");
    symlinkSync(real, linkedDirectory);

    const code = await runBrowserAnnotate({
      form: writeForm({ over: { out: join(linkedDirectory, "annotated.png") } }),
      home,
      json: false,
    });

    expect(code).toBe(0);
    const recordForm = JSON.parse(readFileSync(join(real, "annotated.png.image-record.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(recordForm["path"]).toBe(join(real, "annotated.png"));
    expect(recordForm["expectDigest"]).toBe(imageDigestOf({ bytes: readFileSync(join(real, "annotated.png")) }));
  });

  it("binds an out whose directories do not exist yet below the deepest real one", async () => {
    const nested = join(root, "a", "b", "annotated.png");

    const code = await runBrowserAnnotate({ form: writeForm({ over: { out: nested } }), home, json: false });

    expect(code).toBe(0);
    const recordForm = JSON.parse(readFileSync(`${nested}.image-record.json`, "utf8")) as Record<string, unknown>;
    expect(recordForm["path"]).toBe(nested);
  });

  it("leaves no older record form behind when the new one cannot be written", async () => {
    // 200 bytes of name: the PNG's temporary file fits the 255-byte component limit, the form's does not.
    const longOut = join(root, `${"a".repeat(196)}.png`);
    const staleForm = `${longOut}.image-record.json`;
    writeFileSync(staleForm, JSON.stringify({ expectDigest: "sha256:old", path: longOut }));

    const code = await runBrowserAnnotate({ form: writeForm({ over: { out: longOut } }), home, json: false });

    expect(code).toBe(1);
    expect(existsSync(longOut)).toBe(true);
    expect(existsSync(staleForm)).toBe(false);
  });

  it("answers 2 for a box off the picture and writes nothing", async () => {
    const off = [{ note: "off", rect: { height: 10, width: 10, x: 195, y: 0 } }];

    const code = await runBrowserAnnotate({ form: writeForm({ over: { annotations: off } }), home, json: false });

    expect(code).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it("answers 1 for a form file that is not there, and 2 for one that is not JSON", async () => {
    const notJson = join(root, "bad.json");
    writeFileSync(notJson, "{ nope");

    expect(await runBrowserAnnotate({ form: join(root, "absent.json"), home, json: false })).toBe(1);
    expect(await runBrowserAnnotate({ form: notJson, home, json: false })).toBe(2);
  });

  it("answers 1 for a source that is not there", async () => {
    const code = await runBrowserAnnotate({
      form: writeForm({ over: { source: join(root, "gone.png") } }),
      home,
      json: false,
    });

    expect(code).toBe(1);
    expect(existsSync(out)).toBe(false);
  });
});
