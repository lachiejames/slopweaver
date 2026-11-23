import { describe, expect, it } from "vitest";

import { githubCodeownerRequirement } from "../../../review/githubCodeowners.js";

const EMPTY = { requests: [], requestsTruncated: false, reviews: [], reviewsTruncated: false } as const;

describe("githubCodeownerRequirement", () => {
  it("reports no requirement when GitHub flags nothing", () => {
    const answer = githubCodeownerRequirement({ ...EMPTY });
    expect(answer.owners).toEqual([]);
    expect(answer.teams).toEqual([]);
    expect(answer.users).toEqual([]);
    expect(answer.sentence).toBe("GitHub reports no code-owner review requirement on this pull request");
  });

  it("keeps only the review requests GitHub flagged as code-owner requests", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      requests: [
        { asCodeOwner: true, kind: "team", name: "acme/eng" },
        { asCodeOwner: false, kind: "user", name: "a-volunteer" },
      ],
    });
    expect(answer.owners).toEqual([{ kind: "team", state: "pending", token: "@acme/eng" }]);
    expect(answer.users).toEqual([]);
    expect(answer.sentence).toBe("GitHub reports these code owners: @acme/eng (pending)");
  });

  it("reads a satisfied team owner off the team an approval was submitted on behalf of", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      reviews: [{ login: "reviewer", onBehalfOf: ["acme/eng"], state: "APPROVED" }],
    });
    expect(answer.owners).toEqual([{ kind: "team", state: "approved", token: "@acme/eng" }]);
    expect(answer.teams).toEqual(["@acme/eng"]);
  });

  it("ignores an onBehalfOf team on a review that did not approve", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      reviews: [{ login: "reviewer", onBehalfOf: ["acme/eng"], state: "CHANGES_REQUESTED" }],
    });
    expect(answer.owners).toEqual([]);
  });

  it("reports a team as pending when a request is still open despite an earlier approval", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
      reviews: [{ login: "reviewer", onBehalfOf: ["acme/eng"], state: "APPROVED" }],
    });
    expect(answer.owners).toEqual([{ kind: "team", state: "pending", token: "@acme/eng" }]);
  });

  it("sorts teams before users and alphabetically within each kind", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      requests: [
        { asCodeOwner: true, kind: "user", name: "zed" },
        { asCodeOwner: true, kind: "team", name: "acme/zebra" },
        { asCodeOwner: true, kind: "user", name: "abe" },
        { asCodeOwner: true, kind: "team", name: "acme/ants" },
      ],
    });
    expect(answer.owners.map((owner) => owner.token)).toEqual(["@acme/ants", "@acme/zebra", "@abe", "@zed"]);
    expect(answer.teams).toEqual(["@acme/ants", "@acme/zebra"]);
    expect(answer.users).toEqual(["@abe", "@zed"]);
  });

  it("leaves an already-@-prefixed name alone rather than doubling the prefix", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      requests: [{ asCodeOwner: true, kind: "team", name: "@acme/eng" }],
    });
    expect(answer.teams).toEqual(["@acme/eng"]);
  });

  it("always states that a satisfied individual owner is invisible to GitHub's flags", () => {
    const answer = githubCodeownerRequirement({ ...EMPTY });
    expect(answer.residue).toEqual([
      "GitHub retires a code-owner review request once it is satisfied, so an INDIVIDUAL owner who has " +
        "already approved leaves no `asCodeOwner` request behind and is not distinguishable here from any " +
        "other approver; a satisfied TEAM is, through the review's `onBehalfOf`",
    ]);
  });

  it("adds one residue line per truncated connection", () => {
    const answer = githubCodeownerRequirement({ ...EMPTY, requestsTruncated: true, reviewsTruncated: true });
    expect(answer.residue.length).toBe(3);
    expect(answer.residue[1]).toBe(
      "GitHub reported more review requests than this read asked for, so a pending owner may be missing",
    );
    expect(answer.residue[2]).toBe(
      "GitHub reported more reviews than this read asked for, so an approved team owner may be missing",
    );
  });

  it("drops a request whose reviewer GitHub named with neither a login nor a slug", () => {
    const answer = githubCodeownerRequirement({
      ...EMPTY,
      requests: [{ asCodeOwner: true, kind: "user", name: "" }],
    });
    expect(answer.owners).toEqual([]);
  });
});
