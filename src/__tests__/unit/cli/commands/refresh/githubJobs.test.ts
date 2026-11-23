/**
 * The GitHub job builders resolve their credential from the run's OWN home.
 *
 * A `--home B` refresh used to call `githubToken()` with no home, so its stored-token tier read the
 * AMBIENT home's token — invisible on the scheduled pass (ambient IS the real home) and real in every
 * `--home` sandbox, the replay and subprocess lanes included. The resolver is a seam because the production
 * read's `gh auth token` tier shells out, which no unit test can call deterministically.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRefreshOptions } from "../../../../../cli/commands/refresh/core.js";
import { githubJob, githubOrgJob } from "../../../../../cli/commands/refresh/githubJobs.js";
import type { ExportWindow } from "../../../../../corpus/types.js";
import { unwrap } from "../../../../../lib/result.js";

const window: ExportWindow = { since: "2026-01-01", until: "2026-02-01" };

/** A resolver that answers the OPERATOR's token for the ambient home only, and records every home asked. */
function operatorOnlyResolver({ ambientHome }: { ambientHome: string }): {
  calls: { home: string }[];
  resolve: (args: { home: string }) => string | undefined;
} {
  const calls: { home: string }[] = [];
  return {
    calls,
    resolve: ({ home }) => {
      calls.push({ home });
      return home === ambientHome ? "operator-token" : undefined;
    },
  };
}

let sandbox: string;
let ambient: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "slop-gh-job-home-"));
  ambient = mkdtempSync(join(tmpdir(), "slop-gh-job-ambient-"));
});
afterEach(() => {
  rmSync(sandbox, { force: true, recursive: true });
  rmSync(ambient, { force: true, recursive: true });
});

describe("githubJob — the credential is read from the run's own home", () => {
  it("asks the resolver for the sandbox home exactly once, and never for the ambient one", () => {
    const resolver = operatorOnlyResolver({ ambientHome: ambient });
    const job = unwrap(
      githubJob({ home: sandbox, noEnrich: false, repoSlug: "acme/widgets", resolveToken: resolver.resolve, window }),
    );
    expect(job.label).toBe("acme/widgets");
    expect(resolver.calls).toEqual([{ home: sandbox }]);
  });

  it("a sandbox that holds its own token gets that token, not the operator's", () => {
    const calls: { home: string; answered: string | undefined }[] = [];
    const job = unwrap(
      githubJob({
        home: sandbox,
        noEnrich: false,
        repoSlug: "acme/widgets",
        resolveToken: ({ home }) => {
          const answered = home === sandbox ? "sandbox-token" : "operator-token";
          calls.push({ answered, home });
          return answered;
        },
        window,
      }),
    );
    expect(job.source).toBe("github");
    expect(calls).toEqual([{ answered: "sandbox-token", home: sandbox }]);
  });
});

describe("githubOrgJob — the same rule in org mode", () => {
  it("asks the resolver for the sandbox home exactly once, and never for the ambient one", () => {
    const resolver = operatorOnlyResolver({ ambientHome: ambient });
    const options = unwrap(parseRefreshOptions({ rest: ["--all-repos", "--github-org", "acme"] }));
    const job = unwrap(githubOrgJob({ home: sandbox, options, resolveToken: resolver.resolve, window }));
    expect(job.label).toBe("org:acme (all-repos)");
    expect(resolver.calls).toEqual([{ home: sandbox }]);
  });
});
