/**
 * `slopweaver sweep board` driven end to end over a real handovers directory.
 *
 * The verb's own classification is unit-tested in `./classify.test.ts`; what this file covers is the WIRING
 * that file cannot see — the flags, the census, the default view's findings filter, and the fact that a
 * closed row never reaches the classifier at all. Every fixture is written to a throwaway home and read back,
 * which is the filesystem round-trip `.claude/rules/testing.md` allows rather than a shared service.
 */
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverSettle } from "../../../cli/commands/handover/settleRowRun.js";
import { sweepBoardJsonLines } from "../../../cli/commands/sweep/boardEmit.js";
import { runSweepBoard } from "../../../cli/commands/sweep/boardRun.js";
import { SWEEP_BOARD_FLAG_NAMES } from "../../../cli/commands/sweep/core.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { runJournalPath } from "../../../handover/runStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { findingsDigest } from "../../../sweep/census.js";
import { capture, home, removeHomes, writeRow } from "./boardRunFixture.js";

afterEach(() => {
  removeHomes();
});

describe("runSweepBoard", () => {
  it("prints its own usage on --help and reads no board", async () => {
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver sweep board");
  });

  it("refuses an unknown flag as a caller mistake", async () => {
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--nope"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("unknown flag: --nope");
  });

  it("refuses a --deadline that is not a non-negative number, rather than defaulting a mistyped budget", async () => {
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", home(), "--deadline", "soon"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe(
      "sweep board: --deadline takes a non-negative number of seconds, where 0 means unbounded",
    );
  });

  it("censuses every verdict class, including the ones that are zero, and names what it scanned", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root] })).toBe(EXIT_OK);
    expect(out[0]).toBe("sweep board: 1 doc(s) scanned, 1 live row(s) swept");
    expect(out.slice(1, 10)).toEqual([
      "  CONTRADICTED  0",
      "  SHIPPED       0",
      "  PR_ENDED      0",
      "  UNCARDED      0",
      "  ORPHANED      0",
      "  SUPERSEDED    0",
      "  OVERTAKEN     0",
      "  UNWITNESSED   1",
      "  KEEP          0",
    ]);
  });

  it("keeps UNWITNESSED out of the default view, because no pure-code act follows from it", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root] })).toBe(EXIT_OK);
    expect(out.at(-1)).toBe("Nothing to act on.");
  });

  it("reports an ORPHANED row with the dead leaf as its witness, and offers the settle act", async () => {
    const handoverDir = join(home(), "handovers");
    writeRow({ handoverDir, slug: "a-dead-leaf", status: "rejected" });
    writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "can-never-run", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", join(handoverDir, "..")] })).toBe(EXIT_OK);
    expect(out[0]).toBe("sweep board: 2 doc(s) scanned, 1 live row(s) swept");
    expect(out).toContain("ORPHANED — 1:");
    expect(out).toContain("  can-never-run  [settle]");
    expect(out).toContain(
      "      blockedBy reaches a-dead-leaf (rejected) via can-never-run -> a-dead-leaf — it can never run",
    );
  });

  it("narrows to one cohort under --verdict, printing the census unchanged above it", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--verdict", "UNWITNESSED"] })).toBe(EXIT_OK);
    expect(out).toContain("UNWITNESSED — 1:");
    expect(out).toContain("  no-probe-row  [none]");
  });

  it("emits one JSON object per shown candidate under --json, and no census", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--json", "--verdict", "UNWITNESSED"] })).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(String.raw`"verdict":"UNWITNESSED"`);
    expect(out[0]).toContain(String.raw`"slug":"no-probe-row"`);
  });

  it("sweeps nothing outside the requested priority cohort", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--priority", "p0"] })).toBe(EXIT_OK);
    expect(out[0]).toBe("sweep board: 1 doc(s) scanned, 0 live row(s) swept");
  });
});

describe("runSweepBoard --write", () => {
  it("advertises --write on the flag list the help-truth ratchet reads", async () => {
    expect(SWEEP_BOARD_FLAG_NAMES).toContain("--write");
  });

  it("publishes exactly the --json lines, each newline-terminated, in the same order", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeRow({ handoverDir, slug: "a-dead-leaf", status: "rejected" });
    writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "b-never-runs", status: "ready" });
    writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "c-never-runs", status: "ready" });
    const json = capture();
    expect(await runSweepBoard({ deps: json.deps, rest: ["--home", root, "--json"] })).toBe(EXIT_OK);
    const written = capture();
    expect(await runSweepBoard({ deps: written.deps, rest: ["--home", root, "--write"] })).toBe(EXIT_OK);
    const path = stateHomePaths({ home: root }).live.hygiene.sweepBoard;
    expect(json.out).toHaveLength(2);
    expect(readFileSync(path, "utf8")).toBe(json.out.map((line) => `${line}\n`).join(""));
    expect(written.diagnostics).toEqual([
      `sweep board: wrote 2 finding(s) to ${path}`,
      `sweep board: wrote the census of 2 row(s) to ${stateHomePaths({ home: root }).live.hygiene.sweepBoardCensus}`,
    ]);
  });

  it("leaves the human output exactly as it is without --write", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const plain = capture();
    await runSweepBoard({ deps: plain.deps, rest: ["--home", root] });
    const written = capture();
    await runSweepBoard({ deps: written.deps, rest: ["--home", root, "--write"] });
    expect(written.out).toEqual(plain.out);
  });

  it("keeps --json stdout clean, sending the confirmation to the diagnostic channel", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeRow({ handoverDir, slug: "a-dead-leaf", status: "rejected" });
    writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "b-never-runs", status: "ready" });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--json", "--write"] })).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(readFileSync(stateHomePaths({ home: root }).live.hygiene.sweepBoard, "utf8")).toBe(`${out[0]!}\n`);
  });

  it("truncates the document to zero bytes on a clean pass, which is an answer rather than an absence", async () => {
    const root = home();
    const path = stateHomePaths({ home: root }).live.hygiene.sweepBoard;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, '{"slug":"yesterday"}\n', "utf8");
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(diagnostics).toEqual([
      `sweep board: wrote 0 finding(s) to ${path}`,
      `sweep board: wrote the census of 1 row(s) to ${stateHomePaths({ home: root }).live.hygiene.sweepBoardCensus}`,
    ]);
  });

  it("fails the run and leaves what occupies the path when the document cannot be replaced", async () => {
    const root = home();
    const path = stateHomePaths({ home: root }).live.hygiene.sweepBoard;
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "kept"), "kept", "utf8");
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain(`sweep board: hygiene document ${path} was not replaced`);
    expect(readFileSync(join(path, "kept"), "utf8")).toBe("kept");
  });

  it("leaves yesterday's document and fails the run when a handover file could not be read", async () => {
    const root = home();
    const path = stateHomePaths({ home: root }).live.hygiene.sweepBoard;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, '{"slug":"yesterday"}\n', "utf8");
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    // A directory where a doc should be: listed as markdown, and unreadable as one.
    mkdirSync(join(root, "handovers", "broken.md"));
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe('{"slug":"yesterday"}\n');
    expect(diagnostics).toEqual([
      "sweep board: --write left the previous document standing because 1 handover file(s) could not be read: broken.md",
    ]);
  });

  it("leaves yesterday's document and fails the run when a run journal holds a line it could not read", async () => {
    const root = home();
    const path = stateHomePaths({ home: root }).live.hygiene.sweepBoard;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, '{"slug":"yesterday"}\n', "utf8");
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const journal = runJournalPath({ runsDir: stateHomePaths({ home: root }).runs, slug: "no-probe-row" });
    mkdirSync(join(journal, ".."), { recursive: true });
    writeFileSync(journal, "{not-json}\n", "utf8");
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe('{"slug":"yesterday"}\n');
    expect(diagnostics).toEqual([
      "sweep board: --write left the previous document standing because 1 run journal(s) held a line that could not be read: no-probe-row",
    ]);
  });

  it("fails the run when an archived blocker is on disk and does not read, and never for one that is absent", async () => {
    const root = home();
    writeRow({ blockedBy: ["gone", "broken"], handoverDir: join(root, "handovers"), slug: "child", status: "ready" });
    // A directory where the archived doc should be: on disk, and unreadable as one.
    mkdirSync(join(root, "handovers", "archive", "broken.md"), { recursive: true });
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "sweep board: --write left the previous document standing because 1 archive read(s) failed for the top-up generation pass: broken.md",
      "sweep board: --write left the previous document standing because 1 archived blocker(s) may be on disk and could not be read: broken",
    ]);
  });

  it("fails the run when the archive cannot be opened, never reading its blocker as absent", async () => {
    const root = home();
    writeRow({ blockedBy: ["broken"], handoverDir: join(root, "handovers"), slug: "child", status: "ready" });
    const archive = join(root, "handovers", "archive");
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "broken.md"), "");
    chmodSync(archive, 0o000);
    const { deps, diagnostics } = capture();
    try {
      expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toContain(
        "because 1 archive read(s) failed for the top-up generation pass: the archive itself (EACCES",
      );
      expect(diagnostics[1]).toBe(
        "sweep board: --write left the previous document standing because 1 archived blocker(s) may be on disk and could not be read: broken",
      );
    } finally {
      chmodSync(archive, 0o755);
    }
  });

  it("fails the run when an archived blocker is a link whose target is gone", async () => {
    const root = home();
    writeRow({ blockedBy: ["broken"], handoverDir: join(root, "handovers"), slug: "child", status: "ready" });
    mkdirSync(join(root, "handovers", "archive"), { recursive: true });
    symlinkSync(join(root, "nowhere.md"), join(root, "handovers", "archive", "broken.md"));
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "sweep board: --write left the previous document standing because 1 archive read(s) failed for the top-up generation pass: broken.md",
      "sweep board: --write left the previous document standing because 1 archived blocker(s) may be on disk and could not be read: broken",
    ]);
  });

  it("refuses to publish a filtered selection as the whole board", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--verdict", "UNWITNESSED"] })).toBe(
      EXIT_ERROR,
    );
    expect(diagnostics).toEqual([
      "sweep board: --write left the previous document standing because --verdict or --priority narrowed the selection, and the document is the whole board",
    ]);
  });

  it("refuses to publish another directory's board as this home's, and publishes its own named by --dir", async () => {
    const root = home();
    const elsewhere = home();
    writeRow({ handoverDir: join(elsewhere, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps, diagnostics } = capture();
    const away = ["--home", root, "--dir", join(elsewhere, "handovers"), "--write"];
    expect(await runSweepBoard({ deps, rest: away })).toBe(EXIT_ERROR);
    expect(
      await runSweepBoard({ deps, rest: ["--home", root, "--dir", join(root, "handovers", "."), "--write"] }),
    ).toBe(0);
    expect(diagnostics).toEqual([
      "sweep board: --write left the previous document standing because --dir read a directory other than this home's handovers, and the document is this home's board",
      `sweep board: wrote 0 finding(s) to ${join(root, "live", "hygiene", "sweep-board.jsonl")}`,
      `sweep board: wrote the census of 0 row(s) to ${join(root, "live", "hygiene", "sweep-board-census.json")}`,
    ]);
  });

  it("publishes the whole pass's verdict census beside the findings, carrying the digest of the lines written", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeRow({ handoverDir, slug: "a-dead-leaf", status: "rejected" });
    writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "b-never-runs", status: "ready" });
    writeRow({ handoverDir, slug: "no-probe-row", status: "ready" });
    const { deps } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_OK);
    const paths = stateHomePaths({ home: root }).live.hygiene;
    const written = readFileSync(paths.sweepBoard, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(written.length).toBe(1);
    expect(JSON.parse(readFileSync(paths.sweepBoardCensus, "utf8"))).toEqual({
      census: {
        CONTRADICTED: 0,
        KEEP: 0,
        ORPHANED: 1,
        OVERTAKEN: 0,
        PR_ENDED: 0,
        SHIPPED: 0,
        SUPERSEDED: 0,
        UNCARDED: 0,
        UNWITNESSED: 1,
      },
      findingsSha256: findingsDigest({ lines: written }),
      producer: "sweep board",
      scanned: 3,
      schemaVersion: 5,
      swept: 2,
    });
  });

  it("writes no census either when the read was partial, so part of the board never reads as its whole", async () => {
    const root = home();
    const census = stateHomePaths({ home: root }).live.hygiene.sweepBoardCensus;
    mkdirSync(join(census, ".."), { recursive: true });
    writeFileSync(census, "yesterday\n", "utf8");
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });
    const { deps } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--verdict", "UNWITNESSED"] })).toBe(
      EXIT_ERROR,
    );
    expect(readFileSync(census, "utf8")).toBe("yesterday\n");
  });

  it("fails the run when the census cannot be replaced, writing it first so the findings are never touched", async () => {
    const root = home();
    const paths = stateHomePaths({ home: root }).live.hygiene;
    const census = paths.sweepBoardCensus;
    mkdirSync(census, { recursive: true });
    writeFileSync(join(census, "kept"), "kept", "utf8");
    writeFileSync(paths.sweepBoard, '{"slug":"yesterday"}\n', "utf8");
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write"] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain(`sweep board: hygiene document ${census} was not replaced`);
    expect(readFileSync(join(census, "kept"), "utf8")).toBe("kept");
    expect(readFileSync(paths.sweepBoard, "utf8")).toBe('{"slug":"yesterday"}\n');
  });

  it("serialises one line per candidate and nothing for none", async () => {
    expect(sweepBoardJsonLines({ candidates: [] })).toEqual([]);
  });
});

describe("runSweepBoard on an overtaken top-up generation", () => {
  const OLD = "vulnerability-fix-topup-acme-api-1790000000000";
  const NEW = "vulnerability-fix-topup-acme-api-1790100000000";
  const ALERT = "https://github.com/acme/api/security/dependabot/1089";
  const batch = ({ item }: { item: string }): string =>
    [
      "Raise 1 vulnerability-fix pull request(s) in acme/api as bot, to bring the open set back to 10.",
      "",
      "The batch, worst CVSS first:",
      item,
    ].join("\\n");
  // Disjoint on purpose: a later lookalike's batch may share nothing with this row's.
  const OLD_BATCH = batch({
    item: `  - handlebars (npm, yarn.lock) — critical CVSS 9.8, GHSA-8r5x-fm3f-whwj, alert ${ALERT}, first patched 4.7.10`,
  });
  const NEW_BATCH = batch({
    item: "  - lodash (npm, yarn.lock) — high CVSS 7.2, GHSA-35jh-r3h4-6jhm, alert https://github.com/acme/api/security/dependabot/1090, first patched 4.17.21",
  });
  const brief = ({
    slug,
    askedIso,
    settled,
    summary,
  }: {
    slug: string;
    askedIso: string;
    settled: boolean;
    summary: string;
  }): string =>
    [
      "---",
      `slug: ${slug}`,
      "kind: ask",
      `summary: "${summary}"`,
      "status: ready",
      `askedIso: ${askedIso}`,
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      ...(settled ? ["settlement: answered", "settlementWitness: raised"] : []),
      "---",
      "",
    ].join("\n");

  it("reports a disjoint later batch OVERTAKEN with no ending, and a settle on the board it names ends that board's row", async () => {
    const root = home();
    const board = join(root, "elsewhere-board");
    mkdirSync(join(board, "archive"), { recursive: true });
    writeFileSync(
      join(board, `${OLD}.md`),
      brief({ askedIso: "2026-10-01T00:00:00.000Z", settled: false, slug: OLD, summary: OLD_BATCH }),
    );
    writeFileSync(
      join(board, "archive", `${NEW}.md`),
      brief({ askedIso: "2026-10-02T00:00:00.000Z", settled: true, slug: NEW, summary: NEW_BATCH }),
    );
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--dir", board] })).toBe(EXIT_OK);
    expect(out).toContain("  OVERTAKEN     1");
    const where = `--home ${root} --dir ${board}`;
    expect(out.filter((line) => line.includes("naming this board"))).toEqual([
      `      ${NEW} matches this row's top-up slug and batch brief with a later slug epoch, 2026-09-22T18:00:00.000Z — its batch may carry none of this row's packages, so read where they stand: if one is still owed, keep this row; if none is, settle it once nobody holds it, with whichever ending and witness the facts support (\`slopweaver handover settle --help\`; a decline is the owner's alone), naming this board: \`${where}\``,
    ]);
    expect(out.join("\n")).not.toContain(`handover settle ${OLD}`);
    // A person reads this row's one package, finds its alert dismissed, answers that in a thread, and settles
    // the row `answered` with that answer's permalink, on the board the witness named.
    const answer = "https://acme.slack.com/archives/C0123/p1790200000000000";
    const chosen = `slopweaver handover settle ${OLD} --as answered --witness ${answer} ${where}`;
    expect(await runHandoverSettle(["node", ...chosen.split(" ")])).toBe(EXIT_OK);
    const settled = readFileSync(join(board, `${OLD}.md`), "utf8");
    expect(settled).toContain("settlement: answered");
    expect(settled).toContain(`settlementWitness: ${answer}`);
  });
});
