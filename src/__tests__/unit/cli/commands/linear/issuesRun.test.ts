/** `linear issues` — a pure read: what reaches the reader, and what each outcome prints and exits. */
import { describe, expect, it } from "vitest";

import { type LinearIssuesDeps, runLinearIssues } from "../../../../../cli/commands/linear/issuesRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";
import type { LinearIssuesDocument, LinearIssuesSelection } from "../../../../../live/linear/issues.js";

const NOW_MS = Date.parse("2026-10-24T00:00:00.000Z");

const DOCUMENT: LinearIssuesDocument = {
  createdSinceIso: undefined,
  creator: "me",
  issues: [],
  project: undefined,
  readAtIso: "2026-10-24T09:00:00.000Z",
  source: "linear",
  team: { id: "team-1", key: "SUP", name: "Ops & Access" },
};

function harness({ fail }: { fail: boolean }): {
  deps: LinearIssuesDeps;
  asked: { selection: LinearIssuesSelection; home: string | undefined }[];
  out: string[];
  diagnostics: string[];
} {
  const asked: { selection: LinearIssuesSelection; home: string | undefined }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    asked,
    deps: {
      nowMs: () => NOW_MS,
      read: (args) => {
        asked.push(args);
        return Promise.resolve(fail ? err(LinearLiveErrors.readFailed({ message: "no token" })) : ok(DOCUMENT));
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}

describe("runLinearIssues", () => {
  it("hands the reader the whole selection, a relative window resolved against the clock", async () => {
    const { deps, asked } = harness({ fail: false });

    const code = await runLinearIssues({
      deps,
      rest: ["--team", "SUP", "--creator", "me", "--created-since", "7d", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([
      {
        home: "/h",
        selection: {
          createdSinceIso: "2026-10-17T00:00:00.000Z",
          creator: "me",
          project: undefined,
          teamKey: "SUP",
        },
      },
    ]);
  });

  it("prints ONE JSON document under --json", async () => {
    const { deps, out } = harness({ fail: false });

    expect(await runLinearIssues({ deps, rest: ["--team", "SUP", "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out.join("\n"))).toEqual(DOCUMENT);
  });

  it("refuses with neither --team nor --project, before reading anything", async () => {
    const { deps, asked, diagnostics } = harness({ fail: false });

    expect(await runLinearIssues({ deps, rest: ["--creator", "me"] })).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
    expect(diagnostics.join("\n")).toContain("name --team <team-key>, --project <uuid|url>, or both");
  });

  it("refuses a creator other than me", async () => {
    const { deps, diagnostics } = harness({ fail: false });

    expect(await runLinearIssues({ deps, rest: ["--team", "SUP", "--creator", "tobias"] })).toBe(EXIT_USAGE);
    expect(diagnostics.join("\n")).toContain('--creator accepts only `me`, got "tobias"');
  });

  it("exits 1 with the reader's message when the read fails", async () => {
    const { deps, diagnostics } = harness({ fail: true });

    expect(await runLinearIssues({ deps, rest: ["--team", "SUP"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual(["no token"]);
  });
});
