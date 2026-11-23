/**
 * The `github exposure inventory` shell over plain fake edges: what it prints, where, and the exit codes.
 */
import { describe, expect, it } from "vitest";

import { type GithubExposureDeps, runGithubExposure } from "../../../../../cli/commands/github/exposureRun.js";
import { err, ok } from "../../../../../lib/result.js";
import type { GithubExposureSeam } from "../../../../../live/github/exposureListing.js";
import { GITHUB_EXPOSURE_CALLS } from "../../../../../live/github/exposureModel.js";
import { GithubJobLogErrors } from "../../../../../live/github/jobLogErrors.js";

const ARGV_HEAD = ["node", "slopweaver", "github", "exposure"];

/** Fake edges over a repository with nothing in it but its settings, recording what is printed. */
function edges({ token }: { token: string | undefined }): {
  deps: GithubExposureDeps;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const seam: GithubExposureSeam = {
    get: ({ call }) => {
      if (call === "repository") {
        return Promise.resolve(ok({ has_discussions: false, has_pages: false, has_wiki: false }));
      }
      const { itemsKey } = GITHUB_EXPOSURE_CALLS[call];
      return Promise.resolve(ok(itemsKey === undefined ? [] : { [itemsKey]: [], total_count: 0 }));
    },
    graphql: () => Promise.resolve(err({ message: "unused", status: undefined })),
  };
  return {
    deps: {
      denylist: () => ({ kind: "absent" }),
      home: () => "/never-read",
      makeSeam: () => seam,
      makeStreamLog:
        () =>
        ({ jobId }) =>
          Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId }))),
      nonce: () => "n0nce000",
      ownHome: () => "/never-a-home",
      nowIso: () => "2026-11-19T00:00:00.000Z",
      out: ({ line }) => {
        out.push(line);
      },
      token: () => token,
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runGithubExposure", () => {
  it("prints a complete inventory of an empty repository and exits 0", async () => {
    const { deps, out, diagnostics } = edges({ token: "token-fixture" });
    const code = await runGithubExposure({ argv: [...ARGV_HEAD, "inventory", "--repo", "acme/widgets"], deps });
    expect(diagnostics).toEqual([]);
    expect(out[0]).toContain("acme/widgets");
    expect(code).toBe(0);
  });

  it("refuses a missing sub-verb with the usage and exit 2, before any credential is read", async () => {
    const { deps, diagnostics } = edges({ token: undefined });
    const code = await runGithubExposure({ argv: [...ARGV_HEAD, "--repo", "acme/widgets"], deps });
    expect(code).toBe(2);
    expect(diagnostics[0]).toBe('github exposure needs a sub-verb: inventory or sweep (got "--repo")');
    expect(diagnostics[1]).toContain("usage: slopweaver github exposure");
  });

  it("prints each bad flag on its own line, then the usage", async () => {
    const { deps, diagnostics } = edges({ token: undefined });
    const code = await runGithubExposure({
      argv: [...ARGV_HEAD, "inventory", "--repo", "acme/widgets", "--bogus", "--also"],
      deps,
    });
    expect(code).toBe(2);
    expect(diagnostics.slice(0, 2)).toEqual(["unknown flag: --bogus", "unknown flag: --also"]);
    expect(diagnostics[2]).toContain("usage: slopweaver github exposure");
  });

  it("exits 1 and says how to connect when no GitHub token is configured", async () => {
    const { deps, diagnostics, out } = edges({ token: undefined });
    const code = await runGithubExposure({ argv: [...ARGV_HEAD, "inventory", "--repo", "acme/widgets"], deps });
    expect(code).toBe(1);
    expect(diagnostics).toEqual(["no GitHub token configured; run `slopweaver connect github`"]);
    expect(out).toEqual([]);
  });
});
