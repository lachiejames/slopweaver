/**
 * `slopweaver workstreams loop-in` — park the conversation a mined candidate owes one person on their Queue.
 *
 * Nothing is sent. The draft goes through `slack draft record`'s own path, so every as-me gate runs and they read,
 * edits and sends it from the Queue. The rules are `../../../workstreams/loopIn.ts`; the lock and the check are
 * `../../../workstreams/loopInStore.ts`.
 */
import { z } from "zod";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { ReceiptsDeclaration } from "../../../outbound/slack/draftReceipts.js";
import { type LoopInError, LoopInErrors } from "../../../workstreams/loopInErrors.js";
import {
  type LoopInDeps,
  type LoopInReceipt,
  type ParkedLoopIn,
  parkLoopIn,
} from "../../../workstreams/loopInStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseWorkstreamsLoopInArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { WORKSTREAMS_LOOP_IN_USAGE } from "./usage.js";

/** Everything `workstreams loop-in` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsLoopInDeps extends LoopInDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The exit code a failed park maps to: a candidate or person not owed a conversation is a caller mistake, anything else
 * an error.
 *
 * @returns the exit code
 */
function loopInExit({ error }: { error: LoopInError }): number {
  if (error.code === "LOOP_IN_NOT_OWED") {
    return EXIT_USAGE;
  }
  return EXIT_ERROR;
}

/** Print what stands: the receipt whole under `--json`, else one line naming the draft and its state. */
function printReceipt({
  json,
  receipt,
  writeOut,
}: {
  json: boolean;
  receipt: LoopInReceipt;
  writeOut: (line: string) => void;
}): void {
  if (json) {
    writeOut(JSON.stringify(receipt));
    return;
  }
  const said = {
    held: "was already waiting on the Queue for your yes",
    parked: "is parked on the Queue for your yes — nothing sent",
    released: "was already sent",
  } as const;
  writeOut(`${receipt.candidate} → ${receipt.person}: draft ${receipt.draftId} ${said[receipt.state]}`);
}

/**
 * Run `workstreams loop-in` against injected seams.
 *
 * @param rest the argv tail after `workstreams loop-in`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsLoopIn({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsLoopInDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_LOOP_IN_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsLoopInArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_LOOP_IN_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const candidateId = stringFlag({ name: "candidate", values });
  const person = stringFlag({ name: "person", values });
  if (candidateId === undefined || person === undefined) {
    deps.writeDiagnostic("workstreams loop-in: --candidate <id> and --person <slack member id> go together");
    deps.writeDiagnostic(WORKSTREAMS_LOOP_IN_USAGE);
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", values }) });
  const parked = await parkLoopIn({ candidateId, deps, home, person });
  if (parked.isErr()) {
    deps.writeDiagnostic(`workstreams loop-in: ${parked.error.message}`);
    return loopInExit({ error: parked.error });
  }
  printReceipt({ json: values["json"] === true, receipt: parked.value, writeOut: deps.writeOut });
  return EXIT_OK;
}

/** What `slack draft record --json` prints on a park, as far as this verb reads it. */
const parkedDocument = z.object({ item: z.object({ id: z.string() }) });

/**
 * Park one loop-in through `slack draft record`'s own path: as them, a message, never a review ask, nothing sent.
 *
 * @returns the parked draft, or why nothing parked
 */
async function parkThroughDraftRecord({
  home,
  channel,
  form,
  why,
  receipts,
}: {
  home: string;
  channel: string;
  form: string;
  why: string;
  receipts: ReceiptsDeclaration;
}): Promise<Result<ParkedLoopIn, LoopInError>> {
  const [{ runDraftRecord }, { liveSlackDraftDeps }] = await Promise.all([
    import("../slack/draftRecordEntry.js"),
    import("../slack/draftWiring.js"),
  ]);
  const printed: string[] = [];
  const code = await runDraftRecord({
    deps: {
      ...liveSlackDraftDeps(),
      out: (line) => {
        printed.push(line);
      },
    },
    options: {
      actor: "me",
      // The FIRST opener to this person on this candidate: one held or sent under the same exact why parks nothing new
      // (`../../../workstreams/loopIn.ts`'s `loopInDraftOf`), so an opener that asks has not been asked here before.
      askedBefore: { kind: "none" },
      channel,
      formSource: form,
      home,
      json: true,
      // A conversation they owe a person is a message to them, never a finding.
      kind: "message",
      media: [],
      mode: "record",
      // `../../../workstreams/loopIn.ts`'s `loopInOpenerOf`: the evidence link the opener ends on, its own address, or `--tried` when it has neither.
      receipts,
      // An opener can read as a review ask by its wording; it asks nobody for one.
      reviewer: "not-an-ask",
      supersedes: [],
      why,
    },
  });
  if (code !== EXIT_OK) {
    return err(LoopInErrors.parkRefused({ exitCode: code }));
  }
  const report = parkedDocument.safeParse(
    safeJsonParse({ label: "slack draft record's park report", text: printed.join("\n") }),
  );
  if (!report.success) {
    return err(LoopInErrors.parkReportUnreadable({ detail: report.error.message }));
  }
  return ok({ draftId: report.data.item.id });
}

/**
 * The real seams: the draft register, `slack draft record`'s park, the lock, the clock and the two output channels.
 *
 * @returns the production dependencies for {@link runWorkstreamsLoopIn}
 */
export function productionWorkstreamsLoopInDeps(): WorkstreamsLoopInDeps {
  return {
    drafts: ({ home }) => foldSlackDraftLog({ log: parseSlackDraftLog({ lines: readSlackDraftLines({ home }) }) }),
    lock: ({ home, key, nowIso }) => acquireOperationLock({ home, key, nowIso }),
    now: () => new Date().toISOString(),
    park: parkThroughDraftRecord,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams loop-in`. */
export const workstreamsLoopInCommand = defineCommand({
  run: (argv) => runWorkstreamsLoopIn({ deps: productionWorkstreamsLoopInDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
