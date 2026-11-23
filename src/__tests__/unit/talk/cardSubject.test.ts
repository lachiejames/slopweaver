/**
 * Whose pull request a `pr:` card names, from the newest landing document — the shape of an
 * every-author reading whose census still names the token's own login — consulting only the card's own repository.
 */
import { describe, expect, it } from "vitest";

import { prCardSubject } from "../../../talk/cardSubject.js";

const AT = "2026-10-02T03:48:53.964Z";

/** One census repository read as `octocat`. */
const read = ({ repo, prs }: { repo: string; prs: readonly Record<string, unknown>[] }): Record<string, unknown> => ({
  kind: "read",
  pullRequests: prs,
  repo,
  viewer: "octocat",
});

/** A bump seat's reading: no author selected, census and rows over everybody's. */
const EVERY_AUTHOR = {
  census: [
    read({
      prs: [{ author: "user1-acme", number: 18277 }, { author: "OctoCat", number: 18100 }, { number: 17000 }],
      repo: "acme/acme-admin",
    }),
  ],
  rows: [{ number: 18277 }, { number: 18100 }],
  selection: { includeDrafts: false, repos: ["acme/acme-admin"] },
};

describe("prCardSubject", () => {
  it("says a colleague's pull request is not the owner's even on the every-author reading that drew it", () => {
    expect(prCardSubject({ cardKey: "pr:acme.acme-admin.18277", document: EVERY_AUTHOR, observedAtIso: AT })).toEqual({
      kind: "not-owner",
      why: `acme/acme-admin#18277 was opened by user1-acme, not octocat (the landing reading of ${AT})`,
    });
  });

  it("says the owner's own is theirs, comparing the login without case", () => {
    expect(prCardSubject({ cardKey: "pr:acme.acme-admin.18100", document: EVERY_AUTHOR, observedAtIso: AT })).toEqual({
      kind: "owner",
    });
  });

  it("names a deleted account when GitHub lists the pull request with no author", () => {
    expect(prCardSubject({ cardKey: "pr:acme.acme-admin.17000", document: EVERY_AUTHOR, observedAtIso: AT })).toEqual({
      kind: "not-owner",
      why: `acme/acme-admin#17000 was opened by a deleted account, not octocat (the landing reading of ${AT})`,
    });
  });

  it("judges each repository's #5 by that repository alone, when one is a colleague's and one is the owner's", () => {
    const document = {
      census: [
        read({ prs: [{ author: "someone", number: 5 }], repo: "a/b" }),
        read({ prs: [{ author: "octocat", number: 5 }], repo: "a/c" }),
      ],
    };
    expect(prCardSubject({ cardKey: "pr:a.b.5", document, observedAtIso: AT })).toEqual({
      kind: "not-owner",
      why: `a/b#5 was opened by someone, not octocat (the landing reading of ${AT})`,
    });
    expect(prCardSubject({ cardKey: "pr:a.c.5", document, observedAtIso: AT })).toEqual({ kind: "owner" });
  });

  it("matches the repository without case, and keeps the dots of a dotted repository name", () => {
    const document = { census: [read({ prs: [{ author: "someone", number: 9 }], repo: "Acme/Widgets.Api" })] };
    expect(prCardSubject({ cardKey: "pr:acme.widgets.api.9", document, observedAtIso: AT })).toEqual({
      kind: "not-owner",
      why: `acme/widgets.api#9 was opened by someone, not octocat (the landing reading of ${AT})`,
    });
  });

  it("never refuses a pull request the reading does not list — the owner's own, merged since it was read", () => {
    expect(JSON.stringify(EVERY_AUTHOR)).not.toContain("16406");
    expect(prCardSubject({ cardKey: "pr:acme.acme-admin.16406", document: EVERY_AUTHOR, observedAtIso: AT })).toEqual({
      kind: "owner",
    });
  });

  it("never refuses on a document with no census, nor over a repository the census could not read", () => {
    const older = { rows: [], selection: { includeDrafts: true, repos: ["a/b"] } };
    const unread = { census: [{ kind: "unread", repo: "a/b", why: "rate limited" }], rows: [] };
    expect(prCardSubject({ cardKey: "pr:a.b.942", document: older, observedAtIso: AT })).toEqual({ kind: "owner" });
    expect(prCardSubject({ cardKey: "pr:a.b.1", document: unread, observedAtIso: AT })).toEqual({ kind: "owner" });
  });

  it("refuses a key naming no repository and number — a bare number included — and never refuses over a document that says nothing", () => {
    expect(prCardSubject({ cardKey: "pr:18277", document: EVERY_AUTHOR, observedAtIso: AT })).toEqual({
      kind: "not-owner",
      why: '"pr:18277" names no pull request by repository and number',
    });
    expect(prCardSubject({ cardKey: "pr:a.b.1", document: [], observedAtIso: AT })).toEqual({ kind: "owner" });
  });
});
