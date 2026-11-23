/**
 * The kind labels a created or updated pull request is given: the pure plan over what it carries and what the
 * repository defines, and the apply over plain fake label edges, read back.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { applyKindLabels, kindLabelPlan } from "../../../../../cli/commands/github/kindLabelApply.js";
import type { GithubWriteApi } from "../../../../../corpus/github/write.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };

const DEFINED = ["bug fix", "feature", "security", "maintenance"];

const TARGET = { number: 7, owner: "acme", repo: "widgets", title: "fix(security): close the open port" };

describe("kindLabelPlan", () => {
  it("has nothing to do for a title that derives no label", () => {
    expect(
      kindLabelPlan({ current: [], defined: DEFINED, title: "Update the readme", truncated: false }),
    ).toStrictEqual({ kind: "none" });
  });

  it("is present once every derived label is carried", () => {
    const plan = kindLabelPlan({
      current: ["bug fix", "security"],
      defined: DEFINED,
      title: TARGET.title,
      truncated: false,
    });
    expect(plan).toStrictEqual({ kind: "present" });
  });

  it("adds only the missing labels", () => {
    const plan = kindLabelPlan({ current: ["bug fix"], defined: DEFINED, title: TARGET.title, truncated: false });
    expect(plan).toStrictEqual({ kind: "add", labels: ["security"] });
  });

  it("names a derived label the repository does not define, and whether the read was truncated", () => {
    const plan = kindLabelPlan({ current: [], defined: ["bug fix"], title: TARGET.title, truncated: true });
    expect(plan).toStrictEqual({ kind: "undefined", labels: ["security"], truncated: true });
  });
});

/** Fake label edges: the labels the pull request carries before and after the add, and every add sent. */
function edges({
  before,
  after,
  defined = DEFINED,
}: {
  before: readonly string[];
  after: readonly string[];
  defined?: readonly string[];
}): { api: Pick<GithubWriteApi, "addIssueLabels" | "issueLabels" | "repoLabels">; adds: (readonly string[])[] } {
  const adds: (readonly string[])[] = [];
  let reads = 0;
  return {
    adds,
    api: {
      addIssueLabels: ({ labels }) => {
        adds.push(labels);
        return okAsync(labels);
      },
      issueLabels: () => {
        reads += 1;
        return okAsync({ htmlUrl: "https://github.com/acme/widgets/pull/7", labels: reads === 1 ? before : after });
      },
      repoLabels: () => okAsync({ names: defined, truncated: false }),
    },
  };
}

describe("applyKindLabels", () => {
  it("adds the missing labels and confirms them by reading back", async () => {
    const { adds, api } = edges({ after: ["bug fix", "security"], before: [] });
    expect(await applyKindLabels({ api, target: TARGET })).toStrictEqual([
      "kind labels: added bug fix, security, read back",
    ]);
    expect(adds).toStrictEqual([["bug fix", "security"]]);
  });

  it("says the add is unconfirmed when the read-back still lacks a label", async () => {
    const { api } = edges({ after: ["bug fix"], before: [] });
    expect(await applyKindLabels({ api, target: TARGET })).toStrictEqual([
      "kind labels UNCONFIRMED: the read-back still lacks security",
    ]);
  });

  it("adds nothing and says why when the repository does not define a derived label", async () => {
    const { adds, api } = edges({ after: [], before: [], defined: ["bug fix"] });
    expect(await applyKindLabels({ api, target: TARGET })).toStrictEqual([
      'kind labels not applied: acme/widgets defines no "security" label; define it once, then re-run',
    ]);
    expect(adds).toStrictEqual([]);
  });

  it("adds nothing and reads nothing for a title that derives no label", async () => {
    const api: Pick<GithubWriteApi, "addIssueLabels" | "issueLabels" | "repoLabels"> = {
      addIssueLabels: () => errAsync(HTTP_ERROR),
      issueLabels: () => errAsync(HTTP_ERROR),
      repoLabels: () => errAsync(HTTP_ERROR),
    };
    expect(await applyKindLabels({ api, target: { ...TARGET, title: "Update the readme" } })).toStrictEqual([]);
  });

  it("names the failed read rather than adding blind", async () => {
    const { api: base } = edges({ after: [], before: [] });
    const api = { ...base, issueLabels: () => errAsync(HTTP_ERROR) };
    expect(await applyKindLabels({ api, target: TARGET })).toStrictEqual([
      "kind labels not applied: could not read #7's labels: unreachable",
    ]);
  });
});
