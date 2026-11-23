/**
 * The org-domain inference — the half of the mention fix that decides who counts as a colleague.
 *
 * Every domain here is `example.*` or `.test`: the real set is org-specific and may never be committed,
 * which is the same reason `resolveOrgDomains` infers it rather than naming it.
 */
import { describe, expect, it } from "vitest";

import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  domainLabel,
  emailDomain,
  isOrgEmail,
  parseOrgDomainsFile,
  resolveOrgDomains,
} from "../../../silver/orgDomains.js";

/** One member row carrying an email at `domain`. */
function member({ id, domain, bot = false }: { id: string; domain: string; bot?: boolean }): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-08-30T00:00:00.000Z",
    identity: {
      email: `${id}@${domain}`,
      emailNormalised: `${id}@${domain}`,
      emailTrust: "trusted",
      nativeId: id,
      source: "slack",
    },
    profile: { bot },
    provenance: [],
    raw: {},
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/** `count` members at one domain, ids prefixed so two domains never collide. */
function membersAt({ domain, count, from = 0 }: { domain: string; count: number; from?: number }): MemberBronzeRow[] {
  return Array.from({ length: count }, (_, index) => member({ domain, id: `u${String(from + index)}` }));
}

describe("emailDomain", () => {
  it("takes the part after the last @", () => {
    expect(emailDomain({ email: "Ada.Lovelace@Example.COM" })).toBe("example.com");
  });

  it("has no domain for a string with no @", () => {
    expect(emailDomain({ email: "ada" })).toBe(undefined);
  });

  it("has no domain for a trailing @", () => {
    expect(emailDomain({ email: "ada@" })).toBe(undefined);
  });
});

describe("domainLabel", () => {
  it("reads the first label, whatever the suffix", () => {
    expect(domainLabel({ domain: "example.com.au" })).toBe("example");
    expect(domainLabel({ domain: "example.co.nz" })).toBe("example");
    expect(domainLabel({ domain: "notexample.com" })).toBe("notexample");
  });

  it("reads a domain with no dot as its own label, and an empty one as empty", () => {
    expect(domainLabel({ domain: "localhost" })).toBe("localhost");
    expect(domainLabel({ domain: "" })).toBe("");
  });
});

describe("parseOrgDomainsFile", () => {
  it("reads one domain per line, ignoring comments, blanks and a leading @", () => {
    const domains = parseOrgDomainsFile({
      content: "# ours\n@Example.com\n\nexample.net  # the other one\n",
    });

    expect(domains).toEqual(["example.com", "example.net"]);
  });

  it("reads nothing from an empty file", () => {
    expect(parseOrgDomainsFile({ content: "\n\n# only a comment\n" })).toEqual([]);
  });
});

describe("resolveOrgDomains", () => {
  it("takes the configured set outright, ignoring what the corpus says", () => {
    const settled = unwrap(
      resolveOrgDomains({ configured: ["example.net"], rows: membersAt({ count: 50, domain: "example.com" }) }),
    );

    expect(settled.domains).toEqual(["example.net"]);
    expect(settled.basis).toBe("configured: example.net");
  });

  it("infers the plurality domain and its sibling TLDs", () => {
    const settled = unwrap(
      resolveOrgDomains({
        rows: [
          ...membersAt({ count: 40, domain: "example.com.au" }),
          ...membersAt({ count: 3, domain: "example.co.nz", from: 100 }),
          ...membersAt({ count: 6, domain: "webmail.test", from: 200 }),
        ],
      }),
    );

    expect(settled.domains).toEqual(["example.co.nz", "example.com.au"]);
  });

  it("counts a member once however many rows they have", () => {
    const rows = [...membersAt({ count: 6, domain: "example.com" }), ...membersAt({ count: 6, domain: "example.com" })];

    expect(unwrap(resolveOrgDomains({ rows })).basis).toBe(
      "inferred: 6 members on the plurality domain, 0 on the runner-up, 1 sibling domain(s)",
    );
  });

  it("ignores bots, which are the accounts most likely to sit at a vendor domain", () => {
    const rows = [
      ...membersAt({ count: 6, domain: "example.com" }),
      member({ bot: true, domain: "vendor.test", id: "bot-1" }),
      member({ bot: true, domain: "vendor.test", id: "bot-2" }),
      member({ bot: true, domain: "vendor.test", id: "bot-3" }),
      member({ bot: true, domain: "vendor.test", id: "bot-4" }),
    ];

    expect(unwrap(resolveOrgDomains({ rows })).domains).toEqual(["example.com"]);
  });

  it("refuses when no member carries an email at all", () => {
    const settled = resolveOrgDomains({ rows: [] });

    expect(settled.isErr()).toBe(true);
    expect(unwrapErr(settled)[0]).toContain("no member email carries a domain");
  });

  it("refuses a plurality too small to be evidence of an organisation", () => {
    const settled = resolveOrgDomains({ rows: membersAt({ count: 4, domain: "example.com" }) });

    expect(settled.isErr()).toBe(true);
    expect(unwrapErr(settled)[0]).toContain("no email domain is a clear plurality");
  });

  it("refuses a plurality that does not clear the runner-up by the stated margin", () => {
    const settled = resolveOrgDomains({
      rows: [
        ...membersAt({ count: 8, domain: "example.com" }),
        ...membersAt({ count: 6, domain: "other.test", from: 100 }),
      ],
    });

    expect(settled.isErr()).toBe(true);
    expect(unwrapErr(settled)[0]).toContain("top holds 8 members, runner-up 6");
  });

  it("tallies every domain's voters, naming the runner-up's count beside the plurality's", () => {
    const rows = [
      ...membersAt({ count: 9, domain: "example.com" }),
      ...membersAt({ count: 2, domain: "other.test", from: 100 }),
      ...membersAt({ count: 1, domain: "third.test", from: 200 }),
    ];

    expect(unwrap(resolveOrgDomains({ rows })).basis).toBe(
      "inferred: 9 members on the plurality domain, 2 on the runner-up, 1 sibling domain(s)",
    );
  });
});

describe("isOrgEmail", () => {
  it("accepts an address at an org domain", () => {
    expect(isOrgEmail({ email: "Ada@Example.com", orgDomains: ["example.com"] })).toBe(true);
  });

  it("rejects an address anywhere else", () => {
    expect(isOrgEmail({ email: "ada@other.test", orgDomains: ["example.com"] })).toBe(false);
  });

  it("rejects everything when no domains were settled", () => {
    expect(isOrgEmail({ email: "ada@example.com", orgDomains: [] })).toBe(false);
  });
});
