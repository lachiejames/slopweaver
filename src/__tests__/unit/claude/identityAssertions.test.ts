import { describe, expect, it } from "vitest";

import { claudeErrorLines } from "../../../claude/claudeErrors.js";
import {
  assertionFor,
  assessIdentity,
  type ClaudeIdentityAssertion,
  collidingAliases,
  establishAssertion,
  identityFileProblem,
  parseIdentityAssertions,
  reenrollAssertions,
  renderIdentityStatus,
} from "../../../claude/identityAssertions.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ASSERTED = "2026-09-05T14:53:28.136Z";
const NOW = "2026-09-09T15:00:00.000Z";

/** Synthetic organisation ids, so a test can prove a rendered string never carries one. */
const ORG_A = "org-aaaa-0000";
const ORG_B = "org-bbbb-1111";

const assertion = ({
  alias,
  organizationId = ORG_A,
}: {
  alias: string;
  organizationId?: string;
}): ClaudeIdentityAssertion => ({ alias, assertedAtIso: ASSERTED, organizationId });

describe("assessIdentity", () => {
  it("reports CHANGED when the live account is not the asserted one — plan-one's real state, measured", () => {
    const status = assessIdentity({
      alias: "plan-one",
      assertion: assertion({ alias: "plan-one", organizationId: ORG_A }),
      observedOrganizationId: ORG_B,
    });

    expect(status.kind).toBe("changed");
    expect(status.alias).toBe("plan-one");
  });

  it("reports match when the live account is the asserted one", () => {
    const status = assessIdentity({
      alias: "plan-one",
      assertion: assertion({ alias: "plan-one" }),
      observedOrganizationId: ORG_A,
    });

    expect(status.kind).toBe("match");
  });

  it("reports unbound when nothing has been asserted, never adopting what it found", () => {
    const status = assessIdentity({ alias: "plan-two", observedOrganizationId: ORG_B });

    expect(status.kind).toBe("unbound");
  });

  it("reports unobserved, not changed, when the store could not be read this pass", () => {
    const status = assessIdentity({ alias: "plan-three", assertion: assertion({ alias: "plan-three" }) });

    expect(status.kind).toBe("unobserved");
  });

  it("stays CHANGED across repeated observations, so the drift cannot erase its own evidence", () => {
    const standing = assertion({ alias: "plan-one", organizationId: ORG_A });
    const first = assessIdentity({ alias: "plan-one", assertion: standing, observedOrganizationId: ORG_B });
    const second = assessIdentity({ alias: "plan-one", assertion: standing, observedOrganizationId: ORG_B });

    expect(first.kind).toBe("changed");
    expect(second.kind).toBe("changed");
  });
});

describe("establishAssertion", () => {
  it("establishes an assertion for an unbound store", () => {
    const result = establishAssertion({ alias: "plan-two", assertions: [], nowIso: NOW, organizationId: ORG_B });

    expect(result.established).toBe(true);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]!.alias).toBe("plan-two");
    expect(result.assertions[0]!.assertedAtIso).toBe(NOW);
  });

  it("REFUSES to overwrite a standing assertion, which is the whole mechanism", () => {
    const standing = [assertion({ alias: "plan-one", organizationId: ORG_A })];
    const result = establishAssertion({
      alias: "plan-one",
      assertions: standing,
      nowIso: NOW,
      organizationId: ORG_B,
    });

    expect(result.established).toBe(false);
    expect(result.assertions).toStrictEqual(standing);
    expect(result.assertions[0]!.assertedAtIso).toBe(ASSERTED);
  });

  it("leaves other stores untouched when it establishes one", () => {
    const result = establishAssertion({
      alias: "plan-two",
      assertions: [assertion({ alias: "plan-one" })],
      nowIso: NOW,
      organizationId: ORG_B,
    });

    expect(result.assertions.map((entry) => entry.alias)).toEqual(["plan-one", "plan-two"]);
  });
});

describe("reenrollAssertions", () => {
  const ORG_C = "org-cccc-2222";
  const three = [
    assertion({ alias: "plan-one", organizationId: ORG_A }),
    assertion({ alias: "plan-two", organizationId: ORG_B }),
    assertion({ alias: "plan-three", organizationId: ORG_C }),
  ];

  it("replaces the sole standing row IN PLACE and leaves every neighbour as it was", () => {
    const result = unwrap(
      reenrollAssertions({
        assertions: three,
        changes: [{ alias: "plan-two", organizationId: "org-new" }],
        nowIso: NOW,
      }),
    );

    expect(result.assertions).toEqual([
      three[0],
      { alias: "plan-two", assertedAtIso: NOW, organizationId: "org-new" },
      three[2],
    ]);
    expect(result.replaced).toEqual([{ alias: "plan-two", replacedAssertedAtIso: ASSERTED }]);
  });

  // The shape measured live: stores holding a PERMUTATION of their enrolled accounts. Any single
  // store collides with another row that is itself about to change, so only the whole set can be judged.
  it("clears a permutation in one judgement, which no one-at-a-time order can", () => {
    const rotated = [
      { alias: "plan-one", organizationId: ORG_B },
      { alias: "plan-two", organizationId: ORG_C },
      { alias: "plan-three", organizationId: ORG_A },
    ];

    const alone = claudeErrorLines({
      error: unwrapErr(reenrollAssertions({ assertions: three, changes: rotated.slice(0, 1), nowIso: NOW })),
    });
    const together = unwrap(reenrollAssertions({ assertions: three, changes: rotated, nowIso: NOW }));

    expect(alone).toEqual([
      "plan-one: NOT RE-ENROLLED — this account would also be enrolled under plan-two; sign in a distinct account",
    ]);
    expect(together.assertions.map((entry) => entry.organizationId)).toEqual([ORG_B, ORG_C, ORG_A]);
    expect(together.replaced.map((row) => row.alias)).toEqual(["plan-one", "plan-two", "plan-three"]);
  });

  it("refreshes the instant when the account is unchanged, since the act is still deliberate", () => {
    const result = unwrap(
      reenrollAssertions({ assertions: three, changes: [{ alias: "plan-two", organizationId: ORG_B }], nowIso: NOW }),
    );

    expect(result.assertions[1]).toEqual({ alias: "plan-two", assertedAtIso: NOW, organizationId: ORG_B });
  });

  it("REFUSES a store with no standing enrollment, which is a first enrollment and a different act", () => {
    const problems = claudeErrorLines({
      error: unwrapErr(
        reenrollAssertions({
          assertions: three,
          changes: [{ alias: "plan-four", organizationId: "org-new" }],
          nowIso: NOW,
        }),
      ),
    });

    expect(problems).toEqual([
      "plan-four: NOT RE-ENROLLED — no standing enrollment exists; use `slopweaver claude signin --enroll plan-four` for a first enrollment",
    ]);
  });

  it("REFUSES an alias with two standing rows rather than guessing which one stands", () => {
    const doubled = [...three, assertion({ alias: "plan-two", organizationId: ORG_C })];

    const problems = claudeErrorLines({
      error: unwrapErr(
        reenrollAssertions({
          assertions: doubled,
          changes: [{ alias: "plan-two", organizationId: "org-new" }],
          nowIso: NOW,
        }),
      ),
    });

    expect(problems).toEqual([
      "plan-two: NOT RE-ENROLLED — 2 standing enrollment rows use this alias; repair the assertions file before trying again",
    ]);
  });

  it("REFUSES an account the final list would hold twice, naming aliases and never the organisation", () => {
    const problems = claudeErrorLines({
      error: unwrapErr(
        reenrollAssertions({ assertions: three, changes: [{ alias: "plan-two", organizationId: ORG_A }], nowIso: NOW }),
      ),
    });

    expect(problems).toEqual([
      "plan-two: NOT RE-ENROLLED — this account would also be enrolled under plan-one; sign in a distinct account",
    ]);
    expect(problems.join(" ")).not.toContain(ORG_A);
  });

  it("is all-or-nothing: one bad store refuses the whole set", () => {
    const problems = claudeErrorLines({
      error: unwrapErr(
        reenrollAssertions({
          assertions: three,
          changes: [
            { alias: "plan-two", organizationId: "org-new" },
            { alias: "plan-four", organizationId: "org-newer" },
          ],
          nowIso: NOW,
        }),
      ),
    });

    expect(problems).toEqual([
      "plan-four: NOT RE-ENROLLED — no standing enrollment exists; use `slopweaver claude signin --enroll plan-four` for a first enrollment",
    ]);
  });

  it("REFUSES a store named twice, and an empty set", () => {
    const twice = [
      { alias: "plan-two", organizationId: "org-new" },
      { alias: "plan-two", organizationId: "org-newer" },
    ];

    expect(
      claudeErrorLines({ error: unwrapErr(reenrollAssertions({ assertions: three, changes: twice, nowIso: NOW })) }),
    ).toEqual(["NOT RE-ENROLLED — plan-two named more than once"]);
    expect(
      claudeErrorLines({ error: unwrapErr(reenrollAssertions({ assertions: three, changes: [], nowIso: NOW })) }),
    ).toEqual(["NOT RE-ENROLLED — no store was named"]);
  });

  it("is not blocked by a collision between two OTHER stores", () => {
    const tangled = [...three, assertion({ alias: "plan-four", organizationId: ORG_C })];

    const result = unwrap(
      reenrollAssertions({
        assertions: tangled,
        changes: [{ alias: "plan-two", organizationId: "org-new" }],
        nowIso: NOW,
      }),
    );

    expect(result.assertions[1]!.organizationId).toBe("org-new");
  });
});

describe("parseIdentityAssertions", () => {
  it("reads back what was stored", () => {
    const parsed = parseIdentityAssertions({
      value: { assertions: [{ alias: "plan-one", assertedAtIso: ASSERTED, organizationId: ORG_A }] },
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.alias).toBe("plan-one");
  });

  it("answers empty for anything unrecognisable rather than throwing", () => {
    expect(parseIdentityAssertions({ value: undefined })).toEqual([]);
    expect(parseIdentityAssertions({ value: { assertions: "nope" } })).toEqual([]);
    expect(parseIdentityAssertions({ value: 7 })).toEqual([]);
  });

  it("drops a malformed entry and keeps the usable ones", () => {
    const parsed = parseIdentityAssertions({
      value: {
        assertions: [
          { alias: "good", assertedAtIso: ASSERTED, organizationId: ORG_A },
          { alias: "no-org", assertedAtIso: ASSERTED },
        ],
      },
    });

    expect(parsed.map((entry) => entry.alias)).toEqual(["good"]);
  });
});

describe("collidingAliases", () => {
  it("names both stores when one account is asserted for two of them", () => {
    const colliding = collidingAliases({
      assertions: [
        assertion({ alias: "plan-one", organizationId: ORG_A }),
        assertion({ alias: "plan-two", organizationId: ORG_A }),
        assertion({ alias: "plan-three", organizationId: ORG_B }),
      ],
    });

    expect(colliding).toEqual(["plan-one", "plan-two"]);
  });

  it("answers empty when every store holds a distinct account", () => {
    const colliding = collidingAliases({
      assertions: [
        assertion({ alias: "plan-one", organizationId: ORG_A }),
        assertion({ alias: "plan-two", organizationId: ORG_B }),
      ],
    });

    expect(colliding).toEqual([]);
  });
});

describe("assertionFor", () => {
  it("finds the assertion standing for a store", () => {
    const found = assertionFor({
      alias: "plan-two",
      assertions: [assertion({ alias: "plan-one" }), assertion({ alias: "plan-two", organizationId: ORG_B })],
    });

    expect(found!.alias).toBe("plan-two");
  });

  it("answers undefined for an unbound store", () => {
    expect(assertionFor({ alias: "plan-nine", assertions: [] })).toBeUndefined();
  });
});

describe("renderIdentityStatus", () => {
  it("names the instant a changed store was enrolled, and never an organisation", () => {
    const line = renderIdentityStatus({
      status: { alias: "plan-one", assertedAtIso: ASSERTED, kind: "changed" },
    });

    expect(line).toBe(`plan-one identity: CHANGED since ${ASSERTED} — a sign-in replaced this slot`);
    expect(line).not.toContain(ORG_A);
    expect(line).not.toContain(ORG_B);
  });

  it("renders each of the four verdicts distinctly", () => {
    const unbound = renderIdentityStatus({ status: { alias: "p", kind: "unbound" } });
    const unobserved = renderIdentityStatus({ status: { alias: "p", assertedAtIso: ASSERTED, kind: "unobserved" } });
    const match = renderIdentityStatus({ status: { alias: "p", assertedAtIso: ASSERTED, kind: "match" } });

    expect(unbound).toContain("unbound");
    expect(unobserved).toContain("unchecked this pass");
    expect(match).toContain("matches the account enrolled");
  });
});

describe("identityFileProblem", () => {
  it("names a BARE ARRAY, the exact shape a consumer wrote and lost every assertion to", () => {
    const problem = identityFileProblem({
      value: [{ alias: "plan-one", assertedAtIso: ASSERTED, organizationId: ORG_A }],
    });

    expect(problem).toContain("a bare array");
    expect(problem).toContain("read as unbound");
  });

  it("answers undefined for an absent file, which is not a problem", () => {
    expect(identityFileProblem({ value: undefined })).toBeUndefined();
    expect(identityFileProblem({ value: null })).toBeUndefined();
  });

  it("answers undefined for a usable document", () => {
    const problem = identityFileProblem({
      value: { assertions: [{ alias: "plan-one", assertedAtIso: ASSERTED, organizationId: ORG_A }] },
    });

    expect(problem).toBeUndefined();
  });

  it("names a document with no assertions array", () => {
    expect(identityFileProblem({ value: { nope: true } })).toContain("no `assertions` array");
  });

  it("counts entries dropped as malformed rather than reporting the file clean", () => {
    const problem = identityFileProblem({
      value: {
        assertions: [
          { alias: "good", assertedAtIso: ASSERTED, organizationId: ORG_A },
          { alias: "no-org", assertedAtIso: ASSERTED },
        ],
      },
    });

    expect(problem).toContain("1 identity assertion(s) were dropped");
  });

  it("distinguishes present-but-unusable from absent, which parseIdentityAssertions cannot", () => {
    const bare = [{ alias: "plan-one", assertedAtIso: ASSERTED, organizationId: ORG_A }];

    expect(parseIdentityAssertions({ value: bare })).toEqual([]);
    expect(parseIdentityAssertions({ value: undefined })).toEqual([]);
    expect(identityFileProblem({ value: bare })).toBeDefined();
    expect(identityFileProblem({ value: undefined })).toBeUndefined();
  });
});

describe("the address an enrollment binds", () => {
  const BOUND = "admin@example.invalid";
  const OTHER = "second@example.invalid";

  it("binds the address handed to it, so a later pass can name the account", () => {
    const result = establishAssertion({
      alias: "plan-two",
      assertions: [],
      email: BOUND,
      nowIso: NOW,
      organizationId: ORG_B,
    });

    expect(result.assertions[0]!.email).toBe(BOUND);
  });

  it("omits the key entirely when no address was offered, rather than binding an empty one", () => {
    const result = establishAssertion({ alias: "plan-two", assertions: [], nowIso: NOW, organizationId: ORG_B });

    expect(Object.hasOwn(result.assertions[0]!, "email")).toBe(false);
  });

  it("round-trips an address through the stored document", () => {
    const parsed = parseIdentityAssertions({
      value: { assertions: [{ alias: "plan-one", assertedAtIso: ASSERTED, email: BOUND, organizationId: ORG_A }] },
    });

    expect(parsed[0]!.email).toBe(BOUND);
  });

  // The highest-value case in this file: EVERY row stored on this install predates the binding and carries no
  // address. A parse that dropped them would read the whole fleet as unenrolled the moment this landed.
  it("KEEPS a row that carries no address, which is every row written before addresses were recorded", () => {
    const parsed = parseIdentityAssertions({
      value: {
        assertions: [
          { alias: "with", assertedAtIso: ASSERTED, email: BOUND, organizationId: ORG_A },
          { alias: "without", assertedAtIso: ASSERTED, organizationId: ORG_B },
        ],
      },
    });

    expect(parsed.map((entry) => entry.alias)).toEqual(["with", "without"]);
    expect(Object.hasOwn(parsed[1]!, "email")).toBe(false);
  });

  it("DROPS a row whose address is not a string, because a surface would go on to render it", () => {
    const parsed = parseIdentityAssertions({
      value: {
        assertions: [
          { alias: "good", assertedAtIso: ASSERTED, organizationId: ORG_A },
          { alias: "numeric", assertedAtIso: ASSERTED, email: 7, organizationId: ORG_B },
        ],
      },
    });

    expect(parsed.map((entry) => entry.alias)).toEqual(["good"]);
  });

  it("replaces the address on a re-enrollment, binding the new pair together", () => {
    const standing = [{ alias: "plan-one", assertedAtIso: ASSERTED, email: BOUND, organizationId: ORG_A }];

    const result = unwrap(
      reenrollAssertions({
        assertions: standing,
        changes: [{ alias: "plan-one", email: OTHER, organizationId: ORG_B }],
        nowIso: NOW,
      }),
    );

    expect(result.assertions[0]).toEqual({
      alias: "plan-one",
      assertedAtIso: NOW,
      email: OTHER,
      organizationId: ORG_B,
    });
  });

  // The whole row is replaced rather than merged. Carrying the old address forward beside a new organisation
  // is exactly the stale-address-on-a-live-token pair this binding exists to make impossible.
  it("does NOT carry the old address forward when a re-enrollment names none", () => {
    const standing = [{ alias: "plan-one", assertedAtIso: ASSERTED, email: BOUND, organizationId: ORG_A }];

    const result = unwrap(
      reenrollAssertions({
        assertions: standing,
        changes: [{ alias: "plan-one", organizationId: ORG_B }],
        nowIso: NOW,
      }),
    );

    expect(Object.hasOwn(result.assertions[0]!, "email")).toBe(false);
  });

  it("leaves a neighbour's address untouched when another store is re-enrolled", () => {
    const standing = [
      { alias: "plan-one", assertedAtIso: ASSERTED, email: BOUND, organizationId: ORG_A },
      { alias: "plan-two", assertedAtIso: ASSERTED, organizationId: ORG_B },
    ];

    const result = unwrap(
      reenrollAssertions({
        assertions: standing,
        changes: [{ alias: "plan-two", email: OTHER, organizationId: "org-new" }],
        nowIso: NOW,
      }),
    );

    expect(result.assertions[0]!.email).toBe(BOUND);
    expect(result.assertions[1]!.email).toBe(OTHER);
  });
});
