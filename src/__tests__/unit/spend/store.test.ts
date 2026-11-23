import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseCardExport } from "../../../spend/parse.js";
import { cardDirectory, readLatestSnapshots, writeCardSnapshot } from "../../../spend/store.js";
import { exportText } from "./exportFixture.js";

const homes: string[] = [];

const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-spend-"));
  homes.push(home);
  return home;
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

const snapshotAsOf = ({ asOf }: { asOf: string }) =>
  unwrap(
    parseCardExport({ asOf, importedAt: `${asOf}T01:00:00.000Z`, sourcePath: "/tmp/card.md", text: exportText() }),
  );

describe("the spend register", () => {
  it("reads back exactly what it wrote", () => {
    const home = newHome();
    const snapshot = snapshotAsOf({ asOf: "2026-03-28" });
    const path = unwrap(writeCardSnapshot({ home, snapshot }));
    expect(path).toBe(join(home, "spend", "cards", "airwallex-0042", "2026-03-28.json"));
    expect(unwrap(readLatestSnapshots({ home, last4: undefined }))).toEqual([snapshot]);
  });

  it("reads the newest capture day of a card", () => {
    const home = newHome();
    unwrap(writeCardSnapshot({ home, snapshot: snapshotAsOf({ asOf: "2026-03-28" }) }));
    unwrap(writeCardSnapshot({ home, snapshot: snapshotAsOf({ asOf: "2026-03-29" }) }));
    const read = unwrap(readLatestSnapshots({ home, last4: "0042" }));
    expect(read.map((snapshot) => snapshot.asOf)).toEqual(["2026-03-29"]);
  });

  it("replaces an import of the same capture day rather than adding a second file", () => {
    const home = newHome();
    unwrap(writeCardSnapshot({ home, snapshot: snapshotAsOf({ asOf: "2026-03-28" }) }));
    unwrap(writeCardSnapshot({ home, snapshot: snapshotAsOf({ asOf: "2026-03-28" }) }));
    expect(readdirSync(cardDirectory({ home, last4: "0042", provider: "airwallex" }))).toEqual(["2026-03-28.json"]);
  });

  it("answers no cards on a home that has imported nothing", () => {
    expect(unwrap(readLatestSnapshots({ home: newHome(), last4: undefined }))).toEqual([]);
  });

  it("refuses a card never imported, naming the ones that were", () => {
    const home = newHome();
    unwrap(writeCardSnapshot({ home, snapshot: snapshotAsOf({ asOf: "2026-03-28" }) }));
    const error = unwrapErr(readLatestSnapshots({ home, last4: "9999" }));
    expect(error.code).toBe("CARD_NOT_FOUND");
    expect(error.message).toBe("no card ending 9999 — imported: airwallex-0042");
  });

  it("refuses a stored file that is not a snapshot", () => {
    const home = newHome();
    const directory = cardDirectory({ home, last4: "0042", provider: "airwallex" });
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "2026-03-28.json"), '{"schemaVersion":1}');
    const error = unwrapErr(readLatestSnapshots({ home, last4: undefined }));
    expect(error.code).toBe("SNAPSHOT_INVALID");
    expect(error.message).toContain("asOf");
  });

  it("refuses a stored file that is not JSON", () => {
    const home = newHome();
    const directory = cardDirectory({ home, last4: "0042", provider: "airwallex" });
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "2026-03-28.json"), "not json");
    expect(unwrapErr(readLatestSnapshots({ home, last4: undefined })).code).toBe("SNAPSHOT_UNREADABLE");
  });
});
