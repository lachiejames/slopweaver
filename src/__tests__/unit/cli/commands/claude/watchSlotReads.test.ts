/**
 * `claude watch`'s keychain reads over an injected item reader — a plain fake keyed by service name, never a mock
 * and never the real keychain. Each store's service is the one `claudeStoreService` derives for its directory.
 */
import { describe, expect, it } from "vitest";

import type { KeychainItemReader } from "../../../../../claude/keychain.js";
import { claudeStoreService } from "../../../../../claude/storeService.js";
import {
  pinnedActiveAlias,
  storeLives,
  storesSharingActiveCredential,
} from "../../../../../cli/commands/claude/watchSlotReads.js";

const SHARED = { claudeAiOauth: { accessToken: "A", expiresAt: 1_790_000_000_000 } };
const OTHER = { claudeAiOauth: { accessToken: "B", expiresAt: 1_790_003_600_000 } };

const ACCOUNTS = [
  { alias: "plan-one", email: "one@example.test", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
  { alias: "plan-three", storeDir: "/stores/three" },
];

/** A keychain holding the active slot and plan-one on one credential, plan-two on another, plan-three on nothing. */
const readItem: KeychainItemReader = ({ service }) => {
  const items = new Map<string, unknown>([
    [claudeStoreService({}), SHARED],
    [claudeStoreService({ storeDir: "/stores/one" }), SHARED],
    [claudeStoreService({ storeDir: "/stores/two" }), OTHER],
  ]);
  const item = items.get(service);
  if (item === undefined) {
    throw Object.assign(new Error("absent"), { status: 44 });
  }
  return JSON.stringify(item);
};

describe("pinnedActiveAlias", () => {
  it("names the configured plan whose store the pin points at", () => {
    expect(pinnedActiveAlias({ accounts: ACCOUNTS, pin: "/stores/two" })).toBe("plan-two");
  });

  it("answers nothing for an absent or blank pin", () => {
    expect(pinnedActiveAlias({ accounts: ACCOUNTS, pin: undefined })).toBeUndefined();
    expect(pinnedActiveAlias({ accounts: ACCOUNTS, pin: "  " })).toBeUndefined();
  });

  it("answers nothing for a pin no configured plan holds, rather than inventing an alias", () => {
    expect(pinnedActiveAlias({ accounts: ACCOUNTS, pin: "/stores/elsewhere" })).toBeUndefined();
  });
});

describe("storesSharingActiveCredential", () => {
  it("names only the store holding the active slot's own credential", () => {
    expect(storesSharingActiveCredential({ accounts: ACCOUNTS, readItem })).toStrictEqual(["plan-one"]);
  });
});

describe("storeLives", () => {
  it("reports each store's expiry, its cached email, and a signed-out store with neither", () => {
    expect(storeLives({ accounts: ACCOUNTS, readItem })).toStrictEqual([
      {
        alias: "plan-one",
        email: "one@example.test",
        expiresAtIso: "2026-09-21T14:13:20.000Z",
        hasCredential: true,
      },
      { alias: "plan-two", expiresAtIso: "2026-09-21T15:13:20.000Z", hasCredential: true },
      { alias: "plan-three", hasCredential: false },
    ]);
  });
});
