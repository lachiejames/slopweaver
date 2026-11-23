/**
 * The Knock transport's closed call list: five routes, each bound to its operation and its admitted query keys, an
 * id that can only ever name one resource, and a send that refuses any URL the builder could not have made —
 * before the key leaves the process.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { KnockReadErrors } from "../../../../live/knock/errors.js";
import { buildKnockUrl, isClosedKnockUrl, isSafeKnockId, knockGet } from "../../../../live/knock/transport.js";

describe("buildKnockUrl", () => {
  it("builds the environment list with its filters, a repeated status sent repeated and never as `status[]`", () => {
    const url = unwrap(
      buildKnockUrl({
        request: {
          messageId: null,
          operation: "knock.messages.list",
          query: [
            ["status", "undelivered"],
            ["status", "bounced"],
            ["inserted_at.gte", "2026-10-11T00:00:00Z"],
            ["page_size", "50"],
          ],
          userId: null,
        },
      }),
    );
    expect(url.href).toBe(
      "https://api.knock.app/v1/messages?status=undelivered&status=bounced&inserted_at.gte=2026-10-11T00%3A00%3A00Z&page_size=50",
    );
  });

  it("builds each id-bearing route on its own operation", () => {
    const operations = ["knock.message.read", "knock.message.events.list", "knock.message.deliveryLogs.list"] as const;
    const routes = operations.map(
      (operation) =>
        unwrap(buildKnockUrl({ request: { messageId: "m-1", operation, query: [], userId: null } })).pathname,
    );
    expect(routes).toEqual(["/v1/messages/m-1", "/v1/messages/m-1/events", "/v1/messages/m-1/delivery_logs"]);
    expect(
      unwrap(
        buildKnockUrl({
          request: { messageId: null, operation: "knock.users.messages.list", query: [], userId: "user_1" },
        }),
      ).pathname,
    ).toBe("/v1/users/user_1/messages");
  });

  it("refuses a filter key the per-message routes do not admit", () => {
    expect(
      unwrapErr(
        buildKnockUrl({
          request: {
            messageId: "m-1",
            operation: "knock.message.events.list",
            query: [["status", "sent"]],
            userId: null,
          },
        }),
      ),
    ).toEqual(
      KnockReadErrors.urlRefused({
        operation: "knock.message.events.list",
        why: "the URL leaves the closed call list",
      }),
    );
  });

  it("refuses a user id carrying a path character, naming only the operation", () => {
    const refused = unwrapErr(
      buildKnockUrl({
        request: { messageId: null, operation: "knock.users.messages.list", query: [], userId: "u/../../workflows" },
      }),
    );
    expect(refused).toEqual(
      KnockReadErrors.urlRefused({
        operation: "knock.users.messages.list",
        why: "it takes one user id with no path character in it",
      }),
    );
    expect(refused.message).not.toContain("workflows");
  });

  it("refuses an id on the environment list and a missing id on a message read", () => {
    expect(
      unwrapErr(
        buildKnockUrl({ request: { messageId: "m-1", operation: "knock.messages.list", query: [], userId: null } }),
      ).message,
    ).toBe("refused knock.messages.list: the environment list takes no id");
    expect(
      unwrapErr(
        buildKnockUrl({ request: { messageId: null, operation: "knock.message.read", query: [], userId: null } }),
      ).message,
    ).toBe("refused knock.message.read: it takes one message id with no path character in it");
  });
});

describe("isSafeKnockId", () => {
  it("admits an ordinary id and refuses every shape that could change the route", () => {
    expect(
      [
        "2FVHPWxRqNuXQ9krvNP5A6Z4qXe",
        "",
        ".",
        "..",
        "batch",
        "a/b",
        "a?b",
        "a#b",
        "a%2Fb",
        "a b",
        "a\\b",
        "x".repeat(257),
      ].map((value) => isSafeKnockId({ value })),
    ).toEqual([true, false, false, false, false, false, false, false, false, false, false, false]);
  });
});

describe("isClosedKnockUrl", () => {
  it("refuses another origin, credentials in the URL, a fragment and a write route", () => {
    const cases = [
      ["https://api.knock.app/v1/messages", "knock.messages.list"],
      ["https://evil.example/v1/messages", "knock.messages.list"],
      ["https://u:p@api.knock.app/v1/messages", "knock.messages.list"],
      ["https://api.knock.app/v1/messages#x", "knock.messages.list"],
      ["https://api.knock.app/v1/messages/m-1/read", "knock.message.read"],
      ["https://api.knock.app/v1/messages/m-1/content", "knock.message.read"],
      ["https://api.knock.app/v1/messages/batch", "knock.message.read"],
      ["https://api.knock.app/v1/messages/m-1/events", "knock.message.deliveryLogs.list"],
    ] as const;
    expect(cases.map(([href, operation]) => isClosedKnockUrl({ operation, url: new URL(href) }))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("refuses an encoded slash smuggled into the id segment", () => {
    expect(
      isClosedKnockUrl({ operation: "knock.message.read", url: new URL("https://api.knock.app/v1/messages/a%2Fb") }),
    ).toBe(false);
  });

  it("admits only the builder's own spelling of an id, refusing `%41` for `A` and a lowercase escape", () => {
    const built = unwrap(
      buildKnockUrl({ request: { messageId: "a:b", operation: "knock.message.read", query: [], userId: null } }),
    );
    expect(built.pathname).toBe("/v1/messages/a%3Ab");
    expect(
      [built.href, "https://api.knock.app/v1/messages/%41", "https://api.knock.app/v1/messages/a%3ab"].map((href) =>
        isClosedKnockUrl({ operation: "knock.message.read", url: new URL(href) }),
      ),
    ).toEqual([true, false, false]);
  });
});

describe("knockGet", () => {
  it("refuses a URL off the closed list at the send, before any request", async () => {
    const refused = unwrapErr(
      await knockGet({
        credential: { apiKey: "sk_fake" },
        operation: "knock.messages.list",
        scopeId: "scope",
        url: new URL("https://api.knock.app/v1/workflows/booking-reminder/trigger"),
      }),
    );
    expect(refused).toEqual(
      KnockReadErrors.urlRefused({
        operation: "knock.messages.list",
        why: "the URL is not one the closed call list builds",
      }),
    );
  });
});
