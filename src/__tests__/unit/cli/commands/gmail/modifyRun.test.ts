/**
 * Unit: the mutation shells. Every edge is a plain function — no vi.fn anywhere — and the shells route their one
 * mutating call through `throughDoor`, which records its decision through the in-memory door ledger each case is
 * handed (`doorLedgerFixture.ts`), so a decision is read back without a shared service. `home` stays a real
 * `mkdtempSync` directory because the shells still take one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import type { GmailModifyDeps } from "../../../../../cli/commands/gmail/modifyRun.js";
import {
  runGmailArchive,
  runGmailLabel,
  runGmailLabels,
  runGmailMark,
} from "../../../../../cli/commands/gmail/modifyRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import type { GmailModifyPlan, GmailModifyScope } from "../../../../../live/gmail/modify.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

/** A plan the fake `plan` seam hands back, varied by the two things the shells branch on. */
function planFixture({
  noop = false,
  scope = "message",
}: {
  noop?: boolean;
  scope?: GmailModifyScope;
}): GmailModifyPlan {
  return {
    account: "owner@example.test",
    address: scope === "thread" ? "t-1" : "m-1",
    before: [{ id: "m-1", labelIds: ["INBOX", "UNREAD"] }],
    intent: "archive",
    labelNames: { INBOX: "INBOX", Label_7: "Waiting on" },
    plan: { addLabelIds: [], noop, removeLabelIds: noop ? [] : ["INBOX"] },
    scope,
  };
}

/** Everything the fake seams recorded, so a test can assert what did and did not happen. */
interface Recorded {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly applied: GmailModifyPlan[];
  readonly planned: {
    address: string;
    scope: string;
    intent: string;
    addRefs: readonly string[];
    removeRefs: readonly string[];
  }[];
}

function depsFor({
  home,
  recorded,
  plan = planFixture({}),
  planFails = false,
  failFor = [],
  applyFails = false,
  ledger = memoryDoorLedger().port,
}: {
  home: string;
  recorded: Recorded;
  plan?: GmailModifyPlan;
  planFails?: boolean;
  /** Ids whose planning fails while every other id's succeeds. */
  failFor?: readonly string[];
  applyFails?: boolean;
  /** The door ledger the decision is recorded through — a fresh in-memory one unless a test says the store is down. */
  ledger?: DoorLedgerPort;
}): GmailModifyDeps {
  return {
    apply: async ({ plan: decided }) => {
      recorded.applied.push(decided);
      return applyFails
        ? err(GmailErrors.apiFailed({ message: "mailbox refused the change" }))
        : ok({ after: [{ id: "m-1", labelIds: ["UNREAD"] }], plan: decided, residue: ["the residue line"] });
    },
    doorLedger: ledger,
    home: () => home,
    labels: async () =>
      ok({
        document: {
          coverage: { detail: "2 label(s)", kind: "bounded", residue: [] },
          data: null,
          readAtIso: "2026-08-28T00:00:00.000Z",
          source: "gmail",
          target: { address: "labels", identity: "owner@example.test", kind: "labels" },
        },
        vocabulary: {
          account: "owner@example.test",
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "Label_7", name: "Waiting on", type: "user" },
          ],
        },
      }),
    plan: async ({ address, scope, intent, addRefs, removeRefs }) => {
      recorded.planned.push({ addRefs, address, intent, removeRefs, scope });
      return planFails || failFor.includes(address) ? err(GmailErrors.notConnected()) : ok(plan);
    },
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
    writeOut: (line) => recorded.out.push(line),
  };
}

function fresh(): Recorded {
  return { applied: [], diagnostics: [], out: [], planned: [] };
}

/**
 * Run one shell against a real temp home, cleaning it up afterwards.
 *
 * The caller owns its own {@link Recorded} rather than being handed one back, so nothing is named twice and
 * the assertions read against a binding that was in scope before the run started.
 */
async function withHome({ run }: { run: (args: { home: string }) => Promise<number> }): Promise<number> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gmail-modify-"));
  try {
    return await run({ home });
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}

describe("runGmailArchive", () => {
  it("plans and applies, reporting the state read back", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.applied.length).toBe(1);
    expect(recorded.out[0]).toContain("archive: message m-1");
    expect(recorded.out[0]).toContain("the residue line");
  });

  it("--dry-run plans and sends NOTHING", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: ["m-1", "--dry-run"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.applied).toStrictEqual([]);
    expect(recorded.out[0]).toContain("DRY RUN — nothing was sent.");
  });

  it("--dry-run --json emits an applied:false document", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: ["m-1", "--dry-run", "--json"] }),
    });
    expect(JSON.parse(recorded.out[0]!).applied).toBe(false);
  });

  it("--json on a real run emits an applied:true document", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: ["m-1", "--json"] }),
    });
    expect(JSON.parse(recorded.out[0]!).applied).toBe(true);
  });

  it("passes the thread scope through when --thread is given", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) =>
        runGmailArchive({
          deps: depsFor({ home, plan: planFixture({ scope: "thread" }), recorded }),
          rest: ["t-1", "--thread"],
        }),
    });
    expect(recorded.planned[0]!.scope).toBe("thread");
  });

  it("reports an already-archived message as done rather than claiming a change", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) =>
        runGmailArchive({ deps: depsFor({ home, plan: planFixture({ noop: true }), recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.out[0]).toContain("already done");
  });

  it("exits usage without planning when the id is missing", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: [] }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded.planned).toStrictEqual([]);
  });

  it("exits error and applies nothing when planning fails", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, planFails: true, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.applied).toStrictEqual([]);
    expect(recorded.diagnostics[0]).toContain("slopweaver gmail connect");
  });

  it("exits error and reports the mailbox's own message when the change fails", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ applyFails: true, home, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.diagnostics[0]).toBe("mailbox refused the change");
  });

  it("archives several ids in the order given, one change each", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: ["m-3", "m-1", "m-2"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.planned.map((planned) => planned.address)).toStrictEqual(["m-3", "m-1", "m-2"]);
    expect(recorded.applied.length).toBe(3);
    expect(recorded.out.length).toBe(3);
  });

  it("keeps going past a failed id, names it, and exits error", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) =>
        runGmailArchive({ deps: depsFor({ failFor: ["m-2"], home, recorded }), rest: ["m-1", "m-2", "m-3"] }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.applied.length).toBe(2);
    expect(recorded.diagnostics.length).toBe(1);
    expect(recorded.diagnostics[0]!.startsWith("m-2: ")).toBe(true);
  });

  it("applies nothing for an id whose decision cannot be recorded, names it, and carries on to the next", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) =>
        runGmailArchive({
          deps: depsFor({ home, ledger: unreachableDoorLedger(), recorded }),
          rest: ["m-1", "m-2"],
        }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.applied).toStrictEqual([]);
    expect(recorded.planned.map((planned) => planned.address)).toStrictEqual(["m-1", "m-2"]);
    expect(recorded.diagnostics.map((line) => line.slice(0, 4))).toStrictEqual(["m-1:", "m-2:"]);
    expect(recorded.diagnostics[0]).toContain("not performed: ");
    expect(recorded.diagnostics[0]).toContain("fixture: the store is down");
  });

  it("--json with several ids prints one compact line per id, each naming its id", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ home, recorded }), rest: ["m-1", "m-2", "--json"] }),
    });
    const lines = recorded.out.map((line) => JSON.parse(line) as { address: string; applied: boolean });
    expect(lines.map((line) => [line.address, line.applied])).toStrictEqual([
      ["m-1", true],
      ["m-2", true],
    ]);
    expect(recorded.out.some((line) => line.includes("\n"))).toBe(false);
  });

  it("a single id's failure line carries no id prefix, exactly as before", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailArchive({ deps: depsFor({ applyFails: true, home, recorded }), rest: ["m-1"] }),
    });
    expect(recorded.diagnostics).toStrictEqual(["mailbox refused the change"]);
  });
});

describe("runGmailMark", () => {
  it("sends the UNREAD removal for --read", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailMark({ deps: depsFor({ home, recorded }), rest: ["m-1", "--read"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.planned[0]!.removeRefs).toStrictEqual(["UNREAD"]);
    expect(recorded.planned[0]!.intent).toBe("mark read");
  });

  it("sends the UNREAD addition for --unread", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailMark({ deps: depsFor({ home, recorded }), rest: ["m-1", "--unread"] }),
    });
    expect(recorded.planned[0]!.addRefs).toStrictEqual(["UNREAD"]);
  });

  it("exits usage when neither direction is given", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailMark({ deps: depsFor({ home, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded.planned).toStrictEqual([]);
  });
});

describe("runGmailLabel", () => {
  it("passes both reference lists through untouched, for the resolver to interpret", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) =>
        runGmailLabel({
          deps: depsFor({ home, recorded }),
          rest: ["m-1", "--add", "Waiting on", "--remove", "INBOX"],
        }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.planned[0]!.addRefs).toStrictEqual(["Waiting on"]);
    expect(recorded.planned[0]!.removeRefs).toStrictEqual(["INBOX"]);
  });

  it("exits usage when nothing was asked for", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailLabel({ deps: depsFor({ home, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("shows a label's display name beside its opaque id in a dry run", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) =>
        runGmailLabel({
          deps: depsFor({
            home,
            plan: {
              ...planFixture({}),
              intent: "label",
              plan: { addLabelIds: ["Label_7"], noop: false, removeLabelIds: [] },
            },
            recorded,
          }),
          rest: ["m-1", "--add", "Waiting on", "--dry-run"],
        }),
    });
    expect(recorded.out[0]).toContain("+Waiting on (Label_7)");
  });
});

describe("runGmailLabels", () => {
  it("renders system labels and user labels with both name and id", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailLabels({ deps: depsFor({ home, recorded }), rest: [] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.out[0]).toContain("Waiting on  →  Label_7");
  });

  it("--json emits the shared provider document", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailLabels({ deps: depsFor({ home, recorded }), rest: ["--json"] }),
    });
    expect(JSON.parse(recorded.out[0]!).source).toBe("gmail");
  });

  it("exits usage on an unknown flag", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailLabels({ deps: depsFor({ home, recorded }), rest: ["--nope"] }),
    });
    expect(code).toBe(EXIT_USAGE);
  });
});
