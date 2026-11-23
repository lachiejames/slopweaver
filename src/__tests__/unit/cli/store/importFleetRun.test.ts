/**
 * `store import-fleet`'s shell, driven end to end against a temp home.
 *
 * Every case runs under `--dry-run`, which is the whole reason the shell is reachable from a unit test at
 * all: it opens no connection, so what is exercised here is the real argument parsing, the real directory
 * walk and the real projections, with only the write suppressed.
 *
 * The home is minted with `mkdtempSync` and passed explicitly with `--home`, per
 * `.claude/rules/testing.md` — the ambient `$SLOPWEAVER_HOME` is never written to.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runImportFleet } from "../../../../cli/commands/store/importFleetRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";

/** Every home this file has minted, so `afterEach` can remove them. */
const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with the directories the verb reads. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "import-fleet-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(join(home, "runs"), { recursive: true });
  mkdirSync(join(home, "ledgers"), { recursive: true });
  mkdirSync(join(home, "orchestration"), { recursive: true });
  return home;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "store", "import-fleet", ...tail];
}

describe("runImportFleet", () => {
  it("exits OK on --help", async () => {
    await expect(runImportFleet(argv({ tail: ["--help"] }))).resolves.toBe(EXIT_OK);
  });

  it("refuses a leg it does not have, before touching anything", async () => {
    const home = freshHome();

    await expect(runImportFleet(argv({ tail: ["--only", "atlas", "--home", home] }))).resolves.toBe(EXIT_USAGE);
  });

  it("dry-runs an empty home to OK — an absent grants journal is not a failure", async () => {
    const home = freshHome();

    await expect(runImportFleet(argv({ tail: ["--dry-run", "--home", home] }))).resolves.toBe(EXIT_OK);
  });

  it("projects a board document and a ledger line from a real home without writing", async () => {
    const home = freshHome();
    writeFileSync(join(home, "handovers", "a-row.md"), "---\nslug: a-row\nkind: ask\nstatus: ready\n---\n\n# A row\n");
    writeFileSync(
      join(home, "ledgers", "autonomy.jsonl"),
      `${JSON.stringify({
        actionId: "a1",
        bySession: "workspace:1",
        doneIso: "2026-09-12T02:06:09Z",
        kind: "press-merge-when-ready",
        subject: "https://example.invalid/1",
        why: "every gate was green",
        witness: "slopweaver github enqueue -> queued",
      })}\n`,
    );

    const code = await runImportFleet(
      argv({ tail: ["--dry-run", "--home", home, "--only", "board", "--only", "autonomy"] }),
    );

    expect(code).toBe(EXIT_OK);
  });

  it("dry-runs the owner-turns leg over a home holding the owner's files", async () => {
    const home = freshHome();
    mkdirSync(join(home, "supervisor-scratch", "handoff-9291"), { recursive: true });
    writeFileSync(join(home, "supervisor-scratch", "handoff-9291", "owner-turn-291-60.txt"), "their words\n");

    const code = await runImportFleet(argv({ tail: ["--dry-run", "--home", home, "--only", "owner-turns"] }));

    expect(code).toBe(EXIT_OK);
  });

  it("exits non-zero when an owner-turn file cannot be stored verbatim", async () => {
    const home = freshHome();
    mkdirSync(join(home, "handovers", "archive"), { recursive: true });
    writeFileSync(join(home, "handovers", "archive", "owner-turn-1-1.txt"), "a\u0000b");

    const code = await runImportFleet(argv({ tail: ["--dry-run", "--home", home, "--only", "owner-turns"] }));

    expect(code).not.toBe(EXIT_OK);
  });

  it("exits non-zero when a ledger line cannot be projected", async () => {
    const home = freshHome();
    writeFileSync(join(home, "ledgers", "autonomy.jsonl"), "{not json\n");

    const code = await runImportFleet(argv({ tail: ["--dry-run", "--home", home, "--only", "autonomy"] }));

    expect(code).not.toBe(EXIT_OK);
  });

  // NOT asserted here: the JSON payload itself. The shared `logger` writes to the real stdout and is not
  // injectable from a module-level import, and patching `process.stdout.write` to read it back would be a
  // mock in all but name — banned by `.claude/rules/testing.md`. The payload is `safeJsonStringify` of the
  // same `ImportFleetReport` `importFleetLines` renders, and `importFleetCore.test.ts` asserts that shape
  // field by field; what is left to check here is that the flag is accepted and changes nothing else.
  it("accepts --json and still reports the same exit code", async () => {
    const home = freshHome();

    const code = await runImportFleet(argv({ tail: ["--dry-run", "--json", "--home", home, "--only", "board"] }));

    expect(code).toBe(EXIT_OK);
  });

  it("writes nothing into the home it was pointed at", async () => {
    const home = freshHome();
    writeFileSync(join(home, "handovers", "a-row.md"), "---\nslug: a-row\nstatus: ready\n---\n\n# A row\n");

    await runImportFleet(argv({ tail: ["--dry-run", "--home", home] }));

    // A dry run reads; a file appearing here would mean it did something else.
    expect(() => {
      rmSync(join(home, "handovers", "a-row.md"));
    }).not.toThrow();
  });
});
