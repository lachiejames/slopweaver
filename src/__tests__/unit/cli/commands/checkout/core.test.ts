/**
 * The `checkout` noun's parser, usage lines and target selection — plus one end-to-end dry-run sync over a
 * fake git seam, so both loader targets the manifest names are imported and exercised.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutInspectDeps } from "../../../../../checkouts/inspect.js";
import {
  checkoutUsage,
  parseCheckoutArgs,
  selectCheckouts,
  stringFlag,
} from "../../../../../cli/commands/checkout/core.js";
import {
  checkoutStatusCommand,
  declaredCheckouts,
  NOTHING_DECLARED,
} from "../../../../../cli/commands/checkout/statusRun.js";
import {
  checkoutSyncCommand,
  consoleRefreshLine,
  syncOneCheckout,
} from "../../../../../cli/commands/checkout/syncRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("checkoutUsage", () => {
  it("renders status's real flags, value-taking ones with a placeholder", () => {
    expect(checkoutUsage({ verb: "status" })).toBe(
      "usage: slopweaver checkout status [--fetch] [--home <value>] [--json] [--path <value>]",
    );
  });

  it("renders sync's real flags", () => {
    expect(checkoutUsage({ verb: "sync" })).toBe(
      "usage: slopweaver checkout sync [--dry-run] [--home <value>] [--path <value>]",
    );
  });

  it("names no flag for a verb with no spec, since it declares none", () => {
    expect(checkoutUsage({ verb: "no-such-verb" })).toBe("usage: slopweaver checkout no-such-verb");
  });
});

describe("parseCheckoutArgs", () => {
  it("accepts status's switches", () => {
    const parsed = unwrap(parseCheckoutArgs({ rest: ["--fetch", "--json"], verb: "status" }));
    expect(parsed.values["fetch"]).toBe(true);
    expect(parsed.values["json"]).toBe(true);
  });

  it("accepts a --path value", () => {
    const parsed = unwrap(parseCheckoutArgs({ rest: ["--path", "/repo"], verb: "status" }));
    expect(stringFlag({ name: "path", parsed })).toBe("/repo");
  });

  it("rejects an unknown flag", () => {
    const parsed = parseCheckoutArgs({ rest: ["--nope"], verb: "status" });
    expect(unwrapErr(parsed)).toEqual(["unknown flag: --nope"]);
  });

  it("rejects status's --fetch on sync, which does not accept it", () => {
    expect(unwrapErr(parseCheckoutArgs({ rest: ["--fetch"], verb: "sync" }))).toEqual(["unknown flag: --fetch"]);
  });

  it("accepts sync's --dry-run", () => {
    expect(unwrap(parseCheckoutArgs({ rest: ["--dry-run"], verb: "sync" })).values["dry-run"]).toBe(true);
  });

  it("refuses every flag on a verb with no spec, which accepts none", () => {
    expect(unwrapErr(parseCheckoutArgs({ rest: ["--json"], verb: "no-such-verb" }))).toEqual(["unknown flag: --json"]);
  });
});

describe("selectCheckouts", () => {
  const configs = [{ path: "/one" }, { path: "/two" }];

  it("keeps every checkout when no --path was given", () => {
    expect(selectCheckouts({ configs, path: undefined })).toEqual(configs);
  });

  it("narrows to the one --path names", () => {
    expect(selectCheckouts({ configs, path: "/two" })).toEqual([{ path: "/two" }]);
  });

  it("selects NOTHING for an unmatched --path, rather than falling back to all of them", () => {
    expect(selectCheckouts({ configs, path: "/three" })).toEqual([]);
  });
});

describe("declaredCheckouts", () => {
  it("reports none for a state home with no profile at all", () => {
    expect(declaredCheckouts({ home: "/nonexistent-slopweaver-home" })).toEqual([]);
  });
});

describe("the nothing-declared line", () => {
  it("tells the operator where to declare a checkout rather than reporting a clean bill", () => {
    expect(NOTHING_DECLARED).toContain("mainCheckouts");
    expect(NOTHING_DECLARED).toContain("docs/main-checkouts.md");
  });
});

/** A fake git answering from a table, keyed by the first two argv entries; absent means the call failed. */
const deps = ({ table }: { table: Readonly<Record<string, string>> }): CheckoutInspectDeps => ({
  git: ({ args }) => table[args.slice(0, 2).join(" ")],
  mtimeMs: ({ path }) =>
    ({ "/repo/node_modules/.yarn-state.yml": 300, "/repo/package.json": 100, "/repo/yarn.lock": 200 })[path],
});

const SYNCABLE: Readonly<Record<string, string>> = {
  "branch --show-current": "main",
  "fetch --quiet": "",
  "rev-list --left-right": "3\t0",
  "rev-parse --abbrev-ref": "origin/main",
  "rev-parse --absolute-git-dir": "/repo/.git",
  "status --porcelain": "",
};

describe("syncOneCheckout", () => {
  it("reports what a dry run WOULD do without claiming it did it", () => {
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: deps({ table: SYNCABLE }),
      dryRun: true,
      nowMs: 0,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.lines[0]).toBe("/repo: WOULD fast-forward 3 commit(s) onto origin/main");
  });

  it("says the install was skipped and why, when nothing required it", () => {
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: deps({ table: SYNCABLE }),
      dryRun: true,
      nowMs: 0,
    });
    expect(outcome.lines[1]).toBe(
      "  install: skipped — the pull touched no dependency file and node_modules already matched the lockfile",
    );
  });

  it("reads what a dry run WOULD pull in, so its install decision is not made against an empty list", () => {
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: deps({ table: { ...SYNCABLE, "diff --name-only": "yarn.lock" } }),
      dryRun: true,
      nowMs: 0,
    });
    expect(outcome.lines[1]).toBe("  install: WOULD run `yarn install --immutable` — the pull changed yarn.lock");
  });

  it("refuses a dirty main checkout before touching anything", () => {
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: deps({ table: { ...SYNCABLE, "status --porcelain": " M a.ts" } }),
      dryRun: true,
      nowMs: 0,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toBe(
      "/repo: REFUSED — /repo: 1 uncommitted change(s) — a main checkout must be clean before it is fast-forwarded",
    );
  });

  it("refuses a checkout that is not a readable git repository", () => {
    const outcome = syncOneCheckout({ config: { path: "/repo" }, deps: deps({ table: {} }), dryRun: true, nowMs: 0 });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toBe("/repo: REFUSED — /repo: /repo is not a readable git checkout");
  });

  it("asks the console to come onto the new HEAD after a real fast-forward, and carries its line", () => {
    const asked: string[] = [];
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: deps({ table: { ...SYNCABLE, "merge --ff-only": "", "rev-parse HEAD": "abc123" } }),
      dryRun: false,
      nowMs: 0,
      refresh: ({ cwd }) => {
        asked.push(cwd);
        return "  console: rebuilding the console onto abc123 in the background";
      },
    });
    expect(asked).toEqual(["/repo"]);
    expect(outcome.lines[2]).toBe("  console: rebuilding the console onto abc123 in the background");
  });

  it("never asks the console during a dry run, and says so", () => {
    const asked: string[] = [];
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: deps({ table: SYNCABLE }),
      dryRun: true,
      nowMs: 0,
      refresh: ({ cwd }) => {
        asked.push(cwd);
        return "unreachable";
      },
    });
    expect(asked).toEqual([]);
    expect(outcome.lines[2]).toBe("  console: not asked — a dry run moves no HEAD for it to rebuild onto");
  });
});

/**
 * A fake git whose answers for a key are SCRIPTED per call, in order, then fall back to the table once the
 * script runs out — and which records every key it was asked, so a test can assert the exact merge sequence.
 * `rev-list --left-right` is read three ways in one sync: the preflight, after each failed merge, and the
 * closing re-measure, so its script lists them in that order.
 */
const scriptedDeps = ({
  table,
  scripted,
  calls,
}: {
  table: Readonly<Record<string, string>>;
  scripted: Readonly<Record<string, readonly (string | undefined)[]>>;
  calls: string[];
}): CheckoutInspectDeps => {
  const served = new Map<string, number>();
  return {
    git: ({ args }) => {
      const key = args.slice(0, 2).join(" ");
      calls.push(key);
      const script = scripted[key];
      const index = served.get(key) === undefined ? 0 : served.get(key)!;
      served.set(key, index + 1);
      if (script !== undefined && index < script.length) {
        return script[index];
      }
      return table[key];
    },
    mtimeMs: deps({ table }).mtimeMs,
  };
};

/** A table a real (non-dry) fast-forward completes against: HEAD moves and the pull touched one source file. */
const FAST_FORWARDABLE: Readonly<Record<string, string>> = {
  ...SYNCABLE,
  "diff --name-only": "src/a.ts",
  "merge --ff-only": "",
};

describe("syncOneCheckout's failed fast-forward, re-measured before it is named", () => {
  /** Run one real sync with the given merge and drift scripts, recording calls, waits and console asks. */
  const run = ({
    merges,
    drifts,
  }: {
    merges: readonly (string | undefined)[];
    drifts: readonly (string | undefined)[];
  }) => {
    const calls: string[] = [];
    const waits: number[] = [];
    const asked: string[] = [];
    const outcome = syncOneCheckout({
      config: { path: "/repo" },
      deps: scriptedDeps({
        calls,
        scripted: { "merge --ff-only": merges, "rev-list --left-right": drifts, "rev-parse HEAD": ["aaa", "bbb"] },
        table: FAST_FORWARDABLE,
      }),
      dryRun: false,
      nowMs: 0,
      refresh: ({ cwd }) => {
        asked.push(cwd);
        return "  console: current";
      },
      wait: ({ ms }) => {
        waits.push(ms);
      },
    });
    return { asked, merges: calls.filter((key) => key === "merge --ff-only").length, outcome, waits };
  };

  it("retries a merge that failed while the branch stayed a clean fast-forward, and lands it", () => {
    const result = run({ drifts: ["3\t0", "3\t0"], merges: [undefined, ""] });
    expect(result.outcome.ok).toBe(true);
    expect(result.outcome.lines[0]).toBe("/repo: fast-forwarded onto origin/main (1 file(s) changed)");
    expect(result.merges).toBe(2);
    expect(result.waits).toEqual([100]);
  });

  it("reports a fast-forward still failing after three attempts as transient — never 'needs a human'", () => {
    const result = run({ drifts: ["3\t0", "3\t0", "3\t0", "3\t0"], merges: [undefined, undefined, undefined] });
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.lines).toEqual([
      "/repo: REFUSED — `git merge --ff-only origin/main` failed 3 time(s) while the branch is still a clean fast-forward of it — another git process may be holding a lock in this checkout; re-run `slopweaver checkout sync`",
    ]);
    expect(result.merges).toBe(3);
    expect(result.waits).toEqual([100, 100]);
    expect(result.asked).toEqual([]);
  });

  it("keeps the human-needed refusal for a branch the re-measure shows both ahead and behind", () => {
    const result = run({ drifts: ["3\t0", "1\t1"], merges: [undefined] });
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.lines).toEqual([
      "/repo: REFUSED — `git merge --ff-only origin/main` refused — the branch has diverged and needs a human",
    ]);
    expect(result.merges).toBe(1);
    expect(result.waits).toEqual([]);
  });

  it("succeeds when the merge failed but HEAD already holds the upstream — another process moved it first", () => {
    const result = run({ drifts: ["3\t0", "0\t0"], merges: [undefined] });
    expect(result.outcome.ok).toBe(true);
    expect(result.outcome.lines[0]).toBe("/repo: fast-forwarded onto origin/main (1 file(s) changed)");
    expect(result.merges).toBe(1);
    expect(result.waits).toEqual([]);
    expect(result.asked).toEqual(["/repo"]);
  });

  it("never calls an ahead-only branch diverged after a failed merge", () => {
    const result = run({ drifts: ["3\t0", "0\t2"], merges: [undefined] });
    expect(result.outcome.ok).toBe(true);
    expect(result.outcome.lines[0]).toBe("/repo: fast-forwarded onto origin/main (1 file(s) changed)");
  });

  it("says whether it diverged is unknown when the re-measure cannot be read", () => {
    const result = run({ drifts: ["3\t0", undefined], merges: [undefined] });
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.lines).toEqual([
      "/repo: REFUSED — `git merge --ff-only origin/main` failed and the branch's drift from it could not be read, so whether it diverged is unknown — re-run `slopweaver checkout sync`",
    ]);
    expect(result.waits).toEqual([]);
  });
});

describe("consoleRefreshLine", () => {
  it("carries the refresh's LAST line as its verdict, without the script's own prefix", () => {
    const printed = "docs-site: something first\ndocs-site: the console already serves 7f5351c45\n";
    expect(consoleRefreshLine({ printed, status: 0 })).toBe("  console: the console already serves 7f5351c45");
  });

  it("marks a non-zero exit as a failure and still carries what it said", () => {
    expect(consoleRefreshLine({ printed: "docs-site: jq: command not found", status: 127 })).toBe(
      "  console: refresh FAILED (exit 127) — jq: command not found",
    );
  });

  it("names a refresh that printed nothing rather than rendering an empty label", () => {
    expect(consoleRefreshLine({ printed: "  \n", status: null })).toBe(
      "  console: the refresh printed nothing and exited null",
    );
  });
});

describe("the manifest's loader targets", () => {
  it("runs status's own --help and exits ok", () => {
    expect(checkoutStatusCommand(["node", "cli", "checkout", "status", "--help"])).toBe(0);
  });

  it("runs sync's own --help and exits ok", () => {
    expect(checkoutSyncCommand(["node", "cli", "checkout", "sync", "--help"])).toBe(0);
  });

  it("refuses an unknown flag on status with the usage exit code", () => {
    expect(checkoutStatusCommand(["node", "cli", "checkout", "status", "--nope"])).toBe(2);
  });
});
