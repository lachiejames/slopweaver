import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { parseGithubStackDispatch } from "../../../../../cli/commands/github/stackCore.js";
import { err, ok } from "../../../../../lib/result.js";

describe("parseGithubStackDispatch", () => {
  it("dispatches to push and keeps the remaining tail", () => {
    expect(parseGithubStackDispatch({ argv: ["push", "--form", "-"] })).toEqual(
      ok({ rest: ["--form", "-"], subVerb: "push" }),
    );
  });

  it("keeps an empty tail when no further arguments follow", () => {
    expect(parseGithubStackDispatch({ argv: ["push"] })).toEqual(ok({ rest: [], subVerb: "push" }));
  });

  it("dispatches to sync and keeps the remaining tail", () => {
    expect(parseGithubStackDispatch({ argv: ["sync", "--dry-run"] })).toEqual(
      ok({ rest: ["--dry-run"], subVerb: "sync" }),
    );
  });

  it("dispatches to adopt and keeps the remaining tail", () => {
    expect(parseGithubStackDispatch({ argv: ["adopt", "--pr", "42"] })).toEqual(
      ok({ rest: ["--pr", "42"], subVerb: "adopt" }),
    );
  });

  it("refuses an unrecognised sub-verb", () => {
    expect(parseGithubStackDispatch({ argv: ["rebase"] })).toEqual(
      err(
        GithubVerbErrors.usage({ command: "stack", shape: "<push|sync|restack|submit|adopt|audit|remove|dissolve>" }),
      ),
    );
  });

  it("refuses no sub-verb at all", () => {
    expect(parseGithubStackDispatch({ argv: [] })).toEqual(
      err(
        GithubVerbErrors.usage({ command: "stack", shape: "<push|sync|restack|submit|adopt|audit|remove|dissolve>" }),
      ),
    );
  });
});
