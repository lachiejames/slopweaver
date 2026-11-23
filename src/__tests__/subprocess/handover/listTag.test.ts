/**
 * `handover list --tag` and the tag fields on `list --json` and `row --json`, against the SHIPPED binary.
 *
 * `unit/handover/boardTags.test.ts` proves the composer, the document and the render over models built in memory.
 * What only a process shows is the verb's wiring: the filter parsed before the board is scanned, the journal
 * really read off disk into the row's tags, and the incomplete-journal warning on stderr for exactly the filters
 * whose verdict it could change.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { applyRowEvent } from "../../../handover/rowEvent.js";
import { unwrap } from "../../../lib/result.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Each case spawns the CLI once or twice. */
const CLI_TIMEOUT_MS = 180_000;

const WARNING =
  "broken-one: its journal could not be completely read, so its declared tags and its reply and run tags may be incomplete";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home holding three live rows: one tagged `platform=slack`, one untagged, one whose journal has a bad line. */
function stateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-list-tag-"));
  homes.push(home);
  const runsDir = join(home, "runs");
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  for (const slug of ["slack-one", "plain-one", "broken-one"]) {
    writeFileSync(
      join(home, "handovers", `${slug}.md`),
      ["---", `slug: ${slug}`, "kind: doc", `summary: ${slug} row`, "status: ready", "---", "", `# ${slug}`, ""].join(
        "\n",
      ),
      "utf8",
    );
  }
  unwrap(
    applyRowEvent({
      event: {
        atIso: "2026-09-27T09:00:00.000Z",
        drop: [],
        kind: "tagged",
        set: [{ key: "platform", value: "slack" }],
        why: "test",
      },
      runsDir,
      slug: "slack-one",
    }),
  );
  appendFileSync(join(runsDir, "broken-one.jsonl"), "not a journal line\n", "utf8");
  return home;
}

/** Run the shipped binary against one home, and report what it printed. */
function cli({ args, home }: { args: readonly string[]; home: string }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const child = spawnSync(BIN, [...args, "--home", home], {
    cwd: home,
    encoding: "utf8",
    env: { HOME: home, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: home, TMPDIR: process.env["TMPDIR"]! },
  });
  return { status: child.status, stderr: child.stderr, stdout: child.stdout };
}

/** The parsed `--json` document a run printed. */
function documentOf({ stdout }: { stdout: string }): {
  rows: readonly { slug: string; tags: readonly { key: string; value: string }[]; tagsIncomplete: boolean }[];
  rowsBeforeFilter: number;
  tagFilter: readonly string[];
} {
  return JSON.parse(stdout) as ReturnType<typeof documentOf>;
}

describe("handover list --tag", { timeout: CLI_TIMEOUT_MS }, () => {
  it("prints only the matching rows, against the whole board's count, and warns of the unreadable journal", () => {
    const home = stateHome();
    const listed = cli({ args: ["handover", "list", "--tag", "platform=slack", "--json"], home });
    expect(listed.status).toBe(0);
    const document = documentOf({ stdout: listed.stdout });
    expect(document.rows.map((row) => row.slug)).toEqual(["slack-one"]);
    expect(document.rowsBeforeFilter).toBe(3);
    expect(document.tagFilter).toEqual(["platform=slack"]);
    expect(document.rows[0]!.tags[0]).toEqual({ key: "platform", source: "declared", value: "slack" });
    expect(listed.stderr).toContain(WARNING);
  });

  it("warns of the unreadable journal under a run= filter, which that journal derives", () => {
    const home = stateHome();
    const listed = cli({ args: ["handover", "list", "--tag", "run=none", "--json"], home });
    expect(listed.status).toBe(0);
    expect(listed.stderr).toContain(WARNING);
    expect(documentOf({ stdout: listed.stdout }).rows.map((row) => row.slug)).not.toContain("broken-one");
  });

  it("gives no warning for a filter over doc fields alone, and marks the incomplete row either way", () => {
    const home = stateHome();
    const listed = cli({ args: ["handover", "list", "--tag", "kind=doc,!origin", "--json"], home });
    expect(listed.status).toBe(0);
    expect(listed.stderr).not.toContain("could not be completely read");
    const rows = documentOf({ stdout: listed.stdout }).rows.map((row) => [row.slug, row.tagsIncomplete] as const);
    expect(Object.fromEntries(rows)).toEqual({ "broken-one": true, "plain-one": false, "slack-one": false });
  });

  it("prints the rendered board narrowed, with the count it was narrowed from", () => {
    const home = stateHome();
    const listed = cli({ args: ["handover", "list", "--tag", "!platform"], home });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("filtered by --tag !platform: 2 of 3 row(s)");
    expect(listed.stdout).toContain("plain-one");
    expect(listed.stdout).not.toContain("slack-one");
  });

  it("refuses a malformed filter as a usage error before scanning the board", () => {
    const home = stateHome();
    const refused = cli({ args: ["handover", "list", "--tag", "platfrom=slack"], home });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('"platfrom" is not a tag key — did you mean platform?');
    expect(refused.stderr).not.toContain("handover list: scanning");
  });
});

describe("handover row --json", { timeout: CLI_TIMEOUT_MS }, () => {
  it("carries the row's tags read off its journal", () => {
    const home = stateHome();
    const shown = cli({ args: ["handover", "row", "--slug", "slack-one", "--json"], home });
    expect(shown.status).toBe(0);
    const row = JSON.parse(shown.stdout) as { tags: readonly unknown[]; tagsIncomplete: boolean; unrecognisedTags: [] };
    expect([row.tags[0], row.tagsIncomplete, row.unrecognisedTags]).toEqual([
      { key: "platform", source: "declared", value: "slack" },
      false,
      [],
    ]);
  });
});
