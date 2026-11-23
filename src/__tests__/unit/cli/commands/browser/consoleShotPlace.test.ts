/**
 * Where `browser console-shot` puts its picture and its receipt, over a real temp directory: the receipt is filed
 * before the picture moves, a failed move withdraws the receipt it filed, and an `--out` that is not a file is refused.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { placeConsoleShot, refuseNonFileOut } from "../../../../../cli/commands/browser/consoleShotPlace.js";
import { captureRecordPath, writeCaptureRecord } from "../../../../../visualEvidence/captureRecord.js";
import { type ConsoleObservation, consoleShotReceipt } from "../../../../../visualEvidence/consoleShot.js";
import { ConsoleShotErrors } from "../../../../../visualEvidence/consoleShotErrors.js";
import { consoleWalkNamed } from "../../../../../visualEvidence/consoleWalks.js";

/** The registered walk the receipt names. */
const WALK = consoleWalkNamed({ name: "automations-context" })!;

/** One text walk, inside the region. */
const TEXT = {
  nodes: [{ rect: { height: 20, width: 120, x: 300, y: 40 }, text: "Automations" }],
  opaque: [],
  truncated: false,
};

/** What the spec leaves for a 1920x1080 viewport with `main` at x 280. */
const OBSERVATION: ConsoleObservation = {
  after: TEXT,
  before: TEXT,
  finalPath: "/automations?context=slopweaver",
  initialPath: WALK.initialPath,
  regionCss: { height: 1080, width: 1640, x: 280, y: 0 },
  schemaVersion: 1,
  viewport: { deviceScaleFactor: 1, heightPx: 1080, widthPx: 1920 },
  walk: WALK.name,
  witnessesSeen: [...WALK.witnesses],
};

/** The picture's bytes; placement never decodes them. */
const BYTES = new Uint8Array([137, 80, 78, 71]);

let root = "";
let home = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "console-shot-place-"));
  home = join(root, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/**
 * A receipt naming {@link BYTES} at `out`.
 *
 * @param out where the receipt says the picture is
 * @returns the receipt
 */
function receiptAt({ out }: { out: string }): ReturnType<typeof consoleShotReceipt> {
  return consoleShotReceipt({
    capturedAtIso: "2026-11-21T14:00:00.000Z",
    captureId: "cap-0123456789abcdef",
    final: { digest: `sha256:${"a".repeat(64)}`, heightPx: 1080, path: out, widthPx: 1640 },
    observation: OBSERVATION,
    walk: WALK,
  });
}

describe("placeConsoleShot", () => {
  it("files the receipt and moves the picture onto --out", () => {
    const out = join(root, "proof", "shot.png");
    const placed = placeConsoleShot({ bytes: BYTES, home, out, receipt: unwrap(receiptAt({ out })) });
    expect(unwrap(placed)).toBe(captureRecordPath({ captureId: "cap-0123456789abcdef", home }));
    expect([...readFileSync(out)]).toEqual([137, 80, 78, 71]);
  });

  it("withdraws the receipt it filed when the move onto --out fails, and leaves --out as it was", () => {
    const out = join(root, "taken.png");
    mkdirSync(out);
    const placed = placeConsoleShot({ bytes: BYTES, home, out, receipt: unwrap(receiptAt({ out })) });
    expect(unwrapErr(placed).code).toBe("CONSOLE_IMAGE_FAILED");
    expect(unwrapErr(placed).message).toContain("--out was left as it was");
    expect(existsSync(captureRecordPath({ captureId: "cap-0123456789abcdef", home }))).toBe(false);
    expect(existsSync(`${out}.cap-0123456789abcdef.partial`)).toBe(false);
  });

  it("keeps a receipt an earlier capture of the same bytes filed, when the move fails", () => {
    const out = join(root, "taken.png");
    mkdirSync(out);
    const receipt = unwrap(receiptAt({ out }));
    unwrap(writeCaptureRecord({ home, record: receipt }));
    const placed = placeConsoleShot({ bytes: BYTES, home, out, receipt });
    expect(unwrapErr(placed).code).toBe("CONSOLE_IMAGE_FAILED");
    expect(existsSync(captureRecordPath({ captureId: "cap-0123456789abcdef", home }))).toBe(true);
  });
});

describe("refuseNonFileOut", () => {
  it("refuses an --out that exists as a directory", () => {
    const out = join(root, "taken.png");
    mkdirSync(out);
    const refused = unwrapErr(refuseNonFileOut({ out }));
    expect(refused).toEqual(ConsoleShotErrors.outNotAFile({ out }));
    expect(refused.code).toBe("CONSOLE_OUT_NOT_A_FILE");
  });

  it("accepts an --out that is an existing file, or absent", () => {
    const existing = join(root, "old.png");
    writeFileSync(existing, "old");
    expect(unwrap(refuseNonFileOut({ out: existing }))).toBe(null);
    expect(unwrap(refuseNonFileOut({ out: join(root, "new.png") }))).toBe(null);
  });
});
