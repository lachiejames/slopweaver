import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type HomeReclaimDeps, runHomeReclaim } from "../../../cli/commands/home/reclaimRun.js";
import { readReclaimLedger, reclaimLedgerPath } from "../../../home/reclaim/journalStore.js";

let home = "";

/** A throwaway home, so nothing here can write into the ambient `$SLOPWEAVER_HOME`. */
function freshHome(): string {
  home = mkdtempSync(join(tmpdir(), "reclaim-"));
  return home;
}

/** Write a file, creating its directory. */
function put({ path, text }: { path: string; text: string }): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** Both output channels, captured. */
function captured(): { deps: HomeReclaimDeps; out: string[]; diagnostic: string[] } {
  const out: string[] = [];
  const diagnostic: string[] = [];
  return {
    deps: {
      nowIso: () => "2026-09-22T00:00:00.000Z",
      session: "a test",
      writeDiagnostic: (line) => {
        diagnostic.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostic,
    out,
  };
}

/** A finished pass's record directory: the sidecar and the artifact the pass writes last. */
function finishedRecord({ orchestration, id }: { orchestration: string; id: string }): void {
  put({ path: join(orchestration, `${id}/record.json`), text: "{}" });
  put({ path: join(orchestration, `${id}/artifact.md`), text: "the pass wrote this" });
}

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("home reclaim over codex-scratch", () => {
  it("takes a finished pass's whole scratch — a clone, its object store, installs, notes — and keeps its record", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "aaa", orchestration });
    put({ path: join(orchestration, "aaa.scratch/review-packet.md"), text: "the diff under review" });
    put({ path: join(orchestration, "aaa.scratch/review-tree/.git/objects/pack/p.pack"), text: "a clone's pack" });
    put({ path: join(orchestration, "aaa.scratch/review-tree/src/real.ts"), text: "a mutant's own edit" });
    put({ path: join(orchestration, "aaa.scratch/review-tree/node_modules/x/index.js"), text: "an install" });
    put({ path: join(orchestration, "aaa.scratch/yarn-cache-elsewhere/a.zip"), text: "a cache by any name" });

    const { deps } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(existsSync(join(orchestration, "aaa.scratch"))).toBe(false);
    expect(existsSync(join(orchestration, "aaa/artifact.md"))).toBe(true);
    expect(existsSync(join(orchestration, "aaa/record.json"))).toBe(true);
  });

  it("never enters a scratch whose pass wrote no artifact — it may still be running", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    put({ path: join(orchestration, "bbb/record.json"), text: "{}" });
    put({ path: join(orchestration, "bbb.scratch/probe/node_modules/left-pad/index.js"), text: "in use" });
    const { deps } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(existsSync(join(orchestration, "bbb.scratch/probe/node_modules/left-pad/index.js"))).toBe(true);
  });

  // The walk never follows a symlink, so a `<id>.scratch` that is one is never a candidate — and neither is
  // what it points at. The target sits OUTSIDE the root, so a removal that followed the link reddens here.
  it("never takes a scratch that is a symlink, nor what it points at", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "ccc", orchestration });
    put({ path: join(root, "elsewhere/precious.txt"), text: "outside the root" });
    symlinkSync(join(root, "elsewhere"), join(orchestration, "ccc.scratch"));
    const { deps, out } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("from 0 entr(ies)");
    expect(existsSync(join(orchestration, "ccc.scratch"))).toBe(true);
    expect(existsSync(join(root, "elsewhere/precious.txt"))).toBe(true);
  });

  // The walk opens its root with readdirSync, which follows a link, so an `orchestration`
  // that links elsewhere would lose a finished scratch wherever it resolves. The outside tree CARRIES a
  // finished pass, so a reclaim that walked through the link would take it and this reddens.
  it("refuses an orchestration root that is a symlink, and touches nothing it resolves to", () => {
    const root = freshHome();
    const outside = join(root, "outside");
    finishedRecord({ id: "kkk", orchestration: outside });
    put({ path: join(outside, "kkk.scratch/precious.txt"), text: "outside the home's own root" });
    symlinkSync(outside, join(root, "orchestration"));
    const { deps, diagnostic } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(1);
    expect(diagnostic.join("\n")).toContain("is a symlink or not a directory, so nothing below it is reclaimed");
    expect(existsSync(join(outside, "kkk.scratch/precious.txt"))).toBe(true);
  });

  // rmSync removes a link, never its target. The target sits OUTSIDE the root and carries a file, so a
  // removal that followed the link inside a taken scratch reddens here.
  it("removes a link inside a taken scratch without reaching what it points at", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "jjj", orchestration });
    put({ path: join(root, "elsewhere/precious.txt"), text: "outside the root" });
    put({ path: join(orchestration, "jjj.scratch/notes.md"), text: "spent" });
    symlinkSync(join(root, "elsewhere"), join(orchestration, "jjj.scratch/escape"));
    const { deps } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(existsSync(join(orchestration, "jjj.scratch"))).toBe(false);
    expect(existsSync(join(root, "elsewhere/precious.txt"))).toBe(true);
  });

  it("takes every finished workspace in one run and leaves each running one", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "ddd", orchestration });
    finishedRecord({ id: "eee", orchestration });
    put({ path: join(orchestration, "ddd.scratch/a.txt"), text: "spent" });
    put({ path: join(orchestration, "eee.scratch/b.txt"), text: "spent" });
    put({ path: join(orchestration, "fff.scratch/c.txt"), text: "running" });
    const { deps, out } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("from 2 entr(ies), examining 2 finished pass(es)");
    expect(existsSync(join(orchestration, "ddd.scratch"))).toBe(false);
    expect(existsSync(join(orchestration, "eee.scratch"))).toBe(false);
    expect(existsSync(join(orchestration, "fff.scratch/c.txt"))).toBe(true);
  });

  // A directory its owner may list but not search (`0400`) names a file `lstat` cannot
  // reach. Dropping that file would let the witness say "held" over a path it never saw, so the run stops
  // before any removal. The input CARRIES both the unreachable file and a finished scratch, so a walk that
  // went back to ignoring the failure removes `done.scratch` and reddens the last line.
  it("stops before removing anything when a kept file cannot be measured", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "done", orchestration });
    put({ path: join(orchestration, "done.scratch/file"), text: "spent" });
    put({ path: join(orchestration, "live.scratch/precious.txt"), text: "a running pass's" });
    chmodSync(join(orchestration, "live.scratch"), 0o400);
    const { deps, diagnostic } = captured();
    try {
      const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });
      expect(code).toBe(1);
      expect(diagnostic.join("\n")).toContain("live.scratch/precious.txt");
    } finally {
      chmodSync(join(orchestration, "live.scratch"), 0o700);
    }
    expect(existsSync(join(orchestration, "live.scratch/precious.txt"))).toBe(true);
    expect(existsSync(join(orchestration, "done.scratch/file"))).toBe(true);
  });

  // A record written under the id `foo.scratch` sits where `foo`'s scratch would. The
  // input CARRIES both a finished `foo` and that record, so a rule that trusted the name alone removes it.
  it("never takes a directory named like a scratch that is itself a pass record", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "foo", orchestration });
    finishedRecord({ id: "foo.scratch", orchestration });
    const { deps, out } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("from 0 entr(ies)");
    expect(existsSync(join(orchestration, "foo.scratch/artifact.md"))).toBe(true);
    expect(existsSync(join(orchestration, "foo.scratch/record.json"))).toBe(true);
  });

  it("deletes nothing without --apply", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "ggg", orchestration });
    put({ path: join(orchestration, "ggg.scratch/probe/node_modules/x/index.js"), text: "spent" });
    const { deps, out } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root] });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("nothing was deleted");
    expect(existsSync(join(orchestration, "ggg.scratch/probe/node_modules/x/index.js"))).toBe(true);
  });

  it("journals the run and a witness it actually took, so the row is not an assertion about nothing", () => {
    const root = freshHome();
    const orchestration = join(root, "orchestration");
    finishedRecord({ id: "hhh", orchestration });
    put({ path: join(orchestration, "hhh.scratch/review-packet.md"), text: "spent" });
    put({ path: join(orchestration, "iii.scratch/notes.md"), text: "a running pass's notes" });
    put({ path: join(orchestration, "stray.txt"), text: "nobody's" });
    mkdirSync(join(orchestration, "jjj.scratch"), { recursive: true });
    // Read before the apply removes it: the figure is the blocks the file held, never its five logical bytes.
    const spentBlocks = lstatSync(join(orchestration, "hhh.scratch/review-packet.md")).blocks * 512;
    const { deps, diagnostic } = captured();
    runHomeReclaim({ deps, rest: ["--root", "codex-scratch", "--home", root, "--apply"] });

    // The witness LINE is the falsifiable part: it is printed only on an attempted check, and it names how
    // many paths that check covered — four top-level entries kept by name (the record, two running scratches,
    // one EMPTY, and the stray file) plus the record's two files and the running pass's one, the stray file
    // counted once — so a witness that checked nothing, stopped walking the records or skipped the empty
    // workspace reddens here.
    expect(diagnostic.join("\n")).toContain("home reclaim: checking the witness — 7 kept path(s)");
    expect(existsSync(join(orchestration, "stray.txt"))).toBe(true);
    expect(existsSync(join(orchestration, "iii.scratch/notes.md"))).toBe(true);
    expect(existsSync(join(orchestration, "jjj.scratch"))).toBe(true);
    const rows = readReclaimLedger({ path: reclaimLedgerPath({ home: root }) });
    expect(rows.isOk()).toBe(true);
    const row = rows._unsafeUnwrap()[0]!;
    expect(row.root).toBe("codex-scratch");
    expect(row.takes).toBe("finished-scratch");
    expect(row.removedEntries).toBe(1);
    expect(spentBlocks).toBeGreaterThan(0);
    expect(row.freedBytes).toBe(spentBlocks);
    expect(row.witnessHeld).toBe(true);
    expect(row.session).toBe("a test");
    expect(row.atIso).toBe("2026-09-22T00:00:00.000Z");
  });
});

describe("home reclaim's allowlist", () => {
  it("refuses a root it does not declare, rather than skipping it quietly", () => {
    const root = freshHome();
    const { deps, diagnostic } = captured();
    const code = runHomeReclaim({ deps, rest: ["--root", "exec-store", "--home", root] });

    expect(code).toBe(2);
    expect(diagnostic.join("\n")).toContain('no reclaim root is declared as "exec-store"');
    expect(diagnostic.join("\n")).toContain("declared roots are codex-scratch");
  });

  // The regression the finding names: this root was once declared, and one pass took
  // handoff-<n>/shell.txt and autonomy-qualified.jsonl out of the LIVE supervisor chair as byte-identical
  // copies. The fixture carries exactly that shape, so the assertion is falsifiable in both directions:
  // the files it calls surviving are the ones the old rule chose between.
  it("cannot reach supervisor-scratch at all, and leaves two same-byte chair files standing", () => {
    const root = freshHome();
    const scratch = join(root, "supervisor-scratch");
    put({ path: join(scratch, "handoff-9290/autonomy-raw-188.jsonl"), text: "an unchanged reading" });
    put({ path: join(scratch, "handoff-9291/autonomy-qualified.jsonl"), text: "an unchanged reading" });
    put({ path: join(scratch, "handoff-9291/shell.txt"), text: "the page shell" });
    mkdirSync(join(root, "orchestration"), { recursive: true });
    const { deps, diagnostic } = captured();
    const named = runHomeReclaim({ deps, rest: ["--root", "supervisor-scratch", "--home", root, "--apply"] });

    expect(named).toBe(2);
    expect(diagnostic.join("\n")).toContain('no reclaim root is declared as "supervisor-scratch"');

    const everyRoot = runHomeReclaim({ deps, rest: ["--home", root, "--apply"] });
    expect(everyRoot).toBe(0);
    expect(existsSync(join(scratch, "handoff-9290/autonomy-raw-188.jsonl"))).toBe(true);
    expect(existsSync(join(scratch, "handoff-9291/autonomy-qualified.jsonl"))).toBe(true);
    expect(existsSync(join(scratch, "handoff-9291/shell.txt"))).toBe(true);
  });

  it("cannot reach a home directory no root declares", () => {
    const root = freshHome();
    put({ path: join(root, "exec-store", "a.bin"), text: "same" });
    put({ path: join(root, "exec-store", "b.bin"), text: "same" });
    mkdirSync(join(root, "orchestration"), { recursive: true });
    const { deps } = captured();
    const code = runHomeReclaim({ deps, rest: ["--home", root, "--apply"] });

    expect(code).toBe(0);
    expect(existsSync(join(root, "exec-store", "a.bin"))).toBe(true);
    expect(existsSync(join(root, "exec-store", "b.bin"))).toBe(true);
  });
});
