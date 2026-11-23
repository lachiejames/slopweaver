/**
 * Unit: `gmail triage-rules` over an in-memory store — the list, the exit codes, `--json`'s round trip, and `--set`'s
 * one pinned write, validated whole before the store is opened. Every row here is synthetic.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type GmailTriageRulesDeps, runGmailTriageRules } from "../../../../../cli/commands/gmail/triageRulesRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GmailTriageRulesPort } from "../../../../../live/gmail/triageRuleStore.js";
import { readGmailTriageRulesFile } from "../../../../../live/gmail/triageRuleStore.js";
import { memoryGmailTriageRulesPort, unavailableGmailTriageRulesPort } from "../../../../gmailTriageRulesFixture.js";
import { type MemorySingletonStore, memorySingletonStore } from "../../../../singletonRegisterFixture.js";

const FROM_ROW = {
  anchor: "transcript:FIXTURE#from-row",
  key: "from:notices@vendor.example",
  kind: "from",
  sender: "Vendor notices",
  why: "the signal reaches the owner another way",
} as const;

const LAST_REPLY = { anchor: "knowledge:l-0000000000000401", kind: "last-reply", why: "nobody is waiting" } as const;

/** A version 2 document carrying the given sender rows and structural rules, every other array empty. */
const v2 = ({
  rules = [],
  structuralRules = [],
}: {
  rules?: readonly unknown[];
  structuralRules?: readonly unknown[];
}): Record<string, unknown> => ({ delegates: [], gatedRules: [], rules, schemaVersion: 2, structuralRules });

interface Recorded {
  readonly out: string[];
  readonly diagnostics: string[];
}

describe("runGmailTriageRules", () => {
  let home: string;
  let store: MemorySingletonStore;
  let recorded: Recorded;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-triage-rules-run-"));
    store = memorySingletonStore();
    recorded = { diagnostics: [], out: [] };
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const depsOver = ({ port }: { port: GmailTriageRulesPort }): GmailTriageRulesDeps => ({
    home: () => home,
    port,
    readDocument: readGmailTriageRulesFile,
    writeDiagnostic: (line) => {
      recorded.diagnostics.push(line);
    },
    writeOut: (line) => {
      recorded.out.push(line);
    },
  });

  const run = ({ rest }: { rest: readonly string[] }): Promise<number> =>
    runGmailTriageRules({ deps: depsOver({ port: memoryGmailTriageRulesPort({ store }) }), rest });

  const declared = ({ value }: { value: unknown }): string => {
    const path = join(home, "rules.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  it("exits 3 and says so when the install declares nothing", async () => {
    expect(await run({ rest: [] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded.out).toEqual([
      "this install declares no gmail triage policy (the store holds none): every group is carded",
    ]);
  });

  it("exits 3 over a stored policy that declares nothing, at its revision", async () => {
    store.rows.set(home, { document: v2({}), revision: 2 });
    expect(await run({ rest: [] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded.out).toEqual(["0 gmail triage choice(s), store revision 2"]);
  });

  it("--set writes the whole document once, at revision 1, then lists it", async () => {
    const path = declared({ value: v2({ rules: [FROM_ROW], structuralRules: [LAST_REPLY] }) });
    expect(await run({ rest: ["--set", path] })).toBe(EXIT_OK);
    expect(store.rows.get(home)).toEqual({
      document: v2({ rules: [FROM_ROW], structuralRules: [LAST_REPLY] }),
      revision: 1,
    });
    expect(recorded.diagnostics).toEqual(["gmail triage-rules: wrote revision 1"]);
    expect(recorded.out).toEqual([
      "2 gmail triage choice(s), store revision 1\n" +
        "sender rows (archived unasked):\n" +
        "  from:notices@vendor.example — the signal reaches the owner another way [transcript:FIXTURE#from-row]\n" +
        "structural rules:\n" +
        "  last-reply — nobody is waiting [knowledge:l-0000000000000401]",
    ]);
  });

  it("--set over an existing row pins to the revision read and bumps it", async () => {
    store.rows.set(home, { document: { rules: [], schemaVersion: 1 }, revision: 5 });
    const path = declared({ value: v2({ rules: [FROM_ROW] }) });
    expect(await run({ rest: ["--set", path, "--json"] })).toBe(EXIT_OK);
    expect(store.rows.get(home)!.revision).toBe(6);
    expect(JSON.parse(recorded.out[0]!)).toEqual({ document: v2({ rules: [FROM_ROW] }), revision: 6 });
  });

  it("--json prints a document --set takes back unchanged, a version 1 row read at version 2", async () => {
    store.rows.set(home, { document: { rules: [FROM_ROW], schemaVersion: 1 }, revision: 3 });
    expect(await run({ rest: ["--json"] })).toBe(EXIT_OK);
    const printed = JSON.parse(recorded.out[0]!) as { document: unknown };
    expect(printed).toEqual({ document: v2({ rules: [FROM_ROW] }), revision: 3 });
    expect(await run({ rest: ["--set", declared({ value: printed.document })] })).toBe(EXIT_OK);
    expect(store.rows.get(home)).toEqual({ document: v2({ rules: [FROM_ROW] }), revision: 4 });
  });

  it("--set refuses a malformed document with exit 2, opening no store", async () => {
    const path = declared({ value: v2({ rules: [{ ...FROM_ROW, kind: "domain" }] }) });
    expect(await run({ rest: ["--set", path] })).toBe(EXIT_USAGE);
    expect([store.opened, store.rows.size]).toEqual([0, 0]);
    expect(recorded.diagnostics[0]).toContain(`gmail triage-rules: ${path} is not a gmail triage rule document (`);
  });

  it("--set refuses a path that does not exist with exit 1, opening no store", async () => {
    const path = join(home, "absent.json");
    expect(await run({ rest: ["--set", path] })).toBe(EXIT_ERROR);
    expect(store.opened).toBe(0);
    expect(recorded.diagnostics).toEqual([`gmail triage-rules: ${path} does not exist — nothing was written`]);
  });

  it("refuses an empty --set before anything is read", async () => {
    expect(await run({ rest: ["--set", " "] })).toBe(EXIT_USAGE);
    expect(store.opened).toBe(0);
    expect(recorded.diagnostics).toContain("--set needs a path");
  });

  it("exits 1 on a store outage, naming it", async () => {
    const deps = depsOver({ port: unavailableGmailTriageRulesPort() });
    expect(await runGmailTriageRules({ deps, rest: [] })).toBe(EXIT_ERROR);
    expect(recorded.out).toEqual([]);
    expect(recorded.diagnostics[0]).toContain(
      "gmail triage-rules: this install's gmail triage rules live in the store",
    );
  });
});
