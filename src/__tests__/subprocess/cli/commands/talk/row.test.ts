/**
 * `talk row` reads a row's run journal beside its doc, through the SHIPPED binary over a throwaway home — the seam a
 * pure projector test cannot prove: `--home`, the runs directory, journal decoding, the correction fold and the JSON.
 *
 * The defect it holds down: the Tauri row's doc named no file, its journal's corrected question placed
 * `PLAN.md` in `~/dev/acme-desktop-tauri`, and the voice told the owner the full briefing was not there yet.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "a-tauri-prototype";

const DOC = [
  "---",
  `slug: ${SLUG}`,
  "kind: ask",
  'summary: "a Tauri prototype of the desktop app"',
  "status: ready",
  "---",
  "",
  "# a Tauri prototype",
  "",
  "## What to build",
  "",
  "A prototype.",
  "",
].join("\n");

const CORRECTED = "Want to try it? Folder: ~/dev/acme-desktop-tauri (local git). Plan: PLAN.md in the folder.";

const JOURNAL = [
  { atIso: "2026-10-20T10:00:00.000Z", branch: "tauri", docHash: "h1", kind: "started" },
  { atIso: "2026-10-20T10:28:00.000Z", kind: "question", question: "The prototype is ready. Want to try it?" },
  { atIso: "2026-10-20T10:59:00.000Z", kind: "question-corrected", question: CORRECTED, why: "placed the plan" },
]
  .map((event) => JSON.stringify(event))
  .join("\n");

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home holding the row's doc and, when given, its journal. */
function homeWith({ journal }: { journal: string | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "talk-row-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  writeFileSync(join(home, "handovers", `${SLUG}.md`), DOC);
  if (journal !== undefined) {
    writeFileSync(join(home, "runs", `${SLUG}.jsonl`), `${journal}\n`);
  }
  return home;
}

/** Run `talk row --json` over one home. */
function talkRow({ home }: { home: string }): { status: number | null; row: Record<string, unknown> } {
  const result = spawnSync(BIN, ["talk", "row", "--slug", SLUG, "--json", "--home", home], {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.stdout.trim() === "") {
    throw new Error(`talk row printed nothing; exit ${String(result.status)}; stderr: ${result.stderr}`);
  }
  return { row: JSON.parse(result.stdout) as Record<string, unknown>, status: result.status };
}

describe("talk row reads the run journal", () => {
  it("hands over the corrected open question and the plan file it names", () => {
    const { row, status } = talkRow({ home: homeWith({ journal: JOURNAL }) });
    expect(status).toBe(0);
    expect(row["question"]).toBe(CORRECTED);
    expect(row["questionHeld"]).toBe(true);
    expect(row["files"]).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
    expect(row["journalUnread"]).toBe(undefined);
  });

  // One bad line once hid the readable correction and the plan file it placed.
  it("states a journal line it could not decode, and still hands over the readable question's plan file", () => {
    const { row, status } = talkRow({ home: homeWith({ journal: `${JOURNAL}\nnot json` }) });
    expect(status).toBe(0);
    expect(row["journalUnread"]).toBe("1 journal line(s) could not be read");
    expect(row["question"]).toBe(CORRECTED);
    expect(row["questionHeld"]).toBe(undefined);
    expect(row["files"]).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("reads a row never started as one with no question, and no unread journal", () => {
    const { row, status } = talkRow({ home: homeWith({ journal: undefined }) });
    expect(status).toBe(0);
    expect(row["question"]).toBe(undefined);
    expect(row["journalUnread"]).toBe(undefined);
    expect(row["files"]).toEqual([]);
  });
});
