/**
 * Removing a home's retired copies of the Storage address and key. Each case writes the files first, so the
 * absence asserted afterwards is a removal and not a home that never held them.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { connectStore } from "../../../../store/client.js";
import { storeUrlSelection } from "../../../../store/config.js";
import { StoreErrors } from "../../../../store/errors.js";
import { removeRetiredStorageCopies, retiredStorageSecretNames } from "../../../../store/objects/retiredCopies.js";

const homes: string[] = [];

/** A throwaway home whose `secrets/` holds the named files. */
function homeWithSecrets({ names }: { names: readonly string[] }): string {
  const home = mkdtempSync(join(tmpdir(), "retired-copies-"));
  mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
  for (const name of names) {
    writeFileSync(join(home, "secrets", name), "FIXTURE", { mode: 0o600 });
  }
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("retiredStorageSecretNames", () => {
  it("derives exactly the two retired Storage copies from the register", () => {
    expect(retiredStorageSecretNames()).toEqual(["store-api-url", "store-service-key"]);
  });
});

describe("removeRetiredStorageCopies", () => {
  it("removes both retired copies and leaves every other secret", () => {
    const home = homeWithSecrets({ names: ["slack-bot-token", "store-api-url", "store-service-key"] });
    expect(existsSync(join(home, "secrets", "store-service-key"))).toBe(true);

    unwrap(removeRetiredStorageCopies({ home }));

    expect(existsSync(join(home, "secrets", "store-service-key"))).toBe(false);
    expect(existsSync(join(home, "secrets", "store-api-url"))).toBe(false);
    expect(existsSync(join(home, "secrets", "slack-bot-token"))).toBe(true);
  });

  it("succeeds on a home that never held them", () => {
    const home = homeWithSecrets({ names: ["slack-bot-token"] });

    expect(removeRetiredStorageCopies({ home }).isOk()).toBe(true);
    expect(existsSync(join(home, "secrets", "slack-bot-token"))).toBe(true);
  });
});

describe("storeUrlSelection", () => {
  it("removes the retired copies on every path that selects the store, not only connectStore", () => {
    const home = homeWithSecrets({ names: ["store-api-url", "store-service-key"] });
    expect(existsSync(join(home, "secrets", "store-service-key"))).toBe(true);

    const selected = storeUrlSelection({ env: { SLOPWEAVER_STORE_URL: "postgres://127.0.0.1:5432/x" }, home });

    expect(unwrap(selected).origin).toBe("environment");
    expect(existsSync(join(home, "secrets", "store-service-key"))).toBe(false);
    expect(existsSync(join(home, "secrets", "store-api-url"))).toBe(false);
  });

  it("refuses to select the store over a retired copy that will not be removed", () => {
    const home = homeWithSecrets({ names: ["store-api-url"] });
    const stuck = join(home, "secrets", "store-service-key");
    mkdirSync(join(stuck, "inside"), { recursive: true });

    const selected = storeUrlSelection({ env: { SLOPWEAVER_STORE_URL: "postgres://127.0.0.1:5432/x" }, home });

    expect(unwrapErr(selected)).toEqual(StoreErrors.retiredCopyUnremoved({ path: stuck }));
    expect(existsSync(stuck)).toBe(true);
  });
});

describe("connectStore", () => {
  it("removes an upgraded home's retired copies even when no store is selected and Storage is never reached", async () => {
    const home = homeWithSecrets({ names: ["slack-bot-token", "store-api-url", "store-service-key"] });
    expect(existsSync(join(home, "secrets", "store-service-key"))).toBe(true);

    const connected = await connectStore({ env: {}, home });

    expect(unwrapErr(connected).code).toBe("STORE_URL_MISSING");
    expect(existsSync(join(home, "secrets", "store-service-key"))).toBe(false);
    expect(existsSync(join(home, "secrets", "store-api-url"))).toBe(false);
    expect(existsSync(join(home, "secrets", "slack-bot-token"))).toBe(true);
  });
});
