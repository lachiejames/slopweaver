/**
 * `spend tasks`'s shell against a plain fake mailbox: the exit each reading ends on, the usage refusal, and a
 * mailbox read that fails naming its step. Values are invented.
 */
import { describe, expect, it } from "vitest";

import { runSpendTasks, type SpendTasksDeps } from "../../../../../cli/commands/spend/tasksRun.js";
import { SPEND_TASKS_USAGE } from "../../../../../cli/commands/spend/usage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { SpendMerchantDocument } from "../../../../../spend/merchants/core.js";
import { type SpendMerchantError, SpendMerchantErrors } from "../../../../../spend/merchants/errors.js";
import { NO_MERCHANTS_NOTE } from "../../../../../spend/merchants/read.js";
import { TaskReminderErrors } from "../../../../../spend/tasks/errors.js";
import { REMINDER_QUERY, type TasksMailbox } from "../../../../../spend/tasks/read.js";
import { StoreErrors } from "../../../../../store/errors.js";
import { FIXTURE_MERCHANTS } from "../../../spend/merchantFixture.js";

/** A mailbox whose searches answer nothing, or fail when `failSearch` is set. */
const emptyMailbox = ({ failSearch }: { failSearch: boolean }): TasksMailbox => ({
  account: "owner@example.test",
  readFull: async ({ id }) => err({ message: `no message ${id}` }),
  savePart: async () => err({ message: "nothing to save" }),
  search: async () => {
    if (failSearch) {
      return err({ message: "quota exhausted" });
    }
    return ok([]);
  },
});

/** The deps, and what each stream received. */
const harness = ({
  mailbox,
  register = ok({ merchants: FIXTURE_MERCHANTS, schemaVersion: 1 }),
}: {
  mailbox: SpendTasksDeps["mailbox"];
  register?: Result<SpendMerchantDocument, SpendMerchantError>;
}) => {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const homes: string[] = [];
  const deps: SpendTasksDeps = {
    defaultHome: () => "/home/default",
    mailbox: (args) => {
      homes.push(args.home);
      return mailbox(args);
    },
    readMerchants: async () => register,
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, homes, out };
};

describe("runSpendTasks", () => {
  it("exits 3 on an inbox holding no reminder, and says which mailbox it searched", async () => {
    const { deps, out, homes } = harness({ mailbox: () => ok(emptyMailbox({ failSearch: false })) });
    expect(await runSpendTasks({ deps, rest: [] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual([
      `spend tasks: no Airwallex task reminder in the inbox of owner@example.test (searched: ${REMINDER_QUERY})`,
    ]);
    expect(homes).toEqual(["/home/default"]);
  });

  it("binds the mailbox under --home and prints the reading as JSON", async () => {
    const { deps, out, homes } = harness({ mailbox: () => ok(emptyMailbox({ failSearch: false })) });
    expect(await runSpendTasks({ deps, rest: ["--home", "/home/other", "--json"] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(JSON.parse(out[0]!)).toEqual({ account: "owner@example.test", kind: "no-reminder", query: REMINDER_QUERY });
    expect(homes).toEqual(["/home/other"]);
  });

  it("exits 1 naming the step when the mailbox read fails", async () => {
    const { deps, diagnostics } = harness({ mailbox: () => ok(emptyMailbox({ failSearch: true })) });
    const expected = TaskReminderErrors.mailboxReadFailed({
      cause: { message: "quota exhausted" },
      step: "reminder search",
    });
    expect(await runSpendTasks({ deps, rest: [] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([`spend tasks: ${expected.message}`]);
  });

  it("exits 1 when the mailbox cannot be bound", async () => {
    const { deps, diagnostics } = harness({ mailbox: () => err({ message: "no Gmail grant" }) });
    expect(await runSpendTasks({ deps, rest: [] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual(["spend tasks: no Gmail grant"]);
  });

  it("runs with no merchant registered when no store is selected, saying so once on stderr", async () => {
    const absent = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.urlMissing({ envVar: "SLOPWEAVER_STORE_URL", secretName: "store-url" }),
    });
    const { deps, diagnostics } = harness({
      mailbox: () => ok(emptyMailbox({ failSearch: false })),
      register: err(absent),
    });
    expect(await runSpendTasks({ deps, rest: [] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(diagnostics).toEqual([`spend tasks: ${NO_MERCHANTS_NOTE}`]);
  });

  it("refuses before binding the mailbox when the store cannot be reached", async () => {
    const unreachable = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "card merchants read" }),
    });
    const { deps, diagnostics, homes } = harness({
      mailbox: () => ok(emptyMailbox({ failSearch: false })),
      register: err(unreachable),
    });
    expect(await runSpendTasks({ deps, rest: [] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([`spend tasks: ${unreachable.message}`]);
    expect(homes).toEqual([]);
  });

  it("refuses an unknown flag with the usage, and prints the usage on --help", async () => {
    const refused = harness({ mailbox: () => ok(emptyMailbox({ failSearch: false })) });
    expect(await runSpendTasks({ deps: refused.deps, rest: ["--card", "1234"] })).toBe(EXIT_USAGE);
    expect(refused.diagnostics.at(-1)).toBe(SPEND_TASKS_USAGE);
    expect(refused.homes).toEqual([]);
    const help = harness({ mailbox: () => ok(emptyMailbox({ failSearch: false })) });
    expect(await runSpendTasks({ deps: help.deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(help.out).toEqual([SPEND_TASKS_USAGE]);
  });
});
