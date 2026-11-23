/**
 * The KnowBe4 runner over an injected GET: paging to a short page, the parent fan-out, the page and parent
 * bounds, and a failed path that never sinks the others. The GET is a plain function seam, never a mock.
 */
import { describe, expect, it } from "vitest";

import {
  KNOWBE4_MAX_PAGES,
  KNOWBE4_PER_PAGE,
  type Knowbe4FillObservation,
  runKnowbe4Fill,
} from "../../../../atlas/knowbe4/fill/run.js";
import { withTokenWithheld } from "../../../../atlas/knowbe4/fill/withheld.js";
import { err, ok, type Result } from "../../../../lib/result.js";
import { type Knowbe4ReadError, Knowbe4ReadErrors } from "../../../../live/knowbe4/errors.js";
import type { Knowbe4Get } from "../../../../live/knowbe4/transport.js";

const AT = "2026-10-15T00:00:00.000Z";

/** A minimal ACTIVE user row the strict boundary admits — the status a group's `member_count` counts. */
function userRow({ id }: { id: number }): { id: number; email: string; status: string } {
  return { email: `person${String(id)}@example.com`, id, status: "active" };
}

/**
 * A fake GET answering through `answer`, recording every URL it was sent. A canned body is sent as its JSON text,
 * the way the transport hands a real one over, and a string is sent as-is, so a case can answer text that is not JSON.
 *
 * @param answer what one URL answers
 * @returns the seam, and the list of what it was sent
 */
function recordingGet({ answer }: { answer: (input: { url: URL }) => Result<unknown, Knowbe4ReadError> }): {
  get: Knowbe4Get;
  sent: string[];
} {
  const sent: string[] = [];
  const get: Knowbe4Get = async ({ url }) => {
    sent.push(`${url.pathname}${url.search}`);
    return answer({ url }).map((body) => (typeof body === "string" ? body : JSON.stringify(body)));
  };
  return { get, sent };
}

/**
 * The account answers one object and every list answers empty, unless `override` answers the URL first.
 *
 * @param override answers for the URLs a case is about, or `undefined` to fall through to the empty account
 * @returns what the URL answers
 */
function accountAndEmpty({
  url,
  override,
}: {
  url: URL;
  override: (input: { url: URL }) => Result<unknown, Knowbe4ReadError> | undefined;
}): Result<unknown, Knowbe4ReadError> {
  const chosen = override({ url });
  if (chosen !== undefined) {
    return chosen;
  }
  if (url.pathname === "/v1/account") {
    return ok({ name: "Example Co", subscription_level: "Diamond" });
  }
  return ok([]);
}

/**
 * A list that holds `rows` on page 1 and nothing after, the way a real list under one page ends.
 *
 * @param rows what page 1 answers
 * @param url the URL asked
 * @returns the page
 */
function firstPageOnly({ rows, url }: { rows: readonly unknown[]; url: URL }): Result<unknown, Knowbe4ReadError> {
  return ok(url.searchParams.get("page") === "1" ? rows : []);
}

/** One answered path's item count, or the failure's status and message. */
function outcomeOf({ fill, template }: { fill: Knowbe4FillObservation; template: string }): unknown {
  const answered = fill.answered.find((entry) => entry.template === template);
  if (answered !== undefined) {
    return { items: answered.items.length, truncatedBy: answered.truncatedBy };
  }
  const failed = fill.failed.find((entry) => entry.template === template)!;
  return { message: failed.message, status: failed.status };
}

describe("withTokenWithheld", () => {
  it("never names a field KnowBe4 sent undeclared, so neither data nor a token split across keys reaches a cell", async () => {
    const halves = ["ABCDEFGHIJ", "abcdefghij"] as const;
    const row = { ...userRow({ id: 1 }), [halves[0]]: 1, [halves[1]]: 2, ssn_123_45_6789: true };
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => (asked.pathname === "/v1/users" ? ok([row]) : undefined),
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(Object.keys(row)).toEqual(["email", "id", "status", ...halves, "ssn_123_45_6789"]);
    expect(outcomeOf({ fill, template: "/v1/users" })).toEqual({
      message:
        "GET /v1/users answered a shape this version does not read — refused, not guessed: 3 undeclared field(s), named nowhere since KnowBe4 chose the names",
      status: null,
    });
    expect(fill.failed.length).toBe(1);
  });

  it("withholds a bound that names the token as a provider id, and keeps a bound that does not", () => {
    const token = "kb4-fake-token-of-a-real-length";
    const read = { items: [], kind: "group-member", template: "/v1/groups/{id}/members" } as const;
    const fill: Knowbe4FillObservation = {
      answered: [
        { ...read, truncatedBy: `a row count other than the parent's own under ${token} (0 of 1)` },
        { ...read, truncatedBy: "the run's 250-request ceiling" },
        { ...read, truncatedBy: null },
      ],
      failed: [],
      filledAtIso: AT,
    };

    expect(withTokenWithheld({ fill, token }).answered.map((entry) => entry.truncatedBy)).toEqual([
      "the request failed and its error quoted the token, so its words are withheld",
      "the run's 250-request ceiling",
      null,
    ]);
  });

  it("refuses a path whose kept rows quote the token, at any depth, and keeps one whose rows do not", () => {
    const token = "kb4-fake-token-of-a-real-length";
    const fill: Knowbe4FillObservation = {
      answered: [
        {
          items: [{ detail: { email: `x${token}@a.test` }, providerId: "1" }],
          kind: "user",
          template: "/v1/users",
          truncatedBy: null,
        },
        {
          items: [{ detail: { targetGroups: [{ groupId: "0", name: token }] }, providerId: "2" }],
          kind: "training-campaign",
          template: "/v1/training/campaigns",
          truncatedBy: null,
        },
        {
          items: [{ detail: { name: "Staff" }, providerId: "3" }],
          kind: "group",
          template: "/v1/groups",
          truncatedBy: null,
        },
      ],
      failed: [],
      filledAtIso: AT,
    };
    const withheld = withTokenWithheld({ fill, token });

    expect(withheld.answered.map((read) => read.template)).toEqual(["/v1/groups"]);
    expect(withheld.failed).toEqual([
      {
        kind: "user",
        message: "/v1/users answered a row quoting the token this run sent — refused, not stored",
        status: null,
        template: "/v1/users",
      },
      {
        kind: "training-campaign",
        message: "/v1/training/campaigns answered a row quoting the token this run sent — refused, not stored",
        status: null,
        template: "/v1/training/campaigns",
      },
    ]);
  });
});

describe("runKnowbe4Fill", () => {
  it("reads every path once over an empty account, account unpaged and every list with paging", async () => {
    const { get, sent } = recordingGet({ answer: ({ url }) => accountAndEmpty({ override: () => undefined, url }) });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(fill.failed).toEqual([]);
    expect(fill.answered.length).toBe(11);
    expect(sent.slice(0, 2)).toEqual(["/v1/account", "/v1/users?page=1&per_page=500"]);
    expect(sent).toContain(
      "/v1/training/enrollments?exclude_archived_users=false&include_campaign_id=true&include_store_purchase_id=true&page=1&per_page=500",
    );
    expect(sent).toContain("/v1/training/campaigns?exclude_percentages=true&page=1&per_page=500");
  });

  it("follows a top-level list past a short page, ending it only on an empty one", async () => {
    // A short page is not proof of the end once KnowBe4 may cap or ignore `per_page`, so page 2's
    // hundred rows are followed to page 3 rather than taken as the last of them.
    const { get, sent } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname !== "/v1/users") {
              return undefined;
            }
            const page = Number(asked.searchParams.get("page"));
            const length = [KNOWBE4_PER_PAGE, 100, 0][page - 1]!;
            return ok(Array.from({ length }, (_, index) => userRow({ id: page * 1000 + index })));
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/users" })).toEqual({ items: KNOWBE4_PER_PAGE + 100, truncatedBy: null });
    expect(sent.filter((path) => path.startsWith("/v1/users?"))).toEqual([
      "/v1/users?page=1&per_page=500",
      "/v1/users?page=2&per_page=500",
      "/v1/users?page=3&per_page=500",
    ]);
  });

  it("reports a list that never ends as truncated at the page bound, not as complete", async () => {
    const { get, sent } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname !== "/v1/users") {
              return undefined;
            }
            const offset = (Number(asked.searchParams.get("page")) - 1) * KNOWBE4_PER_PAGE;
            return ok(Array.from({ length: KNOWBE4_PER_PAGE }, (_, index) => userRow({ id: offset + index + 1 })));
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/users" })).toEqual({
      items: KNOWBE4_PER_PAGE * KNOWBE4_MAX_PAGES,
      truncatedBy: "the 20-page bound",
    });
    expect(sent.filter((path) => path.startsWith("/v1/users?")).length).toBe(KNOWBE4_MAX_PAGES);
  });

  it("fails a list whose next page repeats an id, which is KnowBe4 no longer honouring `page`", async () => {
    const full = Array.from({ length: KNOWBE4_PER_PAGE }, (_, index) => userRow({ id: index + 1 }));
    const { get, sent } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({ override: ({ url: asked }) => (asked.pathname === "/v1/users" ? ok(full) : undefined), url }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/users" })).toEqual({
      message: "page 2 repeated 1, already read in this list — KnowBe4 may have stopped honouring `page`",
      status: null,
    });
    expect(sent.filter((path) => path.startsWith("/v1/users?")).length).toBe(2);
  });

  it("fans a per-parent path out over every parent the parent list answered", async () => {
    const { get, sent } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname === "/v1/groups") {
              return firstPageOnly({
                rows: [
                  { id: 10, member_count: 2, name: "Everyone" },
                  { id: 11, member_count: 0, name: "Engineering" },
                ],
                url: asked,
              });
            }
            if (asked.pathname === "/v1/groups/10/members") {
              return ok([userRow({ id: 1 }), userRow({ id: 2 })]);
            }
            return undefined;
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(
      fill.answered.find((entry) => entry.template === "/v1/groups/{id}/members")!.items.map((item) => item.providerId),
    ).toEqual(["10:1", "10:2"]);
    expect(sent.filter((path) => path.includes("/members"))).toEqual([
      "/v1/groups/10/members?page=1&per_page=500",
      "/v1/groups/11/members?page=1&per_page=500",
    ]);
  });

  it("reports the parent bound when there are more parents than a run fans out over", async () => {
    const groups = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, member_count: 0, name: "Team" }));
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) =>
            asked.pathname === "/v1/groups" ? firstPageOnly({ rows: groups, url: asked }) : undefined,
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/groups/{id}/members" })).toEqual({
      items: 0,
      truncatedBy: "the 100-parent bound (101 parents)",
    });
  });

  it("publishes a per-parent read the request ceiling stopped between two parents as truncated, keeping what it read", async () => {
    // Every top-level list goes first: account 1, groups 2 (its rows, then the empty page) and seven empty lists
    // 1 each spend 10 of 250. Groups 1–12 then take 20 pages each, so the ceiling falls exactly before group 13
    const { get, sent } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname === "/v1/groups") {
              const memberCount = 19 * KNOWBE4_PER_PAGE + 1;
              const rows = Array.from({ length: 14 }, (_, index) => ({
                id: index + 1,
                member_count: memberCount,
                name: "Team",
              }));
              return firstPageOnly({ rows, url: asked });
            }
            if (!/^\/v1\/groups\/\d+\/members$/.test(asked.pathname)) {
              return undefined;
            }
            const page = Number(asked.searchParams.get("page"));
            const length = page < KNOWBE4_MAX_PAGES ? KNOWBE4_PER_PAGE : 1;
            return ok(Array.from({ length }, (_, index) => userRow({ id: page * 1000 + index })));
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/groups/{id}/members" })).toEqual({
      items: 12 * (19 * KNOWBE4_PER_PAGE + 1),
      truncatedBy: "the run's 250-request ceiling, before 13",
    });
    expect(sent.length).toBe(250);
    expect(sent.some((path) => path.startsWith("/v1/groups/13/"))).toBe(false);
    expect(fill.answered.map((entry) => entry.template).slice(0, 9)).toEqual([
      "/v1/account",
      "/v1/users",
      "/v1/groups",
      "/v1/training/campaigns",
      "/v1/training/store_purchases",
      "/v1/training/policies",
      "/v1/training/enrollments",
      "/v1/phishing/campaigns",
      "/v1/phishing/security_tests",
    ]);
  });

  it("fails a list whose one page carries an id twice, since two rows would share one identity", async () => {
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) =>
            asked.pathname === "/v1/users"
              ? firstPageOnly({ rows: [userRow({ id: 1 }), userRow({ id: 1 })], url: asked })
              : undefined,
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/users" })).toEqual({
      message: "page 1 repeated 1, already read in this list — KnowBe4 may have stopped honouring `page`",
      status: null,
    });
  });

  it("holds a CLOSED test's recipients to its scheduled count, and follows an uncounted one to an empty page", async () => {
    const { get, sent } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname === "/v1/phishing/security_tests") {
              return firstPageOnly({
                rows: [
                  { groups: [], pst_id: 5, scheduled_count: 600, status: "Closed" },
                  { groups: [], pst_id: 6, scheduled_count: 600, status: "Active" },
                  { groups: [], pst_id: 7, scheduled_count: null, status: "Closed" },
                ],
                url: asked,
              });
            }
            const test = /^\/v1\/phishing\/security_tests\/(\d+)\/recipients$/.exec(asked.pathname);
            if (test === null) {
              return undefined;
            }
            const rows = Array.from({ length: 100 }, (_, index) => ({
              recipient_id: index + 1,
              user: { id: index + 1 },
            }));
            return firstPageOnly({ rows, url: asked });
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/phishing/security_tests/{id}/recipients" })).toEqual({
      items: 300,
      truncatedBy: "a row count other than the parent's own under 5 (100 of 600)",
    });
    // A short page ends only a counted list: an active test, or a closed one with no count, reads page 2.
    expect(
      sent.filter((path) => path.includes("/recipients")).map((path) => path.replace(/&per_page=\d+/, "")),
    ).toEqual([
      "/v1/phishing/security_tests/5/recipients?page=1",
      "/v1/phishing/security_tests/6/recipients?page=1",
      "/v1/phishing/security_tests/6/recipients?page=2",
      "/v1/phishing/security_tests/7/recipients?page=1",
      "/v1/phishing/security_tests/7/recipients?page=2",
    ]);
  });

  it("reports a group read with fewer, or more, members than the group's own count as not whole", async () => {
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname === "/v1/groups") {
              return firstPageOnly({
                rows: [
                  { id: 10, member_count: 3, name: "Everyone" },
                  { id: 11, member_count: 0, name: "Engineering" },
                ],
                url: asked,
              });
            }
            if (asked.pathname === "/v1/groups/10/members" || asked.pathname === "/v1/groups/11/members") {
              return ok([userRow({ id: 1 })]);
            }
            return undefined;
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/groups/{id}/members" })).toEqual({
      items: 2,
      truncatedBy: "a row count other than the parent's own under 10 (1 of 3), 11 (1 of 0)",
    });
  });

  it("holds a group to its count of ACTIVE members, keeping the archived ones its list also returns", async () => {
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => {
            if (asked.pathname === "/v1/groups") {
              return firstPageOnly({
                rows: [
                  { id: 10, member_count: 2, name: "Everyone" },
                  { id: 11, member_count: 2, name: "Engineering" },
                  { id: 12, member_count: 1, name: "Security" },
                ],
                url: asked,
              });
            }
            if (asked.pathname === "/v1/groups/10/members") {
              return ok([
                { ...userRow({ id: 1 }), status: "active" },
                { ...userRow({ id: 2 }), status: "active" },
                { ...userRow({ id: 3 }), status: "archived" },
              ]);
            }
            if (asked.pathname === "/v1/groups/11/members") {
              return ok([
                { ...userRow({ id: 1 }), status: "active" },
                { ...userRow({ id: 3 }), status: "archived" },
              ]);
            }
            if (asked.pathname === "/v1/groups/12/members") {
              // A member with no status is never counted as active.
              return ok([{ email: "person4@example.com", id: 4 }]);
            }
            return undefined;
          },
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(outcomeOf({ fill, template: "/v1/groups/{id}/members" })).toEqual({
      items: 6,
      truncatedBy: "a row count other than the parent's own under 11 (1 of 2), 12 (0 of 1)",
    });
  });

  it("fails a 403 path with KnowBe4's status, its children with the parent's words and its 403, and keeps every other path", async () => {
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) =>
            asked.pathname === "/v1/groups"
              ? err(Knowbe4ReadErrors.transportFailed({ message: "KnowBe4 answered 403 on /v1/groups", status: 403 }))
              : undefined,
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(fill.failed).toEqual([
      { kind: "group", message: "KnowBe4 answered 403 on /v1/groups", status: 403, template: "/v1/groups" },
      {
        kind: "group-member",
        message: "its parent list /v1/groups did not answer (KnowBe4 answered 403 on /v1/groups)",
        status: 403,
        template: "/v1/groups/{id}/members",
      },
    ]);
    expect(fill.answered.length).toBe(9);
  });

  it("fails a path whose page drifted from its boundary with no status, since KnowBe4 did answer 2xx", async () => {
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) =>
            asked.pathname === "/v1/training/policies" ? ok([{ policy_id: 1, surprise: true }]) : undefined,
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });
    const failed = fill.failed.find((entry) => entry.template === "/v1/training/policies")!;

    expect(failed.status).toBe(null);
    expect(failed.message).toContain("answered a shape this version does not read");
  });

  it("fails a path whose body is not JSON with no status, and keeps every other path", async () => {
    const { get } = recordingGet({
      answer: ({ url }) =>
        accountAndEmpty({
          override: ({ url: asked }) => (asked.pathname === "/v1/groups" ? ok("<html>maintenance</html>") : undefined),
          url,
        }),
    });
    const fill = await runKnowbe4Fill({ at: AT, get });

    expect(fill.failed.map((entry) => [entry.template, entry.status, entry.message])).toEqual([
      ["/v1/groups", null, "/v1/groups answered a body that is not JSON"],
      [
        "/v1/groups/{id}/members",
        null,
        "its parent list /v1/groups did not answer (/v1/groups answered a body that is not JSON)",
      ],
    ]);
    expect(fill.answered.length).toBe(9);
  });
});
