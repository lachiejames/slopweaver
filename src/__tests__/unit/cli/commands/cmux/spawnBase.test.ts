/**
 * {@link spawnBaseVerdict} over a typed table of git answers — the advisory a spawn prints, and the refusal
 * `--require-current-base` turns it into, without a real repository.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutInspectDeps } from "../../../../../checkouts/inspect.js";
import { spawnBaseVerdict } from "../../../../../cli/commands/cmux/spawnBase.js";
import type { SpawnPlan } from "../../../../../cmux/plan.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

const PLAN: SpawnPlan = {
  baseBranch: undefined,
  branch: "a-branch",
  cwd: "/tmp/repo",
  driver: "claude",
  host: "claude-code",
  model: undefined,
  pickupCommand: "/slopweaver:pickup a-doc — a pickup line long enough to clear the corroboration floor",
  repoRoot: "/tmp/repo",
  respondingToHandle: undefined,
  sessionName: undefined,
  slug: "a-doc",
  spawnedAt: "2026-08-17T00:00:00.000Z",
  template: "code",
  workspaceName: "a-doc",
  workspaceTitle: "a-doc",
  worktreeExists: true,
};

const DOC_TEXT = "---\nslug: a-doc\nstatus: ready\n---\n\n# A doc\n\nChange `src/cmux/plan.ts` and nothing else.\n";
const DOC = parseHandoverDoc({ path: "/tmp/repo/a-doc.md", text: DOC_TEXT });

/** Every mtime the inspection reads, all at one instant, so the install and fetch lines are stable. */
const NOW_MS = 1_800_000_000_000;
const STAMP_MS = NOW_MS - 60_000;

/** A git read seam answering from a table keyed by the call's first two arguments; a missing key fails. */
function tableDeps({ answers }: { answers: Readonly<Record<string, string>> }): CheckoutInspectDeps {
  return {
    git: ({ args }) => answers[args.slice(0, 2).join(" ")],
    mtimeMs: () => STAMP_MS,
  };
}

/** The answers of a checkout on `main` tracking `origin/main`, `behind` commits behind it, whose upstream changed `changed`. */
function checkoutAnswers({ behind, changed }: { behind: number; changed: string }): Record<string, string> {
  return {
    "branch --show-current": "main",
    "diff --name-only": changed,
    "fetch --quiet": "",
    "rev-list --left-right": `${String(behind)}\t0`,
    "rev-parse --absolute-git-dir": "/tmp/repo/.git",
    "rev-parse --abbrev-ref": "origin/main",
    "status --porcelain": "",
  };
}

const CURRENT_REPORT = [
  "/tmp/repo [main]",
  "  upstream origin/main: current",
  "  last fetch: 1 min ago",
  "  node_modules: matches the lockfile (by install mtime, or a recorded verified install)",
];

const BEHIND_REPORT = [
  "/tmp/repo [main]",
  "  upstream origin/main: 3 BEHIND — run `slopweaver checkout sync`",
  "  last fetch: 1 min ago",
  "  node_modules: matches the lockfile (by install mtime, or a recorded verified install)",
];

const OVERLAP_HEAD = [
  "base: main is 3 commit(s) behind origin/main",
  "  and it changed 1 path(s) this doc names:",
  "    src/cmux/plan.ts",
];

const FORK_NOTE =
  "  (a NEW worktree forks from the freshly-fetched remote, so this drift affects what the doc's probes and a " +
  "bare `slopweaver` read — not the branch about to be cut)";

describe("spawnBaseVerdict", () => {
  it("reports a current base with the checkout report and the current line and no refusal, even when a current base is required", () => {
    const verdict = spawnBaseVerdict({
      deps: tableDeps({ answers: checkoutAnswers({ behind: 0, changed: "" }) }),
      doc: DOC,
      docText: DOC_TEXT,
      nowMs: NOW_MS,
      plan: PLAN,
      requireCurrentBase: true,
    });

    expect(verdict).toEqual({
      lines: [...CURRENT_REPORT, "base: main is current with origin/main"],
      refusal: undefined,
    });
  });

  it("advises on a behind base whose upstream changed a doc-named path, offering --require-current-base, with the fork note for a new worktree and no refusal", () => {
    const verdict = spawnBaseVerdict({
      deps: tableDeps({ answers: checkoutAnswers({ behind: 3, changed: "src/cmux/plan.ts\nREADME.md" }) }),
      doc: DOC,
      docText: DOC_TEXT,
      nowMs: NOW_MS,
      plan: { ...PLAN, worktreeExists: false },
      requireCurrentBase: false,
    });

    expect(verdict).toEqual({
      lines: [
        ...BEHIND_REPORT,
        ...OVERLAP_HEAD,
        '  this is the "your change depends on the latest base" case — pull the main checkout first, or pass --require-current-base to make this a refusal',
        FORK_NOTE,
      ],
      refusal: undefined,
    });
  });

  it("turns the same behind base into a refusal with its exact text under --require-current-base, drops the line offering the flag and keeps the behind report, overlap and fork note", () => {
    const verdict = spawnBaseVerdict({
      deps: tableDeps({ answers: checkoutAnswers({ behind: 3, changed: "src/cmux/plan.ts\nREADME.md" }) }),
      doc: DOC,
      docText: DOC_TEXT,
      nowMs: NOW_MS,
      plan: { ...PLAN, worktreeExists: false },
      requireCurrentBase: true,
    });

    expect(verdict).toEqual({
      lines: [
        ...BEHIND_REPORT,
        ...OVERLAP_HEAD,
        '  this is the "your change depends on the latest base" case — pull the main checkout first',
        FORK_NOTE,
      ],
      refusal:
        "--require-current-base was passed and the base is 3 commit(s) behind (including 1 path(s) this doc names) — pull the main checkout, then retry",
    });
  });

  it("leaves the fork note off when the worktree already exists, and calls drift outside the doc's paths harmless with no refusal", () => {
    const verdict = spawnBaseVerdict({
      deps: tableDeps({ answers: checkoutAnswers({ behind: 3, changed: "README.md" }) }),
      doc: DOC,
      docText: DOC_TEXT,
      nowMs: NOW_MS,
      plan: PLAN,
      requireCurrentBase: false,
    });

    expect(verdict).toEqual({
      lines: [
        ...BEHIND_REPORT,
        "base: main is 3 commit(s) behind origin/main",
        "  none of the 1 path(s) this doc names changed upstream — drift looks harmless, forking anyway",
      ],
      refusal: undefined,
    });
  });

  it("names a detached HEAD as such in the base line, since there is no branch to name", () => {
    const answers = { ...checkoutAnswers({ behind: 3, changed: "README.md" }), "branch --show-current": "" };

    const verdict = spawnBaseVerdict({
      deps: tableDeps({ answers }),
      doc: DOC,
      docText: DOC_TEXT,
      nowMs: NOW_MS,
      plan: PLAN,
      requireCurrentBase: false,
    });

    expect(verdict.lines.slice(-2)).toEqual([
      "base: detached HEAD is 3 commit(s) behind origin/main",
      "  none of the 1 path(s) this doc names changed upstream — drift looks harmless, forking anyway",
    ]);
    expect(verdict.refusal).toBe(undefined);
  });

  it("prints the unmeasurable upstream line and the unmeasured base line and invents no refusal when the drift count could not be taken", () => {
    const answers = checkoutAnswers({ behind: 3, changed: "src/cmux/plan.ts" });
    delete answers["rev-list --left-right"];

    const verdict = spawnBaseVerdict({
      deps: tableDeps({ answers }),
      doc: DOC,
      docText: DOC_TEXT,
      nowMs: NOW_MS,
      plan: PLAN,
      requireCurrentBase: true,
    });

    expect(verdict).toEqual({
      lines: [
        "/tmp/repo [main]",
        "  upstream origin/main: UNMEASURABLE — the comparison did not produce a count",
        "  last fetch: 1 min ago",
        "  node_modules: matches the lockfile (by install mtime, or a recorded verified install)",
        "base: could not measure whether /tmp/repo is current with its upstream",
      ],
      refusal: undefined,
    });
  });
});
