import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type ProofCassetteDeps, runProofCassette } from "../../../../cli/commands/proof/cassette.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";
import {
  type CaptureReceipt,
  captureIdFor,
  isCaptureReceipt,
  readCaptureRecord,
} from "../../../../visualEvidence/captureRecord.js";
import { frameTextLines } from "../../../../visualEvidence/frameText.js";
import { imageDigestOf } from "../../../../visualEvidence/imageIo.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Every line one run printed, and every render it asked for — read back rather than spied on. */
interface Captured {
  readonly out: string[];
  readonly errors: string[];
  readonly renders: { source: string; cwd: string; out: string }[];
}

/** A scratch directory outside any checkout, removed after the test. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-cassette-test-"));
  dirs.push(dir);
  return dir;
}

/** The bytes the fake render "wrote", standing in for a stripped video. */
const VIDEO = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);

/** What the fake recorder wrote as its transcript: two frames of one screen, split by VHS-style box drawing. */
const TRANSCRIPT = "> claude -p hi\n\n────────\n> claude -p hi\nhello\n";

/** Plain-function edges: a fixed tape, a recording render, and a chosen answer to "was it written". */
function makeDeps({
  tape = ok('Type "claude -p hi"\nEnter'),
  render = ok(undefined),
  written = true,
  transcript = TRANSCRIPT,
  finalise = ok({ heightPx: 600, widthPx: 1200 }),
}: {
  tape?: Result<string>;
  render?: Result<void>;
  written?: boolean;
  transcript?: string | null;
  finalise?: Result<{ widthPx: number; heightPx: number }>;
} = {}): {
  readonly deps: ProofCassetteDeps;
  readonly captured: Captured;
  readonly dir: string;
  readonly home: string;
} {
  const dir = scratch();
  const home = scratch();
  const captured: Captured = { errors: [], out: [], renders: [] };
  return {
    captured,
    deps: {
      cwd: dir,
      env: {},
      exists: () => written,
      finalise: () => finalise,
      home,
      nowIso: () => "2026-11-17T03:00:00.000Z",
      readBytes: () => ok(VIDEO),
      readTranscript: () => transcript,
      log: {
        error: ({ msg }) => {
          captured.errors.push(msg);
        },
        out: ({ line }) => {
          captured.out.push(line);
        },
      },
      readTape: () => tape,
      render: (args) => {
        captured.renders.push(args);
        return render;
      },
    },
    dir,
    home,
  };
}

/** The capture id the fixture video's digest names. */
const CAPTURE_ID = captureIdFor({ digest: imageDigestOf({ bytes: VIDEO }) });

describe("runProofCassette", () => {
  it("renders the built tape to the .mp4 and its transcript, files the receipt, and names the next steps", () => {
    const { captured, deps, dir } = makeDeps();
    const out = join(dir, "demo.mp4");
    expect(runProofCassette({ deps, rest: ["--tape", "demo.tape", "--out", out] })).toBe(EXIT_OK);
    expect(captured.renders).toStrictEqual([
      {
        cwd: dir,
        out,
        source: `Set TypingSpeed 5ms\nType "claude -p hi"\nEnter\nOutput "${out}"\nOutput "${out}.txt"\n`,
      },
    ]);
    expect(captured.out).toStrictEqual([
      out,
      `  capture receipt ${CAPTURE_ID}; frame text from ${out}.txt`,
      "next: read the transcript, then record what the recording shows: slopweaver browser image-record " +
        `--form <form>, citing capture id ${CAPTURE_ID}`,
      "the recording stays local: github attach holds every capture verb but browser console-shot until a figure " +
        "check exists",
    ]);
    expect(captured.errors).toStrictEqual([]);
  });

  it("files a version-2 receipt whose frame text is every distinct line the transcript showed", () => {
    const { deps, dir, home } = makeDeps();
    const out = join(dir, "demo.mp4");
    runProofCassette({ deps, rest: ["--tape", "demo.tape", "--out", out] });
    const record = unwrap(readCaptureRecord({ captureId: CAPTURE_ID, home }))!;
    expect(isCaptureReceipt(record)).toBe(true);
    const receipt = record as CaptureReceipt;
    expect(receipt).toMatchObject({
      cropRect: { height: 600, width: 1200, x: 0, y: 0 },
      detail: { tape: join(dir, "demo.tape"), transcript: `${out}.txt` },
      final: { artifact: { digest: imageDigestOf({ bytes: VIDEO }), heightPx: 600, widthPx: 1200 }, path: out },
      schemaVersion: 2,
      verb: "proof cassette",
    });
    expect(frameTextLines({ frameText: receipt.frameText })).toBe("> claude -p hi\nhello");
  });

  it("files an incomplete receipt, and says attach will refuse it, when the recorder wrote no transcript", () => {
    const { captured, deps, dir, home } = makeDeps({ transcript: null });
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.mp4")] })).toBe(EXIT_OK);
    expect(unwrap(readCaptureRecord({ captureId: CAPTURE_ID, home }))).toMatchObject({
      frameText: { kind: "incomplete", reasons: ["the recorder wrote no transcript beside the video"] },
    });
    expect(captured.errors).toStrictEqual([
      "proof cassette: frame text incomplete (the recorder wrote no transcript beside the video) — github attach " +
        "will refuse this recording",
    ]);
  });

  it("reports a strip that failed, and files no receipt", () => {
    const { captured, deps, dir, home } = makeDeps({ finalise: err(["could not strip the video's metadata"]) });
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.mp4")] })).toBe(EXIT_ERROR);
    expect(captured.errors).toStrictEqual(["proof cassette: could not strip the video's metadata"]);
    expect(unwrap(readCaptureRecord({ captureId: CAPTURE_ID, home }))).toBeNull();
  });

  it("runs vhs from --cwd when one is named", () => {
    const { captured, deps, dir } = makeDeps();
    runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.mp4"), "--cwd", "sub"] });
    expect(captured.renders[0]!.cwd).toBe(join(dir, "sub"));
  });

  it("refuses a slow tape before anything is rendered, naming the escape hatch", () => {
    const { captured, deps, dir } = makeDeps({ tape: ok("Set TypingSpeed 50ms") });
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.mp4")] })).toBe(EXIT_ERROR);
    expect(captured.renders).toStrictEqual([]);
    expect(captured.errors[0]).toContain("proof cassette: line 1: types at 50ms");
    expect(captured.errors.join("\n")).toContain(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_SLOW_CASSETTE=1",
    );
  });

  it("renders a slow tape when the escape hatch is open", () => {
    const { captured, deps, dir } = makeDeps({ tape: ok('Type@500ms"x"') });
    const out = join(dir, "a.mp4");
    const opened = { ...deps, env: { SLOPWEAVER_ALLOW_SLOW_CASSETTE: "1" } };
    expect(runProofCassette({ deps: opened, rest: ["--tape", "t.tape", "--out", out] })).toBe(EXIT_OK);
    expect(captured.renders[0]!.source).toBe(
      `Set TypingSpeed 5ms\nType@500ms"x"\nOutput "${out}"\nOutput "${out}.txt"\n`,
    );
  });

  it("refuses a GIF output with no escape hatch, since nothing about it is policy", () => {
    const { captured, deps, dir } = makeDeps();
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.gif")] })).toBe(EXIT_ERROR);
    expect(captured.errors[0]).toContain("--out must be an .mp4");
    expect(captured.errors).toHaveLength(1);
  });

  it("reports an unreadable tape", () => {
    const { captured, deps, dir } = makeDeps({ tape: err(["cannot read the tape t.tape: ENOENT"]) });
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.mp4")] })).toBe(EXIT_ERROR);
    expect(captured.errors).toStrictEqual(["proof cassette: cannot read the tape t.tape: ENOENT"]);
  });

  it("reports a vhs failure", () => {
    const { captured, deps, dir } = makeDeps({ render: err(["vhs failed: boom"]) });
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", join(dir, "a.mp4")] })).toBe(EXIT_ERROR);
    expect(captured.errors).toStrictEqual(["proof cassette: vhs failed: boom"]);
  });

  it("refuses a clean vhs exit that wrote no file", () => {
    const { captured, deps, dir } = makeDeps({ written: false });
    const out = join(dir, "a.mp4");
    expect(runProofCassette({ deps, rest: ["--tape", "t.tape", "--out", out] })).toBe(EXIT_ERROR);
    expect(captured.errors).toStrictEqual([`proof cassette: vhs exited cleanly but wrote no ${out}`]);
  });

  it("names both missing required flags", () => {
    const { captured, deps } = makeDeps();
    expect(runProofCassette({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(captured.errors.slice(0, 2)).toStrictEqual(["--tape is required", "--out is required"]);
  });
});
