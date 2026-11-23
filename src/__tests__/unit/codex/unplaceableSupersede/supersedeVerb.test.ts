/**
 * Retiring a pass that recorded NO TREE (an owner ruling: a supersede verb, explicit and journalled, the gate
 * fail-closed by default).
 *
 * The shape under test is a measured one: a plan READY with no tree, a later placed p2 READY, and a pull request
 * unable to land without a hatch because nothing could retire the first.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { runCodexSupersedeOver } from "../../../../cli/commands/codex/supersedeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
import { captureTreeFingerprint, resolveRepoRoot } from "../../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../../codex/landingGateRun.js";
import type { SupersessionPort } from "../../../../codex/supersessionPort.js";
import type { CodexArtifactRecord, CodexPassTree } from "../../../../codex/types.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryFallbackRegisterPort } from "../../../fallbackRegisterFixture.js";
import {
  type MemorySupersessionStore,
  memorySupersessionPort,
  memorySupersessionStore,
  unavailableSupersessionPort,
} from "../../../landingRegistersFixture.js";
import { seedTemplate } from "../../../seedTemplate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { HEAD, NO_TREE_AT } from "./harness.js";

/** The real-git budget, hoisted so a `describe` naming it still fits one line. */
const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };

/**
 * The verb over a real checkout, real pass records on disk and the real register.
 *
 * The first case is the second defect this change fixes: `codex supersede` used to fail closed on the no-tree
 * count BEFORE judging its target, so one no-tree record in a checkout made every retirement impossible —
 * including the one that clears it.
 */
describe("codex supersede beside a no-tree record", REAL_GIT, () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway directory this block owns. */
  function scratch({ label }: { label: string }): string {
    const dir = mkdtempSync(join(tmpdir(), `sw-unplace-${label}-`));
    dirs.push(dir);
    return dir;
  }

  /**
   * The seeded repository every case copies, committed ONCE per block and never written: its `init`, config,
   * remote, `add` and `commit` were a third of this block's git spawns. A copy carries the index's stale stat
   * data, which git content-checks rather than trusts, so a copy fingerprints exactly as the seed did.
   */
  let template: string | undefined;
  afterAll(() => {
    if (template !== undefined) {
      rmSync(template, { force: true, recursive: true });
    }
  });

  /** The seeded template, built by whichever case asks first. */
  function templateRepo(): string {
    if (template !== undefined) {
      return template;
    }
    template = seedTemplate({ prefix: "sw-unplace-template-", seed: seedRepo });
    return template;
  }

  /** A one-commit repository on `feature` with an `origin`, which the landing read resolves first. */
  function scratchRepo(): string {
    const source = templateRepo();
    const dir = scratch({ label: "repo" });
    cpSync(source, dir, { recursive: true });
    return dir;
  }

  /** Build the repository {@link scratchRepo} describes at `dir`, with real git. */
  function seedRepo({ dir }: { dir: string }): void {
    const steps: readonly (readonly string[])[] = [
      ["init", "--initial-branch=feature"],
      ["config", "user.email", "dev@example.invalid"],
      ["config", "user.name", "Dev"],
      ["remote", "add", "origin", "git@github.com:acme/widget.git"],
    ];
    for (const args of steps) {
      gitInTemp({ args, cwd: dir });
    }
    writeFileSync(join(dir, "a.txt"), "one\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-m", "first"], cwd: dir });
  }

  /** Write one FINISHED pass where `scanPassRecords` reads it: the artifact is what marks a run finished. */
  function writeRecord({ home, record }: { home: string; record: CodexArtifactRecord }): void {
    const runDir = join(stateHomePaths({ home }).orchestration, record.artifactId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "record.json"), JSON.stringify(record));
    writeFileSync(join(runDir, "artifact.md"), "# artifact\n");
  }

  /** A pass record in `repoRoot`: a plan or an r1 review, with the captured tree or none. */
  function passRecord({
    artifactId,
    createdAtIso,
    mode,
    repoRoot,
    tree,
    verdict,
  }: {
    artifactId: string;
    createdAtIso: string;
    mode: "plan" | "review";
    repoRoot: string;
    tree: CodexPassTree | undefined;
    verdict: "READY" | "CLEAN" | "BROKEN";
  }): CodexArtifactRecord {
    const shared = {
      artifactId,
      attempts: [],
      bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
      createdAtIso,
      observedElapsedMs: 10,
      repoRoot,
      requestedApprovalPolicy: "never",
      requestedModel: "m",
      requestedNetworkAccess: true,
      requestedReasoningEffort: "xhigh",
      requestedSandboxMode: "workspace-write",
      requestedWebSearch: true,
      requestedWritableRoots: [],
      schemaVersion: 1,
      ...(tree === undefined ? {} : { tree }),
    } as const;
    if (mode === "plan") {
      return {
        ...shared,
        outcome: {
          answer: { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" },
          kind: "answered",
          rawFinalResponse: "{}",
        },
        scope: { mode: "plan", pass: "p2", promptBytes: 1, promptSha256: "abc" },
      };
    }
    return {
      ...shared,
      outcome: {
        answer: {
          counterexample: "",
          evidence: "",
          propertyId: "r1-01",
          summary: "s",
          verdict: verdict === "BROKEN" ? "BROKEN" : "CLEAN",
        },
        kind: "answered",
        rawFinalResponse: "{}",
      },
      scope: {
        baseRef: "origin/main",
        baseSha: "b".repeat(40),
        diffBytes: 10,
        diffSha256: "d".repeat(64),
        headSha: HEAD,
        mode: "review",
        pass: "r1",
        property: { id: "r1-01", statement: "a falsifiable claim" },
      },
    };
  }

  /**
   * A checkout, a home, the tree the checkout stands on, a no-tree plan recorded in it, and an empty
   * supersession register.
   */
  function setup(): {
    dir: string;
    home: string;
    repoRoot: string;
    tree: CodexPassTree;
    headSha: string;
    store: MemorySupersessionStore;
    supersessions: SupersessionPort;
  } {
    const dir = scratchRepo();
    const home = scratch({ label: "home" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const repoRoot = unwrap(resolveRepoRoot({ cwd: dir }));
    const now = unwrap(captureTreeFingerprint({ cwd: dir }));
    const tree: CodexPassTree = {
      branch: "feature",
      dirtyBytes: now.dirtyBytes,
      fingerprint: now.digest,
      headSha: now.headSha,
      treeSha: now.treeSha,
    };
    writeRecord({
      home,
      record: passRecord({
        artifactId: "b44980e5",
        createdAtIso: NO_TREE_AT,
        mode: "plan",
        repoRoot,
        tree: undefined,
        verdict: "READY",
      }),
    });
    const store = memorySupersessionStore();
    return {
      dir,
      headSha: now.headSha,
      home,
      repoRoot,
      store,
      supersessions: memorySupersessionPort({ store }),
      tree,
    };
  }

  /** The verb, invoked exactly as the dispatcher does, over the test's own supersession register. */
  function supersede({
    artifactId,
    dir,
    home,
    supersessions,
  }: {
    artifactId: string;
    dir: string;
    home: string;
    supersessions: SupersessionPort;
  }): Promise<number> {
    return runCodexSupersedeOver({
      argv: [
        "node",
        "slopweaver",
        "codex",
        "supersede",
        "--artifact",
        artifactId,
        "--reason",
        "re-run on a captured tree",
        "--home",
        home,
        "--repo",
        dir,
      ],
      fallbackPort: memoryFallbackRegisterPort(),
      supersessions,
    });
  }

  it("still retires a wording in a checkout holding a no-tree record", async () => {
    const { dir, home, repoRoot, store, supersessions, tree } = setup();
    const at = { mode: "review", repoRoot, tree } as const;
    writeRecord({
      home,
      record: passRecord({
        ...at,
        artifactId: "broken-1",
        createdAtIso: "2026-09-27T16:00:00.000Z",
        verdict: "BROKEN",
      }),
    });
    writeRecord({
      home,
      record: passRecord({ ...at, artifactId: "clean-1", createdAtIso: "2026-09-27T16:10:00.000Z", verdict: "CLEAN" }),
    });

    expect(await supersede({ artifactId: "broken-1", dir, home, supersessions })).toBe(EXIT_OK);
    expect(store.rows.get("broken-1")!.replacedBy).toBe("clean-1");
  });

  it("refuses the no-tree record while nothing later captured a tree, and the landing read stays unreadable", async () => {
    const { dir, headSha, home, store, supersessions } = setup();

    expect(await supersede({ artifactId: "b44980e5", dir, home, supersessions })).toBe(EXIT_ERROR);
    expect(store.rows.size).toBe(0);
    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { baseSha: undefined, branch: "feature", headSha, repository: "acme/widget" },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions,
    });
    expect(read.kind).toBe("unreadable");
  });

  it("refuses to retire anything while the register cannot be read, so nothing is written past an outage", async () => {
    const { dir, home } = setup();
    expect(await supersede({ artifactId: "b44980e5", dir, home, supersessions: unavailableSupersessionPort() })).toBe(
      EXIT_ERROR,
    );
  });

  it("retires it beside a later placed plan, and the landing floor stops failing closed on it", async () => {
    const { dir, headSha, home, repoRoot, supersessions, tree } = setup();
    writeRecord({
      home,
      record: passRecord({
        artifactId: "224c5d1c",
        createdAtIso: "2026-09-27T15:48:34.269Z",
        mode: "plan",
        repoRoot,
        tree,
        verdict: "READY",
      }),
    });

    expect(await supersede({ artifactId: "b44980e5", dir, home, supersessions })).toBe(EXIT_OK);
    const row = unwrap(await supersessions.read({ home })).get("b44980e5")!;
    expect(row).toEqual({
      artifactId: "b44980e5",
      atIso: row.atIso,
      branch: "feature",
      kind: "no-tree",
      mode: "plan",
      pass: "p2",
      reason: "re-run on a captured tree",
      replacedBy: "224c5d1c",
    });
    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { baseSha: undefined, branch: "feature", headSha, repository: "acme/widget" },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions,
    });
    expect(read.kind).toBe("read");
  });

  it("fails the landing read closed when the register cannot be read, rather than counting nothing retired", async () => {
    const { dir, headSha, home } = setup();
    const supersessions = unavailableSupersessionPort();
    const outage = unwrapErr(await supersessions.read({ home }));
    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { baseSha: undefined, branch: "feature", headSha, repository: "acme/widget" },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions,
    });
    expect(read).toEqual({ kind: "unreadable", reason: `could not read the supersession register: ${outage.message}` });
  });
});
