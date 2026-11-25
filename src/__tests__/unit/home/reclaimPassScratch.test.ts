/**
 * A finished Codex pass reclaiming its OWN scratch: exactly that one workspace goes, its record survives, the
 * act is journalled — and every check that refuses leaves the scratch exactly where it was.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readReclaimLedger } from "../../../home/reclaim/journalStore.js";
import { passReclaimSession, reclaimFinishedPassScratch } from "../../../home/reclaim/passScratch.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-11-25T15:00:00.000Z";

let home = "";

/** A throwaway home, so nothing here can write into the ambient `$SLOPWEAVER_HOME`. */
function freshHome(): { orchestration: string; ledgerPath: string } {
  home = mkdtempSync(join(tmpdir(), "reclaim-pass-"));
  return { ledgerPath: join(home, "ledgers", "home-reclaim.jsonl"), orchestration: join(home, "orchestration") };
}

/** Write a file, creating its directory. */
function put({ path, text }: { path: string; text: string }): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** A pass that published: its record files, and a scratch holding an install the pass made. */
function publishedPass({ orchestration, id }: { orchestration: string; id: string }): string {
  put({ path: join(orchestration, id, "record.json"), text: "{}" });
  put({ path: join(orchestration, id, "artifact.md"), text: "the answer of record" });
  put({ path: join(orchestration, `${id}.scratch`, "review-packet.md"), text: "the diff under review" });
  put({ path: join(orchestration, `${id}.scratch`, "worktree", "node_modules", "x", "index.js"), text: "an install" });
  return join(orchestration, `${id}.scratch`);
}

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("reclaimFinishedPassScratch", () => {
  it("removes only its own scratch, keeps its record and every sibling, and journals one row", () => {
    const { orchestration, ledgerPath } = freshHome();
    const scratchPath = publishedPass({ id: "own", orchestration });
    const siblingScratch = publishedPass({ id: "sibling", orchestration });
    put({ path: join(orchestration, "running.scratch", "probe.txt"), text: "a pass still running" });

    const outcome = unwrap(
      reclaimFinishedPassScratch({
        artifactId: "own",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath,
      }),
    );

    expect(outcome.entries).toEqual(["own.scratch"]);
    expect(outcome.freedBytes).toBeGreaterThan(0);
    expect(existsSync(scratchPath)).toBe(false);
    expect(existsSync(join(orchestration, "own", "record.json"))).toBe(true);
    expect(existsSync(join(orchestration, "own", "artifact.md"))).toBe(true);
    expect(existsSync(siblingScratch)).toBe(true);
    expect(existsSync(join(orchestration, "running.scratch", "probe.txt"))).toBe(true);
    expect(unwrap(readReclaimLedger({ path: ledgerPath }))).toEqual([
      {
        atIso: NOW,
        freedBytes: outcome.freedBytes,
        removedEntries: 1,
        root: "codex-scratch",
        session: "pass:own",
        takes: "finished-scratch",
        witnessHeld: true,
      },
    ]);
  });

  it("refuses a path that is not the exact scratch this pass was given, and removes nothing", () => {
    const { orchestration, ledgerPath } = freshHome();
    publishedPass({ id: "own", orchestration });
    const someoneElses = publishedPass({ id: "other", orchestration });

    const error = unwrapErr(
      reclaimFinishedPassScratch({
        artifactId: "own",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath: someoneElses,
      }),
    );

    expect(error.code).toBe("PASS_SCRATCH_NOT_RECLAIMABLE");
    expect(error.message).toContain("not the one this pass's own scratch was created at");
    expect(existsSync(someoneElses)).toBe(true);
    expect(existsSync(join(orchestration, "own.scratch"))).toBe(true);
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("refuses an id that would reach outside the orchestration root", () => {
    const { orchestration, ledgerPath } = freshHome();
    const outside = join(home, "escape.scratch");
    put({ path: join(outside, "keep.txt"), text: "outside the root" });

    const error = unwrapErr(
      reclaimFinishedPassScratch({
        artifactId: "../escape",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath: outside,
      }),
    );

    expect(error.code).toBe("PASS_SCRATCH_NOT_RECLAIMABLE");
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });

  it("refuses a pass whose artifact is not written — it is not finished — and leaves its scratch", () => {
    const { orchestration, ledgerPath } = freshHome();
    const scratchPath = publishedPass({ id: "own", orchestration });
    rmSync(join(orchestration, "own", "artifact.md"));

    const error = unwrapErr(
      reclaimFinishedPassScratch({
        artifactId: "own",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath,
      }),
    );

    expect(error.message).toContain("its artifact.md is not there");
    expect(existsSync(scratchPath)).toBe(true);
  });

  it("refuses a pass whose record.json is missing, and leaves its scratch", () => {
    const { orchestration, ledgerPath } = freshHome();
    const scratchPath = publishedPass({ id: "own", orchestration });
    rmSync(join(orchestration, "own", "record.json"));

    const error = unwrapErr(
      reclaimFinishedPassScratch({
        artifactId: "own",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath,
      }),
    );

    expect(error.message).toContain("its record.json is not there");
    expect(existsSync(scratchPath)).toBe(true);
  });

  it("refuses a record-shaped scratch, and leaves it", () => {
    const { orchestration, ledgerPath } = freshHome();
    const scratchPath = publishedPass({ id: "own", orchestration });
    put({ path: join(scratchPath, "record.json"), text: "{}" });

    const error = unwrapErr(
      reclaimFinishedPassScratch({
        artifactId: "own",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath,
      }),
    );

    expect(error.message).toContain("so it may be a record");
    expect(existsSync(join(scratchPath, "record.json"))).toBe(true);
  });

  it("refuses a scratch that is a symlink, and never follows it", () => {
    const { orchestration, ledgerPath } = freshHome();
    put({ path: join(orchestration, "own", "record.json"), text: "{}" });
    put({ path: join(orchestration, "own", "artifact.md"), text: "the answer of record" });
    const target = join(home, "elsewhere");
    put({ path: join(target, "keep.txt"), text: "not the pass's" });
    symlinkSync(target, join(orchestration, "own.scratch"));

    const error = unwrapErr(
      reclaimFinishedPassScratch({
        artifactId: "own",
        deps: { ledgerPath, nowIso: () => NOW },
        orchestrationRoot: orchestration,
        scratchPath: join(orchestration, "own.scratch"),
      }),
    );

    expect(error.code).toBe("ROOT_NOT_DIRECTORY");
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
  });
});

describe("passReclaimSession", () => {
  it("names the pass, so a ledger row leads to the record whose scratch it removed", () => {
    expect(passReclaimSession({ artifactId: "abc-123" })).toBe("pass:abc-123");
  });
});
