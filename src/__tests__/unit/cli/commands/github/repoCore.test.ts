import { describe, expect, it } from "vitest";

import {
  parseGithubRepoArgs,
  repoAdministrationDoorRequest,
  repoDescriptionDoorRequest,
} from "../../../../../cli/commands/github/repoCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubRepoArgs", () => {
  it("requires one exact repository and a write", () => {
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--description", "new text", "--json"] }))).toEqual({
      args: { description: "new text", dryRun: false, home: undefined, json: true, owner: "o", repo: "r" },
      kind: "description",
    });
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "broken"] }))).toEqual(["--repo owner/name is required"]);
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r"] }))).toEqual([
      "one of --description, --rename-to, --transfer-to, --archive, --create, --set-public, --apply-manifest or --enable-actions is " +
        'required (pass --description "" to clear it)',
    ]);
  });

  it("parses a create as private unless --public says otherwise, and each lifecycle write as a preview", () => {
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--create"] }))).toEqual({
      args: { approve: undefined, home: undefined, json: false, owner: "o", public: false, repo: "r", write: "create" },
      kind: "approved",
    });
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--create", "--public", "--json"] }))).toEqual({
      args: { approve: undefined, home: undefined, json: true, owner: "o", public: true, repo: "r", write: "create" },
      kind: "approved",
    });
    expect(
      unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--set-public", "--approve", "ghrepo-0123456789abcdef"] })),
    ).toEqual({
      args: {
        approve: "ghrepo-0123456789abcdef",
        home: undefined,
        json: false,
        owner: "o",
        public: false,
        repo: "r",
        write: "set-public",
      },
      kind: "approved",
    });
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--enable-actions", "--home", "/h"] }))).toEqual({
      args: {
        approve: undefined,
        home: "/h",
        json: false,
        owner: "o",
        public: false,
        repo: "r",
        write: "enable-actions",
      },
      kind: "approved",
    });
  });

  it("parses a settings apply carrying its artifact's path, and refuses one with an empty path", () => {
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--apply-manifest", "apply.json"] }))).toEqual({
      args: {
        approve: undefined,
        home: undefined,
        json: false,
        manifestPath: "apply.json",
        owner: "o",
        public: false,
        repo: "r",
        write: "apply-manifest",
      },
      kind: "approved",
    });
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--apply-manifest", ""] }))).toEqual([
      "--apply-manifest takes the apply artifact's path",
    ]);
  });

  it("refuses --public off a create, two lifecycle writes at once, and --dry-run on one", () => {
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--set-public", "--public"] }))).toEqual([
      "--public only qualifies --create; --set-public makes an existing repository public",
    ]);
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--create", "--enable-actions"] }))).toEqual([
      "name one of --description, --rename-to, --transfer-to, --archive, --create, --set-public, --apply-manifest or --enable-actions; " +
        "each is its own write",
    ]);
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--create", "--dry-run"] }))).toEqual([
      "--dry-run is the description write's preview; every other write previews by default",
    ]);
  });

  it("accepts an empty description as a valid clear-it request", () => {
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--description", ""] }))).toEqual({
      args: { description: "", dryRun: false, home: undefined, json: false, owner: "o", repo: "r" },
      kind: "description",
    });
  });

  it("parses each administration write as a preview unless --approve carries a digest", () => {
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--rename-to", "s"] }))).toEqual({
      args: {
        action: { kind: "rename", newName: "s" },
        approve: undefined,
        home: undefined,
        json: false,
        owner: "o",
        repo: "r",
      },
      kind: "administration",
    });
    expect(unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--transfer-to", "p", "--home", "/h"] }))).toEqual({
      args: {
        action: { kind: "transfer", newOwner: "p" },
        approve: undefined,
        home: "/h",
        json: false,
        owner: "o",
        repo: "r",
      },
      kind: "administration",
    });
    expect(
      unwrap(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--archive", "--approve", "ghrepo-0123456789abcdef"] })),
    ).toEqual({
      args: {
        action: { kind: "archive" },
        approve: "ghrepo-0123456789abcdef",
        home: undefined,
        json: false,
        owner: "o",
        repo: "r",
      },
      kind: "administration",
    });
  });

  it("refuses two writes in one invocation", () => {
    expect(
      unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--rename-to", "s", "--transfer-to", "p"] })),
    ).toEqual([
      "name one of --description, --rename-to, --transfer-to, --archive, --create, --set-public, --apply-manifest or --enable-actions; " +
        "each is its own write",
    ]);
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--description", "x", "--archive"] }))).toEqual([
      "name one of --description, --rename-to, --transfer-to, --archive, --create, --set-public, --apply-manifest or --enable-actions; " +
        "each is its own write",
    ]);
  });

  it("refuses an owner or whitespace in a new name or login", () => {
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--rename-to", "p/s"] }))).toEqual([
      "--rename-to takes the new repository name alone: no owner, slash or whitespace",
    ]);
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--transfer-to", "a b"] }))).toEqual([
      "--transfer-to takes the receiving account or organisation login alone: no slash or whitespace",
    ]);
  });

  it("refuses a malformed digest, --dry-run on an administration write and --approve on a description", () => {
    expect(
      unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--archive", "--approve", "gcp-0123456789abcdef"] })),
    ).toEqual(["--approve takes the digest a preview printed: ghrepo- and 16 hex characters"]);
    expect(unwrapErr(parseGithubRepoArgs({ rest: ["--repo", "o/r", "--archive", "--dry-run"] }))).toEqual([
      "--dry-run is the description write's preview; every other write previews by default",
    ]);
    expect(
      unwrapErr(
        parseGithubRepoArgs({ rest: ["--repo", "o/r", "--description", "x", "--approve", "ghrepo-0123456789abcdef"] }),
      ),
    ).toEqual(["--approve is for every write bar --description, which takes --dry-run instead"]);
  });
});

describe("repoDescriptionDoorRequest", () => {
  it("addresses the repository as the door artifact and marks the write external", () => {
    const request = repoDescriptionDoorRequest({
      args: { description: "x", dryRun: false, home: undefined, json: false, owner: "o", repo: "r" },
      home: "/tmp/home",
    });
    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "repo" },
      artifact: { id: "o/r" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});

describe("repoAdministrationDoorRequest", () => {
  it("names the write on the action, carries the plan and digest, and requires approval", () => {
    const request = repoAdministrationDoorRequest({
      digest: "ghrepo-0123456789abcdef",
      home: "/tmp/home",
      kind: "transfer",
      view: { source: "o/r", target: "p/r" },
    });
    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "repo transfer" },
      artifact: { digest: "ghrepo-0123456789abcdef", source: "o/r", target: "p/r" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: true },
    });
  });
});
