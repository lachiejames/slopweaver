/**
 * What a read row calls itself, and why a `--query` selected it.
 *
 * Every fixture is a plain object: both functions under test are pure over the normalized view, so no
 * store, no home and no adapter is involved.
 */
import { describe, expect, it } from "vitest";

import {
  ATLAS_EXCERPT_MAX_CHARS,
  ATLAS_NAME_KEYS,
  ATLAS_NAME_MAX_CHARS,
  ATLAS_PATH_MAX_CHARS,
  ATLAS_QUERY_DEPTH_LIMIT,
  atlasEntityName,
  atlasQueryMatches,
  atlasQueryTokens,
  entityCarriesTokens,
} from "../../../../atlas/kit/entityLabel.js";
import type { AtlasEntityView } from "../../../../atlas/kit/read.js";
import { entityMatchesQuery } from "../../../../atlas/kit/selectEntities.js";

/**
 * One entity view, with everything defaulted so a test names only what it is about.
 *
 * @param over the fields this test cares about
 * @returns the entity view
 */
function entity(over: Partial<AtlasEntityView> = {}): AtlasEntityView {
  return {
    detail: null,
    id: "id-1",
    kind: "policies",
    observations: [],
    providerId: "provider-1",
    scope: "jumpcloud",
    ...over,
  };
}

/**
 * A value nested `depth` levels below the root, for the depth-bound tests.
 *
 * @param depth how many objects to wrap the leaf in
 * @param leaf the string to bury
 * @returns the nested value
 */
function nest({ depth, leaf }: { depth: number; leaf: string }): unknown {
  let value: unknown = leaf;
  for (let level = 0; level < depth; level += 1) {
    value = { down: value };
  }
  return value;
}

describe("atlasEntityName", () => {
  it("takes the provider's own `name`", () => {
    expect(atlasEntityName({ detail: { name: "Android - Passcode Policy" } })).toBe("Android - Passcode Policy");
  });

  it("prefers an earlier key over a later one", () => {
    expect(atlasEntityName({ detail: { description: "a long prose field", name: "Windows - Lock Screen" } })).toBe(
      "Windows - Lock Screen",
    );
  });

  it("falls through every key in declared order", () => {
    const chosen = ATLAS_NAME_KEYS.map((key) => atlasEntityName({ detail: { [key]: `called by ${key}` } }));
    expect(chosen).toEqual(ATLAS_NAME_KEYS.map((key) => `called by ${key}`));
  });

  it("declares at least one key, so the fall-through test above cannot pass vacuously", () => {
    expect(ATLAS_NAME_KEYS.length).toBeGreaterThan(0);
  });

  it("answers null when the payload names the entity nothing", () => {
    expect(atlasEntityName({ detail: { serialNumber: "C02XY", systemID: "abc" } })).toBeNull();
  });

  it("answers null for a whitespace-only name rather than an empty headline", () => {
    expect(atlasEntityName({ detail: { name: "   " } })).toBeNull();
  });

  it("answers null for a non-string name rather than stringifying it", () => {
    expect(atlasEntityName({ detail: { name: { first: "ada" } } })).toBeNull();
  });

  it("answers null when detail is not a record at all", () => {
    expect(atlasEntityName({ detail: null })).toBeNull();
    expect(atlasEntityName({ detail: ["a", "b"] })).toBeNull();
    expect(atlasEntityName({ detail: "a bare string" })).toBeNull();
  });

  it("trims a name before using it", () => {
    expect(atlasEntityName({ detail: { title: "  BitLocker Full Disk Encryption  " } })).toBe(
      "BitLocker Full Disk Encryption",
    );
  });

  it("cuts a prose description to the headline budget and says it cut", () => {
    const long = "x".repeat(ATLAS_NAME_MAX_CHARS + 40);
    const name = atlasEntityName({ detail: { description: long } });
    expect(name).toBe(`${"x".repeat(ATLAS_NAME_MAX_CHARS - 1)}…`);
  });

  it("leaves a name exactly at the budget uncut", () => {
    const exact = "y".repeat(ATLAS_NAME_MAX_CHARS);
    expect(atlasEntityName({ detail: { name: exact } })).toBe(exact);
  });
});

describe("atlasQueryTokens", () => {
  it("lowercases and splits on whitespace", () => {
    expect(atlasQueryTokens({ query: "Password  Policy" })).toEqual(["password", "policy"]);
  });

  it("drops a repeated token, which never changed a selection", () => {
    expect(atlasQueryTokens({ query: "password password" })).toEqual(["password"]);
  });

  it("answers an empty list for a whitespace-only query", () => {
    expect(atlasQueryTokens({ query: "   " })).toEqual([]);
  });
});

describe("entityCarriesTokens, and the selection it decides", () => {
  it("matches a token in the provider id", () => {
    expect(entityMatchesQuery({ entity: entity({ providerId: "v2-policies-get" }), query: "POLICIES" })).toBe(true);
  });

  it("matches a token in the scope", () => {
    expect(entityMatchesQuery({ entity: entity({ scope: "account/abc" }), query: "account" })).toBe(true);
  });

  it("matches a token in the kind", () => {
    expect(entityMatchesQuery({ entity: entity({ kind: "password-policy" }), query: "password" })).toBe(true);
  });

  it("matches a string leaf buried in detail", () => {
    const view = entity({ detail: { template: { configFields: [{ label: "Password" }] } } });
    expect(entityMatchesQuery({ entity: view, query: "password" })).toBe(true);
  });

  it("requires every token, not any of them", () => {
    const view = entity({ detail: { name: "Windows - Lock Screen" } });
    expect(entityMatchesQuery({ entity: view, query: "windows lock" })).toBe(true);
    expect(entityMatchesQuery({ entity: view, query: "windows bitlocker" })).toBe(false);
  });

  it("never matches a token across two different fields", () => {
    const view = entity({ detail: { left: "pass", right: "word" }, kind: "k", providerId: "p", scope: "s" });
    expect(entityMatchesQuery({ entity: view, query: "password" })).toBe(false);
  });

  it("matches everything when the query is only whitespace", () => {
    expect(entityMatchesQuery({ entity: entity(), query: "   " })).toBe(true);
  });

  it("reads a leaf at the depth limit and stops one level past it", () => {
    const atLimit = entity({ detail: nest({ depth: ATLAS_QUERY_DEPTH_LIMIT - 1, leaf: "buried" }) });
    const pastLimit = entity({ detail: nest({ depth: ATLAS_QUERY_DEPTH_LIMIT, leaf: "buried" }) });
    expect(entityMatchesQuery({ entity: atLimit, query: "buried" })).toBe(true);
    expect(entityMatchesQuery({ entity: pastLimit, query: "buried" })).toBe(false);
  });

  it("is the same decision the exported predicate makes, field for field", () => {
    const view = entity({ detail: { template: { configFields: [{ label: "Password" }] } } });
    const tokens = atlasQueryTokens({ query: "password screen" });
    expect(entityCarriesTokens({ entity: view, tokens })).toBe(
      entityMatchesQuery({ entity: view, query: "password screen" }),
    );
    expect(entityCarriesTokens({ entity: view, tokens })).toBe(false);
  });
});

describe("atlasQueryMatches", () => {
  it("names the field that carried the token, and shows what it says", () => {
    const view = entity({ detail: { name: "macOS - Disallow Change Password" } });
    expect(atlasQueryMatches({ entity: view, query: "password" })).toEqual([
      { alsoIn: 0, excerpt: "macOS - Disallow Change Password", path: "detail.name", token: "password" },
    ]);
  });

  it("addresses an array element with a bracket rather than a dot", () => {
    const view = entity({ detail: { template: { configFields: [{ label: "SSID" }, { label: "Password" }] } } });
    const matches = atlasQueryMatches({ entity: view, query: "password" });
    expect(matches[0]!.path).toBe("detail.template.configFields[1].label");
  });

  it("reports the FIRST field and counts the rest", () => {
    const view = entity({
      detail: { name: "Password Policy", notes: "requires a password", template: { alert: "password" } },
    });
    const matches = atlasQueryMatches({ entity: view, query: "password" });
    expect(matches[0]!.path).toBe("detail.name");
    expect(matches[0]!.alsoIn).toBe(2);
  });

  it("reaches an identity field before it reaches detail", () => {
    const view = entity({ detail: { name: "a policy" }, providerId: "v2-policies-get" });
    expect(atlasQueryMatches({ entity: view, query: "policies" })[0]!.path).toBe("providerId");
  });

  it("gives one entry per token, in token order", () => {
    const view = entity({ detail: { name: "Windows Lock Screen" } });
    expect(atlasQueryMatches({ entity: view, query: "screen windows" }).map((match) => match.token)).toEqual([
      "screen",
      "windows",
    ]);
  });

  it("omits a token no field carried, so the witness never claims a match that is not there", () => {
    const view = entity({ detail: { name: "Windows Lock Screen" } });
    expect(atlasQueryMatches({ entity: view, query: "windows bitlocker" }).map((match) => match.token)).toEqual([
      "windows",
    ]);
  });

  it("leaves a path inside the budget exactly as addressed", () => {
    const view = entity({ detail: { template: { label: "Password" } } });
    expect(atlasQueryMatches({ entity: view, query: "password" })[0]!.path).toBe("detail.template.label");
  });

  it("elides the HEAD of a path a provider's own key made too wide, keeping the leaf", () => {
    const wideKey = "k".repeat(200);
    const view = entity({ detail: { [wideKey]: { label: "Password" } } });
    const path = atlasQueryMatches({ entity: view, query: "password" })[0]!.path;
    expect(path).toBe(`…${"k".repeat(89)}.label`);
    expect(path.length).toBe(ATLAS_PATH_MAX_CHARS);
  });

  it("cuts a long field down to the hit, with an ellipsis on each cut side", () => {
    const view = entity({ detail: { notes: `${"a".repeat(200)} password ${"b".repeat(200)}` } });
    const excerpt = atlasQueryMatches({ entity: view, query: "password" })[0]!.excerpt;
    // 24 characters of lead-in, the hit, then the rest of the 90-character budget.
    expect(excerpt).toBe(`…${"a".repeat(23)} password ${"b".repeat(57)}…`);
    expect(excerpt.length).toBe(ATLAS_EXCERPT_MAX_CHARS + 2);
  });

  it("leaves a field inside the budget whole, with no ellipsis", () => {
    const view = entity({ detail: { notes: "requires a password" } });
    expect(atlasQueryMatches({ entity: view, query: "password" })[0]!.excerpt).toBe("requires a password");
  });

  it("answers nothing for a whitespace-only query", () => {
    expect(atlasQueryMatches({ entity: entity({ detail: { name: "anything" } }), query: " " })).toEqual([]);
  });
});
