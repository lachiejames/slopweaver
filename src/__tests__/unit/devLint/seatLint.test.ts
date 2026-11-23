import { describe, expect, it } from "vitest";
import { type LintCheck, lintChecks } from "../../../devLint/devLint.js";
import {
  ageLabel,
  fetchHeadNamesOriginMain,
  isSeatCheck,
  oxlintChangedFiles,
  projectSeatChecks,
  reflogFetchAtMs,
  SEAT_FETCH_MAX_AGE_MS,
  type SeatLintContext,
  SeatPreparationErrors,
  seatContextLines,
  seatFetchVerdict,
  seatOxlintWithheld,
  seatUncovered,
} from "../../../devLint/seatLint.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BASE = "b".repeat(40);
const ORIGIN_MAIN = "c".repeat(40);

const SEAT: SeatLintContext = {
  baseSha: BASE,
  changedOxlintFiles: ["src/a.ts", "src/b.tsx"],
  fetch: { ageMs: 90_000, source: "origin/main reflog" },
};

describe("ageLabel", () => {
  it("reads seconds under a minute, minutes under two hours, and hours past that", () => {
    expect(
      [0, 40_000, 60_000, 15 * 60_000, 119 * 60_000, 2 * 60 * 60_000, 26 * 60 * 60_000].map((ms) => ageLabel({ ms })),
    ).toEqual(["0s", "40s", "1 min", "15 min", "119 min", "2 h", "26 h"]);
  });
});

describe("seatFetchVerdict", () => {
  it("trusts a fetch exactly at the bound", () => {
    expect(
      unwrap(seatFetchVerdict({ fetchedAtMs: 0, maxAgeMs: SEAT_FETCH_MAX_AGE_MS, nowMs: SEAT_FETCH_MAX_AGE_MS })),
    ).toEqual({
      ageMs: SEAT_FETCH_MAX_AGE_MS,
    });
  });

  it("refuses a fetch one millisecond past the bound, naming its age and the fetch to run", () => {
    const refusal = unwrapErr(
      seatFetchVerdict({ fetchedAtMs: 0, maxAgeMs: SEAT_FETCH_MAX_AGE_MS, nowMs: SEAT_FETCH_MAX_AGE_MS + 1 }),
    );
    expect(refusal).toEqual({
      ageMs: SEAT_FETCH_MAX_AGE_MS + 1,
      code: "FETCH_STALE",
      message:
        "dev lint --lane seat: origin/main was last fetched 15 min ago, past the 15 min bound, so its merge-base " +
        "may not be main's tip — run `git fetch origin main`, then re-run `slopweaver dev lint --lane seat`",
    });
  });

  it("reads a fetch time in the future, a skewed clock, as age zero", () => {
    expect(unwrap(seatFetchVerdict({ fetchedAtMs: 5_000, maxAgeMs: SEAT_FETCH_MAX_AGE_MS, nowMs: 1_000 }))).toEqual({
      ageMs: 0,
    });
  });
});

describe("fetchHeadNamesOriginMain", () => {
  it("accepts a `git fetch origin main` line at origin/main's commit", () => {
    const text = `${ORIGIN_MAIN}\t\tbranch 'main' of github.com:acme/example\n`;
    expect(fetchHeadNamesOriginMain({ originMain: ORIGIN_MAIN, text })).toBe(true);
  });

  it("accepts a whole-remote fetch's not-for-merge main line", () => {
    const text = `${"d".repeat(40)}\t\tbranch 'feature' of github.com:acme/example\n${ORIGIN_MAIN}\tnot-for-merge\tbranch 'main' of github.com:acme/example\n`;
    expect(fetchHeadNamesOriginMain({ originMain: ORIGIN_MAIN, text })).toBe(true);
  });

  it("refuses a FETCH_HEAD from a fetch of another branch, which would make a stale main look fresh", () => {
    const text = `${ORIGIN_MAIN}\t\tbranch 'feature' of github.com:acme/example\n`;
    expect(fetchHeadNamesOriginMain({ originMain: ORIGIN_MAIN, text })).toBe(false);
  });

  it("refuses a main line at a different commit than origin/main now names", () => {
    const text = `${"d".repeat(40)}\t\tbranch 'main' of github.com:acme/example\n`;
    expect(fetchHeadNamesOriginMain({ originMain: ORIGIN_MAIN, text })).toBe(false);
  });

  it("refuses an empty FETCH_HEAD", () => {
    expect(fetchHeadNamesOriginMain({ originMain: ORIGIN_MAIN, text: "" })).toBe(false);
  });
});

describe("reflogFetchAtMs", () => {
  const OLD = "a".repeat(40);
  const entry = ({ to, message }: { to: string; message: string }): string =>
    `${OLD} ${to} Acme Dev <dev@example.com> 1763600000 +1100\t${message}`;

  it("reads a fetch entry moving origin/main to its commit at the entry's own time", () => {
    const text = `${entry({ message: "fetch origin main: fast-forward", to: ORIGIN_MAIN })}\n`;
    expect(reflogFetchAtMs({ originMain: ORIGIN_MAIN, text })).toBe(1_763_600_000_000);
  });

  it("reads a pull's fetch entry", () => {
    const text = entry({ message: "pull: fast-forward", to: ORIGIN_MAIN });
    expect(reflogFetchAtMs({ originMain: ORIGIN_MAIN, text })).toBe(1_763_600_000_000);
  });

  it("refuses a hand `update-ref` as the last entry, even after an older fetch", () => {
    const text = [
      entry({ message: "fetch: fast-forward", to: ORIGIN_MAIN }),
      entry({ message: "", to: ORIGIN_MAIN }),
    ].join("\n");
    expect(reflogFetchAtMs({ originMain: ORIGIN_MAIN, text })).toBe(undefined);
  });

  it("refuses a fetch entry to a commit origin/main no longer names", () => {
    const text = entry({ message: "fetch: forced-update", to: "d".repeat(40) });
    expect(reflogFetchAtMs({ originMain: ORIGIN_MAIN, text })).toBe(undefined);
  });

  it("refuses an empty reflog", () => {
    expect(reflogFetchAtMs({ originMain: ORIGIN_MAIN, text: "" })).toBe(undefined);
  });
});

describe("oxlintChangedFiles", () => {
  it("unions the three sources, drops deleted paths and types oxlint does not lint, and sorts", () => {
    expect(
      oxlintChangedFiles({
        committed: ["src/z.ts", "src/gone.ts", "docs/a.md"],
        existing: new Set(["src/z.ts", "docs/a.md", "src/a.mts", "site/p.tsx", "src/z.ts"]),
        untracked: ["site/p.tsx"],
        working: ["src/a.mts", "src/z.ts"],
      }),
    ).toEqual(["site/p.tsx", "src/a.mts", "src/z.ts"]);
  });

  it("answers no files for a branch that changed nothing", () => {
    expect(oxlintChangedFiles({ committed: [], existing: new Set(), untracked: [], working: [] })).toEqual([]);
  });
});

describe("isSeatCheck", () => {
  const row = (over: Partial<LintCheck>): LintCheck => ({ args: [], cmd: "/bin/x", name: "x", ...over });

  it("keeps an ordinary gate, oxlint and internal-exports, and leaves out every other whole-project one", () => {
    expect(
      [
        row({ name: "host-wording" }),
        row({ exclusive: true, name: "oxlint" }),
        row({ exclusive: true, name: "named-object-params" }),
        row({ name: "knip" }),
        row({ name: "prettier" }),
        row({ name: "internal-exports" }),
      ].map((check) => isSeatCheck({ check })),
    ).toEqual([true, true, false, false, false, true]);
  });
});

describe("projectSeatChecks", () => {
  it("never hands oxlint a bare tail, which would lint the whole tree", () => {
    const oxlint: LintCheck = { args: ["--deny-warnings", "."], cmd: "/bin/oxlint", exclusive: true, name: "oxlint" };
    expect(projectSeatChecks({ checks: [oxlint], seat: SEAT })).toEqual([
      {
        args: ["--deny-warnings", "--no-error-on-unmatched-pattern", "--", "src/a.ts", "src/b.tsx"],
        cmd: "/bin/oxlint",
        env: { SLOPWEAVER_COVERAGE_BASE_SHA: BASE },
        name: "oxlint",
        runsLast: true,
      },
    ]);
  });

  // MEASURED past the 3,072 MiB slot even narrowed (its row comment), so it must not join the pool, and it runs
  // last so the lane can withhold it on the machine's state at that moment.
  it("moves the REAL oxlint row from exclusive-first to runs-last, keeping its GOMAXPROCS cap", () => {
    const real = lintChecks({ cwd: "/repo" }).find((check) => check.name === "oxlint")!;
    const projected = projectSeatChecks({ checks: [real], seat: SEAT })[0]!;
    expect([projected.exclusive, projected.runsLast]).toEqual([undefined, true]);
    expect(projected.env).toEqual({ GOMAXPROCS: "4", SLOPWEAVER_COVERAGE_BASE_SHA: BASE });
  });

  it("projects the REAL oxlint row to its type-aware flags plus the changed files", () => {
    const real = lintChecks({ cwd: "/repo" }).find((check) => check.name === "oxlint")!;
    expect(projectSeatChecks({ checks: [real], seat: SEAT })[0]!.args).toEqual([
      "--type-aware",
      "--tsconfig",
      "./config/typescript/tsconfig.lint.json",
      "--deny-warnings",
      "--no-error-on-unmatched-pattern",
      "--",
      "src/a.ts",
      "src/b.tsx",
    ]);
  });
});

describe("seatOxlintWithheld", () => {
  it("lets oxlint run when no lap holds the machine", () => {
    expect(seatOxlintWithheld({ holder: undefined })).toBe(undefined);
  });

  it("withholds it while a lap holds the machine, naming the lap and the command to re-run", () => {
    expect(seatOxlintWithheld({ holder: { phase: "running", pid: 4242, subject: "acme/widgets#116" } })).toBe(
      "a lap holds this machine (pid 4242, running, acme/widgets#116), and its own oxlint beside this one would " +
        "exhaust memory — re-run `slopweaver dev lint --lane seat --only oxlint` once the lap ends",
    );
  });
});

describe("seatUncovered", () => {
  it("names the REAL plan's whole-project gates, then the two no gate is", () => {
    expect(seatUncovered({ checks: lintChecks({ cwd: "/repo" }) })).toEqual([
      "prettier",
      "knip",
      "named-object-params",
      "whole-tree oxlint",
      "typecheck",
    ]);
  });
});

describe("seatContextLines", () => {
  it("prints the full base, the fetch age and its source, and the oxlint scope", () => {
    expect(seatContextLines({ seat: SEAT })).toEqual([
      `dev lint --lane seat: base ${BASE} (merge-base of HEAD and origin/main)`,
      "dev lint --lane seat: origin/main last fetched 1 min ago (origin/main reflog)",
      "changed-file oxlint: 2 eligible file(s)",
    ]);
  });

  it("says oxlint does not run when no file is eligible", () => {
    expect(seatContextLines({ seat: { ...SEAT, changedOxlintFiles: [] } })[2]).toBe(
      "changed-file oxlint: 0 eligible file(s) — not run",
    );
  });
});

describe("SeatPreparationErrors", () => {
  it("names the fetch to run when the fetch time cannot be proven", () => {
    expect(SeatPreparationErrors.fetchAgeUnreadable({ originMain: ORIGIN_MAIN }).message).toBe(
      `dev lint --lane seat: cannot tell when origin/main was last fetched — no FETCH_HEAD names its ${ORIGIN_MAIN} ` +
        "and no reflog entry records a fetch to it — run `git fetch origin main`, then re-run `slopweaver dev lint --lane seat`",
    );
  });
});
