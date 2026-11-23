import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  CheckoutNameErrors,
  checkoutForRepo,
  checkoutForRepoName,
  checkoutForRunningRepo,
} from "../../../../live/checkout/checkoutForRepo.js";

/** A declared-checkout world: which paths exist, and which repository each one's `origin` is. */
function world({ origins }: { origins: Readonly<Record<string, string>> }) {
  return {
    originOf: ({ cwd }: { cwd: string }) => origins[cwd],
    paths: () => Object.keys(origins),
  };
}

describe("checkoutForRepo", () => {
  it("finds the declared checkout whose origin is that repository", () => {
    const found = checkoutForRepo({
      home: "/home",
      owner: "acme",
      repo: "widgets",
      ...world({ origins: { "/checkouts/other": "acme/other", "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(found.isOk()).toBe(true);
    expect(unwrap(found)).toBe("/checkouts/widgets");
  });

  it("matches case-insensitively, because GitHub does", () => {
    const found = checkoutForRepo({
      home: "/home",
      owner: "Acme",
      repo: "Widgets",
      ...world({ origins: { "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrap(found)).toBe("/checkouts/widgets");
  });

  it("refuses when no declared checkout is that repository, and names every one it looked at", () => {
    const found = checkoutForRepo({
      home: "/home",
      owner: "acme",
      repo: "missing",
      ...world({ origins: { "/checkouts/other": "acme/other" } }),
    });

    expect(found.isErr()).toBe(true);
    expect(found.isErr() ? found.error.code : "").toBe("CHECKOUT_UNDECLARED");
    expect(found.isErr() ? found.error.slug : "").toBe("acme/missing");
    expect(found.isErr() ? found.error.message : "").toContain("/checkouts/other");
  });

  it("says so plainly when nothing at all is declared", () => {
    const found = checkoutForRepo({ home: "/home", owner: "acme", repo: "widgets", ...world({ origins: {} }) });

    expect(found.isErr()).toBe(true);
    expect(found.isErr() ? found.error.message : "").toContain("Declared: none");
  });

  it("skips a declared path whose origin this build cannot read, rather than taking it", () => {
    const found = checkoutForRepo({
      home: "/home",
      originOf: ({ cwd }) => (cwd === "/checkouts/widgets" ? "acme/widgets" : undefined),
      owner: "acme",
      paths: () => ["/checkouts/unreadable", "/checkouts/widgets"],
      repo: "widgets",
    });

    expect(unwrap(found)).toBe("/checkouts/widgets");
  });
});

describe("checkoutForRunningRepo", () => {
  it("resolves the DECLARED main checkout, not the worktree the caller is standing in", () => {
    const found = checkoutForRunningRepo({
      home: "/home",
      repositoryOf: () => ok({ owner: "acme", repo: "widgets" }),
      root: "/checkouts/widgets/.worktrees/some-branch",
      verb: "machine watch",
      ...world({ origins: { "/checkouts/other": "acme/other", "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrap(found)).toBe("/checkouts/widgets");
  });

  it("resolves through the code's own checkout when the process stands outside every checkout", () => {
    // The scheduled prune's run-due stands in the state home; its code is a worktree of the same repository.
    const found = checkoutForRunningRepo({
      codeRoot: () => "/checkouts/widgets/.worktrees/some-branch",
      home: "/home",
      repositoryOf: ({ cwd }) =>
        cwd === "/checkouts/widgets/.worktrees/some-branch" ? ok({ owner: "acme", repo: "widgets" }) : err(["no"]),
      root: "/home/state",
      verb: "automation run-due",
      ...world({ origins: { "/checkouts/other": "acme/other", "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrap(found)).toBe("/checkouts/widgets");
  });

  it("never asks the code's checkout when the standing one answers", () => {
    const asked: string[] = [];
    const found = checkoutForRunningRepo({
      codeRoot: () => {
        asked.push("code");
        return "/checkouts/other";
      },
      home: "/home",
      repositoryOf: ({ cwd }) =>
        cwd === "/checkouts/widgets" ? ok({ owner: "acme", repo: "widgets" }) : ok({ owner: "acme", repo: "other" }),
      root: "/checkouts/widgets",
      verb: "machine watch",
      ...world({ origins: { "/checkouts/other": "acme/other", "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrap(found)).toBe("/checkouts/widgets");
    expect(asked).toEqual([]);
  });

  it("refuses in the CALLING verb's own words when neither anchor has a readable origin", () => {
    const found = checkoutForRunningRepo({
      codeRoot: () => "/mirror/code",
      home: "/home",
      repositoryOf: () => err(["not a repository"]),
      root: "/somewhere/not-a-repo",
      verb: "machine watch",
      ...world({ origins: { "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrapErr(found)).toEqual([
      "machine watch: neither /somewhere/not-a-repo nor this build's own checkout /mirror/code has a readable " +
        "`origin`, so there is no repository to open a seated session against",
    ]);
  });

  it("refuses naming the standing directory when the code sits in no checkout at all", () => {
    const found = checkoutForRunningRepo({
      codeRoot: () => undefined,
      home: "/home",
      repositoryOf: () => err(["not a repository"]),
      root: "/somewhere/not-a-repo",
      verb: "machine watch",
      ...world({ origins: { "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrapErr(found)).toEqual([
      "machine watch: /somewhere/not-a-repo has no readable `origin`, and this build's own code sits in no " +
        "checkout, so there is no repository to open a seated session against",
    ]);
  });

  it("forwards the undeclared-checkout refusal as a displayable line", () => {
    const found = checkoutForRunningRepo({
      home: "/home",
      repositoryOf: () => ok({ owner: "acme", repo: "widgets" }),
      root: "/checkouts/widgets",
      verb: "machine watch",
      ...world({ origins: { "/checkouts/other": "acme/other" } }),
    });

    expect(found.isErr()).toBe(true);
    expect(found.isErr() ? found.error.length : 0).toBe(1);
    expect(found.isErr() ? found.error[0]! : "").toContain("no declared main checkout has acme/widgets");
  });
});

describe("checkoutForRepoName", () => {
  it("finds the one declared checkout whose origin repository carries that name, whatever its owner", () => {
    const found = checkoutForRepoName({
      home: "/home",
      name: "slopweaver",
      ...world({ origins: { "/checkouts/other": "acme/other", "/dev/slopweaver": "lachiejames/slopweaver" } }),
    });

    expect(unwrap(found)).toBe("/dev/slopweaver");
  });

  it("matches case-insensitively", () => {
    const found = checkoutForRepoName({
      home: "/home",
      name: "SlopWeaver",
      ...world({ origins: { "/dev/slopweaver": "lachiejames/slopweaver" } }),
    });

    expect(unwrap(found)).toBe("/dev/slopweaver");
  });

  it("refuses a name no declared checkout carries, naming every one it looked at", () => {
    const found = checkoutForRepoName({
      home: "/home",
      name: "slopweaver",
      ...world({ origins: { "/checkouts/widgets": "acme/widgets" } }),
    });

    expect(unwrapErr(found)).toEqual(
      CheckoutNameErrors.undeclared({ declared: ["/checkouts/widgets"], name: "slopweaver" }),
    );
    expect(unwrapErr(found).message).toContain("a bare name is never read as a directory");
  });

  it("refuses a name two owners share rather than picking one", () => {
    const found = checkoutForRepoName({
      home: "/home",
      name: "widgets",
      ...world({ origins: { "/a/widgets": "acme/widgets", "/b/widgets": "globex/widgets" } }),
    });

    expect(unwrapErr(found)).toEqual(
      CheckoutNameErrors.ambiguous({ matches: ["/a/widgets", "/b/widgets"], name: "widgets" }),
    );
  });

  it("skips a declared checkout with no readable origin", () => {
    const found = checkoutForRepoName({
      home: "/home",
      name: "widgets",
      originOf: ({ cwd }) => (cwd === "/b/widgets" ? "acme/widgets" : undefined),
      paths: () => ["/a/unreadable", "/b/widgets"],
    });

    expect(unwrap(found)).toBe("/b/widgets");
  });
});
