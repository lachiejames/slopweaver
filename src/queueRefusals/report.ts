/**
 * The chair's read of the Queue cards a gate withheld: the console's `GET /api/queue-refusals` report
 * (`site/lib/queueRefusalReport.ts`), validated at the boundary, and the one document `slopweaver queue refusals
 * --json` prints — the report when the console answered, or the stated reason it did not.
 *
 * Why the chair reads it at all: a card that fails its own gate no longer reaches the owner's Queue, so unless a
 * seat learns of it, the card is simply lost. The supervisor tick takes this reading and the chair routes each
 * withheld card to a seat that fixes its source record that pass (`skills/supervisor/reference/sweep-contract.md`).
 *
 * **A console that did not answer is never zero withheld.** It is a document of its own (`reached: false`) and a
 * non-zero exit, so a tick reads "unknown", never a quiet Queue.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";

/** The console's path for the report. */
export const QUEUE_REFUSALS_PATH = "/api/queue-refusals";

/**
 * How long one read of the report may take: the console reads seven registers, `handover list` up to 90s of them, and
 * the read must end inside the tick's shared reading budget (`READING_TIMEOUT_MS`, 120s) so a slow console is reported
 * by this verb rather than killed by the tick.
 */
const QUEUE_REFUSALS_TIMEOUT_MS = 100_000;

/** One register the console could not read, and why. */
const unreadSchema = z.strictObject({ source: z.string().min(1), why: z.string().min(1) });

/** One card a gate withheld, as the console names it — never the card itself. */
const withheldSchema = z.strictObject({
  key: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  why: z.string().min(1),
});

/** The report's fields, shared by the boundary read and the printed document. */
const reportFields = {
  complete: z.boolean(),
  observedAtIso: z.string().min(1),
  unread: z.array(unreadSchema),
  withheld: z.array(withheldSchema),
};

/**
 * Whether a report's `complete` agrees with its `unread` list. A report claiming completeness beside an unread
 * register would otherwise read as "0 withheld" and exit 0, so a disagreeing one is refused rather than believed.
 *
 * @returns true when `complete` is exactly "no register went unread"
 */
function completeAgrees({ complete, unread }: { complete: boolean; unread: readonly unknown[] }): boolean {
  return complete === (unread.length === 0);
}

/** What a refused disagreement says. */
const COMPLETE_DISAGREES = "complete disagrees with unread: a complete report names no unread register";

/** The report's whole shape; {@link completeAgrees} is checked after the read, as `defineBoundary` requires. */
const reportSchema = z.strictObject(reportFields);

/** `GET /api/queue-refusals`, read strictly: a field the console adds, drops or renames refuses by name. */
const QUEUE_REFUSALS_BOUNDARY = defineBoundary({ endpoint: `GET ${QUEUE_REFUSALS_PATH}`, schema: reportSchema });

/** The console's report, as validated. */
export type QueueRefusalReport = z.output<typeof reportSchema>;

/** The console was not reachable at all — nothing listening, or the read ran out of time. */
export interface ConsoleUnreachableError {
  readonly code: "CONSOLE_UNREACHABLE";
  readonly message: string;
  readonly url: string;
}

/** The console answered, but not with the report — a build that predates the route answers 404. */
export interface ConsoleRefusedError {
  readonly code: "CONSOLE_REFUSED";
  readonly message: string;
  readonly url: string;
  readonly status: number;
}

/** The console answered a body the boundary refused. */
export interface ReportUnreadableError {
  readonly code: "REPORT_UNREADABLE";
  readonly message: string;
  readonly url: string;
}

/** Why the report could not be read. */
export type QueueRefusalsError = ConsoleUnreachableError | ConsoleRefusedError | ReportUnreadableError;

/** How to raise each {@link QueueRefusalsError}. */
export const QueueRefusalsErrors = {
  refused: ({ url, status }: { url: string; status: number }): ConsoleRefusedError => ({
    code: "CONSOLE_REFUSED",
    message:
      `the console at ${url} answered ${String(status)}, not the report` +
      (status === 404 ? " — it may be serving a build without that route" : ""),
    status,
    url,
  }),
  unreachable: ({ url, cause }: { url: string; cause: unknown }): ConsoleUnreachableError => ({
    code: "CONSOLE_UNREACHABLE",
    message: `the console at ${url} did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
    url,
  }),
  unreadable: ({ url, detail }: { url: string; detail: string }): ReportUnreadableError => ({
    code: "REPORT_UNREADABLE",
    message: `the console at ${url} answered a report this build does not read: ${detail}`,
    url,
  }),
} as const;

/** One HTTP answer, as the injected getter hands it back. */
interface ConsoleAnswer {
  readonly status: number;
  readonly text: string;
}

/** The getter a read goes through — `fetch` in the verb, a plain function in a test. */
export type ConsoleGet = (request: { url: string; timeoutMs: number }) => Promise<ConsoleAnswer>;

/**
 * Read the report from the console.
 *
 * @param consoleBase the console origin, no trailing slash
 * @param get the HTTP getter; a throw from it is the console not answering
 * @returns the validated report, or why it could not be read
 */
export async function fetchQueueRefusals({
  consoleBase,
  get,
}: {
  consoleBase: string;
  get: ConsoleGet;
}): Promise<Result<QueueRefusalReport, QueueRefusalsError>> {
  const url = `${consoleBase}${QUEUE_REFUSALS_PATH}`;
  let answer: ConsoleAnswer;
  try {
    answer = await get({ timeoutMs: QUEUE_REFUSALS_TIMEOUT_MS, url });
  } catch (cause) {
    return err(QueueRefusalsErrors.unreachable({ cause, url }));
  }
  if (answer.status !== 200) {
    return err(QueueRefusalsErrors.refused({ status: answer.status, url }));
  }
  const parsed = QUEUE_REFUSALS_BOUNDARY.parseJson({ text: answer.text });
  if (parsed.isErr()) {
    return err(QueueRefusalsErrors.unreadable({ detail: parsed.error.message, url }));
  }
  if (!completeAgrees(parsed.value)) {
    return err(QueueRefusalsErrors.unreadable({ detail: COMPLETE_DISAGREES, url }));
  }
  return ok(parsed.value);
}

/** What `queue refusals --json` prints: the report beside the console it came from, or why the console was not read. */
export type QueueRefusalsOutcome =
  | ({ readonly consoleUrl: string; readonly reached: true } & QueueRefusalReport)
  | { readonly consoleUrl: string; readonly reached: false; readonly why: string };

/**
 * The printed document's schema — what the tick digest reads the captured reading back through, so a document this
 * build did not write is named rather than half-read.
 */
export const queueRefusalsOutcomeSchema = z
  .discriminatedUnion("reached", [
    z.strictObject({ consoleUrl: z.string().min(1), reached: z.literal(true), ...reportFields }),
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
export function queueRefusalsOutcome({
  consoleUrl,
  read,
}: {
  consoleUrl: string;
  read: Result<QueueRefusalReport, QueueRefusalsError>;
}): QueueRefusalsOutcome {
  if (read.isErr()) {
    return { consoleUrl, reached: false, why: read.error.message };
  }
  return { consoleUrl, reached: true, ...read.value };
}
