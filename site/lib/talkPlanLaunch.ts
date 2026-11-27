/**
 * The EFFECTFUL half of a plan call: start the `codex app-server` child `talk offer` composed,
 * hand it to a {@link PlanCall} — or, for the orb messenger's typed box, a {@link TypedPlanSession} — and hold it in the
 * registry until it ends.
 *
 * Everything the child is told is in the composition, and everything the call does with it is `talkPlanCall.ts`;
 * this file is only the process. The child gets:
 *
 * - the vendored executable and argv exactly as the verb printed them — never a `codex` on PATH;
 * - this server's environment with every credential in `unsetEnv` REMOVED, so an exported API key can never
 *   outrank the ChatGPT login (`account/read` then checks the login it did get), and `CODEX_HOME` set to the
 *   register row `talk offer` routed the call to, so that row's plan pays and its pause and usage limit hold;
 * - a fresh empty working directory, removed when it exits, so the thread has no project to read;
 * - pipes on all three streams, and nothing detached: it dies with the call, and with this server.
 *
 * Rule 2 (`no-headless`, NH008) recognises this module's one `spawn` by its call shape.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CallOpenMode } from "./callRollover";
import { originArgvOfServer } from "./consoleOrigin";
import { processMeetingLedger } from "./meetingLedger";
import type { PlanOpenOutcome } from "./planCallContract";
import type { ConversationInstance } from "./talkArbiter";
import { forgetPlanCall, heldContextFor, holdPlanCall } from "./talkCallRegistry";
import { callThreadJournalFor } from "./talkCallThreadAppend";
import { processTalkNoticeLedger } from "./talkNoticeLedger";
import { PlanCall } from "./talkPlanCall";
import { planCallLogLine } from "./talkPlanLog";
import type { PlanComposition } from "./talkPlanProtocol";
import { type TypedOpenOutcome, TypedPlanSession } from "./talkTypedSession";
import { processTriagePresented } from "./triagePresented";

/** How much of the child's stderr a refusal quotes. */
const STDERR_TAIL_BYTES = 2048;

/** How long a stopped child gets to exit on SIGTERM before SIGKILL — so the most a SIGTERM-deaf child outlives an ordinary stop by. */
const KILL_GRACE_MS = 3000;

/**
 * The environment the child inherits: this server's, less every named credential, with `CODEX_HOME` set to the
 * register row `talk offer` routed the call to — assigned AFTER the scrub, so an ambient `CODEX_HOME` in this
 * server's environment can never decide which plan pays.
 *
 * @param codexHome the routed register row's `$CODEX_HOME`
 * @param env this server's environment
 * @param unsetEnv the variables to remove
 * @returns the child's environment
 */
export function planChildEnvironment({
  codexHome,
  env,
  unsetEnv,
}: {
  codexHome: string;
  env: NodeJS.ProcessEnv;
  unsetEnv: readonly string[];
}): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of unsetEnv) {
    delete out[key];
  }
  out["CODEX_HOME"] = codexHome;
  return out;
}

/**
 * Start the child and run the handshake.
 *
 * @param composition what the verb composed
 * @param mode why the page opened it: a fresh press clears the triage card an earlier call held, a reconnect or
 *   rollover carries it on
 * @param offerSdp the page's WebRTC offer
 * @param signal the press's own request signal: the page going away mid-handshake stops the call there
 * @param instance the owner's call, or the desktop test instance's
 * @returns the call's id with the handshake's outcome; any outcome but `open` has already killed the child
 */
export async function openPlanCall({
  composition,
  mode,
  offerSdp,
  signal,
  instance,
}: {
  composition: PlanComposition;
  mode: CallOpenMode;
  offerSdp: string;
  signal: AbortSignal;
  instance: ConversationInstance;
}): Promise<{ readonly callId: string; readonly outcome: PlanOpenOutcome }> {
  const call = startPlanChild({ composition, instance, make: (deps) => new PlanCall(deps) });
  // Seated as it is made, so a later call's triage card always outranks this one's late answers. A test call is never
  // seated: a fresh seat clears the card the owner's call presented, and every triage step passes an unseated call by.
  if (instance === "owner") {
    processTriagePresented().seat({ call, mode });
  }
  const outcome = await whileMinting({ call, run: () => call.open({ composition, offerSdp }), signal });
  const event = { kind: "opened", outcome: outcome.kind } as const;
  console.info(planCallLogLine({ atIso: new Date().toISOString(), event, id: call.id }));
  return { callId: call.id, outcome };
}

/**
 * Start the child for a typed conversation and open its thread — the same child a call gets, with no realtime.
 *
 * @param composition what `talk offer --typed` composed
 * @param signal the press's own request signal: the page going away mid-open stops the conversation there
 * @param instance the owner's conversation, or the desktop test instance's, held as a test call
 * @returns the conversation's id with how opening it ended; any outcome but `open` has already killed the child
 */
export async function openTypedSession({
  composition,
  instance,
  signal,
}: {
  composition: PlanComposition;
  instance: ConversationInstance;
  signal: AbortSignal;
}): Promise<{ readonly callId: string; readonly outcome: TypedOpenOutcome }> {
  const session = startPlanChild({ composition, instance, make: (deps) => new TypedPlanSession(deps) });
  const outcome = await whileMinting({ call: session, run: () => session.openTyped({ composition }), signal });
  return { callId: session.id, outcome };
}

/**
 * Run one opening step, stopping the call if the press's request goes away while it runs. Only while it runs: once
 * the route answers, a closed request is the normal end of a response, and the page's own event stream (absent past
 * a grace period) is what ends the call.
 *
 * @param call the call being opened
 * @param run the opening step
 * @param signal the press's request signal
 * @returns what the step returned
 */
async function whileMinting<T>({
  call,
  run,
  signal,
}: {
  call: PlanCall;
  run: () => Promise<T>;
  signal: AbortSignal;
}): Promise<T> {
  const onAbort = (): void => {
    call.stop({ reason: "the page went away while the call was being minted" });
  };
  if (signal.aborted) {
    onAbort();
  }
  signal.addEventListener("abort", onAbort, { once: true });
  const outcome = await run();
  signal.removeEventListener("abort", onAbort);
  return outcome;
}

/**
 * Start the composition's child, wire it to the call `make` builds, and hold that call until it ends.
 *
 * @param composition what the verb composed
 * @param instance whose it is, which picks the ledgers it claims its lines in
 * @param make builds the call over the child's port, this server's clock and a fresh id
 * @returns the held call
 */
function startPlanChild<C extends PlanCall>({
  composition,
  instance,
  make,
}: {
  composition: PlanComposition;
  instance: ConversationInstance;
  make: (deps: ConstructorParameters<typeof PlanCall>[0]) => C;
}): C {
  const context = heldContextFor({
    instance,
    ownerMeetings: processMeetingLedger(),
    ownerNotices: processTalkNoticeLedger(),
  });
  const cwd = mkdtempSync(join(tmpdir(), "slopweaver-talk-plan-"));
  const child = spawn(composition.executable, [...composition.argv], {
    cwd,
    env: planChildEnvironment({
      codexHome: composition.codexHome,
      env: process.env,
      unsetEnv: composition.unsetEnv,
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let exited = false;
  const id = randomUUID();
  const call = make({
    clock: {
      after: ({ ms, run }) => {
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      elapsedMs: () => performance.now(),
      nowMs: () => Date.now(),
    },
    id,
    journal: callThreadJournalFor({
      callId: id,
      instance: instance === "e2e" ? "e2e" : undefined,
      origin: originArgvOfServer(),
    }),
    meetings: context.meetings,
    mintToken: () => randomUUID(),
    notices: context.notices,
    onEnded: ({ id: ended }) => {
      forgetPlanCall({ id: ended });
    },
    port: {
      kill: () => {
        if (exited) {
          return;
        }
        child.stdin.end();
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!exited) {
            child.kill("SIGKILL");
          }
        }, KILL_GRACE_MS).unref();
      },
      write: ({ line }) => {
        if (!exited && child.stdin.writable) {
          child.stdin.write(line);
        }
      },
    },
  });
  // The registry's own exit hook stops the call gracefully, but a SIGKILL deferred to a timer never runs once the
  // server is exiting, so a child that ignores SIGTERM would outlive it. This one is synchronous, and the registry
  // runs it itself on a hang-up, quit or other ending signal, which may never reach an `exit` event.
  const killOnServerExit = (): void => {
    if (!exited) {
      child.kill("SIGKILL");
    }
  };
  holdPlanCall({ call, context, killNow: killOnServerExit });
  process.once("exit", killOnServerExit);
  child.stdin.on("error", () => undefined);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    call.receive({ chunk });
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
  });
  child.on("error", (error) => {
    call.exited({ detail: `could not start: ${error.message}` });
  });
  child.on("exit", (code, exitSignal) => {
    exited = true;
    process.off("exit", killOnServerExit);
    rmSync(cwd, { force: true, recursive: true });
    const how = code === null ? `signal ${String(exitSignal)}` : `code ${String(code)}`;
    const tail = stderr.trim().split("\n").slice(-3).join(" / ");
    call.exited({ detail: tail === "" ? how : `${how}: ${tail}` });
  });
  return call;
}
