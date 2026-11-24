/**
 * `talk find-card` against the SHIPPED binary under a low open-file limit: every board doc is still searched.
 *
 * ## Why this cannot be a unit case
 *
 * `scanBoardConcurrently` and `journalEvidenceConcurrently` read 32 files at once. Under a descriptor limit lower than
 * that, the wide read fails `EMFILE` on docs the serial `scanBoard` opens fine, and each such doc was reported
 * unreadable and left out of the ranking, and each such journal read as empty. Only a process whose limit was
 * lowered before it started can show that, because Node
 * raises its own soft limit at startup and a test cannot lower it from inside. MEASURED on a board of
 * matching docs at `ulimit -n 40`, with the serial retry removed: 65 of 200 rows searched; with it, 200.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { appendRunEvent } from "../../../handover/runStore.js";
import { unwrap } from "../../../lib/result.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Below the scan's 32-wide read plus what the CLI itself holds open, so the wide read must fail some opens. */
const DESCRIPTOR_LIMIT = 40;

/** Comfortably more docs than the limit, so a dropped doc cannot hide in the count. */
const DOC_COUNT = 200;

/** One spawn of the CLI, cold. */
const CLI_TIMEOUT_MS = 180_000;

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway state home holding {@link DOC_COUNT} rows. No doc mentions `needle`; each one's journal started and
 * then asked a question that does, so a row matches only when BOTH its doc and its journal were read.
 */
function boardHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-fd-"));
  homes.push(home);
  const runsDir = join(home, "runs");
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  for (let index = 0; index < DOC_COUNT; index++) {
    const slug = `doc-${String(index).padStart(3, "0")}`;
    const front = ["---", `slug: ${slug}`, "kind: ask", `summary: "row ${String(index)}"`, "status: ready", "---"];
    writeFileSync(
      join(home, "handovers", `${slug}.md`),
      [...front, "", `# ${slug}`, "", "x".repeat(64_000), ""].join("\n"),
    );
    const started = { atIso: "2026-10-26T00:00:00.000Z", branch: slug, docHash: "h", kind: "started" } as const;
    unwrap(appendRunEvent({ event: started, runsDir, slug }));
    const question = `needle ${String(index)}? ${"y".repeat(64_000)}`;
    unwrap(appendRunEvent({ event: { atIso: "2026-10-26T00:01:00.000Z", kind: "question", question }, runsDir, slug }));
  }
  return home;
}

/** Run one command line in a shell whose soft open-file limit is the one given; `unlimited` leaves it as inherited. */
function underLimit({ home, limit, line }: { home: string; limit: number | "unlimited"; line: string }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const command = limit === "unlimited" ? line : `ulimit -n ${String(limit)} && ${line}`;
  const run = spawnSync("sh", ["-c", command], {
    cwd: home,
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: home,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      TMPDIR: process.env["TMPDIR"]!,
    },
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

describe("talk find-card under a low open-file limit", () => {
  it("the limit really refuses 64 files open at once in that shell", () => {
    const home = boardHome();
    const opener = join(home, "opener.cjs");
    writeFileSync(
      opener,
      [
        'const fs = require("node:fs");',
        "const held = [];",
        'let outcome = "opened";',
        "try {",
        '  for (let i = 0; i < 64; i++) held.push(fs.openSync(process.argv[2], "r"));',
        "} catch (error) {",
        "  outcome = error.code;",
        "}",
        "for (const fd of held) fs.closeSync(fd);",
        "console.log(outcome);",
        "",
      ].join("\n"),
    );
    const probe = underLimit({
      home,
      limit: DESCRIPTOR_LIMIT,
      line: `'${process.execPath}' '${opener}' '${join(home, "handovers", "doc-000.md")}'`,
    });
    expect({ status: probe.status, stdout: probe.stdout.trim(), stderr: probe.stderr }).toEqual({
      status: 0,
      stderr: "",
      stdout: "EMFILE",
    });
  });

  it(
    "searches every doc, names none unreadable, and answers exactly as it does with no limit",
    () => {
      const home = boardHome();
      const line = `'${BIN}' talk find-card needle --json --home '${home}'`;
      const limited = underLimit({ home, limit: DESCRIPTOR_LIMIT, line });
      const unlimited = underLimit({ home, limit: "unlimited", line });
      expect(limited.status).toBe(0);
      expect(unlimited.status).toBe(0);
      const answer = JSON.parse(limited.stdout.trim().split("\n").at(-1)!) as {
        rowsSearched: number;
        matching: number;
        unreadable: readonly string[];
      };
      expect(answer.unreadable).toEqual([]);
      expect(answer.rowsSearched).toBe(DOC_COUNT);
      expect(answer.matching).toBe(DOC_COUNT);
      // Every card's placement reads the doc's journal, so a journal the wide read failed shows up here.
      expect(JSON.parse(limited.stdout.trim().split("\n").at(-1)!)).toEqual(
        JSON.parse(unlimited.stdout.trim().split("\n").at(-1)!),
      );
    },
    CLI_TIMEOUT_MS,
  );
});
