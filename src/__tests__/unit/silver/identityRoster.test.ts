/**
 * Unit: the identity roster as a store row — the strict decoder, the retired file's one-time import, compare-and-set
 * and an outage that never falls back to the file, all over an in-memory store. Every record here is synthetic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { retiredRosterFileLine } from "../../../silver/identityRoster.js";
import { decodeIdentityRoster, readIdentityRosterFile } from "../../../silver/identityRosterDecode.js";
import { IdentityRosterErrors, STORED_ROSTER_SOURCE } from "../../../silver/identityRosterErrors.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../identityRosterFixture.js";
import { FIXTURE_OUTAGE_REASON, memorySingletonStore } from "../../singletonRegisterFixture.js";

const SOURCE = "/home/identity.json";

const ADA = {
  handle: "ada",
  heardAs: ["Aida"],
  id: "U0FIXTUREADA",
  identities: [{ handle: "ada", nativeId: "lin-FIXTURE-ada", source: "linear" }],
  name: "Ada Acme",
} as const;
const BOB = { handle: "bob", id: "U0FIXTUREBOB", name: "Bob Acme" } as const;

describe("decodeIdentityRoster", () => {
  it("keeps every record in order, duplicates included, exactly as written", () => {
    expect(unwrap(decodeIdentityRoster({ source: SOURCE, value: [ADA, BOB, ADA] }))).toEqual([ADA, BOB, ADA]);
  });

  it("fills handle from id and name from handle, as the retired file did", () => {
    expect(unwrap(decodeIdentityRoster({ source: SOURCE, value: [{ id: "U0FIXTURECAL" }] }))).toEqual([
      { handle: "U0FIXTURECAL", id: "U0FIXTURECAL", name: "U0FIXTURECAL" },
    ]);
  });

  it("reads an empty array as an empty roster", () => {
    expect(unwrap(decodeIdentityRoster({ source: SOURCE, value: [] }))).toEqual([]);
  });

  it("refuses a document that is not an array", () => {
    expect(unwrapErr(decodeIdentityRoster({ source: SOURCE, value: { records: [] } }))).toEqual(
      IdentityRosterErrors.malformed({ problems: ["it is not a JSON array"], source: SOURCE }),
    );
  });

  it.each([
    ["an entry that is not an object", ["ada"], "entry 0 is not an object"],
    ["an entry with no id", [{ handle: "ada" }], "entry 0.id is not a non-empty string"],
    ["an empty name", [{ ...BOB, name: "" }], "entry 0.name is not a non-empty string"],
    ["identities that are not an array", [{ ...BOB, identities: "x" }], "entry 0.identities is not an array"],
    [
      "an identity from an unknown source",
      [{ ...BOB, identities: [{ nativeId: "x", source: "fax" }] }],
      "entry 0.identities[0].source is not one of",
    ],
    [
      "a heardAs spelling with no letter in it",
      [{ ...BOB, heardAs: ["   "] }],
      "entry 0.heardAs[0] is not a spelling with a letter or digit in it",
    ],
  ])("refuses %s, naming the entry by index", (_label, value, problem) => {
    const error = unwrapErr(decodeIdentityRoster({ source: SOURCE, value }));
    expect(error.code).toBe("IDENTITY_ROSTER_MALFORMED");
    expect(error.problems.some((found) => found.startsWith(problem))).toBe(true);
  });

  it("refuses an unknown key by COUNT, never echoing the key or its value", () => {
    const hiddenKey = "private-note-FIXTURE-never-echoed";
    const error = unwrapErr(decodeIdentityRoster({ source: SOURCE, value: [{ ...BOB, [hiddenKey]: hiddenKey }] }));
    expect(error.problems).toEqual([
      "entry 0 carries 1 key(s) the roster does not hold (allowed: id, handle, name, email, identities, heardAs)",
    ]);
    expect(error.message).not.toContain(hiddenKey);
    expect(JSON.stringify([{ [hiddenKey]: hiddenKey }])).toContain(hiddenKey);
  });

  it("reports every problem across every entry in one refusal", () => {
    const error = unwrapErr(decodeIdentityRoster({ source: SOURCE, value: [{ handle: "x" }, "y"] }));
    expect(error.problems).toEqual(["entry 0.id is not a non-empty string", "entry 1 is not an object"]);
  });
});

describe("readIdentityRosterFile", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-identity-roster-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("answers undefined when nothing is there", () => {
    expect(unwrap(readIdentityRosterFile({ operation: "read it", path: join(home, "absent.json") }))).toBe(undefined);
  });

  it("refuses a file that is not JSON, rather than reading it as an empty roster", () => {
    const path = join(home, "identity.json");
    writeFileSync(path, "[ not json");
    const error = unwrapErr(readIdentityRosterFile({ operation: "read it", path }));
    expect([error.code, error.message.startsWith(`${path} is not an identity roster: `)]).toEqual([
      "IDENTITY_ROSTER_MALFORMED",
      true,
    ]);
  });

  it("refuses a path it cannot read as a file", () => {
    const path = join(home, "identity.json");
    mkdirSync(path);
    const error = unwrapErr(readIdentityRosterFile({ operation: "read it", path }));
    expect(error.code).toBe("IDENTITY_ROSTER_MALFORMED");
    expect(error.message).toContain("it could not be read (");
  });
});

describe("the store port", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-identity-roster-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const writeRetiredFile = ({ value }: { value: unknown }): string => {
    const path = stateHomePaths({ home }).identityJson;
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  it("answers an empty roster at no revision when the store is empty and there is no file, writing nothing", async () => {
    const store = memorySingletonStore();
    const snapshot = unwrap(await memoryIdentityRosterPort({ store }).read({ home }));
    expect(snapshot).toEqual({ records: [], retiredFile: undefined, revision: null });
    expect(store.rows.size).toBe(0);
  });

  it("imports the retired file ONCE, and then the row is the authority over any later edit to it", async () => {
    const store = memorySingletonStore();
    const port = memoryIdentityRosterPort({ store });
    const path = writeRetiredFile({ value: [ADA] });
    const imported = unwrap(await port.read({ home }));
    expect([imported.revision, imported.records]).toEqual([1, [ADA]]);
    writeRetiredFile({ value: [BOB] });
    const reread = unwrap(await port.read({ home }));
    expect(reread).toEqual({ records: [ADA], retiredFile: path, revision: 1 });
    expect(retiredRosterFileLine({ snapshot: reread })).toBe(
      `${path} is retired and read by nothing: the store's row (revision 1) is the identity roster. Change it with ` +
        "`slopweaver identity roster replace`, then move that file out of the home",
    );
  });

  it("peeks without importing: the file is named as awaiting the import and no row is written", async () => {
    const store = memorySingletonStore();
    const path = writeRetiredFile({ value: [ADA] });
    const peeked = unwrap(await memoryIdentityRosterPort({ store }).peek({ home }));
    expect(peeked).toEqual({ records: [], retiredFile: path, revision: null });
    expect(store.rows.size).toBe(0);
    expect(retiredRosterFileLine({ snapshot: peeked })).toContain(
      "the next roster read will attempt to import it once",
    );
  });

  it("refuses a malformed retired file on the import, writing no row", async () => {
    const store = memorySingletonStore();
    writeRetiredFile({ value: [{ handle: "no-id" }] });
    const error = unwrapErr(await memoryIdentityRosterPort({ store }).read({ home }));
    expect(error.code).toBe("IDENTITY_ROSTER_MALFORMED");
    expect(store.rows.size).toBe(0);
  });

  it("refuses a stored row that is not a roster, rather than reading it as nobody", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: { not: "a roster" }, revision: 3 });
    expect(unwrapErr(await memoryIdentityRosterPort({ store }).read({ home }))).toEqual(
      IdentityRosterErrors.malformed({ problems: ["it is not a JSON array"], source: STORED_ROSTER_SOURCE }),
    );
  });

  it("replaces the roster pinned to the revision read, bumping it", async () => {
    const store = memorySingletonStore();
    const port = memoryIdentityRosterPort({ store });
    const first = unwrap(await port.replace({ expectedRevision: null, home, records: [ADA] }));
    const second = unwrap(await port.replace({ expectedRevision: 1, home, records: [BOB, ADA] }));
    expect([first.revision, second.revision, second.records]).toEqual([1, 2, [BOB, ADA]]);
    expect(store.rows.get(home)).toEqual({ document: [BOB, ADA], revision: 2 });
  });

  it("refuses a stale revision with nothing written, opening the store once and never retrying", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: [ADA], revision: 4 });
    const error = unwrapErr(
      await memoryIdentityRosterPort({ store }).replace({ expectedRevision: 3, home, records: [] }),
    );
    expect([error, store.rows.get(home)!.revision, store.opened]).toEqual([
      IdentityRosterErrors.revisionConflict({ expectedRevision: 3 }),
      4,
      1,
    ]);
  });

  it("refuses a first write when a row already exists, naming revision 0", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: [ADA], revision: 1 });
    expect(
      unwrapErr(await memoryIdentityRosterPort({ store }).replace({ expectedRevision: null, home, records: [BOB] })),
    ).toEqual(IdentityRosterErrors.revisionConflict({ expectedRevision: 0 }));
    expect(store.rows.get(home)).toEqual({ document: [ADA], revision: 1 });
  });

  it("refuses on a store outage and never falls back to the retired file", async () => {
    writeRetiredFile({ value: [ADA] });
    const error = unwrapErr(await unavailableIdentityRosterPort().read({ home }));
    expect(error.code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("so who a handle names is UNKNOWN");
    expect(error.message).toContain(FIXTURE_OUTAGE_REASON);
  });
});
