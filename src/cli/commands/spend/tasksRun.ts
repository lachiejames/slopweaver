/**
 * The effectful shell for `spend tasks`: parse (pure), bind the Gmail door with the READ capability, read the newest
 * Airwallex task reminder and each expense's invoice (`../../../spend/tasks/read.ts`), and print one act per expense.
 *
 * A read of their mailbox that also WRITES locally — a matched receipt's PDFs land owner-only under
 * `live/gmail/attachments/`, exactly where `gmail attachment` puts them — and never a write to Airwallex.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomicBytes } from "../../../lib/writeAtomic.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { attachmentParts, DEFAULT_MAX_ATTACHMENT_BYTES, fetchGmailAttachment } from "../../../live/gmail/attachment.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import { parseGmailMessage } from "../../../live/gmail/parse.js";
import { readGmailListing } from "../../../live/gmail/read.js";
import { readTasks, type TaskReading, type TasksMailbox } from "../../../spend/tasks/read.js";
import { renderTaskReading } from "../../../spend/tasks/render.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSpendTasksArgs } from "./core.js";
import { type ReadSpendMerchants, readSpendMerchants, registeredMerchants } from "./merchantSeam.js";
import { SPEND_TASKS_USAGE } from "./usage.js";

/** The argv index the `spend tasks` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** The seams `spend tasks` performs its effects through. */
export interface SpendTasksDeps {
  /** Bind the mailbox for a home, or say why it cannot be. */
  readonly mailbox: (args: { home: string }) => Result<TasksMailbox, { message: string }>;
  /** The install's card-merchant register, read before the mailbox is bound. */
  readonly readMerchants: ReadSpendMerchants;
  readonly defaultHome: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `spend tasks` against injected edges.
 *
 * @param rest the argv tail after `spend tasks`
 * @param deps the injected edges
 * @returns the process exit code — 3 when no reminder is in the inbox
 */
export async function runSpendTasks({
  deps,
  rest,
}: {
  deps: SpendTasksDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SPEND_TASKS_USAGE);
    return EXIT_OK;
  }
  const parsed = parseSpendTasksArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SPEND_TASKS_USAGE);
    return EXIT_USAGE;
  }
  let home: string;
  if (parsed.value.home === undefined) {
    home = deps.defaultHome();
  } else {
    home = parsed.value.home;
  }
  const merchants = await registeredMerchants({ deps, home, verb: "spend tasks" });
  if (merchants.isErr()) {
    return EXIT_ERROR;
  }
  const mailbox = deps.mailbox({ home });
  if (mailbox.isErr()) {
    deps.writeDiagnostic(`spend tasks: ${mailbox.error.message}`);
    return EXIT_ERROR;
  }
  const reading = await readTasks({ mailbox: mailbox.value, merchants: merchants.value });
  if (reading.isErr()) {
    deps.writeDiagnostic(`spend tasks: ${reading.error.message}`);
    return EXIT_ERROR;
  }
  if (parsed.value.json) {
    deps.writeOut(safeJsonStringify({ label: "spend tasks", space: 2, value: reading.value }));
  } else {
    deps.writeOut(renderTaskReading({ reading: reading.value }));
  }
  return exitFor({ reading: reading.value });
}

/**
 * The exit a reading ends on: 3 for an inbox holding no reminder, so `spend tasks || …` fires on nothing to do.
 *
 * @returns the exit code
 */
function exitFor({ reading }: { reading: TaskReading }): number {
  if (reading.kind === "no-reminder") {
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_OK;
}

/**
 * The production mailbox: a `read` grant, the Gmail door's own listing, full read and attachment fetch.
 *
 * @param home the Slopweaver home the grant and the attachments root resolve under
 * @returns the bound mailbox, or why the grant cannot serve it
 */
export function productionMailbox({ home }: { home: string }): Result<TasksMailbox, { message: string }> {
  const bound = resolveGmailClient({ capabilities: ["read"], home });
  if (bound.isErr()) {
    return err(bound.error);
  }
  const { account, client } = bound.value;
  const api = makeGmailApi({ account, client });
  const nowIso = (): string => new Date().toISOString();
  return ok({
    account,
    readFull: async ({ id }) => {
      const message = await api.getMessage({ format: "full", id });
      if (message.isErr()) {
        return err(message.error);
      }
      const parsed = parseGmailMessage({ message: message.value });
      if (parsed === undefined) {
        return err({ message: `message ${id} carries no id or thread id Gmail can address` });
      }
      return ok({ message: parsed, parts: attachmentParts({ part: message.value.payload }) });
    },
    savePart: async ({ messageId, partId }) => {
      const fetched = await fetchGmailAttachment({
        account,
        api,
        maxBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
        messageId,
        nowIso,
        root: stateHomePaths({ home }).live.gmail.attachments,
        selector: { name: undefined, partId },
        writeBytes: ({ bytes, path }) => {
          writeFileAtomicBytes({ bytes, dirMode: 0o700, fileMode: 0o600, path });
        },
      });
      return fetched.map((result) => result.saved.localPath);
    },
    search: async ({ query, limit }) => {
      const listed = await readGmailListing({ account, api, labelIds: [], limit, nowIso, query });
      return listed.map((result) =>
        result.listing.entries.map((entry) => ({ id: entry.id, sentAtIso: entry.sentAtIso })),
      );
    },
  });
}

/** `slopweaver spend tasks` — the newest Airwallex task reminder, as one upload act per expense, invoice pulled. */
export const spendTasksCommand = defineCommand({
  run: (argv) =>
    runSpendTasks({
      deps: {
        defaultHome: () => slopweaverHome(),
        mailbox: productionMailbox,
        readMerchants: readSpendMerchants,
        writeDiagnostic: (line) => {
          logger.warn({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
