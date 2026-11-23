/**
 * The description write at its own module: what each read answers decides the outcome, the JSON form names the
 * outcome and the repository, and a read-back that does not show the sent text fails rather than reporting `set`.
 * The dispatch from `github repo --description` is `repoRun.test.ts`'s.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runRepoDescription } from "../../../../../cli/commands/github/repoDescriptionRun.js";
import type { GithubRepoDescriptionApi, RepoDescription } from "../../../../../outbound/github/repoDescription.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { githubHttpError } from "../../../../githubRepoWriteFakes.js";

const OLD: RepoDescription = { description: "old text", htmlUrl: "https://github.com/acme/widget" };
const NEW: RepoDescription = { description: "new text", htmlUrl: "https://github.com/acme/widget" };

/** A description client answering each read from `reads` in turn and recording every send. */
function descriptionApi({
  reads,
  sets,
}: {
  reads: (RepoDescription | "refused")[];
  sets: string[];
}): GithubRepoDescriptionApi {
  return {
    read: () => {
      const next = reads.shift()!;
      return next === "refused" ? errAsync(githubHttpError({ status: 403 })) : okAsync(next);
    },
    setDescription: ({ description }) => {
      sets.push(description);
      return okAsync(NEW);
    },
  };
}

/** One run over `reads`, collecting what it printed and sent. */
async function runOver({ reads, json = false }: { reads: (RepoDescription | "refused")[]; json?: boolean }): Promise<{
  code: number;
  out: string[];
  diagnostic: string[];
  sets: string[];
  ledgerRows: number;
}> {
  const out: string[] = [];
  const diagnostic: string[] = [];
  const sets: string[] = [];
  const ledger = memoryDoorLedger();
  const code = await runRepoDescription({
    args: { description: "new text", dryRun: false, home: undefined, json, owner: "acme", repo: "widget" },
    seams: {
      api: descriptionApi({ reads, sets }),
      home: "/home/fixture",
      ledger: ledger.port,
      out: (line) => out.push(line),
      writeDiagnostic: (line) => diagnostic.push(line),
    },
  });
  return { code, diagnostic, ledgerRows: ledger.records().length, out, sets };
}

describe("runRepoDescription", () => {
  it("sends once through the door and reports the read-back as one JSON document", async () => {
    const run = await runOver({ json: true, reads: [OLD, NEW] });
    expect(run.code).toBe(0);
    expect(run.sets).toEqual(["new text"]);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ description: "new text", outcome: "set", repo: "acme/widget" });
    expect(run.ledgerRows).toBeGreaterThan(0);
  });

  it("fails when the read-back does not show the text it sent", async () => {
    const run = await runOver({ reads: [OLD, OLD] });
    expect(run.code).toBe(1);
    expect(run.sets).toEqual(["new text"]);
    expect(run.out).toEqual([]);
    expect(run.diagnostic.join("\n")).toContain(
      "GitHub accepted the description for acme/widget but the read-back does not match what was sent",
    );
  });

  it("sends nothing when the first read is refused", async () => {
    const run = await runOver({ reads: ["refused"] });
    expect(run.code).toBe(1);
    expect(run.sets).toEqual([]);
    expect(run.ledgerRows).toBe(0);
    expect(run.diagnostic).toEqual(["HTTP 403"]);
  });
});
