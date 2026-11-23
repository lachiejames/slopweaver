/**
 * The chair's read of the Queue cards that STOP the owner's work: the console's `GET /api/queue-stopping` report
 * (`site/lib/queueStoppingReport.ts`), validated at the boundary, and the one document `slopweaver queue stopping
 * --json` prints — the report when the console answered, or the stated reason it did not.
 *
 * Why the chair reads it: a stopped automation, or any blocker on one of the owner's priorities, is never buried,
 * and the chat update names it, in the Queue's order (a blocker first, a stopped automation after the owner's
 * priorities). The console is the one
 * place the Queue's rows are computed, so this asks it rather than re-deriving a second copy of the predicate, exactly
 * as `queue refusals` does (`../queueRefusals/report.ts`).
 *
 * **A console that did not answer is never "nothing stops".** It is a document of its own (`reached: false`) and a
 * non-zero exit, so a tick reads "unknown", never a clear Queue.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ConsoleGet } from "../queueRefusals/report.js";

/** The console's path for the report. */
export const QUEUE_STOPPING_PATH = "/api/queue-stopping";

/**
 * How long one read may take: the console reads three registers, `handover list` up to 90s of them, and the read must
 * end inside the tick's shared reading budget (`READING_TIMEOUT_MS`, 120s), as `queue refusals`' does.
 */
const QUEUE_STOPPING_TIMEOUT_MS = 100_000;

/** One register the console could not read, and why. */
const unreadSchema = z.strictObject({ source: z.string().min(1), why: z.string().min(1) });

/** One card stopping the owner's work, as the console names it. */
const stoppingSchema = z.strictObject({
  key: z.string().min(1),
  kind: z.string().min(1),
  options: z.array(z.strictObject({ letter: z.string().min(1), sentence: z.string().min(1) })),
  problem: z.string().nullable(),
  question: z.string(),
  reason: z.enum(["marked", "blocks-focus"]),
});

/** The report's fields, shared by the boundary read and the printed document. */
const reportFields = {
  complete: z.boolean(),
  observedAtIso: z.iso.datetime(),
  stopping: z.array(stoppingSchema),
  unread: z.array(unreadSchema),
};

/**
 * Whether a report's `complete` agrees with its `unread` list: one claiming completeness beside an unread register
 * would read as "nothing stops", so a disagreeing one is refused rather than believed.
 *
 * @returns true when `complete` is exactly "no register went unread"
 */
function completeAgrees({ complete, unread }: { complete: boolean; unread: readonly unknown[] }): boolean {
  return complete === (unread.length === 0);
}

/** What a refused disagreement says. */
const COMPLETE_DISAGREES = "complete disagrees with unread: a complete report names no unread register";

/** `GET /api/queue-stopping`, read strictly: a field the console adds, drops or renames refuses by name. */
const QUEUE_STOPPING_BOUNDARY = defineBoundary({
  endpoint: `GET ${QUEUE_STOPPING_PATH}`,
  schema: z.strictObject(reportFields),
});

/** The console's report, as validated. */
export type QueueStoppingReport = z.output<z.ZodObject<typeof reportFields>>;

/** The console was not reachable at all — nothing listening, or the read ran out of time. */
interface StoppingConsoleUnreachableError {
  readonly code: "CONSOLE_UNREACHABLE";
  readonly message: string;
}

/** The console answered, but not with the report — a build that predates the route answers 404. */
interface StoppingConsoleRefusedError {
  readonly code: "CONSOLE_REFUSED";
  readonly message: string;
  readonly status: number;
}

/** The console answered a body the boundary refused. */
interface StoppingReportUnreadableError {
  readonly code: "REPORT_UNREADABLE";
  readonly message: string;
}

/** Why the report could not be read. */
export type QueueStoppingError =
  StoppingConsoleUnreachableError | StoppingConsoleRefusedError | StoppingReportUnreadableError;

/** How to raise each {@link QueueStoppingError}. */
const QueueStoppingErrors = {
  refused: ({ url, status }: { url: string; status: number }): StoppingConsoleRefusedError => ({
    code: "CONSOLE_REFUSED",
    message:
      `the console at ${url} answered ${String(status)}, not the report` +
      (status === 404 ? " — it may be serving a build without that route" : ""),
    status,
  }),
  unreachable: ({ url, cause }: { url: string; cause: unknown }): StoppingConsoleUnreachableError => ({
    code: "CONSOLE_UNREACHABLE",
    message: `the console at ${url} did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  unreadable: ({ url, detail }: { url: string; detail: string }): StoppingReportUnreadableError => ({
    code: "REPORT_UNREADABLE",
    message: `the console at ${url} answered a report this build does not read: ${detail}`,
  }),
} as const;

/**
 * Read the report from the console.
 *
 * @param consoleBase the console origin, no trailing slash
 * @param get the HTTP getter; a throw from it is the console not answering
 * @returns the validated report, or why it could not be read
 */
export async function fetchQueueStopping({
  consoleBase,
  get,
}: {
  consoleBase: string;
  get: ConsoleGet;
}): Promise<Result<QueueStoppingReport, QueueStoppingError>> {
  const url = `${consoleBase}${QUEUE_STOPPING_PATH}`;
  let answer: Awaited<ReturnType<ConsoleGet>>;
  try {
    answer = await get({ timeoutMs: QUEUE_STOPPING_TIMEOUT_MS, url });
  } catch (cause) {
    return err(QueueStoppingErrors.unreachable({ cause, url }));
  }
  if (answer.status !== 200) {
    return err(QueueStoppingErrors.refused({ status: answer.status, url }));
  }
  const parsed = QUEUE_STOPPING_BOUNDARY.parseJson({ text: answer.text });
  if (parsed.isErr()) {
    return err(QueueStoppingErrors.unreadable({ detail: parsed.error.message, url }));
  }
  if (!completeAgrees(parsed.value)) {
    return err(QueueStoppingErrors.unreadable({ detail: COMPLETE_DISAGREES, url }));
  }
  return ok(parsed.value);
}

/** What `queue stopping --json` prints: the report beside the console it came from, or why it was not read. */
export type QueueStoppingOutcome =
  | ({ readonly consoleUrl: string; readonly reached: true } & QueueStoppingReport)
  | { readonly consoleUrl: string; readonly reached: false; readonly why: string };

/** The printed document's schema — what the tick digest reads the captured reading back through. */
export const queueStoppingOutcomeSchema = z
  .discriminatedUnion("reached", [
    // A reached report came from a real address, so one naming none is malformed rather than read.
    z.strictObject({ consoleUrl: z.url(), reached: z.literal(true), ...reportFields }),
    z.strictObject({ consoleUrl: z.string().min(1), reached: z.literal(false), why: z.string().min(1) }),
  ])
  .refine((outcome) => !outcome.reached || completeAgrees(outcome), { message: COMPLETE_DISAGREES });

/**
 * The document a read comes to.
 *
 * @param consoleUrl the report's address, named in the document
 * @param read the report, or why it could not be read
 * @returns the outcome to print
 */
export function queueStoppingOutcome({
  consoleUrl,
  read,
}: {
  consoleUrl: string;
  read: Result<QueueStoppingReport, QueueStoppingError>;
}): QueueStoppingOutcome {
  if (read.isErr()) {
    return { consoleUrl, reached: false, why: read.error.message };
  }
  return { consoleUrl, reached: true, ...read.value };
}
