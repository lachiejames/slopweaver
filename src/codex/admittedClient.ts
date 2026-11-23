/**
 * The two thread shapes that are not an SDK thread: one POISONED (its `run` reports a failure that happened
 * before any turn), and a client whose every thread is ADMITTED by a gate first.
 *
 * Split out of `./client.ts` at the `file-size-ratchet` line, along a real seam: that module owns the locked
 * options and the SDK adapter, and these own what happens when a thread must not reach the SDK at all.
 */
import { errAsync } from "neverthrow";

import { toIngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import type { LockedCodexClient, LockedCodexThread } from "./client.js";

/**
 * A thread that has already failed, whose `run()` returns that failure.
 *
 * Thread CREATION is synchronous, so a throw from `startThread`/`resumeThread` escaped the bounded-pass
 * state machine entirely: no attempt was recorded, and therefore neither usage nor items were reported as
 * not-measured — the exact silent-failure class this module exists to avoid. Found by this tool reviewing
 * its own diff.
 *
 * Deferring the failure into `run()` keeps ONE path through the state machine: the caller records a `failed`
 * attempt with `not-measured` usage and items, exactly as for any other transport fault.
 *
 * @param error what failed, carried into the reported `IngestError`
 * @param operation the SDK call it stands in for, so a report names which one never ran
 * @returns a thread with no id whose `run` returns that failure
 */
export function poisonedThread({ error, operation }: { error: unknown; operation: string }): LockedCodexThread {
  return {
    currentId: () => null,
    run: async () => errAsync(toIngestError({ defaultKind: "llm", error, operation, provider: "codex" })),
  };
}

/**
 * A locked client whose every thread is ADMITTED first, in the directory it would run in.
 *
 * The browser door (`./browserDoor.ts`) judges what a thread would load, and Codex loads a trusted project's
 * own `.codex/config.toml` from the thread's working directory — which a pass mints per invocation, after
 * routing. So the check sits HERE, at the one moment the directory is known and nothing has started; a
 * refused thread is a poisoned one, and its `run` reports the refusal as the pass's failure.
 *
 * @param client the locked client to gate
 * @param admitThread the gate, asked with the thread's working directory; `err` carries the refusal text
 * @returns the same client, refusing any thread its gate refuses
 */
export function admittedCodexClient({
  client,
  admitThread,
}: {
  client: LockedCodexClient;
  admitThread: (args: { workingDirectory: string }) => Result<void, string>;
}): LockedCodexClient {
  return {
    model: client.model,
    resumeThread: ({ threadId, workingDirectory }) => {
      const admitted = admitThread({ workingDirectory });
      if (admitted.isErr()) {
        return poisonedThread({ error: new Error(admitted.error), operation: "codex.resumeThread" });
      }
      return client.resumeThread({ threadId, workingDirectory });
    },
    startThread: ({ workingDirectory }) => {
      const admitted = admitThread({ workingDirectory });
      if (admitted.isErr()) {
        return poisonedThread({ error: new Error(admitted.error), operation: "codex.startThread" });
      }
      return client.startThread({ workingDirectory });
    },
  };
}
