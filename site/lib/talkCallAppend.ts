/**
 * Append one batch of a call's lines through `slopweaver talk transcript` — the verb is the one writer of
 * `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`, and it masks every secret before the append. The batch is piped on the
 * verb's stdin, never staged in a file: it is unmasked until the verb masks it, and a staged file is what a SIGKILL
 * between write and cleanup would leave on disk. The transcript route writes the page's batches through it, naming
 * where the server is serving from so the verb can refuse a console that is not the owner's (`./consoleOrigin.ts`).
 */
import { consoleTranscriptWrites } from "./consoleHome";
import { spawnVerb } from "./spawnVerb";
import { announceWriterIntent } from "./writerIntent";

/**
 * The bound on one append — a wedged child is still killed, but a starved one is not. It was ten seconds, "generous"
 * on an idle machine, and under load (average over 50) it produced 503s in the owner's browser console: the route
 * killed a verb the machine had starved past it, often after the verb had appended. MEASURED at load average 70-113
 * on 15 cores: a one-line append took 14.2-33.2 s wall for 1.0-1.3 s of CPU, against an empty home and against a
 * copy of a real call file alike. Repro, with a batch file and a scratch home:
 * `/usr/bin/time -p bin/slopweaver talk transcript --call <uuid> --entries-file - --json --home <dir> < <batch>`.
 * One post is in flight at a time and lines queue behind it, so a slow append only makes the next batch bigger.
 */
export const TRANSCRIPT_TIMEOUT_MS = 120_000;

/**
 * The verb's argv for one batch: the server's own origin flags, and `--console-instance e2e` beside them — never in
 * place of one — when the desktop test instance posted it.
 *
 * @param callId the call the lines belong to
 * @param handoff the route's handoff intent on the landing ledger (`./writerIntent.ts`), which the verb checks once it
 *   is visible
 * @param originArgv where this server is serving from (`./consoleOrigin.ts`)
 * @param instance `e2e` when the desktop test instance posted the batch, else `undefined`
 * @returns the argv after `slopweaver`, reading the batch from stdin
 */
export function transcriptArgv({
  callId,
  handoff,
  originArgv,
  instance,
}: {
  callId: string;
  handoff: string;
  originArgv: readonly string[];
  instance: "e2e" | undefined;
}): readonly string[] {
  const marked = instance === undefined ? [] : ["--console-instance", instance];
  const handed = ["--handoff", handoff];
  return ["talk", "transcript", "--call", callId, "--entries-file", "-", ...originArgv, ...marked, ...handed, "--json"];
}

/**
 * Hand one batch to the verb.
 *
 * @param callId the call the lines belong to
 * @param jsonl the lines, one JSON object per line, as `parseTalkTranscriptRequest` renders them
 * @param originArgv where this server is serving from (`./consoleOrigin.ts`), so the verb refuses a console that is not
 *   the owner's writing their live home and stamps each call it opens
 * @param instance `e2e` when the desktop test instance posted the batch, so the verb stamps the call as the walk's
 * @returns `undefined` once the verb appended them, else why it did not — a verb that could not be started included,
 *   so a caller's report of the failure is never skipped by a throw — and the verb's exit code when it ran, which says
 *   whether the batch itself was refused or the append failed and may be retried (`unappendedStatus`)
 */
export async function appendCallBatch({
  callId,
  jsonl,
  originArgv,
  instance,
}: {
  callId: string;
  jsonl: string;
  originArgv: readonly string[];
  instance: "e2e" | undefined;
}): Promise<{ readonly why: string; readonly exitCode: number | undefined } | undefined> {
  // Announced before the verb is spawned and withdrawn once it exits: the batch is admitted from here, and the verb,
  // handed the ledger's handoff, writes nothing once it has lapsed (`./writerIntent.ts`).
  // The ledger's goes up first and comes down last, since every fence waits on the ledger last — and
  // comes down even when withdrawing the call's throws, so a failed removal never strands it.
  let ledger: Handoff | undefined;
  let call: Handoff | undefined;
  try {
    const writes = consoleTranscriptWrites({ callId });
    ledger = announceWriterIntent({ path: writes.ledger });
    call = announceWriterIntent({ path: writes.call });
    const ran = await spawnVerb({
      argv: transcriptArgv({ callId, handoff: ledger.intent, instance, originArgv }),
      stdin: jsonl,
      timeoutMs: TRANSCRIPT_TIMEOUT_MS,
      title:
        "slopweaver talk transcript --call <callId> --entries-file - --console-root <root> --console-port <n> --console-default-port <n> [--console-instance e2e] --handoff <intent> --json",
    });
    if (ran.ok) {
      return undefined;
    }
    return { exitCode: ran.exitCode, why: ran.notMeasured };
  } catch (cause) {
    return { exitCode: undefined, why: `the batch could not be written: ${String(cause)}` };
  } finally {
    try {
      call?.withdraw();
    } finally {
      ledger?.withdraw();
    }
  }
}

/** One handoff intent the route published, and what withdraws it. */
type Handoff = ReturnType<typeof announceWriterIntent>;

/**
 * The bound on one wake. A reach into the chair reads its screen and may press Enter once more, a few seconds on an
 * idle machine; the same starved-machine margin as the append's, since nothing waits on it.
 */
const WAKE_TIMEOUT_MS = 120_000;

/**
 * How long the owner must be quiet before the chair is typed one turn: `src/talk/chairWake.ts`'s `QUIET_BEFORE_DELIVERY_MS`,
 * restated because `site/` never imports `src/` and bound to it by `src/__tests__/unit/talk/quietFloorMirror.test.ts`.
 */
export const QUIET_BEFORE_DELIVERY_MS = 2 * 60_000;

/** Past the floor, so the verb asked then judges the owner quiet rather than holding a millisecond short. */
const QUIET_MARGIN_MS = 5_000;

/** The one wake this server has waiting for the owner's quiet, replaced by each finished stretch after it. */
let pendingWake: ReturnType<typeof setTimeout> | undefined;

/**
 * Run the wake now. A wake that fails is said on the server's stderr, never to the owner: the courier asks the same question
 * within 5s, so a lost wake costs no word. One that ran but said something on its own stderr — a last wake it could
 * not read, say — is passed on there too, never dropped with its exit.
 *
 * @param originArgv this server's console origin
 */
async function wakeNow({ originArgv }: { originArgv: readonly string[] }): Promise<void> {
  const said = ({ why }: { why: string }): void => {
    process.stderr.write(`talk wake-chair (console wake): ${why}\n`);
  };
  try {
    const ran = await spawnVerb({
      argv: ["talk", "wake-chair", "--json", ...originArgv],
      timeoutMs: WAKE_TIMEOUT_MS,
      title: "slopweaver talk wake-chair --json",
    });
    if (!ran.ok) {
      said({ why: ran.notMeasured });
      return;
    }
    if (ran.err.trim() !== "") {
      said({ why: ran.err.trim() });
    }
  } catch (cause) {
    said({ why: `could not be started: ${String(cause)}` });
  }
}

/**
 * Wake the pinned chair once the owner has been quiet {@link QUIET_BEFORE_DELIVERY_MS} after a finished stretch of
 * their speech (`slopweaver talk wake-chair`, `src/talk/chairWake.ts`) — ONE pending wake per server, pushed back by
 * every stretch after it, so a call is typed as one turn per quiet stretch. NOT awaited: the batch's answer never
 * waits on cmux, and a wake that fails or never fires costs no word, since the stretch is in the call file and the
 * chair's `talk courier --follow` asks the same question every 5s. Every word reaches the supervisor, relayed or not.
 * It carries this server's origin, so the verb types nothing for a console that is not the owner's.
 *
 * @param originArgv `--console-root`, `--console-port` and `--console-default-port`, as `./consoleOrigin.ts` derives them
 */
export function wakeChairInBackground({ originArgv }: { originArgv: readonly string[] }): void {
  if (pendingWake !== undefined) {
    clearTimeout(pendingWake);
  }
  pendingWake = setTimeout(() => {
    pendingWake = undefined;
    void wakeNow({ originArgv });
  }, QUIET_BEFORE_DELIVERY_MS + QUIET_MARGIN_MS);
  pendingWake.unref();
}
