import { describe, expect, it } from "vitest";

import { projectJumpcloudValue } from "../../../../atlas/jumpcloud/projection.js";
import { admitJumpcloudPage } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { unwrap } from "../../../../lib/result.js";

/** An endpoint with no endpoint-scoped denial of its own, so these tests exercise the name rules alone. */
const ANY_ENDPOINT = "/api/systems";

describe("projectJumpcloudValue", () => {
  it("drops a SAML private key from an application record and says it did", () => {
    const result = projectJumpcloudValue({
      endpoint: ANY_ENDPOINT,
      value: { displayName: "Okta", idpPrivateKey: "-----BEGIN PRIVATE KEY-----", _id: "65a0" },
    });
    expect(result.value).toStrictEqual({ displayName: "Okta", _id: "65a0" });
    expect(result.dropped).toStrictEqual([{ pointer: "/idpPrivateKey", reason: "secret-material" }]);
  });

  it("drops a RADIUS shared secret", () => {
    const result = projectJumpcloudValue({
      endpoint: ANY_ENDPOINT,
      value: { name: "radius-1", sharedSecret: "hunter2" },
    });
    expect(result.value).toStrictEqual({ name: "radius-1" });
    expect(result.dropped).toStrictEqual([{ pointer: "/sharedSecret", reason: "secret-material" }]);
  });

  it("calls an ephemeral handle housekeeping rather than secret material", () => {
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { results: [], continuationToken: "abc" } });
    expect(result.value).toStrictEqual({ results: [] });
    expect(result.dropped).toStrictEqual([{ pointer: "/continuationToken", reason: "ephemeral-token" }]);
  });

  it("keeps the full-disk-encryption POSTURE, which is a boolean about a key rather than the key", () => {
    const result = projectJumpcloudValue({
      endpoint: ANY_ENDPOINT,
      value: { fde: { keyPresent: true, active: true } },
    });
    expect(result.value).toStrictEqual({ fde: { keyPresent: true, active: true } });
    expect(result.dropped).toStrictEqual([]);
  });

  it("keeps the per-device user metrics the owner-attribution question needs", () => {
    const value = { userMetrics: [{ userName: "someone", lastLogin: "2026-09-01", admin: true, isFDEUser: true }] };
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value });
    expect(result.value).toStrictEqual(value);
    expect(result.dropped).toStrictEqual([]);
  });

  it("reaches a denied field nested inside an array, not only the top level", () => {
    const result = projectJumpcloudValue({
      endpoint: ANY_ENDPOINT,
      value: {
        channels: [
          { name: "ops", authToken: "abc" },
          { name: "sec", authToken: "def" },
        ],
      },
    });
    expect(result.value).toStrictEqual({ channels: [{ name: "ops" }, { name: "sec" }] });
    expect(result.dropped).toStrictEqual([
      { pointer: "/channels/0/authToken", reason: "secret-material" },
      { pointer: "/channels/1/authToken", reason: "secret-material" },
    ]);
  });

  it("reports each dropped pointer once and in sorted order", () => {
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { b: { secret: 1 }, a: { apiKey: 2 } } });
    expect(result.dropped).toStrictEqual([
      { pointer: "/a/apiKey", reason: "secret-material" },
      { pointer: "/b/secret", reason: "secret-material" },
    ]);
  });

  it("leaves a document with nothing denied byte-identical", () => {
    const value = { _id: "65a0", hostname: "host", os: "Mac OS X", networkInterfaces: [{ address: "10.0.0.1" }] };
    expect(projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value }).value).toStrictEqual(value);
  });

  it("passes primitives and null through untouched", () => {
    expect(projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: null }).value).toBe(null);
    expect(projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: 7 }).value).toBe(7);
    expect(projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: "text" }).value).toBe("text");
  });

  it("refuses a pathologically deep document rather than overflowing, and marks it a depth limit", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i += 1) {
      deep = { nested: deep };
    }
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: deep });
    expect(result.dropped.map((drop) => drop.reason)).toStrictEqual(["depth-limit"]);
  });

  it("marks a truncation distinguishably from a designed drop in the same document", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i += 1) {
      deep = { nested: deep };
    }
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { apiKey: "k", deep } });
    expect(result.dropped.map((drop) => drop.reason).toSorted()).toStrictEqual(["depth-limit", "secret-material"]);
  });

  it("escapes a field name containing a slash, so two different positions cannot share one pointer", () => {
    const result = projectJumpcloudValue({
      endpoint: ANY_ENDPOINT,
      value: { "a/b": { apiKey: "one" }, a: { "b/apiKey": "two" } },
    });
    expect(result.dropped).toStrictEqual([{ pointer: "/a~1b/apiKey", reason: "secret-material" }]);
  });

  it("escapes a tilde in a field name too, per RFC 6901", () => {
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { "a~b": { secret: 1 } } });
    expect(result.dropped).toStrictEqual([{ pointer: "/a~0b/secret", reason: "secret-material" }]);
  });

  it("keeps a truncation that a colliding pointer would once have erased", () => {
    // The counterexample that found this: at the depth bound, an unescaped field named `a/b` produced the
    // same pointer as `b` inside `a`, so deduplicating by pointer alone dropped whichever came second —
    // and when that was the depth-limit entry, a truncated family published as `synced`.
    let value: Record<string, unknown> = { "a/b": { apiKey: "secret" }, a: { "b/apiKey": { deeper: true } } };
    for (let i = 0; i < 23; i += 1) {
      value = { nested: value };
    }
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value });
    expect(result.dropped.filter((drop) => drop.reason === "depth-limit").length).toBe(1);
  });

  it("drops a denied field a toJSON would reintroduce, because the walk sees what a writer would write", () => {
    const raw = {
      continuationToken: "abc",
      toJSON: () => ({ continuationToken: "abc", hostname: "host" }),
    };
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: raw });
    expect(result.value).toStrictEqual({ hostname: "host" });
    expect(result.dropped).toStrictEqual([{ pointer: "/continuationToken", reason: "ephemeral-token" }]);
  });

  it("still refuses a cyclic document through the depth bound rather than throwing on it", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: cyclic }).dropped.map((d) => d.reason)).toStrictEqual(
      ["depth-limit"],
    );
  });

  it("freezes its drop report, so the evidence cannot be cleared away from the value it describes", () => {
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { apiKey: "k" } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.dropped)).toBe(true);
    // Each entry too: freezing only the array leaves a caller free to rewrite a drop's own reason, and
    // rewriting `depth-limit` into anything else is what turns a truncated family back into a synced one.
    expect(Object.isFrozen(result.dropped[0])).toBe(true);
  });

  it("copies no function, so a toJSON that survives the raw-walk fallback still cannot reintroduce a field", () => {
    let calls = 0;
    const value = {
      rows: [
        {
          toJSON: () => {
            calls += 1;
            if (calls === 1) {
              throw new Error("first");
            }
            return { continuationToken: "survives" };
          },
        },
      ],
    };
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value });
    expect(JSON.stringify(result.value)).toBe('{"rows":[{}]}');
  });

  it("walks an array by index, so an array carrying its own map cannot decide what is stored", () => {
    const value: unknown[] = [];
    value[0] = value;
    Object.defineProperty(value, "map", {
      enumerable: false,
      value: () => [{ continuationToken: "survives" }],
    });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule: the hostile
    // `map` really does offer a continuation token, and the walk stores none of it.
    expect(JSON.stringify(value.map(() => null))).toContain("continuationToken");
    expect(JSON.stringify(projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value }).value)).not.toContain(
      "continuationToken",
    );
  });

  it("nulls a function sitting in an ARRAY, not only one at an object key", () => {
    let calls = 0;
    const f = () => undefined;
    Object.defineProperty(f, "toJSON", {
      value: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("first");
        }
        return { continuationToken: "survives" };
      },
    });
    const result = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { rows: [f] } });
    expect(JSON.stringify(result.value)).toBe('{"rows":[null]}');
  });
});

describe("projecting a record its measured boundary admitted", () => {
  // The boundary DECLARES `password` on a policy template's config defaults, because the census measured it there.
  // Admitting a key is not storing it: the same record still loses the field to the name rule on its way in.
  const template = {
    activation: "a",
    alert: null,
    behavior: "b",
    configFields: [
      {
        defaultValue: [{ password: "hunter2", username: "wifi" }],
        displayOptions: null,
        displayType: "text",
        id: "f1",
        label: "Network",
        name: "network",
        position: 0,
        readOnly: false,
        required: false,
        sensitive: true,
        tooltip: null,
        validators: null,
      },
    ],
    deliveryTypes: [],
    description: "d",
    displayName: "Wi-Fi",
    id: "t1",
    name: "wifi",
    osMetaFamily: "darwin",
    osRestrictions: [],
    policyLevel: "default",
    reference: null,
    state: "",
  };

  it("drops a password the boundary declared, and reports the drop as secret material", () => {
    const page = unwrap(
      admitJumpcloudPage({ headers: {}, surface: "v2-policytemplates-get", text: JSON.stringify(template) }),
    );
    expect(page.records).toStrictEqual([template]);
    const projected = projectJumpcloudValue({ endpoint: "/api/v2/policytemplates", value: page.records[0] });
    expect(projected.dropped).toStrictEqual([
      { pointer: "/configFields/0/defaultValue/0/password", reason: "secret-material" },
    ]);
    expect(JSON.stringify(projected.value)).not.toContain("hunter2");
  });
});

describe("projecting a Windows service record", () => {
  const SERVICES = "/api/v2/systeminsights/services";
  const record = {
    display_name: "Acme Worker",
    name: "AcmeWorker",
    path: "C:\\svc-wrapper.exe run --name acme-worker --env AWS_ACCESS_KEY_ID=AKIAZZZZZZZZZZZZZZZZ -- app.exe",
    start_type: "AUTO_START",
  };

  it("drops the command line and keeps everything else about the service", () => {
    const projected = projectJumpcloudValue({ endpoint: SERVICES, value: record });
    expect(projected.value).toStrictEqual({
      display_name: "Acme Worker",
      name: "AcmeWorker",
      start_type: "AUTO_START",
    });
  });

  it("REPORTS the drop as a disclosure decision, so coverage can say what it withheld", () => {
    const projected = projectJumpcloudValue({ endpoint: SERVICES, value: record });
    expect(projected.dropped).toStrictEqual([{ pointer: "/path", reason: "secret-material" }]);
  });

  it("keeps the same path when the very same record comes through the apps endpoint", () => {
    const projected = projectJumpcloudValue({ endpoint: "/api/v2/systeminsights/apps", value: record });
    expect(projected.dropped).toStrictEqual([]);
  });
});
