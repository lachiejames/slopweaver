import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runBrowserTerminalShot } from "../../../../../cli/commands/browser/terminalShotRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { captureIdFor, readCaptureRecord } from "../../../../../visualEvidence/captureRecord.js";
import { imageDigestOf } from "../../../../../visualEvidence/imageIo.js";

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "terminal-shot-run-"));
  home = join(root, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Write a form to disk, returning its path. */
function formFor({ form }: { form: Record<string, unknown> }): string {
  const path = join(root, "form.json");
  writeFileSync(path, JSON.stringify(form));
  return path;
}

const CAPTURED_AT = "2026-11-17T04:00:00.000Z";

describe("runBrowserTerminalShot", () => {
  it("writes the PNG and files a receipt naming its bytes, with the kept lines as frame text", async () => {
    const textFile = join(root, "pane.txt");
    writeFileSync(textFile, "$ yarn test\nTests  12 passed\n$ ");
    const out = join(root, "shots", "pane.png");
    const form = formFor({ form: { label: "acme pane", lines: { from: 1, to: 2 }, out, textFile } });
    expect(await runBrowserTerminalShot({ capturedAtIso: CAPTURED_AT, form, home, json: false })).toBe(0);
    const digest = imageDigestOf({ bytes: readFileSync(out) });
    expect(unwrap(readCaptureRecord({ captureId: captureIdFor({ digest }), home }))).toMatchObject({
      capturedAtIso: CAPTURED_AT,
      detail: { label: "acme pane", lines: { from: 1, to: 2 }, sourceLines: 3 },
      final: { artifact: { digest }, path: out },
      verb: "browser terminal-shot",
    });
  });

  it("answers 2 for a form that fails its schema, writing nothing", async () => {
    const out = join(root, "pane.png");
    const form = formFor({ form: { label: "acme pane", out, textFile: "relative.txt" } });
    expect(await runBrowserTerminalShot({ capturedAtIso: CAPTURED_AT, form, home, json: false })).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it("answers 1 when the text file is missing, writing nothing", async () => {
    const out = join(root, "pane.png");
    const form = formFor({ form: { label: "acme pane", out, textFile: join(root, "absent.txt") } });
    expect(await runBrowserTerminalShot({ capturedAtIso: CAPTURED_AT, form, home, json: false })).toBe(1);
    expect(existsSync(out)).toBe(false);
  });
});
