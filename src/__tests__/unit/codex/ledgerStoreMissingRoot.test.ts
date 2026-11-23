import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanPassRecords } from "../../../codex/ledgerStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("scanPassRecords on a home no pass has run on", () => {
  it("reads an orchestration root that was never created as an empty ledger, not an ENOENT crash", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-ledger-"));
    homes.push(home);

    const scan = unwrap(scanPassRecords({ orchestrationRoot: join(home, "orchestration") }));

    expect(scan).toEqual({ records: [], unreadable: 0, withoutSidecar: 0 });
  });

  it("reads an existing but empty orchestration root the same way", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-ledger-"));
    homes.push(home);
    mkdirSync(join(home, "orchestration"));

    const scan = unwrap(scanPassRecords({ orchestrationRoot: join(home, "orchestration") }));

    expect(scan).toEqual({ records: [], unreadable: 0, withoutSidecar: 0 });
  });

  it("keeps a root that exists but cannot be listed as a typed error carrying its errno", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-ledger-"));
    homes.push(home);
    writeFileSync(join(home, "orchestration"), "not a directory");

    const result = scanPassRecords({ orchestrationRoot: join(home, "orchestration") });

    expect(unwrapErr(result).code).toBe("ENOTDIR");
  });
});
