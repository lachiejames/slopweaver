import { describe, expect, it } from "vitest";

import {
  commentDoorRequestFor,
  commentDryRunLines,
  parseGithubCommentArgs,
  parseGithubCommentForm,
} from "../../../../../cli/commands/github/commentCore.js";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const CREATE_ARGV = ["create", "--repo", "o/r", "--number", "7", "--form", '{"summary":[{"kind":"text","text":"x"}]}'];
const EDIT_ARGV = ["edit", "--repo", "o/r", "--comment-id", "9", "--form", '{"summary":[{"kind":"text","text":"x"}]}'];

describe("parseGithubCommentArgs", () => {
  it("parses a create invocation", () => {
    expect(unwrap(parseGithubCommentArgs({ argv: CREATE_ARGV }))).toEqual({
      dryRun: false,
      formSource: '{"summary":[{"kind":"text","text":"x"}]}',
      home: undefined,
      json: false,
      number: 7,
      owner: "o",
      repo: "r",
      subVerb: "create",
    });
  });

  it("parses an edit invocation", () => {
    expect(unwrap(parseGithubCommentArgs({ argv: EDIT_ARGV }))).toEqual({
      commentId: 9,
      dryRun: false,
      formSource: '{"summary":[{"kind":"text","text":"x"}]}',
      home: undefined,
      json: false,
      owner: "o",
      repo: "r",
      subVerb: "edit",
    });
  });

  it("refuses an unrecognised sub-verb", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubCommentArgs({ argv: ["delete", "--repo", "o/r"] })) }),
    ).toEqual(["usage: slopweaver github comment <create|edit> [...]"]);
  });

  it("refuses a missing --repo and a missing --form together", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubCommentArgs({ argv: ["create", "--number", "7"] })) }),
    ).toEqual(["--repo owner/name is required", "--form <json|-> is required"]);
  });

  it("refuses --comment-id on create", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubCommentArgs({ argv: [...CREATE_ARGV, "--comment-id", "9"] })),
      }),
    ).toEqual(["--comment-id is not a `create` flag; `create` addresses --number"]);
  });

  it("refuses --number on edit", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubCommentArgs({ argv: [...EDIT_ARGV, "--number", "7"] })) }),
    ).toEqual(["--number is not an `edit` flag; `edit` addresses --comment-id"]);
  });

  it("refuses a non-positive --number", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubCommentArgs({ argv: ["create", "--repo", "o/r", "--number", "0", "--form", "-"] })),
      }),
    ).toEqual(["--number must be a positive whole number"]);
  });
});

describe("parseGithubCommentForm", () => {
  it("parses a valid form", () => {
    expect(
      unwrap(parseGithubCommentForm({ raw: '{"summary":[{"kind":"text","text":"please re-review this"}]}' })),
    ).toEqual({ summary: [{ kind: "text", text: "please re-review this" }] });
  });

  it("refuses invalid JSON", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubCommentForm({ raw: "{not json" })) })[0]).toContain(
      "the form is not valid JSON",
    );
  });

  it("refuses a form with no summary", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubCommentForm({ raw: "{}" })) }).length).toBeGreaterThan(0);
  });

  it("refuses an unrecognised field, by name", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubCommentForm({ raw: '{"summary":[{"kind":"text","text":"x"}],"bogus":true}' })),
      })[0],
    ).toContain("bogus");
  });
});

describe("commentDryRunLines", () => {
  const artifact = unwrap(parseGithubCommentForm({ raw: '{"summary":[{"kind":"text","text":"please re-review"}]}' }));

  it("names the create destination and renders the body", () => {
    const args = unwrap(parseGithubCommentArgs({ argv: CREATE_ARGV }));
    const lines = commentDryRunLines({ args, artifact });
    expect(lines[0]).toBe("would create: o/r#7");
    expect(lines).toContain("please re-review");
  });

  it("names the edit destination by comment id", () => {
    const args = unwrap(parseGithubCommentArgs({ argv: EDIT_ARGV }));
    expect(commentDryRunLines({ args, artifact })[0]).toBe("would edit: o/r comment 9");
  });
});

describe("commentDoorRequestFor", () => {
  it("addresses a create by owner/repo#number", () => {
    const args = unwrap(parseGithubCommentArgs({ argv: CREATE_ARGV }));
    expect(commentDoorRequestFor({ args, home: "/home" })).toEqual({
      action: { kind: "verb", noun: "github", verb: "comment create" },
      artifact: { id: "o/r#7" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });

  it("addresses an edit by owner/repo and comment id", () => {
    const args = unwrap(parseGithubCommentArgs({ argv: EDIT_ARGV }));
    const request = commentDoorRequestFor({ args, home: "/home" });
    expect(request.artifact).toEqual({ id: "o/r comment 9" });
    expect(request.action).toEqual({ kind: "verb", noun: "github", verb: "comment edit" });
  });
});
