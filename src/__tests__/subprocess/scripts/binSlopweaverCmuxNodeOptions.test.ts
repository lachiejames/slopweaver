/**
 * `bin/slopweaver` strips the NODE_OPTIONS pair a cmux-launched Claude session leaks into every child, before
 * its host-sized heap ceiling reads NODE_OPTIONS.
 *
 * The measured instance: `automation run-due --recipe resync-corpus-github`, seated from cmux, died
 * exit 134 in `derive` at 4,085 MB. cmux's pair read as an operator's explicit ceiling, so the launcher skipped
 * host sizing, and cmux's `--require` shim then deleted NODE_OPTIONS in tsx's parent node — the real CLI ran at
 * V8's default either way. `hooks/lib/cmux-node-options.sh` carries the mechanism.
 *
 * Two halves, because the `ambient-heap-ceiling` gate refuses any tracked file assigning NODE_OPTIONS a value
 * that names the heap flag — this test included. The transformation (cmux's heap token, an operator's own
 * one) is proven through the helper's ARGV; the launcher's wiring is proven end to end with a guard-only
 * value, through a fake tsx that prints what the CLI would inherit and the heap limit a real node child gets.
 * What the fake cannot reproduce is tsx's own child relaunch; the live `dev heap-curve` run in the pull
 * request is the proof of that half.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launcherNodeEnv, writeLauncherManifest } from "../launcherNode.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAUNCHER = join(repoRoot, "bin", "slopweaver");
const HELPER = join(repoRoot, "hooks", "lib", "cmux-node-options.sh");

/** A guard path shaped like cmux's own, for the argv cases that never load it. */
const GUARD = "/t/cmux-claude-node-options/restore-node-options.cjs";
/** Exactly what cmux's wrapper prepends: its guard, then its hard-coded heap token. */
const CMUX_PAIR = `--require=${GUARD} --max-old-space-size=4096`;

/** cmux's own `restore-node-options.cjs` body, so the unfixed launcher reproduces the real failure. */
const SHIM_BODY = [
  'const hadOriginalNodeOptions = process.env.CMUX_ORIGINAL_NODE_OPTIONS_PRESENT === "1";',
  "if (hadOriginalNodeOptions) {",
  '  process.env.NODE_OPTIONS = process.env.CMUX_ORIGINAL_NODE_OPTIONS ?? "";',
  "} else {",
  "  delete process.env.NODE_OPTIONS;",
  "}",
  "delete process.env.CMUX_ORIGINAL_NODE_OPTIONS;",
  "delete process.env.CMUX_ORIGINAL_NODE_OPTIONS_PRESENT;",
  "",
].join("\n");

/** Prints what the CLI would inherit, then the heap limit a real node child actually gets. */
const FAKE_TSX = [
  "#!/bin/sh",
  "printf '%s\\n' \"${NODE_OPTIONS-<unset>}\"",
  "exec node -p 'require(\"v8\").getHeapStatistics().heap_size_limit'",
  "",
].join("\n");

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "slop-cmux-node-options-")));
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * Call the helper under bash `set -euo pipefail`, the launcher's own mode, never throwing on exit 1.
 *
 * @param value the NODE_OPTIONS value to clean
 * @param present CMUX_ORIGINAL_NODE_OPTIONS_PRESENT
 * @param original CMUX_ORIGINAL_NODE_OPTIONS
 * @returns the cleaned value and the helper's exit status
 */
function strip({ value, present = "0", original = "" }: { value: string; present?: string; original?: string }): {
  readonly out: string;
  readonly code: number;
} {
  try {
    const out = execFileSync(
      "/bin/bash",
      [
        "-c",
        'set -euo pipefail; source "$1"; cmux_node_options_without_injection "$2" "$3" "$4"',
        "_",
        HELPER,
        value,
        present,
        original,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (error) {
    const shaped = error as { status?: number; stdout?: string };
    if (shaped.status === undefined || shaped.stdout === undefined) {
      throw error;
    }
    return { code: shaped.status, out: shaped.stdout };
  }
}

describe("cmux_node_options_without_injection", () => {
  it("removes cmux's whole pair, leaving nothing when the operator set nothing", () => {
    expect(strip({ value: CMUX_PAIR })).toEqual({ code: 0, out: "" });
  });

  it("keeps an operator's own appended heap flag, so it still wins", () => {
    expect(strip({ value: `${CMUX_PAIR} --max-old-space-size=16000` })).toEqual({
      code: 0,
      out: "--max-old-space-size=16000",
    });
  });

  it("puts back the heap flag cmux took out of the operator's original, at the front", () => {
    expect(
      strip({
        original: "--enable-source-maps --max-old-space-size=6000",
        present: "1",
        value: `${CMUX_PAIR} --enable-source-maps`,
      }),
    ).toEqual({ code: 0, out: "--max-old-space-size=6000 --enable-source-maps" });
  });

  it("leaves a value with no cmux guard untouched, by exiting 1 with nothing printed", () => {
    expect(strip({ value: "--enable-source-maps --max-old-space-size=4096" })).toEqual({ code: 1, out: "" });
  });

  it("strips cmux's heap token by shape, so a changed cmux number is still removed", () => {
    expect(strip({ value: `--require=${GUARD} --max-old-space-size=8192` })).toEqual({ code: 0, out: "" });
  });

  it("keeps the token after the guard when it is not a heap flag", () => {
    expect(strip({ value: `--require=${GUARD} --enable-source-maps` })).toEqual({
      code: 0,
      out: "--enable-source-maps",
    });
  });

  it("never globs a token, so a `*` survives verbatim", () => {
    expect(strip({ value: `${CMUX_PAIR} --title=a*b` })).toEqual({ code: 0, out: "--title=a*b" });
  });

  it("finds the pair wherever it sits, keeping what came before it", () => {
    expect(strip({ value: `--enable-source-maps ${CMUX_PAIR}` })).toEqual({ code: 0, out: "--enable-source-maps" });
  });

  it("drops the underscored heap flag cmux's merge left behind, so the operator's own order still decides", () => {
    // cmux strips only the hyphenated spelling, so `--max_old_space_size=8000` stays in the merged value; kept
    // there, it would land AFTER the restored `…=6000` and win where the operator's own order had 6000 winning.
    expect(
      strip({
        original: "--max_old_space_size=8000 --max-old-space-size=6000",
        present: "1",
        value: `${CMUX_PAIR} --max_old_space_size=8000`,
      }),
    ).toEqual({ code: 0, out: "--max_old_space_size=8000 --max-old-space-size=6000" });
  });

  it("drops only cmux's ONE leftover copy, so the operator's own repeat of that flag still wins", () => {
    expect(
      strip({
        original: "--max_old_space_size=8000 --max-old-space-size=6000",
        present: "1",
        value: `${CMUX_PAIR} --max_old_space_size=8000 --max_old_space_size=8000`,
      }),
    ).toEqual({ code: 0, out: "--max_old_space_size=8000 --max-old-space-size=6000 --max_old_space_size=8000" });
  });

  it("never restores an OUTER cmux's heap token that a nested launch saved as the original", () => {
    expect(
      strip({
        original: `${CMUX_PAIR} --enable-source-maps`,
        present: "1",
        value: `--require=/u/cmux-claude-node-options/restore-node-options.cjs --max-old-space-size=4096 ${CMUX_PAIR} --enable-source-maps`,
      }),
    ).toEqual({ code: 0, out: "--enable-source-maps" });
  });
});

describe("bin/slopweaver under a cmux-launched session", () => {
  /**
   * Run the real launcher against a fake CLI tree whose tsx reports what it inherited.
   *
   * @param extra environment on top of a base with every NODE_OPTIONS and cmux variable removed
   * @returns the fake tsx's two lines: the NODE_OPTIONS it saw, and a node child's heap_size_limit
   */
  function launch({ extra }: { extra: Readonly<Record<string, string>> }): readonly string[] {
    const cli = join(scratch, "cli");
    mkdirSync(join(cli, "node_modules", ".bin"), { recursive: true });
    const tsx = join(cli, "node_modules", ".bin", "tsx");
    writeFileSync(tsx, FAKE_TSX);
    chmodSync(tsx, 0o755);
    writeLauncherManifest({ dir: cli });
    const stand = join(scratch, "stand");
    mkdirSync(stand, { recursive: true });
    // The session running this test is itself cmux-launched, so its own pair is removed from the base.
    const env: Record<string, string | undefined> = { ...process.env, ...launcherNodeEnv(), SLOPWEAVER_CLI_DIR: cli };
    delete env["NODE_OPTIONS"];
    delete env["CMUX_ORIGINAL_NODE_OPTIONS"];
    delete env["CMUX_ORIGINAL_NODE_OPTIONS_PRESENT"];
    const out = execFileSync(LAUNCHER, ["catalog"], {
      cwd: stand,
      encoding: "utf8",
      env: { ...env, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim().split("\n");
  }

  /** @returns the path of a real guard file carrying cmux's shim body */
  function guardFile(): string {
    const dir = join(scratch, "cmux-claude-node-options");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "restore-node-options.cjs");
    writeFileSync(path, SHIM_BODY);
    return path;
  }

  it("sizes the heap from the host exactly as it would with no cmux at all", () => {
    const control = launch({ extra: {} });
    const seated = launch({
      extra: { CMUX_ORIGINAL_NODE_OPTIONS_PRESENT: "0", NODE_OPTIONS: `--require=${guardFile()}` },
    });
    expect(control[0]).toMatch(/^--max-old-space-size=\d+$/);
    expect(seated).toEqual(control);
  });

  it("keeps an operator's own option beside the host-sized ceiling", () => {
    const control = launch({ extra: { NODE_OPTIONS: "--enable-source-maps" } });
    const seated = launch({
      extra: { CMUX_ORIGINAL_NODE_OPTIONS_PRESENT: "0", NODE_OPTIONS: `--require=${guardFile()} --enable-source-maps` },
    });
    expect(control[0]).toMatch(/^--max-old-space-size=\d+ --enable-source-maps$/);
    expect(seated).toEqual(control);
  });

  it("leaves NODE_OPTIONS alone when no cmux guard is in it", () => {
    const control = launch({ extra: { NODE_OPTIONS: "--enable-source-maps" } });
    const marked = launch({ extra: { CMUX_ORIGINAL_NODE_OPTIONS_PRESENT: "0", NODE_OPTIONS: "--enable-source-maps" } });
    expect(marked).toEqual(control);
  });
});
