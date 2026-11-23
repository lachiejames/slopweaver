/**
 * The pure decisions `store recover` makes about a home it did not build: which URL reaches the recovered
 * database on a wiped machine, what happens to a path the home already holds, which marker a re-run resumes
 * from, and when the database step is refused rather than written into.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { RecoverErrors } from "../../../store/backup/recoverErrors.js";
import {
  bundleNamesToInstall,
  databaseAction,
  databaseNameOf,
  homeStoreUrlRepoint,
  installDecision,
  type RecoverMarker,
  recoveredStoreUrl,
  resumeMarker,
  storeUrlDiffersOnlyByDatabase,
} from "../../../store/backup/recoverPlan.js";
import { BACKUP_PASSPHRASE_SECRET } from "../../../store/backup/secretsBundle.js";
import { STORE_URL_SECRET } from "../../../store/config.js";

const PREFIX = "slopweaver/2026-09-29T17-12-51-910Z/";

const LOCKED = "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/postgres";

const FRESH: RecoverMarker = {
  database: "store_recovered",
  databaseRestoredAtIso: null,
  filesRestoredAtIso: null,
  prefix: PREFIX,
  secretsInstalledAtIso: null,
};

describe("recoveredStoreUrl", () => {
  it("refuses with no store selected, naming yarn store:start, rather than guess the image's default login", () => {
    const url = recoveredStoreUrl({ database: "store_recovered", selection: null });

    expect(unwrapErr(url)).toEqual(
      RecoverErrors.urlUnresolved({
        reasons: [
          "no store is selected: run `yarn store:start` from the checkout first, which locks the stack and writes " +
            "secrets/store-url, then run store recover again",
        ],
      }),
    );
  });

  it("keeps the home's own login, host and port, names the recovered database, and may repoint store-url", () => {
    const url = recoveredStoreUrl({ database: "store_recovered", selection: { origin: "secret", url: LOCKED } });

    expect(unwrap(url)).toEqual({
      homeStoreDatabase: "postgres",
      url: "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/store_recovered",
    });
  });

  it("never lets a URL from the environment repoint the home's store-url", () => {
    const url = recoveredStoreUrl({ database: "store_recovered", selection: { origin: "environment", url: LOCKED } });

    expect(unwrap(url).homeStoreDatabase).toBe(null);
  });

  it("refuses a selected store that is not a URL", () => {
    const url = recoveredStoreUrl({ database: "store_recovered", selection: { origin: "secret", url: "not a url" } });

    expect(unwrapErr(url).code).toBe("RECOVER_URL_UNRESOLVED");
  });
});

describe("homeStoreUrlRepoint", () => {
  it("lets the home's store-url move away from a database holding no table, as on a fresh stack", () => {
    const repoint = homeStoreUrlRepoint({ current: "postgres", publicTables: 0, recovered: "store_recovered" });

    expect(repoint.isOk()).toBe(true);
    expect(unwrap(repoint)).toBe(undefined);
  });

  it("refuses to move it away from a database holding a store, naming both databases", () => {
    const repoint = homeStoreUrlRepoint({ current: "postgres", publicTables: 1, recovered: "store_recovered" });

    expect(unwrapErr(repoint)).toEqual(
      RecoverErrors.homeStoreInUse({ current: "postgres", recovered: "store_recovered" }),
    );
    expect(unwrapErr(repoint).message).toContain("SLOPWEAVER_STORE_URL");
  });
});

describe("storeUrlDiffersOnlyByDatabase", () => {
  const incoming = "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/store_recovered";

  it("is true when the database is the one difference", () => {
    expect(storeUrlDiffersOnlyByDatabase({ incoming, present: LOCKED })).toBe(true);
  });

  it.each([
    ["the password", "postgresql://slopweaver_lock:other-pass@127.0.0.1:55322/postgres"],
    ["the login", "postgresql://postgres:lock-pass@127.0.0.1:55322/postgres"],
    ["the host", "postgresql://slopweaver_lock:lock-pass@localhost:55322/postgres"],
    ["the port", "postgresql://slopweaver_lock:lock-pass@127.0.0.1:54322/postgres"],
    ["the options", "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/postgres?sslmode=require"],
    ["the scheme", "postgres://slopweaver_lock:lock-pass@127.0.0.1:55322/postgres"],
    ["the fragment", "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/postgres#elsewhere"],
  ])("is false when %s differs too", (_field, present) => {
    expect(storeUrlDiffersOnlyByDatabase({ incoming, present })).toBe(false);
  });

  it("is false when nothing differs, so an identical URL is never called a replacement", () => {
    expect(storeUrlDiffersOnlyByDatabase({ incoming, present: incoming })).toBe(false);
  });

  it("is false when either side does not parse", () => {
    expect(storeUrlDiffersOnlyByDatabase({ incoming, present: "not a url" })).toBe(false);
  });
});

describe("databaseNameOf", () => {
  it("names the database alone, never the login or host", () => {
    expect(databaseNameOf({ url: LOCKED })).toBe("postgres");
  });

  it("decodes an encoded name", () => {
    expect(databaseNameOf({ url: "postgresql://a:b@127.0.0.1:1/store%20two" })).toBe("store two");
  });
});

describe("installDecision", () => {
  it("writes what the home does not hold", () => {
    expect(installDecision({ incoming: "a".repeat(64), present: null })).toBe("write");
  });

  it("skips what the home holds byte for byte", () => {
    expect(installDecision({ incoming: "a".repeat(64), present: "a".repeat(64) })).toBe("identical");
  });

  it("never overwrites a difference", () => {
    expect(installDecision({ incoming: "a".repeat(64), present: "b".repeat(64) })).toBe("conflict");
  });
});

describe("bundleNamesToInstall", () => {
  it("drops the old machine's store-url and any passphrase a bundle carries, keeping every token", () => {
    const names = bundleNamesToInstall({
      names: ["slack-bot-token", STORE_URL_SECRET, "linear-api-key", BACKUP_PASSPHRASE_SECRET],
    });

    expect(names).toEqual(["slack-bot-token", "linear-api-key"]);
  });

  it("drops any name that would place a file outside secrets/", () => {
    const names = bundleNamesToInstall({ names: ["../profile.json", "a/b", "a\\b", ".", "..", "github-token"] });

    expect(names).toEqual(["github-token"]);
  });

  it("installs nothing from an empty bundle", () => {
    expect(bundleNamesToInstall({ names: [] })).toEqual([]);
  });
});

describe("resumeMarker", () => {
  it("starts fresh with no marker on disk", () => {
    expect(resumeMarker({ database: "store_recovered", decoded: null, prefix: PREFIX })).toEqual(FRESH);
  });

  it("resumes a marker for the same backup and database", () => {
    const written: RecoverMarker = { ...FRESH, databaseRestoredAtIso: "2026-09-30T01:00:00.000Z" };

    expect(resumeMarker({ database: "store_recovered", decoded: written, prefix: PREFIX })).toEqual(written);
  });

  it("starts fresh when the marker names another database", () => {
    const written: RecoverMarker = { ...FRESH, database: "other", databaseRestoredAtIso: "2026-09-30T01:00:00.000Z" };

    expect(resumeMarker({ database: "store_recovered", decoded: written, prefix: PREFIX })).toEqual(FRESH);
  });

  it("starts fresh when the marker names another backup", () => {
    const written: RecoverMarker = {
      ...FRESH,
      filesRestoredAtIso: "2026-09-30T01:00:00.000Z",
      prefix: "slopweaver/2026-09-28T17-12-51-910Z/",
    };

    expect(resumeMarker({ database: "store_recovered", decoded: written, prefix: PREFIX })).toEqual(FRESH);
  });

  it("starts fresh from a marker that does not parse", () => {
    expect(resumeMarker({ database: "store_recovered", decoded: { prefix: 3 }, prefix: PREFIX })).toEqual(FRESH);
  });
});

describe("databaseAction", () => {
  it("restores into a database that does not exist or is empty", () => {
    expect(unwrap(databaseAction({ marker: FRESH, publicTables: 0 }))).toBe("restore");
  });

  it("skips a database this recovery already restored", () => {
    const marker: RecoverMarker = { ...FRESH, databaseRestoredAtIso: "2026-09-30T01:00:00.000Z" };

    expect(unwrap(databaseAction({ marker, publicTables: 40 }))).toBe("skip");
  });

  it("restores again when the database a marker records has since emptied", () => {
    const marker: RecoverMarker = { ...FRESH, databaseRestoredAtIso: "2026-09-30T01:00:00.000Z" };

    expect(unwrap(databaseAction({ marker, publicTables: 0 }))).toBe("restore");
  });

  it("refuses a database holding a store no recovery recorded restoring", () => {
    expect(unwrapErr(databaseAction({ marker: FRESH, publicTables: 40 }))).toEqual(
      RecoverErrors.databaseHoldsStore({ database: "store_recovered" }),
    );
  });
});
