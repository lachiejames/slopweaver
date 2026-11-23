/**
 * `slopweaver autonomy qualify` over injected seams: its argv contract, its report and its refusal.
 */
import { describe, expect, it } from "vitest";

import { AutonomyErrors } from "../../../../../autonomy/errors.js";
import type { AutonomyQualification } from "../../../../../autonomy/reviseStore.js";
import { QUALIFY_USAGE } from "../../../../../cli/commands/autonomy/core.js";
import {
  type AutonomyQualifyDeps,
  parseRepoFlag,
  runAutonomyQualify,
} from "../../../../../cli/commands/autonomy/qualify.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";

const NOW = "2026-11-02T11:00:00.000Z";

/** Deps whose repair answers with `answer`, recording what it was asked and what was printed. */
function harness({ answer }: { answer: (apply: boolean) => Awaited<ReturnType<AutonomyQualifyDeps["qualify"]>> }): {
  deps: AutonomyQualifyDeps;
  out: string[];
  diagnostics: string[];
  asked: Parameters<AutonomyQualifyDeps["qualify"]>[0][];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const asked: Parameters<AutonomyQualifyDeps["qualify"]>[0][] = [];
  return {
    asked,
    deps: {
      now: () => NOW,
      qualify: (request) => {
        asked.push(request);
        return Promise.resolve(answer(request.apply));
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

/** The qualification the repair reports, applied or not. */
function qualification({ applied }: { applied: boolean }): AutonomyQualification {
  return {
    actionId: "finding-pr.watchpr-dies",
    applied,
    changed: [{ after: "acme/widgets#12 lagged", before: "#12 lagged", field: "why" }],
    witness: "w",
  };
}

describe("runAutonomyQualify", () => {
  it("prints the dry run's before and after and says nothing was written", async () => {
    const { asked, deps, out } = harness({ answer: (apply) => ok(qualification({ applied: apply })) });

    const code = await runAutonomyQualify({
      deps,
      rest: ["finding-pr.watchpr-dies", "--repo", "acme/widgets", "--home", "/fixture-home"],
    });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([
      {
        actionId: "finding-pr.watchpr-dies",
        apply: false,
        home: "/fixture-home",
        nowIso: NOW,
        repo: { owner: "acme", repo: "widgets" },
      },
    ]);
    expect(out).toEqual([
      "autonomy qualify: finding-pr.watchpr-dies",
      "  why before: #12 lagged",
      "  why after:  acme/widgets#12 lagged",
      "  nothing was written — pass --apply to install this",
    ]);
  });

  it("with --apply, asks for the write and reports it applied", async () => {
    const { asked, deps, out } = harness({ answer: (apply) => ok(qualification({ applied: apply })) });

    const code = await runAutonomyQualify({
      deps,
      rest: ["finding-pr.watchpr-dies", "--repo", "acme/widgets", "--apply", "--home", "/fixture-home"],
    });

    expect(code).toBe(EXIT_OK);
    expect(asked[0]!.apply).toBe(true);
    expect(out.at(-1)).toBe("  applied; the original is quoted in the act's own witness");
  });

  it("exits 1 with the repair's own refusal", async () => {
    const { deps, diagnostics } = harness({
      answer: () => err(AutonomyErrors.nothingToQualify({ actionId: "finding-pr.watchpr-dies" })),
    });

    const code = await runAutonomyQualify({
      deps,
      rest: ["finding-pr.watchpr-dies", "--repo", "acme/widgets", "--home", "/fixture-home"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      `autonomy qualify: ${AutonomyErrors.nothingToQualify({ actionId: "finding-pr.watchpr-dies" }).message}`,
    ]);
  });

  it("refuses a missing --repo before reaching the store", async () => {
    const { asked, deps, diagnostics } = harness({ answer: () => ok(qualification({ applied: false })) });

    const code = await runAutonomyQualify({ deps, rest: ["finding-pr.watchpr-dies"] });

    expect(code).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
    expect(diagnostics).toEqual(["autonomy qualify: name exactly one act id, and --repo as owner/repo", QUALIFY_USAGE]);
  });

  it("refuses two act ids before reaching the store", async () => {
    const { asked, deps } = harness({ answer: () => ok(qualification({ applied: false })) });

    expect(await runAutonomyQualify({ deps, rest: ["a", "b", "--repo", "acme/widgets"] })).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
  });

  it("prints usage on --help", async () => {
    const { deps, out } = harness({ answer: () => ok(qualification({ applied: false })) });

    expect(await runAutonomyQualify({ deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(out).toEqual([QUALIFY_USAGE]);
  });
});

describe("parseRepoFlag", () => {
  it("reads one owner/repo pair", () => {
    expect(parseRepoFlag({ raw: "acme/widgets" })).toEqual({ owner: "acme", repo: "widgets" });
  });

  it.each(["widgets", "acme/widgets/extra", "/widgets", "acme/"])("refuses %s", (raw) => {
    expect(parseRepoFlag({ raw })).toBe(undefined);
  });
});
