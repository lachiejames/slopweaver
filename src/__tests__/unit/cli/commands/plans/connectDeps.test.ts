import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { productionCodexConnectDeps } from "../../../../../cli/commands/plans/connectDeps.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { CONNECT_RESERVATION_FILE } from "../../../../../plans/connectPlan.js";

const ATTEMPT_ID = "0123abcd4567ef89";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connect-reserve-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The permission bits of a path, as an octal string. */
const modeOf = ({ path }: { path: string }): string => (statSync(path).mode & 0o777).toString(8);

describe("productionCodexConnectDeps reserveStoreDir", () => {
  it("creates a fresh store owner-only, parent included, holding the attempt's reservation", () => {
    const storeDir = join(home, "codex-accounts", "codex-1");
    const deps = productionCodexConnectDeps({ home });
    const reserved = unwrap(deps.reserveStoreDir({ attemptId: ATTEMPT_ID, storeDir }));
    expect([
      reserved,
      modeOf({ path: storeDir }),
      modeOf({ path: join(storeDir, CONNECT_RESERVATION_FILE) }),
      unwrap(deps.readStoreReservation({ storeDir })),
    ]).toEqual([true, "700", "600", ATTEMPT_ID]);
  });

  it("keeps the store, its reservation and every parent it made owner-only under a umask that strips the owner's own bits", () => {
    // Two missing levels, so the parent this call makes holds another it made.
    const storeDir = join(home, "nested", "codex-accounts", "codex-1");
    const deps = productionCodexConnectDeps({ home });
    const previous = process.umask(0o777);
    try {
      unwrap(deps.reserveStoreDir({ attemptId: ATTEMPT_ID, storeDir }));
    } finally {
      process.umask(previous);
    }
    expect([
      modeOf({ path: join(home, "nested") }),
      modeOf({ path: join(home, "nested", "codex-accounts") }),
      modeOf({ path: storeDir }),
      modeOf({ path: join(storeDir, CONNECT_RESERVATION_FILE) }),
    ]).toEqual(["700", "700", "700", "600"]);
  });

  it("leaves a parent already standing at the mode it had, never this call's to change", () => {
    const parent = join(home, "codex-accounts");
    mkdirSync(parent, { mode: 0o755 });
    unwrap(
      productionCodexConnectDeps({ home }).reserveStoreDir({
        attemptId: ATTEMPT_ID,
        storeDir: join(parent, "codex-1"),
      }),
    );
    expect(modeOf({ path: parent })).toBe("755");
  });

  it("never adopts a directory already standing, leaving what it holds where it was and writing no reservation", () => {
    const storeDir = join(home, "codex-accounts", "codex-1");
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "auth.json"), "{}\n");
    const deps = productionCodexConnectDeps({ home });
    const reserved = unwrap(deps.reserveStoreDir({ attemptId: ATTEMPT_ID, storeDir }));
    expect([
      reserved,
      statSync(join(storeDir, "auth.json")).isFile(),
      unwrap(deps.readStoreReservation({ storeDir })),
    ]).toEqual([false, true, undefined]);
  });

  it("reports a parent that cannot be made as an error, never as a store already taken", () => {
    // A regular file where the stores' directory belongs: the store under it cannot be made, and it is not there.
    writeFileSync(join(home, "codex-accounts"), "not a directory");
    const storeDir = join(home, "codex-accounts", "codex-1");
    const reserved = productionCodexConnectDeps({ home }).reserveStoreDir({ attemptId: ATTEMPT_ID, storeDir });
    expect(unwrapErr(reserved)).toContain("ENOTDIR");
  });

  it("reads no reservation for a store that is not there at all", () => {
    const storeDir = join(home, "codex-accounts", "codex-9");
    expect(unwrap(productionCodexConnectDeps({ home }).readStoreReservation({ storeDir }))).toBeUndefined();
  });
});

describe("productionCodexConnectDeps retireStoreDir", () => {
  it("moves the store into a fresh holding directory beside it, never onto one already standing there", () => {
    const storeDir = join(home, "codex-accounts", "codex-1");
    const deps = productionCodexConnectDeps({ home });
    unwrap(deps.reserveStoreDir({ attemptId: ATTEMPT_ID, storeDir }));
    // A directory squatting a name a removal could have predicted.
    const squat = `${storeDir}.retired-${ATTEMPT_ID}`;
    mkdirSync(squat);
    const holding = unwrap(deps.retireStoreDir({ storeDir }));
    expect([
      holding === squat,
      holding.startsWith(`${storeDir}.retired-`),
      existsSync(storeDir),
      unwrap(deps.readStoreReservation({ storeDir: join(holding, "store") })),
      readdirSync(squat),
    ]).toEqual([false, true, false, ATTEMPT_ID, []]);
  });

  it("removes a retired store by removing its holding directory, leaving whatever was later made at its old path", () => {
    const storeDir = join(home, "codex-accounts", "codex-1");
    const deps = productionCodexConnectDeps({ home });
    unwrap(deps.reserveStoreDir({ attemptId: ATTEMPT_ID, storeDir }));
    const holding = unwrap(deps.retireStoreDir({ storeDir }));
    // A concurrent `plans add` making its own directory at the path the store left.
    mkdirSync(storeDir);
    unwrap(deps.removeStoreDir({ storeDir: holding }));
    expect([existsSync(holding), readdirSync(storeDir)]).toEqual([false, []]);
  });

  it("refuses a store that is not there, leaving no holding directory behind", () => {
    const storeDir = join(home, "codex-accounts", "codex-1");
    mkdirSync(join(home, "codex-accounts"));
    const retired = productionCodexConnectDeps({ home }).retireStoreDir({ storeDir });
    expect([unwrapErr(retired), readdirSync(join(home, "codex-accounts"))]).toEqual([
      expect.stringContaining("ENOENT"),
      [],
    ]);
  });
});
