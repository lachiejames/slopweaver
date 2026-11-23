/**
 * Unit: the install's own `gmail triage` policy — the document's strict shape and refusals, version 1 read as its
 * sender rows alone, the retired file's read,
 * and the store port over an in-memory store: the one-time import, compare-and-set, and an outage that never falls
 * back to the file. Every row here is synthetic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type GmailTriageRulesDocument,
  inertRuleFileLine,
  parseGmailTriageRulesDocument,
  readGmailTriageRulesFile,
} from "../../../../live/gmail/triageRuleStore.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryGmailTriageRulesPort, unavailableGmailTriageRulesPort } from "../../../gmailTriageRulesFixture.js";
import { FIXTURE_OUTAGE_REASON, memorySingletonStore } from "../../../singletonRegisterFixture.js";

const PATH = "/home/gmail-triage-rules.json";

const FROM_ROW = {
  anchor: "transcript:FIXTURE#from-row",
  key: "from:notices@vendor.example",
  kind: "from",
  sender: "Vendor notices",
  why: "the signal reaches the owner another way",
} as const;

const RELAY_ROW = {
  anchor: "transcript:FIXTURE#relay-row",
  key: "relay:alerts@acme.com:certvendor",
  kind: "relay",
  sender: "Certvendor alerts, via the alerts group",
  subjectIncludes: "Certificate issued for",
  why: "the platform team already gets them",
} as const;

/** A version 2 document holding the given parts, every other array empty. */
function v2({
  rules = [],
  structuralRules = [],
  delegates = [],
  gatedRules = [],
}: {
  rules?: readonly unknown[];
  structuralRules?: readonly unknown[];
  delegates?: readonly unknown[];
  gatedRules?: readonly unknown[];
}): Record<string, unknown> {
  return { delegates, gatedRules, rules, schemaVersion: 2, structuralRules };
}

const LAST_REPLY = { anchor: "knowledge:l-0000000000000301", kind: "last-reply", why: "nobody is waiting" } as const;
const FATHOM = { anchor: "knowledge:l-0000000000000302", kind: "fathom-clear-inbox", why: "its verb owns it" } as const;
const INTEGRATION_GATE = {
  anchor: "knowledge:l-0000000000000303",
  key: "from:alerts@monitor.example",
  kind: "provider-integration-not-installed",
  why: "only when the provider's API reads it not installed",
} as const;
const INVITE_GATE = {
  anchor: "knowledge:l-0000000000000304",
  kind: "calendar-invite-responded",
  why: "the owner already answered on the event",
} as const;

/** A typed version 2 document for the port, every unnamed array empty. */
function policyDocument({
  rules = [],
  structuralRules = [],
  delegates = [],
}: {
  rules?: GmailTriageRulesDocument["rules"];
  structuralRules?: GmailTriageRulesDocument["structuralRules"];
  delegates?: GmailTriageRulesDocument["delegates"];
}): GmailTriageRulesDocument {
  return { delegates, gatedRules: [], rules, schemaVersion: 2, structuralRules };
}

describe("parseGmailTriageRulesDocument", () => {
  it("reads a from: row, a narrowed from: row and a relay row exactly as written", () => {
    const narrowed = { ...FROM_ROW, key: "from:billing@vendor.example", subjectIncludes: " renewal " };
    const { rules } = unwrap(
      parseGmailTriageRulesDocument({ source: PATH, value: v2({ rules: [FROM_ROW, narrowed, RELAY_ROW] }) }),
    );
    expect(rules).toEqual([FROM_ROW, narrowed, RELAY_ROW]);
  });

  it("reads every choice of a version 2 document exactly as written", () => {
    const value = v2({
      delegates: [FATHOM],
      gatedRules: [INTEGRATION_GATE, INVITE_GATE],
      rules: [FROM_ROW],
      structuralRules: [LAST_REPLY],
    });
    expect(unwrap(parseGmailTriageRulesDocument({ source: PATH, value }))).toEqual(value);
  });

  it("reads a version 1 document as its sender rows with nothing else switched on, at version 2", () => {
    expect(
      unwrap(parseGmailTriageRulesDocument({ source: PATH, value: { rules: [RELAY_ROW], schemaVersion: 1 } })),
    ).toEqual(v2({ rules: [RELAY_ROW] }));
  });

  it("reads an empty document as an install that declared nothing", () => {
    expect(unwrap(parseGmailTriageRulesDocument({ source: PATH, value: v2({}) }))).toEqual(v2({}));
  });

  it.each([
    ["a missing schema version", { rules: [] }, "schemaVersion"],
    ["another schema version", { rules: [], schemaVersion: 3 }, "schemaVersion"],
    ["a version 2 document missing an array", { rules: [], schemaVersion: 2, structuralRules: [] }, "delegates"],
    ["a version 1 document carrying a version 2 array", { delegates: [], rules: [], schemaVersion: 1 }, "(root)"],
    [
      "an unknown structural kind",
      v2({ structuralRules: [{ ...LAST_REPLY, kind: "older-than" }] }),
      "structuralRules.0.kind",
    ],
    ["a delegate with a blank anchor", v2({ delegates: [{ ...FATHOM, anchor: " " }] }), "delegates.0.anchor"],
    ["a gated rule naming no address", v2({ gatedRules: [{ ...INTEGRATION_GATE, key: "from:" }] }), "gatedRules.0.key"],
    ["a gated rule with no why", v2({ gatedRules: [{ ...INVITE_GATE, why: "" }] }), "gatedRules.0.why"],
    ["an unknown top-level key", { extra: true, rules: [], schemaVersion: 1 }, "(root)"],
    ["an unknown row key", { rules: [{ ...FROM_ROW, note: "x" }], schemaVersion: 1 }, "rules.0"],
    ["an unknown kind", { rules: [{ ...FROM_ROW, kind: "domain" }], schemaVersion: 1 }, "rules.0.kind"],
    ["a from: row keyed as a relay", { rules: [{ ...FROM_ROW, key: "relay:x@y:z" }], schemaVersion: 1 }, "rules.0.key"],
    ["a key naming no address", { rules: [{ ...FROM_ROW, key: "from:" }], schemaVersion: 1 }, "rules.0.key"],
    [
      "a relay row with no subject phrase",
      { rules: [{ ...RELAY_ROW, subjectIncludes: undefined }], schemaVersion: 1 },
      "rules.0.subjectIncludes",
    ],
    ["a blank anchor", { rules: [{ ...FROM_ROW, anchor: "  " }], schemaVersion: 1 }, "rules.0.anchor"],
    ["a blank why", { rules: [{ ...RELAY_ROW, why: "" }], schemaVersion: 1 }, "rules.0.why"],
  ])("refuses %s, naming where", (_label, value, where) => {
    const error = unwrapErr(parseGmailTriageRulesDocument({ source: PATH, value }));
    expect(error.code).toBe("TRIAGE_RULES_MALFORMED");
    expect(error.issues.some((issue) => issue.startsWith(`${where}: `))).toBe(true);
    expect(error.message).toContain(`${PATH} is not a gmail triage rule document (`);
  });

  it("refuses a row repeating another row's key, in either version", () => {
    const v1 = unwrapErr(
      parseGmailTriageRulesDocument({ source: PATH, value: { rules: [FROM_ROW, FROM_ROW], schemaVersion: 1 } }),
    );
    const v2Error = unwrapErr(
      parseGmailTriageRulesDocument({ source: PATH, value: v2({ rules: [FROM_ROW, FROM_ROW] }) }),
    );
    expect([v1.issues, v2Error.issues]).toEqual([
      ["key from:notices@vendor.example is declared more than once"],
      ["key from:notices@vendor.example is declared more than once"],
    ]);
  });

  it("refuses a kind declared twice, naming the array it sits in", () => {
    const error = unwrapErr(
      parseGmailTriageRulesDocument({
        source: PATH,
        value: v2({ delegates: [FATHOM, FATHOM], structuralRules: [LAST_REPLY, LAST_REPLY] }),
      }),
    );
    expect(error.issues).toEqual([
      "structuralRules declares last-reply more than once",
      "delegates declares fathom-clear-inbox more than once",
    ]);
  });
});

describe("readGmailTriageRulesFile", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-triage-rules-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("answers undefined when nothing is there", () => {
    expect(unwrap(readGmailTriageRulesFile({ path: join(home, "absent.json") }))).toBe(undefined);
  });

  it("refuses a file that is not JSON, rather than reading it as empty", () => {
    const path = join(home, "rules.json");
    writeFileSync(path, "{ not json");
    const error = unwrapErr(readGmailTriageRulesFile({ path }));
    expect([error.code, error.message]).toEqual([
      "TRIAGE_RULES_MALFORMED",
      `${path} is not a gmail triage rule document (invalid JSON)`,
    ]);
  });

  it("refuses a path it cannot read as a file", () => {
    const path = join(home, "rules.json");
    mkdirSync(path);
    const error = unwrapErr(readGmailTriageRulesFile({ path }));
    expect(error.code).toBe("TRIAGE_RULES_UNREADABLE");
    expect(error.message).toContain(`${path} could not be read (`);
  });
});

describe("the store port", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-triage-rules-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const writeRetiredFile = ({ value }: { value: unknown }): string => {
    const path = stateHomePaths({ home }).gmailTriageRulesJson;
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  it("answers no rows and no revision when the store is empty and there is no file", async () => {
    const store = memorySingletonStore();
    const snapshot = unwrap(await memoryGmailTriageRulesPort({ store }).read({ home }));
    expect(snapshot).toEqual({
      delegates: [],
      gatedRules: [],
      inertFile: undefined,
      revision: null,
      rules: [],
      structuralRules: [],
    });
    expect(store.rows.size).toBe(0);
  });

  it("imports the retired file ONCE, and then the row is the authority over any later edit to it", async () => {
    const store = memorySingletonStore();
    const port = memoryGmailTriageRulesPort({ store });
    const path = writeRetiredFile({ value: { rules: [RELAY_ROW], schemaVersion: 1 } });
    const imported = unwrap(await port.read({ home }));
    expect([imported.revision, imported.rules]).toEqual([1, [RELAY_ROW]]);
    writeRetiredFile({ value: { rules: [FROM_ROW], schemaVersion: 1 } });
    const reread = unwrap(await port.read({ home }));
    expect([reread.inertFile, reread.revision, reread.rules, reread.structuralRules]).toEqual([
      path,
      1,
      [RELAY_ROW],
      [],
    ]);
    expect(inertRuleFileLine({ snapshot: reread })).toBe(
      `${path} is retired and read by nothing: the store's row (revision 1) is this install's triage rules. ` +
        "Change them with `slopweaver gmail triage-rules --set <path>`, then move that file out of the home",
    );
  });

  it("refuses a damaged retired file on the import, writing no row", async () => {
    const store = memorySingletonStore();
    writeRetiredFile({ value: { rules: [{ ...FROM_ROW, kind: "domain" }], schemaVersion: 1 } });
    const error = unwrapErr(await memoryGmailTriageRulesPort({ store }).read({ home }));
    expect(error.code).toBe("TRIAGE_RULES_MALFORMED");
    expect(store.rows.size).toBe(0);
  });

  it("refuses a stored row that is not the document's shape, rather than reading it as empty", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: { rules: "nope", schemaVersion: 1 }, revision: 3 });
    const error = unwrapErr(await memoryGmailTriageRulesPort({ store }).read({ home }));
    expect([
      error.code,
      error.message.startsWith("the store's gmail-triage-rules row is not a gmail triage rule document ("),
    ]).toEqual(["TRIAGE_RULES_MALFORMED", true]);
  });

  it("replaces the document pinned to the revision read, bumping it", async () => {
    const store = memorySingletonStore();
    const port = memoryGmailTriageRulesPort({ store });
    const first = unwrap(
      await port.replace({ document: policyDocument({ rules: [FROM_ROW] }), expectedRevision: null, home }),
    );
    const second = unwrap(
      await port.replace({
        document: policyDocument({ rules: [RELAY_ROW], structuralRules: [LAST_REPLY] }),
        expectedRevision: 1,
        home,
      }),
    );
    expect([first.revision, second.revision, second.rules, second.structuralRules]).toEqual([
      1,
      2,
      [RELAY_ROW],
      [LAST_REPLY],
    ]);
    expect(store.rows.get(home)).toEqual({
      document: policyDocument({ rules: [RELAY_ROW], structuralRules: [LAST_REPLY] }),
      revision: 2,
    });
  });

  it("reads a stored version 1 row as its sender rows, and upgrades it on the next replace", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: { rules: [FROM_ROW], schemaVersion: 1 }, revision: 1 });
    const port = memoryGmailTriageRulesPort({ store });
    const read = unwrap(await port.read({ home }));
    expect([read.revision, read.rules, read.structuralRules, read.delegates]).toEqual([1, [FROM_ROW], [], []]);
    const written = unwrap(
      await port.replace({
        document: policyDocument({ delegates: [FATHOM], rules: [FROM_ROW] }),
        expectedRevision: 1,
        home,
      }),
    );
    expect([written.revision, written.delegates]).toEqual([2, [FATHOM]]);
  });

  it("refuses a stale revision with nothing written, and never retries it", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: { rules: [FROM_ROW], schemaVersion: 1 }, revision: 4 });
    const error = unwrapErr(
      await memoryGmailTriageRulesPort({ store }).replace({
        document: policyDocument({}),
        expectedRevision: 3,
        home,
      }),
    );
    expect([error.code, store.rows.get(home)!.revision, store.opened]).toEqual([
      "TRIAGE_RULES_REVISION_CONFLICT",
      4,
      1,
    ]);
  });

  it("refuses an insert when a row already exists, naming revision 0", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: { rules: [FROM_ROW], schemaVersion: 1 }, revision: 1 });
    const error = unwrapErr(
      await memoryGmailTriageRulesPort({ store }).replace({
        document: policyDocument({}),
        expectedRevision: null,
        home,
      }),
    );
    expect(error).toEqual({
      code: "TRIAGE_RULES_REVISION_CONFLICT",
      expectedRevision: 0,
      message:
        "the gmail triage rules changed while this change was being prepared (read at revision 0), so nothing " +
        "was written; list them again and decide whether it still applies",
    });
  });

  it("refuses on a store outage and never falls back to the retired file", async () => {
    writeRetiredFile({ value: { rules: [RELAY_ROW], schemaVersion: 1 } });
    const error = unwrapErr(await unavailableGmailTriageRulesPort().read({ home }));
    expect(error.code).toBe("TRIAGE_RULES_STORE_UNAVAILABLE");
    expect(error.message).toContain(`the store could not be opened, so which mail is already ruled is UNKNOWN`);
    expect(error.message).toContain(FIXTURE_OUTAGE_REASON);
  });
});
