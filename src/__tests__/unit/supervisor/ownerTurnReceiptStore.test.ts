/**
 * The receipt journal on disk: a round-trip through a throwaway state home, and the two failures it reports
 * rather than swallows.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import {
  appendOwnerTurnReceipts,
  ownerTurnReceiptPath,
  readOwnerTurnReceipts,
  readTurnsShown,
} from "../../../supervisor/ownerTurnReceiptStore.js";
import type { OwnerTurnReceipt, ReadableTurn } from "../../../supervisor/ownerTurnReceipts.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    chmodSync(dir, 0o700);
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A throwaway state home, removed after the test that minted it. */
function stateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-receipts-"));
  homes.push(home);
  return home;
}

/** One row. */
const receipt = (over: Partial<OwnerTurnReceipt> & { pointer: string }): OwnerTurnReceipt => ({
  bytes: 12,
  readAtIso: "2026-09-15T00:00:00.000Z",
  session: { host: "claude-code", id: "a0000075-0000-4000-8000-000000000082" },
  ...over,
});

describe("the owner-turn receipt journal", () => {
  it("reads nothing on a fresh install, where the file has never been written", () => {
    expect(unwrap(readOwnerTurnReceipts({ home: stateHome() }))).toEqual([]);
  });

  it("appends rows and reads them back in file order, across two appends", () => {
    const home = stateHome();

    unwrap(appendOwnerTurnReceipts({ home, receipts: [receipt({ pointer: "a" }), receipt({ pointer: "b" })] }));
    const path = unwrap(appendOwnerTurnReceipts({ home, receipts: [receipt({ bytes: 3, pointer: "c" })] }));

    expect(path).toBe(ownerTurnReceiptPath({ home }));
    expect(unwrap(readOwnerTurnReceipts({ home })).map((row) => row.pointer)).toEqual(["a", "b", "c"]);
    expect(unwrap(readOwnerTurnReceipts({ home }))[2]!.bytes).toBe(3);
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });

  it("writes nothing at all for an empty batch, and still names the path", () => {
    const home = stateHome();

    const path = unwrap(appendOwnerTurnReceipts({ home, receipts: [] }));

    expect(path).toBe(ownerTurnReceiptPath({ home }));
    expect(unwrap(readOwnerTurnReceipts({ home }))).toEqual([]);
  });

  it("skips a malformed line rather than losing the rows around it", () => {
    const home = stateHome();
    unwrap(appendOwnerTurnReceipts({ home, receipts: [receipt({ pointer: "a" })] }));
    const path = ownerTurnReceiptPath({ home });
    writeFileSync(path, `${readFileSync(path, "utf8")}{oops\n${JSON.stringify(receipt({ pointer: "z" }))}\n`, "utf8");

    expect(unwrap(readOwnerTurnReceipts({ home })).map((row) => row.pointer)).toEqual(["a", "z"]);
  });

  it("reports a read it could not make, rather than answering with an empty journal", () => {
    const home = stateHome();
    unwrap(appendOwnerTurnReceipts({ home, receipts: [receipt({ pointer: "a" })] }));
    chmodSync(ownerTurnReceiptPath({ home }), 0o000);

    const read = readOwnerTurnReceipts({ home });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().message).toContain("permission denied");
    expect(read._unsafeUnwrapErr().operation).toBe("readOwnerTurnReceipts");
  });

  it("answers which window turns this session was shown, and NONE when the journal will not read", () => {
    const home = stateHome();
    const session = "a0000075-0000-4000-8000-000000000082";
    const turns: ReadableTurn[] = [
      { instantIso: "2026-09-14T10:00:00.000Z", pointer: "a", source: "chair", text: "one" },
      { instantIso: "2026-09-14T10:00:00.000Z", pointer: "b", source: "chair", text: "two" },
    ];
    unwrap(appendOwnerTurnReceipts({ home, receipts: [receipt({ pointer: "a" })] }));

    expect([...readTurnsShown({ session: { host: "claude-code", id: session }, home, turns })]).toEqual(["a"]);
    chmodSync(ownerTurnReceiptPath({ home }), 0o000);
    expect([...readTurnsShown({ session: { host: "claude-code", id: session }, home, turns })]).toEqual([]);
  });

  it("reports an append it could not make", () => {
    const home = stateHome();
    unwrap(appendOwnerTurnReceipts({ home, receipts: [receipt({ pointer: "a" })] }));
    chmodSync(ownerTurnReceiptPath({ home }), 0o400);

    const written = appendOwnerTurnReceipts({ home, receipts: [receipt({ pointer: "b" })] });

    expect(written.isErr()).toBe(true);
    expect(written._unsafeUnwrapErr().message).toContain("permission denied");
    expect(written._unsafeUnwrapErr().operation).toBe("appendOwnerTurnReceipts");
  });
});
