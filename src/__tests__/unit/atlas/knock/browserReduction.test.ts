import { describe, expect, it } from "vitest";

import { absentAs, absentAsNumber } from "#lib/absent.js";
import { isKnockHost, knockWirePathOf, reduceKnockCalls } from "../../../../atlas/knock/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

/** One captured response, whose `body` is ALREADY PARSED — the transport parses a JSON response for us. */
const response = ({
  body = {},
  ...over
}: {
  url: string;
  body?: unknown;
  method?: string;
  statusCode?: number;
}): CapturedResponse => ({
  body,
  method: absentAs({ value: over.method, whenAbsent: "GET" }),
  statusCode: absentAsNumber({ value: over.statusCode, whenAbsent: 200 }),
  url: over.url,
});

describe("knock first-party test", () => {
  it("accepts Knock's own hosts", () => {
    expect(isKnockHost({ host: "knock.app" })).toBe(true);
    expect(isKnockHost({ host: "control.knock.app" })).toBe(true);
    expect(isKnockHost({ host: "dashboard.knock.app" })).toBe(true);
  });

  it("rejects a name that merely ends in the same letters", () => {
    expect(isKnockHost({ host: "notknock.app" })).toBe(false);
  });

  it("rejects a name that only contains the domain", () => {
    expect(isKnockHost({ host: "knock.app.evil.test" })).toBe(false);
  });
});

describe("knock wire-path redaction", () => {
  it("rewrites a declared path to the provider's OWN parameter name, whatever the key looks like", () => {
    expect(knockWirePathOf({ api: "management", url: "https://control.knock.app/v1/workflows/weekly-digest" })).toBe(
      "/v1/workflows/{workflow_key}",
    );
  });

  it("keeps a human-chosen key out of the store even when it reads like a route name", () => {
    expect(knockWirePathOf({ api: "management", url: "https://control.knock.app/v1/guides/onboarding" })).toBe(
      "/v1/guides/{guide_key}",
    );
  });

  it("does not redact a declared collection root, which carries no value at all", () => {
    expect(knockWirePathOf({ api: "management", url: "https://control.knock.app/v1/message_types" })).toBe(
      "/v1/message_types",
    );
  });

  it("falls back to shape rules for a path neither document declares", () => {
    expect(
      knockWirePathOf({ api: "management", url: "https://control.knock.app/v1/agents/aBc123XyZ0987654321Q" }),
    ).toBe("/v1/agents/{token}");
  });

  it("redacts a UUID and a bare number on an undeclared path", () => {
    expect(
      knockWirePathOf({
        api: null,
        url: "https://dashboard.knock.app/api/6f1c7b2e-1c4d-4f2a-9c3b-2f7d8e9a0b1c/42",
      }),
    ).toBe("/api/{uuid}/{n}");
  });

  it("answers null for an address it cannot read", () => {
    expect(knockWirePathOf({ api: "data", url: "nonsense" })).toBe(null);
  });
});

describe("reducing one page's captured calls", () => {
  it("keeps a first-party call and attributes it to the API its host serves", () => {
    const rows = reduceKnockCalls({
      responses: [response({ body: { entries: [{ key: "a" }] }, url: "https://control.knock.app/v1/workflows" })],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.api).toBe("management");
    expect(rows[0]!.wirePath).toBe("/v1/workflows");
    expect(rows[0]!.method).toBe("GET");
  });

  it("records field NAMES and never a value", () => {
    const rows = reduceKnockCalls({
      responses: [
        response({
          body: { key: "weekly-digest", name: "Weekly digest" },
          url: "https://control.knock.app/v1/workflows",
        }),
      ],
    });
    expect(rows[0]!.responseFields).toStrictEqual(["key", "name"]);
  });

  it("drops a third party's call entirely — not a redacted row, not a count", () => {
    const rows = reduceKnockCalls({
      responses: [
        response({ url: "https://api.segment.io/v1/t" }),
        response({ url: "https://control.knock.app/v1/channels" }),
      ],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.host).toBe("control.knock.app");
  });

  it("attributes a dashboard-origin call to no published API", () => {
    const rows = reduceKnockCalls({ responses: [response({ url: "https://dashboard.knock.app/api/session" })] });
    expect(rows[0]!.api).toBe(null);
  });
});
