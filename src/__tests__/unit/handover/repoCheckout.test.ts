/**
 * `checkoutFor` — which checkout a row's `repo:` may name, the one judge `handover register` and `handover
 * set-repo` share. Pure over its three seams: no git, no profile.
 */
import { describe, expect, it } from "vitest";

import {
  type CheckoutProbe,
  checkoutFor,
  RepoCheckoutErrors,
  trimmedRepoValue,
} from "../../../handover/repoCheckout.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

/** A probe that answers the same thing for every path. */
const probing =
  ({ probe }: { probe: CheckoutProbe }) =>
  (): CheckoutProbe =>
    probe;

/** A slug resolver that must never be reached. */
const noSlug = (): Result<string, { readonly message: string }> => err({ message: "no slug expected" });

/** A name resolver that must never be reached. */
const noName = (): Result<string, { readonly message: string }> => err({ message: "no name expected" });

describe("checkoutFor", () => {
  it("accepts the top of a main checkout, writing the top git reported", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "main", top: "/w/repo" } }),
      requested: "/w/repo/",
    });
    expect(unwrap(result)).toBe("/w/repo");
  });

  it("refuses a subdirectory, naming the top to pass instead", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "nested", top: "/w/repo" } }),
      requested: "/w/repo/src",
    });
    expect(unwrapErr(result)).toEqual(RepoCheckoutErrors.nested({ requested: "/w/repo/src", top: "/w/repo" }));
    expect(unwrapErr(result).message).toBe(
      "/w/repo/src is inside the checkout /w/repo, not its top — pass --repo /w/repo",
    );
  });

  it("refuses a linked worktree, because the row would lose its repo when the worktree goes", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "linked-worktree", top: "/w/repo/.claude/worktrees.noindex/seat" } }),
      requested: "/w/repo/.claude/worktrees.noindex/seat",
    });
    expect(unwrapErr(result).code).toBe("REPO_LINKED_WORKTREE");
    expect(unwrapErr(result).message).toContain("is a linked worktree");
  });

  it("refuses a path that is not a git checkout", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "not-a-checkout" } }),
      requested: "/nowhere",
    });
    expect(unwrapErr(result)).toEqual(RepoCheckoutErrors.notACheckout({ requested: "/nowhere" }));
  });

  it("resolves owner/name through the declared checkouts' origins, to the top of a main checkout", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: ({ owner, repo }) => ok(`/declared/${owner}-${repo}`),
      inspect: ({ path }) => ({ kind: "main", top: path }),
      requested: "acme/widgets",
    });
    expect(unwrap(result)).toBe("/declared/acme-widgets");
  });

  it("refuses an owner/name whose declared checkout is a linked worktree", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: () => ok("/w/widgets-seat"),
      inspect: probing({ probe: { kind: "linked-worktree", top: "/w/widgets-seat" } }),
      requested: "acme/widgets",
    });
    expect(unwrapErr(result)).toEqual(
      RepoCheckoutErrors.linkedWorktree({ requested: "/w/widgets-seat", top: "/w/widgets-seat" }),
    );
  });

  it("names an owner/name no declared checkout has as its own refusal", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "main", top: "/w/repo" } }),
      requested: "acme/widgets",
    });
    expect(unwrapErr(result)).toEqual(RepoCheckoutErrors.slugUndeclared({ message: "no slug expected" }));
  });

  it("refuses a value carrying a line break before anything is probed", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "main", top: "/w/repo" } }),
      requested: "/w/repo\nstatus: done",
    });
    expect(unwrapErr(result).code).toBe("REPO_LINE_BREAK");
  });
});

describe("checkoutFor — a bare repository name", () => {
  it("resolves a bare name through the declared checkouts, to the top of a main checkout (tick 188's `slopweaver`)", () => {
    const result = checkoutFor({
      byName: ({ name }) => ok(`/dev/personal/${name}`),
      bySlug: noSlug,
      inspect: ({ path }) => ({ kind: "main", top: path }),
      requested: "slopweaver",
    });
    expect(unwrap(result)).toBe("/dev/personal/slopweaver");
  });

  it("refuses a bare name no declared checkout carries, rather than reading it as a directory", () => {
    const result = checkoutFor({
      byName: () => err({ message: "no declared main checkout has a repository named slopweaver" }),
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "main", top: "/here/slopweaver" } }),
      requested: "slopweaver",
    });
    expect(unwrapErr(result)).toEqual(
      RepoCheckoutErrors.nameUnresolved({ message: "no declared main checkout has a repository named slopweaver" }),
    );
  });

  it("refuses a bare name whose declared checkout is a linked worktree", () => {
    const result = checkoutFor({
      byName: () => ok("/w/seat"),
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "linked-worktree", top: "/w/seat" } }),
      requested: "widgets",
    });
    expect(unwrapErr(result).code).toBe("REPO_LINKED_WORKTREE");
  });

  it("reads ./name as a path, never a name — the spelling the name refusal points to", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: ({ path }) => ({ kind: "main", top: `/here/${path.slice(2)}` }),
      requested: "./slopweaver",
    });
    expect(unwrap(result)).toBe("/here/slopweaver");
  });

  it("reads . and .. as paths", () => {
    const inspect = ({ path }: { path: string }): CheckoutProbe => ({ kind: "main", top: `/top${path}` });
    expect(unwrap(checkoutFor({ byName: noName, bySlug: noSlug, inspect, requested: "." }))).toBe("/top.");
    expect(unwrap(checkoutFor({ byName: noName, bySlug: noSlug, inspect, requested: ".." }))).toBe("/top..");
  });
});

describe("checkoutFor — a relative path that looks like owner/name", () => {
  it("reads ../name as a path, never owner `..`", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: ({ path }) => ({ kind: "main", top: `/up/${path.slice(3)}` }),
      requested: "../widgets",
    });
    expect(unwrap(result)).toBe("/up/widgets");
  });
});

describe("checkoutFor — a top the row cannot record faithfully", () => {
  it("refuses a checkout top ending in whitespace, which a trimmed front-matter read would turn into a sibling", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "main", top: "/r/repo " } }),
      requested: "/r/repo /",
    });
    expect(unwrapErr(result)).toEqual(RepoCheckoutErrors.unrecordable({ top: "/r/repo " }));
  });

  it("refuses a checkout top holding a line break, reached through a symlink the typed value did not carry (r3)", () => {
    const result = checkoutFor({
      byName: noName,
      bySlug: noSlug,
      inspect: probing({ probe: { kind: "main", top: "/r/a\nb" } }),
      requested: "/r/link",
    });
    expect(unwrapErr(result)).toEqual(RepoCheckoutErrors.unrecordable({ top: "/r/a\nb" }));
  });
});

describe("trimmedRepoValue", () => {
  /** A disk on which nothing exists, so trimming can never name a different directory. */
  const nothingExists = (): boolean => false;

  it("trims a padded value, as the row's own parser always read one", () => {
    expect(unwrap(trimmedRepoValue({ exists: nothingExists, raw: " /abs/main " }))).toBe("/abs/main");
  });

  it("refuses an empty or all-space value, which would otherwise resolve to the process's own cwd", () => {
    expect(unwrapErr(trimmedRepoValue({ exists: nothingExists, raw: "" }))).toEqual(RepoCheckoutErrors.empty());
    expect(unwrapErr(trimmedRepoValue({ exists: nothingExists, raw: "  " }))).toEqual(RepoCheckoutErrors.empty());
  });

  it("refuses a padded value whose untrimmed path exists, since trimming would name a different directory", () => {
    const result = trimmedRepoValue({ exists: ({ path }) => path === "/r/repo ", raw: "/r/repo " });
    expect(unwrapErr(result)).toEqual(RepoCheckoutErrors.padded({ requested: "/r/repo " }));
  });

  it("passes an unpadded value through without asking the disk", () => {
    expect(unwrap(trimmedRepoValue({ exists: () => true, raw: "/r/repo" }))).toBe("/r/repo");
  });
});
