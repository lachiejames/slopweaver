import { describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import {
  type GithubStackPushArgs,
  type GithubStackPushFacts,
  type GithubStackPushPlan,
  githubStackPushDoorRequest,
  githubStackPushPlan,
  githubStackRegistrationFor,
  parseGithubStackPushArgs,
} from "../../../../../cli/commands/github/stackPushCore.js";
import { err, unwrapErr } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";

// deleted-with-code: createReviewRefusal

function form(over: Partial<PrFormDraft["target"]> = {}): PrFormDraft {
  return { ...EXAMPLE_PR_FORM, target: { base: "bottom", head: "top", owner: "o", repo: "r", ...over } };
}

/** Unwrap a successful argument parse, throwing on the wrong arm. */
function parsedArgs({ argv }: { argv: readonly string[] }): GithubStackPushArgs {
  const parsed = parseGithubStackPushArgs({ argv });
  if (parsed.isErr()) throw new Error(parsed.error.join("; "));
  return parsed.value;
}

const FACTS: GithubStackPushFacts = {
  amendPin: { kind: "pinned", tree: "pinned-tree" },
  branch: "top",
  defaultBranch: "main",
  headSha: "head-sha",
  repo: "o/r",
  repoRoot: "/repo",
};

/** Unwrap a successful stack-push plan, throwing on the wrong arm. */
function planned({
  facts = FACTS,
  prForm = form(),
}: {
  facts?: GithubStackPushFacts;
  prForm?: PrFormDraft;
} = {}): GithubStackPushPlan {
  const result = githubStackPushPlan({ facts, form: prForm });
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
}

describe("parseGithubStackPushArgs", () => {
  it("parses a minimal invocation with the default remote", () => {
    expect(parsedArgs({ argv: ["--form", "-"] })).toEqual({
      baseFreshnessAcknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
      cwd: undefined,
      dryRun: false,
      fileExample: false,
      fileSource: undefined,
      formExample: false,
      formSource: "-",
      home: undefined,
      lockWait: { timeoutSeconds: 540, wait: false },
      orphanAbove: [],
      remote: "origin",
      selfReviewSource: undefined,
    });
  });

  it("parses --wait and --timeout-seconds as the lock wait, on the shared wait contract", () => {
    expect(parsedArgs({ argv: ["--form", "-", "--wait", "--timeout-seconds", "120"] }).lockWait).toEqual({
      timeoutSeconds: 120,
      wait: true,
    });
  });

  it("refuses --timeout-seconds without --wait, so a timeout that would do nothing is never silently accepted", () => {
    const parsed = parseGithubStackPushArgs({ argv: ["--form", "-", "--timeout-seconds", "120"] });
    expect(parsed.isOk()).toBe(false);
    expect(unwrapErr(parsed)).toEqual(["--timeout-seconds only means something with --wait"]);
  });

  it("names all four input modes when none was given, so the shape is discoverable without guessing", () => {
    const parsed = parseGithubStackPushArgs({ argv: [] });
    expect(parsed.isOk()).toBe(false);
    const joined = parsed.isErr() ? parsed.error.join(" ") : "";
    expect(joined).toContain("--form <json|->");
    expect(joined).toContain("--file <path|->");
    expect(joined).toContain("--form-example");
    expect(joined).toContain("--file-example");
  });

  it("accepts --form-example with no real form, and reads no form source", () => {
    const parsed = parsedArgs({ argv: ["--form-example"] });
    expect(parsed.formExample).toBe(true);
    expect(parsed.formSource).toBe(undefined);
  });

  it("accepts --file-example with no real form", () => {
    expect(parsedArgs({ argv: ["--file-example"] }).fileExample).toBe(true);
  });

  it("accepts --file as the authoring-file alternative to --form", () => {
    const parsed = parsedArgs({ argv: ["--file", "/tmp/pr.md"] });
    expect(parsed.fileSource).toBe("/tmp/pr.md");
    expect(parsed.formSource).toBe(undefined);
  });

  it("refuses --form and --file together — two descriptions is two instructions", () => {
    expect(parseGithubStackPushArgs({ argv: ["--form", "{}", "--file", "/tmp/pr.md"] })).toEqual(
      err(["give exactly ONE of --form, --file, --form-example or --file-example to stack push"]),
    );
  });

  it("parses the acknowledgement flags the creation gates read", () => {
    const parsed = parsedArgs({ argv: ["--form", "-", "--acknowledge", "base-moved,already-landed"] });
    expect(parsed.baseFreshnessAcknowledgement.acknowledge).toEqual(["base-moved", "already-landed"]);
  });

  it("requires --reason alongside --acknowledge-all", () => {
    const parsed = parseGithubStackPushArgs({ argv: ["--form", "-", "--acknowledge-all"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed.isErr() ? parsed.error.join(" ") : "").toContain("--acknowledge-all must be paired with --reason");
  });

  it("refuses a blank --remote", () => {
    expect(parseGithubStackPushArgs({ argv: ["--form", "-", "--remote", "  "] })).toEqual(
      err(["--remote must not be blank"]),
    );
  });

  it("parses every flag when all are supplied", () => {
    expect(
      parsedArgs({
        argv: [
          "--form",
          "-",
          "--cwd",
          "/repo",
          "--remote",
          "upstream",
          "--home",
          "/home",
          "--self-review",
          "review.json",
          "--orphan-above",
          "41",
          "--dry-run",
          "--wait",
          "--timeout-seconds",
          "90",
        ],
      }),
    ).toEqual({
      baseFreshnessAcknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
      cwd: "/repo",
      dryRun: true,
      fileExample: false,
      fileSource: undefined,
      formExample: false,
      formSource: "-",
      home: "/home",
      lockWait: { timeoutSeconds: 90, wait: true },
      orphanAbove: [41],
      remote: "upstream",
      selfReviewSource: "review.json",
    });
  });

  it("refuses two stdin-backed forms", () => {
    expect(parseGithubStackPushArgs({ argv: ["--form", "-", "--self-review", "-"] })).toEqual(
      err(["--self-review and the description input cannot both read from stdin; pass one as inline JSON"]),
    );
  });
});

describe("githubStackPushPlan", () => {
  const facts = FACTS;

  it("builds the plan when the form's head matches the checked-out branch", () => {
    expect(planned()).toEqual({
      addArgs: ["add", "--all"],
      amendArgs: ["commit", "--amend", "--no-edit"],
      facts,
      form: form(),
    });
  });

  it("refuses when the form's target.head is not the checked-out branch", () => {
    expect(githubStackPushPlan({ facts, form: form({ head: "someone-elses-branch" }) })).toEqual(
      err(GithubVerbErrors.stackHeadNotCheckedOut({ branch: "top", head: "someone-elses-branch" })),
    );
  });

  it("refuses when the checked-out branch is the remote default", () => {
    expect(githubStackPushPlan({ facts: { ...facts, branch: "main" }, form: form({ head: "main" }) })).toEqual(
      err(GithubVerbErrors.stackPushDefaultBranch({ defaultBranch: "main" })),
    );
  });

  it("refuses when target.base equals target.head", () => {
    expect(githubStackPushPlan({ facts, form: form({ base: "top" }) })).toEqual(
      err(GithubVerbErrors.stackBaseEqualsHead()),
    );
  });

  it("refuses when the form's target repository does not match the checked-out remote", () => {
    expect(githubStackPushPlan({ facts, form: form({ owner: "someone-else" }) })).toEqual(
      err(GithubVerbErrors.stackRepoMismatch({ owner: "someone-else", remoteRepo: "o/r", repo: "r" })),
    );
  });
});

describe("githubStackRegistrationFor", () => {
  it("refuses when no open pull request has the base branch as its head", () => {
    expect(githubStackRegistrationFor({ base: "bottom", newPrStackNumber: undefined, parentPr: undefined })).toEqual({
      kind: "refused",
      reason: "base branch bottom is not the repository default and no open pull request has it as its head",
    });
  });

  it("creates a stack when the parent isn't in one yet", () => {
    expect(
      githubStackRegistrationFor({
        base: "bottom",
        newPrStackNumber: undefined,
        parentPr: { number: 10, stackNumber: undefined },
      }),
    ).toEqual({ kind: "create", parentNumber: 10 });
  });

  it("adds to the parent's existing stack", () => {
    expect(
      githubStackRegistrationFor({
        base: "bottom",
        newPrStackNumber: undefined,
        parentPr: { number: 10, stackNumber: 5 },
      }),
    ).toEqual({ kind: "add", parentNumber: 10, stackNumber: 5 });
  });

  it("reports already-joined when topology alone already put the new PR in the parent's stack", () => {
    expect(
      githubStackRegistrationFor({ base: "bottom", newPrStackNumber: 5, parentPr: { number: 10, stackNumber: 5 } }),
    ).toEqual({ kind: "already-joined", stackNumber: 5 });
  });

  it("still adds when the new PR was auto-joined to a DIFFERENT stack than the parent's", () => {
    expect(
      githubStackRegistrationFor({ base: "bottom", newPrStackNumber: 9, parentPr: { number: 10, stackNumber: 5 } }),
    ).toEqual({ kind: "add", parentNumber: 10, stackNumber: 5 });
  });
});

describe("githubStackPushDoorRequest", () => {
  it("describes the write without a credential-bearing remote URL", () => {
    expect(githubStackPushDoorRequest({ home: "/home", plan: planned() })).toEqual({
      action: { kind: "verb", noun: "github", verb: "stack push" },
      artifact: { base: "bottom", branch: "top", head: "top", repo: "o/r" },
      meta: { createsWorkItem: true, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });
});
