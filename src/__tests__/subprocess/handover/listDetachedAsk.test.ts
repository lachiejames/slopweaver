/**
 * `handover list` against the SHIPPED binary, for a run waiting on the owner's word whose doc left the board — archived,
 * renamed or deleted (row `acme-waiting-run-with-archived-doc`).
 *
 * `unit/handover/detachedAsk.test.ts` proves the classification over events in memory. What only a process shows
 * is the sweep's wiring: the `runs/` directory really listed, a journal no board doc claims really read, the
 * archive really consulted for its doc, and the result on both the text board and `--json`.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { appendRunEvent } from "../../../handover/runStore.js";
import { unwrap } from "../../../lib/result.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Each case spawns the CLI once or twice. */
const CLI_TIMEOUT_MS = 180_000;

const ASKED_ISO = "2026-10-08T01:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An empty home with its board, archive and runs directories. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-list-detached-"));
  homes.push(home);
  mkdirSync(join(home, "handovers", "archive"), { recursive: true });
  mkdirSync(join(home, "runs"), { recursive: true });
  return home;
}

/** A doc file at `handovers/<where>/<slug>.md`. */
function writeDoc({ home, slug, status, where }: { home: string; slug: string; status: string; where: string }): void {
  writeFileSync(
    join(home, where, `${slug}.md`),
    ["---", `slug: ${slug}`, "kind: doc", `summary: ${slug} row`, `status: ${status}`, "---", "", `# ${slug}`, ""].join(
      "\n",
    ),
    "utf8",
  );
}

/** A live, ready doc `live-run` whose `blockedBy` names one slug. */
function blockedLiveRow({ blockedBy, home }: { blockedBy: string; home: string }): void {
  writeFileSync(
    join(home, "handovers", "live-run.md"),
    [
      "---",
      "slug: live-run",
      "kind: doc",
      "summary: live",
      "status: ready",
      `blockedBy: [${blockedBy}]`,
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
}

/** A run journal that started and then asked the owner a question, nothing after. */
function waitingJournal({ home, slug }: { home: string; slug: string }): void {
  const runsDir = join(home, "runs");
  unwrap(
    appendRunEvent({
      event: { atIso: "2026-10-08T00:00:00.000Z", branch: slug, docHash: "h", kind: "started" },
      runsDir,
      slug,
    }),
  );
  unwrap(appendRunEvent({ event: { atIso: ASKED_ISO, kind: "question", question: "Ship it?" }, runsDir, slug }));
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
    env: {
      ...accountSandboxChildEnv(),
      HOME: home,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      TMPDIR: process.env["TMPDIR"]!,
    },
  });
  return { status: child.status, stderr: child.stderr, stdout: child.stdout };
}

/** The parsed `--json` document a run printed, narrowed to what these cases read. */
function documentOf({ home }: { home: string }): {
  rows: readonly { slug: string; ownerWait: string; section: string }[];
  detachedAsks: readonly { slug: string; question: string; askedIso: string; journal: string; doc: unknown }[];
  unreadJournals: readonly { journal: string; why: string }[];
} {
  const listed = cli({ args: ["handover", "list", "--json"], home });
  expect(listed.status).toBe(0);
  return JSON.parse(listed.stdout) as ReturnType<typeof documentOf>;
}

describe("handover list, a waiting run whose doc left the board", { timeout: CLI_TIMEOUT_MS }, () => {
  it("publishes a deleted doc's run as a detached ask, and the text board names it with the abandon remedy", () => {
    const home = emptyHome();
    waitingJournal({ home, slug: "gone-run" });

    const document = documentOf({ home });
    expect(document.rows).toEqual([]);
    expect(document.detachedAsks).toEqual([
      {
        askedIso: ASKED_ISO,
        doc: { kind: "missing" },
        journal: join(home, "runs", "gone-run.jsonl"),
        question: "Ship it?",
        slug: "gone-run",
      },
    ]);

    const text = cli({ args: ["handover", "list"], home });
    expect(text.status).toBe(0);
    expect(text.stdout).toContain("WAITING ON OWNER, NO DOC ON THE BOARD (1)");
    expect(text.stdout).toContain('slopweaver handover abandon gone-run --why "<why>"');
    expect(text.stdout).not.toContain("No orchestration docs");
  });

  it("stands an archived doc's run up as an ordinary row waiting on the owner", () => {
    const home = emptyHome();
    writeDoc({ home, slug: "archived-run", status: "ready", where: join("handovers", "archive") });
    waitingJournal({ home, slug: "archived-run" });

    const document = documentOf({ home });
    expect(document.rows.map((row) => [row.slug, row.ownerWait])).toEqual([["archived-run", "owner"]]);
    expect(document.detachedAsks).toEqual([]);
  });

  it("leaves a done archived doc off the board, so a live row it unblocks stays runnable", () => {
    const home = emptyHome();
    writeDoc({ home, slug: "finished-run", status: "done", where: join("handovers", "archive") });
    waitingJournal({ home, slug: "finished-run" });
    blockedLiveRow({ blockedBy: "finished-run", home });

    const document = documentOf({ home });
    expect(document.rows.map((row) => [row.slug, row.section])).toEqual([["live-run", "RUN NOW"]]);
    expect(document.detachedAsks).toEqual([]);
  });

  it("leaves a settled ask archived under another name off the board, so a live row it blocks stays put", () => {
    const home = emptyHome();
    writeFileSync(
      join(home, "handovers", "archive", "renamed.md"),
      [
        "---",
        "slug: settled-run",
        "kind: ask",
        "summary: settled",
        "status: ready",
        "settlement: answered",
        "settlementWitness: w",
        "---",
        "",
      ].join("\n"),
      "utf8",
    );
    waitingJournal({ home, slug: "settled-run" });
    blockedLiveRow({ blockedBy: "settled-run", home });

    const document = documentOf({ home });
    expect(document.rows.map((row) => [row.slug, row.section])).toEqual([["live-run", "NOT YET"]]);
    expect(document.detachedAsks).toEqual([]);
  });

  it("never draws a live doc's run twice", () => {
    const home = emptyHome();
    writeDoc({ home, slug: "live-run", status: "ready", where: "handovers" });
    waitingJournal({ home, slug: "live-run" });

    const document = documentOf({ home });
    expect(document.rows.map((row) => row.slug)).toEqual(["live-run"]);
    expect(document.detachedAsks).toEqual([]);
  });

  it("calls an archived doc that will not read unreadable, never missing", () => {
    const home = emptyHome();
    writeFileSync(join(home, "handovers", "archive", "broken-run.md"), "---\nslug: [\n---\n", "utf8");
    waitingJournal({ home, slug: "broken-run" });

    const [ask] = documentOf({ home }).detachedAsks;
    expect([ask!.slug, (ask!.doc as { kind: string }).kind]).toEqual(["broken-run", "unreadable"]);
  });

  it("finds an archived doc saved under another file name by the slug it carries", () => {
    const home = emptyHome();
    writeFileSync(
      join(home, "handovers", "archive", "renamed.md"),
      ["---", "slug: moved-run", "kind: doc", "summary: moved", "status: ready", "---", "", "# moved", ""].join("\n"),
      "utf8",
    );
    waitingJournal({ home, slug: "moved-run" });

    const document = documentOf({ home });
    expect(document.rows.map((row) => [row.slug, row.ownerWait])).toEqual([["moved-run", "owner"]]);
    expect(document.detachedAsks).toEqual([]);
  });

  it("finds a renamed archived doc past a misfiled one at its exact path carrying another slug", () => {
    const home = emptyHome();
    const archive = join(home, "handovers", "archive");
    writeFileSync(
      join(archive, "moved-run.md"),
      ["---", "slug: other-run", "kind: doc", "summary: other", "status: ready", "---", ""].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(archive, "renamed.md"),
      ["---", "slug: moved-run", "kind: doc", "summary: moved", "status: ready", "---", ""].join("\n"),
      "utf8",
    );
    waitingJournal({ home, slug: "moved-run" });

    const document = documentOf({ home });
    expect(document.rows.map((row) => [row.slug, row.ownerWait])).toEqual([["moved-run", "owner"]]);
    expect(document.detachedAsks).toEqual([]);
  });

  it("never calls a doc missing while some other archived doc will not read", () => {
    const home = emptyHome();
    // Not a regular file, so the archive scan reports it unreadable — the parser itself tolerates bad front matter.
    mkdirSync(join(home, "handovers", "archive", "other.md"));
    waitingJournal({ home, slug: "gone-run" });

    const [ask] = documentOf({ home }).detachedAsks;
    expect(ask!.doc).toEqual({
      kind: "unreadable",
      why:
        "1 doc(s) on the board or in its archive would not read (archive/other.md), so none can be shown not to " +
        "carry this slug",
    });
  });

  it("reports an unclaimed journal it could not read, rather than skipping it", () => {
    const home = emptyHome();
    waitingJournal({ home, slug: "garbled-run" });
    appendFileSync(join(home, "runs", "garbled-run.jsonl"), "not a journal line\n", "utf8");

    const document = documentOf({ home });
    expect(document.detachedAsks).toEqual([]);
    expect(document.unreadJournals.map((unread) => unread.journal)).toEqual([join(home, "runs", "garbled-run.jsonl")]);
  });
});
