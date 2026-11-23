import { describe, expect, it } from "vitest";

import {
  aliasForOrganization,
  type ClaudeStoreIdentity,
  organizationForAlias,
  parseStoreIdentities,
  recordStoreIdentity,
  soleUnidentifiedAlias,
} from "../../../claude/checkoutIdentity.js";
import { parseClaudeAccounts } from "../../../claude/config.js";
import { ACTIVE_SLOT_ALIAS } from "../../../claude/probeStore.js";
import { unwrapErr } from "../../../lib/result.js";

const NOW = "2026-09-05T12:00:00.000Z";
const EARLIER = "2026-09-04T12:00:00.000Z";

const IDENTITIES: readonly ClaudeStoreIdentity[] = [
  { alias: "plan-one", observedAtIso: EARLIER, organizationId: "org-aaa" },
  { alias: "plan-two", observedAtIso: EARLIER, organizationId: "org-bbb" },
];

describe("parseStoreIdentities", () => {
  it("reads back every well-formed entry", () => {
    const parsed = parseStoreIdentities({
      value: { identities: [{ alias: "plan-one", observedAtIso: NOW, organizationId: "org-aaa" }] },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.alias).toBe("plan-one");
    expect(parsed[0]!.organizationId).toBe("org-aaa");
    expect(parsed[0]!.observedAtIso).toBe(NOW);
  });

  it("answers empty for a record that has never been written", () => {
    expect(parseStoreIdentities({ value: undefined })).toEqual([]);
  });

  it("answers empty for a record carrying no identities at all", () => {
    expect(parseStoreIdentities({ value: { selected: "plan-one", unavailable: [] } })).toEqual([]);
  });

  it("drops a malformed entry and keeps the rest, rather than refusing the whole file", () => {
    const parsed = parseStoreIdentities({
      value: {
        identities: [
          { alias: "plan-one", observedAtIso: NOW, organizationId: "org-aaa" },
          { alias: "plan-two", organizationId: 7 },
          "not an object",
        ],
      },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.alias).toBe("plan-one");
  });
});

describe("recordStoreIdentity", () => {
  it("adds a store that had never been identified", () => {
    const recorded = recordStoreIdentity({
      alias: "plan-three",
      identities: IDENTITIES,
      observedAtIso: NOW,
      organizationId: "org-ccc",
    });
    expect(recorded).toHaveLength(3);
    expect(recorded[2]!.alias).toBe("plan-three");
    expect(recorded[2]!.organizationId).toBe("org-ccc");
  });

  it("lets the newest observation replace an older one for the same store", () => {
    const recorded = recordStoreIdentity({
      alias: "plan-one",
      identities: IDENTITIES,
      observedAtIso: NOW,
      organizationId: "org-signed-in-again",
    });
    expect(recorded).toHaveLength(2);
    expect(organizationForAlias({ alias: "plan-one", identities: recorded })).toBe("org-signed-in-again");
    expect(organizationForAlias({ alias: "plan-two", identities: recorded })).toBe("org-bbb");
  });
});

describe("aliasForOrganization", () => {
  it("names the single store holding that account", () => {
    expect(aliasForOrganization({ identities: IDENTITIES, organizationId: "org-bbb" })).toBe("plan-two");
  });

  it("answers nothing when no store holds it, so the caller falls back rather than guessing", () => {
    expect(aliasForOrganization({ identities: IDENTITIES, organizationId: "org-unseen" })).toBeUndefined();
  });

  it("answers nothing when two stores hold the same account, because that is not a tie to break", () => {
    const duplicated = recordStoreIdentity({
      alias: "plan-three",
      identities: IDENTITIES,
      observedAtIso: NOW,
      organizationId: "org-aaa",
    });
    expect(aliasForOrganization({ identities: duplicated, organizationId: "org-aaa" })).toBeUndefined();
  });

  it("answers nothing against an empty record, which is the fresh-install case", () => {
    expect(aliasForOrganization({ identities: [], organizationId: "org-aaa" })).toBeUndefined();
  });
});

describe("organizationForAlias", () => {
  it("answers the recorded account for a known store", () => {
    expect(organizationForAlias({ alias: "plan-one", identities: IDENTITIES })).toBe("org-aaa");
  });

  it("answers nothing for a store that has never been identified", () => {
    expect(organizationForAlias({ alias: "plan-nine", identities: IDENTITIES })).toBeUndefined();
  });
});

describe("soleUnidentifiedAlias", () => {
  const ALIASES = ["plan-one", "plan-two", "plan-three"];

  it("names the one store that could not be identified", () => {
    expect(soleUnidentifiedAlias({ aliases: ALIASES, identities: IDENTITIES })).toBe("plan-three");
  });

  it("answers nothing when two stores are still unidentified", () => {
    expect(soleUnidentifiedAlias({ aliases: ALIASES, identities: [IDENTITIES[0]!] })).toBeUndefined();
  });

  it("answers nothing when every store has been identified", () => {
    const all = recordStoreIdentity({
      alias: "plan-three",
      identities: IDENTITIES,
      observedAtIso: NOW,
      organizationId: "org-ccc",
    });
    expect(soleUnidentifiedAlias({ aliases: ALIASES, identities: all })).toBeUndefined();
  });

  it("ignores an identity for a store that is no longer configured", () => {
    const retired = recordStoreIdentity({
      alias: "plan-retired",
      identities: IDENTITIES,
      observedAtIso: NOW,
      organizationId: "org-zzz",
    });
    expect(soleUnidentifiedAlias({ aliases: ALIASES, identities: retired })).toBe("plan-three");
  });
});

describe("the active slot's placeholder alias", () => {
  it("could never collide with a configured plan, because an alias may not carry a colon", () => {
    const parsed = parseClaudeAccounts({
      value: [
        { alias: ACTIVE_SLOT_ALIAS, storeDir: "/stores/x" },
        { alias: "plan-two", storeDir: "/stores/two" },
      ],
    });
    expect(unwrapErr(parsed).code).toBe("ACCOUNT_CONFIG_INVALID");
    expect(unwrapErr(parsed).message).toContain("needs an `alias` of lowercase letters, digits and hyphens");
  });
});
