import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import {
  type AutonomyAdoptDeps,
  parseFieldReplacement,
  runAutonomyAdopt,
} from "../../../cli/commands/autonomy/adopt.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  memoryAutonomyLedgerPort,
  memoryAutonomyStore,
  unavailableAutonomyLedgerPort,
} from "../../autonomyLedgerFixture.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway state home this verb may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-adoptcli-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  mkdirSync(join(root, "ledgers"), { recursive: true });
  return root;
}

/** A store holding no import record, with the home's register file present — the import is still to run. */
function pendingImportLedger(): AutonomyLedgerPort {
  const store = memoryAutonomyStore();
  store.source = { kind: "present" };
  return memoryAutonomyLedgerPort({ store });
}

/** One act with no witness, as a pre-verb session hand-appended it. */
const WITNESSLESS_LINE =
  '{"actionId":"h249-t0-rule-secret","kind":"handover.rule.finding",' +
  '"subject":"an-unregistered-secret-in-the-ambient-home-refuses-every-push-on-the-machine",' +
  '"doneIso":"2026-09-12T19:51:24Z","bySession":"fresh-supervisor-handoff-9249",' +
  '"why":"OWNER RULING 245-2: an unasked finding that is obviously wanted lands autonomously."}';

/**
 * The verb's seams, plus the two channels a test reads back.
 *
 * @param ledger the store's ledger; by default one that has not yet imported a register lying beside it, which is
 *   the only state a repair is for
 */
function harness({ ledger = pendingImportLedger() }: { ledger?: AutonomyLedgerPort } = {}): {
  deps: AutonomyAdoptDeps;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      ledger,
      now: () => "2026-09-13T05:45:38.326Z",
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("parseFieldReplacement", () => {
  it("splits an actionId from its replacement at the first equals", () => {
    const parsed = parseFieldReplacement({ raw: "handoff-9251-close=state:supervisor-scratch/x.txt" });

    expect(parsed!.actionId).toBe("handoff-9251-close");
    expect(parsed!.replacement).toBe("state:supervisor-scratch/x.txt");
  });

  it("keeps an equals inside the replacement", () => {
    expect(parseFieldReplacement({ raw: "a=https://example.com/x?y=1" })!.replacement).toBe(
      "https://example.com/x?y=1",
    );
  });

  it("reads a state: reference as a subject repair", () => {
    expect(parseFieldReplacement({ raw: "a=state:supervisor-scratch/x.txt" })!.field).toBe("subject");
  });

  it("reads an http(s) URL as a subject repair", () => {
    expect(parseFieldReplacement({ raw: "a=https://github.com/lachiejames/slopweaver/pull/636" })!.field).toBe(
      "subject",
    );
  });

  it("reads a board row slug as a subject repair", () => {
    expect(parseFieldReplacement({ raw: "a=acquireoperationlock-s-stale-lock-takeover" })!.field).toBe("subject");
  });

  it("reads an ISO-8601 instant as a doneIso repair, which is what a stale row needed", () => {
    const parsed = parseFieldReplacement({ raw: "257-1-dogfood-bugs-636-landed=2026-09-14T01:15:00Z" });

    expect(parsed!.field).toBe("doneIso");
    expect(parsed!.replacement).toBe("2026-09-14T01:15:00Z");
  });

  it("reads an instant carrying an offset and a fraction as a doneIso repair too", () => {
    expect(parseFieldReplacement({ raw: "a=2026-09-14T11:15:00.123456+10:00" })!.field).toBe("doneIso");
  });

  it("refuses a value with no equals, an empty id, or an empty replacement", () => {
    expect(parseFieldReplacement({ raw: "no-equals-here" })).toBeUndefined();
    expect(parseFieldReplacement({ raw: "=state:x" })).toBeUndefined();
    expect(parseFieldReplacement({ raw: "an-act=" })).toBeUndefined();
  });

  it("refuses a replacement the register could read as neither field", () => {
    expect(parseFieldReplacement({ raw: "a=23 workspaces parked 10h on landed pages" })).toBeUndefined();
  });

  it("refuses the placeholder instant the bad row actually carried, which no clock can parse", () => {
    expect(parseFieldReplacement({ raw: "257-1-dogfood-bugs-636-landed=2026-09-14T01:1xZ" })).toBeUndefined();
  });
});

describe("autonomy adopt", () => {
  it("prints its usage for --help and exits clean", async () => {
    const { deps, out } = harness();

    expect(await runAutonomyAdopt({ deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver autonomy adopt");
  });

  it("reports what it would change and writes nothing", async () => {
    const root = home();
    const path = join(root, "ledgers", "autonomy.jsonl");
    writeFileSync(path, `${WITNESSLESS_LINE}\n`, "utf8");
    const { deps, out } = harness();

    const code = await runAutonomyAdopt({ deps, rest: ["--home", root] });

    expect(code).toBe(EXIT_OK);
    expect(out.join("\n")).toContain("h249-t0-rule-secret  line 1  witness");
    expect(out.at(-1)).toBe("  nothing was written — pass --apply to install this");
    expect(readFileSync(path, "utf8")).toBe(`${WITNESSLESS_LINE}\n`);
  });

  it("installs the adopted register under --apply", async () => {
    const root = home();
    const path = join(root, "ledgers", "autonomy.jsonl");
    writeFileSync(path, `${WITNESSLESS_LINE}\n`, "utf8");
    const { deps, out } = harness();

    const code = await runAutonomyAdopt({ deps, rest: ["--home", root, "--apply"] });

    expect(code).toBe(EXIT_OK);
    expect(out.at(-1)).toContain("applied; the original is preserved at");
    expect(readFileSync(path, "utf8")).toContain("Hand-recorded row only");
  });

  it("refuses a positional that does not read as actionId=value", async () => {
    const { deps, diagnostics } = harness();

    const code = await runAutonomyAdopt({ deps, rest: ["no-equals"] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe('autonomy adopt: a replacement reads <actionId>=<value>, not "no-equals"');
  });

  it("names both value spaces when a replacement classifies as neither field", async () => {
    const { deps, diagnostics } = harness();

    const code = await runAutonomyAdopt({ deps, rest: ["an-act=not a subject and not an instant"] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("names no field this verb repairs");
    expect(diagnostics[0]).toContain("2026-09-14T01:15:00Z");
  });

  it("repairs a doneIso no clock can parse, which is what took the whole register off the page", async () => {
    const root = home();
    const path = join(root, "ledgers", "autonomy.jsonl");
    const broken =
      '{"actionId":"257-1-dogfood-bugs-636-landed","kind":"github.pr-land",' +
      '"subject":"https://github.com/lachiejames/slopweaver/pull/636","doneIso":"2026-09-14T01:1xZ",' +
      '"bySession":"dc33d089","why":"The owner ranks these bug fixes second now.",' +
      '"witness":"slopweaver github enqueue --number 636 -> queued"}';
    writeFileSync(path, `${broken}\n`, "utf8");
    const { deps, out } = harness();

    const code = await runAutonomyAdopt({
      deps,
      rest: ["--home", root, "257-1-dogfood-bugs-636-landed=2026-09-14T01:15:00Z", "--apply"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out.join("\n")).toContain("257-1-dogfood-bugs-636-landed  line 1  doneIso, witness");
    const written = readFileSync(path, "utf8");
    expect(written).toContain('"doneIso":"2026-09-14T01:15:00Z"');
    expect(written).toContain('Original doneIso: \\"2026-09-14T01:1xZ\\".');
    expect(written).toContain("slopweaver github enqueue --number 636 -> queued");
  });

  it("refuses to restamp a doneIso a clock can already parse", async () => {
    const root = home();
    const good =
      '{"actionId":"16644-enqueue","kind":"press-merge-when-ready",' +
      '"subject":"https://github.com/acme/acme-admin/pull/16644","doneIso":"2026-09-12T02:06:09Z",' +
      '"bySession":"workspace:123","why":"CI green, mergeable.","witness":"enqueue -> queued",' +
      '"said":"I merged your pull request on the admin app once every check had passed."}';
    writeFileSync(join(root, "ledgers", "autonomy.jsonl"), `${good}\n`, "utf8");
    const { deps, diagnostics } = harness();

    const code = await runAutonomyAdopt({
      deps,
      rest: ["--home", root, "16644-enqueue=2026-09-14T01:15:00Z"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("already carries a doneIso a clock can parse");
  });

  it("refuses a register whose subject is prose and names the subject in the refusal", async () => {
    const root = home();
    writeFileSync(
      join(root, "ledgers", "autonomy.jsonl"),
      '{"actionId":"a-close","kind":"cmux.close.parked","subject":"23 workspaces parked 10h",' +
        '"doneIso":"2026-09-13T01:10:38Z","bySession":"s","why":"owner turn 251-2."}\n',
      "utf8",
    );
    const { deps, diagnostics } = harness();

    const code = await runAutonomyAdopt({ deps, rest: ["--home", root] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("23 workspaces parked 10h");
    expect(diagnostics[0]).toContain("is not a checkable id");
  });

  it("emits one machine-readable document under --json", async () => {
    const root = home();
    writeFileSync(join(root, "ledgers", "autonomy.jsonl"), `${WITNESSLESS_LINE}\n`, "utf8");
    const { deps, out } = harness();

    await runAutonomyAdopt({ deps, rest: ["--home", root, "--json"] });

    const document: unknown = JSON.parse(out[0]!);
    expect((document as { applied: boolean }).applied).toBe(false);
    expect((document as { plan: { objects: number } }).plan.objects).toBe(1);
  });

  it("says so, and writes nothing, when the register already needs no change", async () => {
    const root = home();
    const good =
      '{"actionId":"16644-enqueue","kind":"press-merge-when-ready",' +
      '"subject":"https://github.com/acme/acme-admin/pull/16644","doneIso":"2026-09-12T02:06:09Z",' +
      '"bySession":"workspace:123","why":"CI green, mergeable.","witness":"enqueue -> queued",' +
      '"said":"I merged your pull request on the admin app once every check had passed."}';
    writeFileSync(join(root, "ledgers", "autonomy.jsonl"), `${good}\n`, "utf8");
    const { deps, out } = harness();

    await runAutonomyAdopt({ deps, rest: ["--home", root, "--apply"] });

    expect(out.at(-1)).toBe("  the register already needed no change, so nothing was written");
  });
});

describe("autonomy adopt once the store is the ledger", () => {
  it("refuses a repair the store would never read, and leaves the file alone", async () => {
    const root = home();
    const path = join(root, "ledgers", "autonomy.jsonl");
    writeFileSync(path, `${WITNESSLESS_LINE}\n`, "utf8");
    const store = memoryAutonomyStore();
    store.imported = true;
    const { deps, diagnostics } = harness({ ledger: memoryAutonomyLedgerPort({ store }) });

    const code = await runAutonomyAdopt({ deps, rest: ["--home", root, "--apply"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe(
      "autonomy adopt: the store is already this home's autonomy ledger — it has imported the register, or there " +
        "was none to import — so a repair here would edit a copy nothing reads",
    );
    expect(readFileSync(path, "utf8")).toBe(`${WITNESSLESS_LINE}\n`);
  });

  it("asks again under the register's lock, so an import landing after the first ask leaves the file alone", async () => {
    const root = home();
    const path = join(root, "ledgers", "autonomy.jsonl");
    writeFileSync(path, `${WITNESSLESS_LINE}\n`, "utf8");
    const store = memoryAutonomyStore();
    store.source = { kind: "present" };
    const base = memoryAutonomyLedgerPort({ store });
    // The import completes the moment the verb's first ask has been answered "not imported".
    const racing: AutonomyLedgerPort = {
      ...base,
      readRecords: async (input) => {
        const read = await base.readRecords(input);
        store.imported = true;
        return read;
      },
    };
    const { deps, diagnostics } = harness({ ledger: racing });

    const code = await runAutonomyAdopt({ deps, rest: ["--home", root, "--apply"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe(
      "autonomy adopt: the store is already this home's autonomy ledger — it has imported the register, or there " +
        "was none to import — so a repair here would edit a copy nothing reads — the store changed under this " +
        "adoption, so nothing was written",
    );
    expect(readFileSync(path, "utf8")).toBe(`${WITNESSLESS_LINE}\n`);
  });

  it("refuses when the store cannot say which copy is the ledger", async () => {
    const root = home();
    writeFileSync(join(root, "ledgers", "autonomy.jsonl"), `${WITNESSLESS_LINE}\n`, "utf8");
    const { deps, diagnostics } = harness({ ledger: unavailableAutonomyLedgerPort() });

    const code = await runAutonomyAdopt({ deps, rest: ["--home", root, "--apply"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe(
      `autonomy adopt: could not tell whether the store holds this register: ${AUTONOMY_FIXTURE_OUTAGE.message}`,
    );
  });
});

describe("a padded replacement", () => {
  it("is refused rather than written into the register with its padding", async () => {
    const { deps, diagnostics } = harness();

    const code = await runAutonomyAdopt({ deps, rest: ["an-act=  2026-09-14T01:15:00Z  "] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("names no field this verb repairs");
  });
});
