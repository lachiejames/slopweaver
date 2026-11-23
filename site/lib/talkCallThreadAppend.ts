/**
 * Write one batch of a call's thread journal through `slopweaver talk call-thread-append`, the one writer of
 * `$SLOPWEAVER_HOME/talk/threads/` — and the real {@link CallThreadJournal} a call gets. The batch is piped on the
 * verb's stdin, never staged in a file: it is unmasked until the verb masks it, and a staged file is what a SIGKILL
 * between write and cleanup would leave on disk. It carries this server's origin so the verb refuses a console that is
 * not the owner's.
 */
import { randomUUID } from "node:crypto";

import type { ConsoleOriginArgv } from "./consoleOrigin";
import { VERB_USAGE_EXIT } from "./relayRetry";
import { spawnVerb } from "./spawnVerb";
import { CallThreadJournal } from "./talkCallThreadJournal";

/** The bound on one append: the transcript append's, for the same starved-machine reason (`./talkCallAppend.ts`). */
const CALL_THREAD_APPEND_TIMEOUT_MS = 120_000;

/**
 * Hand one batch to the verb.
 *
 * @param callId the call whose thread it is
 * @param jsonl the entries, one per line
 * @param originArgv where this server is serving from
 * @returns `undefined` once written, else why not and the verb's exit code when it ran
 */
async function appendCallThreadBatch({
  callId,
  jsonl,
  originArgv,
}: {
  callId: string;
  jsonl: string;
  originArgv: readonly string[];
}): Promise<{ readonly why: string; readonly exitCode: number | undefined } | undefined> {
  try {
    const ran = await spawnVerb({
      argv: ["talk", "call-thread-append", "--call", callId, "--entries-file", "-", ...originArgv, "--json"],
      stdin: jsonl,
      timeoutMs: CALL_THREAD_APPEND_TIMEOUT_MS,
      title:
        "slopweaver talk call-thread-append --call <callId> --entries-file - --console-root <root> --console-port <n> --console-default-port <n> --json",
    });
    if (ran.ok) {
      return undefined;
    }
    return { exitCode: ran.exitCode, why: ran.notMeasured };
  } catch (cause) {
    return { exitCode: undefined, why: `the batch could not be written: ${String(cause)}` };
  }
}

/**
 * The journal a call gets: batches through the verb, real time, real ids, reports on this server's stderr. A server
 * that cannot derive its own origin writes nothing — the verb would be writing for a console it cannot name — and its
 * first batch is refused for good, so the journal says why on stderr once and stops.
 *
 * @param origin where this server is serving from, or why that could not be derived
 * @returns the journal
 */
export function callThreadJournalFor({
  callId,
  origin,
}: {
  callId: string;
  origin: ConsoleOriginArgv;
}): CallThreadJournal {
  return new CallThreadJournal({
    callId,
    port: {
      append: async ({ jsonl }) => {
        if ("refused" in origin) {
          return { exitCode: VERB_USAGE_EXIT, why: `this server's console origin is unknown: ${origin.refused}` };
        }
        return appendCallThreadBatch({ callId, jsonl, originArgv: origin.argv });
      },
      newWriteId: () => randomUUID(),
      nowIso: () => new Date().toISOString(),
      report: ({ line }) => {
        process.stderr.write(`${line}\n`);
      },
      wait: ({ ms }) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms).unref();
        }),
    },
  });
}
