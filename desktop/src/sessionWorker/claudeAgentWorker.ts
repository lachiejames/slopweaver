/**
 * One app-hosted Claude session's worker: a process of its own, started only by `sessionWorkerLaunch.ts` once the
 * session's card is on screen, that owns exactly ONE Agent SDK `query` for its whole life — one native Claude Code
 * process, started by this worker after checking the SDK's request (`claudeProcessLaunch.ts`). The control plane
 * never speaks the SDK: the two talk only `workerWire.ts`, exactly as the Codex worker does.
 *
 * Its whole life is bounded by its parent's. When the IPC channel to the control plane closes — the app quit, or was
 * killed — the worker closes the query and exits, so no model process outlives the window it was shown in. The native
 * process stays in this worker's process group, which a card's Stop ends whole (`../sessionProcessGroup.ts`).
 *
 * The session is refused before it reports ready when the SDK says its login is a metered key or a key helper rather
 * than the plan's routed subscription (`claudeMessages.ts` `accountRefusal`): a successful answer proves nothing
 * about which account paid for it.
 */
import type * as AgentSdk from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { accountRefusal, reportsOf, transcriptRefusal, userMessageOf } from "./claudeMessages";
import { spawnClaudeNative } from "./claudeProcessLaunch";
import { claudeSdkOptions } from "./claudeSdkOptions";
import { claudeAccountingStart, claudeUsageStep } from "./claudeUsage";
import {
  type ClaudeWorkerLaunchConfig,
  type FromWorker,
  isToWorker,
  isWorkerLaunchConfig,
  type ToWorker,
  WORKER_CONFIG_ENV,
} from "./workerWire";

type Sdk = typeof AgentSdk;

/**
 * Report to the control plane; a closed channel means the parent is gone, and the exit path below handles that.
 *
 * @param message the report
 */
function report({ message }: { message: FromWorker }): void {
  if (process.send !== undefined && process.connected) {
    process.send(message);
  }
}

/** The prompts the session has been sent and not yet read, as the one input stream its query reads. */
function promptQueue(): {
  readonly push: (message: SDKUserMessage) => void;
  readonly messages: AsyncIterable<SDKUserMessage>;
} {
  const pending: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  const messages = async function* drain(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = pending.shift();
      if (next === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield next;
    }
  };
  const push = (message: SDKUserMessage): void => {
    pending.push(message);
    wake?.();
    wake = undefined;
  };
  return { messages: messages(), push };
}

/**
 * Open the one query and serve the control plane's instructions until it closes or goes away.
 *
 * @param config the worker's launch configuration
 */
async function serve({ config }: { config: ClaudeWorkerLaunchConfig }): Promise<void> {
  const sdk: Sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { sessionId } = config;
  const input = promptQueue();
  const session = sdk.query({
    options: claudeSdkOptions({ config, spawnClaudeCodeProcess: (request) => spawnClaudeNative({ config, request }) }),
    prompt: input.messages,
  });
  let closing = false;
  const close = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    session.close();
    report({ message: { kind: "closed", sessionId } });
    process.exit(0);
  };
  let accounting = claudeAccountingStart({ resumed: config.resumeVendorSessionId !== undefined });
  const streamed = (async (): Promise<void> => {
    for await (const message of session) {
      // The app recorded this transcript id to resume; a session writing any other could never be resumed.
      const strayed = transcriptRefusal({ message, vendorSessionId: config.vendorSessionId });
      if (strayed !== undefined) {
        throw new Error(strayed);
      }
      // A turn's usage goes ahead of its `turn-ended`, over the same ordered channel, so the app has counted the turn
      // by the time it releases the next one.
      const step = claudeUsageStep({ accounting, message, sessionId });
      accounting = step.accounting;
      for (const each of [...step.reports, ...reportsOf({ message, sessionId })]) {
        report({ message: each });
      }
    }
  })();
  streamed.catch((error: unknown) => {
    if (!closing) {
      report({ message: { kind: "failed", message: String(error), sessionId } });
      process.exit(1);
    }
  });

  const initialised = await session.initializationResult();
  const refused = accountRefusal({ account: initialised.account });
  if (refused !== undefined) {
    closing = true;
    session.close();
    report({ message: { kind: "failed", message: refused, sessionId } });
    process.exit(1);
  }
  report({ message: { kind: "ready", sessionId, vendorSessionId: config.vendorSessionId } });

  const act = ({ instruction }: { instruction: ToWorker }): void => {
    if (instruction.kind === "prompt") {
      input.push(userMessageOf({ text: instruction.text }));
      return;
    }
    if (instruction.kind === "cancel") {
      void session.interrupt().catch((error: unknown) => {
        report({ message: { kind: "failed", message: String(error), sessionId } });
      });
      return;
    }
    close();
  };
  process.on("message", (instruction: unknown) => {
    if (isToWorker(instruction)) {
      act({ instruction });
    }
  });
  // The control plane is gone — quit or killed: nothing may keep running that no window shows.
  process.on("disconnect", close);
}

const raw = process.env[WORKER_CONFIG_ENV];
let parsed: unknown;
try {
  parsed = raw === undefined ? undefined : JSON.parse(raw);
} catch {
  parsed = undefined;
}
if (!isWorkerLaunchConfig(parsed) || parsed.vendor !== "claude") {
  process.stderr.write(`session worker: ${WORKER_CONFIG_ENV} is missing or malformed\n`);
  process.exit(2);
}
const config = parsed;
serve({ config }).catch((error: unknown) => {
  report({ message: { kind: "failed", message: String(error), sessionId: config.sessionId } });
  process.exit(1);
});
