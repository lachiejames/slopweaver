/**
 * One app-hosted Codex session's worker: a process of its own, started only by `sessionWorkerLaunch.ts` once the
 * session's card is on screen, that owns exactly ONE vendor connection for its whole life — the maintained ACP adapter
 * (`@agentclientprotocol/codex-acp`), spoken to through the ACP SDK's stable v1 client. It never opens a second
 * connection, and the control plane never speaks the vendor's protocol: the two talk only `workerWire.ts`.
 *
 * Its whole life is bounded by its parent's. When the IPC channel to the control plane closes — the app quit, or was
 * killed — the worker closes the vendor session and exits, so no model process outlives the window it was shown in.
 * The adapter and the Codex app-server it starts stay in this worker's process group, which a card's Stop ends whole
 * (`../sessionProcessGroup.ts`).
 *
 * A permission request is DECLINED: slice 1's card has no way to ask the owner yet, and a request nobody saw is not
 * one anybody granted. The session runs in the adapter's workspace-write preset (`adapterEnvironment.ts`).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import type * as AcpSdk from "@agentclientprotocol/sdk";

import { adapterEnvironment } from "./adapterEnvironment";
import { codexTurnUsageOf, contextOccupancyOf, resolvedModelOf } from "./codexUsage";
import { ownProcessGuardian } from "./processGuardian";
import { codexToolActivityOf } from "./toolActivity";
import {
  type CodexWorkerLaunchConfig,
  type FromWorker,
  isToWorker,
  isWorkerLaunchConfig,
  type ToWorker,
  WORKER_CONFIG_ENV,
} from "./workerWire";

/** How long a closing session waits for the adapter to acknowledge `session/close` before the worker exits anyway. */
const CLOSE_ACK_MS = 5_000;

type Acp = typeof AcpSdk;

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

/**
 * Start the packaged adapter, inside this worker's process group, over stdio.
 *
 * @param config the worker's launch configuration
 * @returns the adapter process
 */
function startAdapter({ config }: { config: CodexWorkerLaunchConfig }): ChildProcess {
  return spawn(process.execPath, [config.adapterEntry], {
    cwd: config.directory,
    // Read once, here, outside the sandbox: the identity a sandboxed `slopweaver` verb's lock records (`processGuardian.ts`).
    env: adapterEnvironment({ config, guardian: ownProcessGuardian(), inherited: process.env }),
    stdio: ["pipe", "pipe", "inherit"],
  });
}

/**
 * Open the vendor session: a new one, or the recorded one continued.
 *
 * @param acp the ACP SDK
 * @param agent the connection's agent side
 * @param config the worker's launch configuration, naming the transcript to resume when there is one
 * @returns Codex's id for the session the worker now holds, and the model the adapter says it runs on
 */
async function openVendorSession({
  acp,
  agent,
  config,
}: {
  acp: Acp;
  agent: AcpSdk.ClientContext;
  config: CodexWorkerLaunchConfig;
}): Promise<{ readonly vendorSessionId: string; readonly resolvedModel: string | undefined }> {
  const resumed = config.resumeVendorSessionId;
  if (resumed === undefined) {
    const opened = await agent.request(acp.methods.agent.session.new, { cwd: config.directory, mcpServers: [] });
    return {
      resolvedModel: resolvedModelOf({ configOptions: opened.configOptions }),
      vendorSessionId: opened.sessionId,
    };
  }
  // ACP's `ResumeSessionResponse` carries no session id (modes and config options only): a success IS the session the
  // request named, and a refusal throws, failing the launch. So the id answered is the one asked for, by protocol.
  const continued = await agent.request(acp.methods.agent.session.resume, {
    cwd: config.directory,
    mcpServers: [],
    sessionId: resumed,
  });
  return { resolvedModel: resolvedModelOf({ configOptions: continued.configOptions }), vendorSessionId: resumed };
}

/**
 * Open the one ACP session and serve the control plane's instructions until it closes or goes away.
 *
 * @param config the worker's launch configuration
 */
async function serve({ config }: { config: CodexWorkerLaunchConfig }): Promise<void> {
  const acp: Acp = await import("@agentclientprotocol/sdk");
  const adapter = startAdapter({ config });
  const { stdin, stdout } = adapter;
  if (stdin === null || stdout === null) {
    throw new Error("the ACP adapter started without its stdio pipes");
  }
  const { sessionId } = config;
  // Unset until the session opens: an update before then cannot be told apart from a native subagent's.
  let heldSessionId: string | undefined;
  const app = acp
    .client({ name: "slopweaver" })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const { update } = params;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        report({ message: { kind: "agent-text", sessionId, text: update.content.text } });
        return;
      }
      if (heldSessionId === undefined) {
        return;
      }
      // Only the held session's tool calls are this seat's facts; a native subagent's own session is not it.
      const activity = params.sessionId === heldSessionId ? codexToolActivityOf({ update }) : undefined;
      if (activity !== undefined) {
        report({ message: { activity, kind: "tool-activity", sessionId } });
        return;
      }
      const occupancy = contextOccupancyOf({
        notificationSessionId: params.sessionId,
        update,
        vendorSessionId: heldSessionId,
      });
      if (occupancy !== undefined) {
        report({ message: { kind: "context-occupancy", sessionId, ...occupancy } });
      }
    })
    .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: "cancelled" } }));
  // Node types `Readable.toWeb` as an untyped stream; a byte pipe's chunks are Uint8Array, which no check can prove.
  // oxlint-disable-next-line no-unsafe-type-assertion -- the adapter's stdout is a byte pipe with no encoding set
  const fromAdapter = Readable.toWeb(stdout) as ReadableStream<Uint8Array>;
  const connection = app.connect(acp.ndJsonStream(Writable.toWeb(stdin), fromAdapter));
  await connection.agent.request(acp.methods.agent.initialize, {
    clientCapabilities: {},
    clientInfo: { name: "slopweaver", version: "1" },
    protocolVersion: acp.PROTOCOL_VERSION,
  });
  // Codex's own thread id: a new session's is the one a later `session/resume` names, which the app records before the
  // launch is answered; a resumed session keeps the id it resumed.
  const { vendorSessionId, resolvedModel } = await openVendorSession({ acp, agent: connection.agent, config });
  heldSessionId = vendorSessionId;
  if (resolvedModel !== undefined) {
    report({ message: { kind: "model-resolved", model: resolvedModel, sessionId } });
  }
  report({ message: { kind: "ready", sessionId, vendorSessionId } });

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await Promise.race([
      connection.agent.request(acp.methods.agent.session.close, { sessionId: vendorSessionId }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, CLOSE_ACK_MS)),
    ]);
    connection.close();
    adapter.kill("SIGTERM");
    report({ message: { kind: "closed", sessionId } });
    process.exit(0);
  };

  const act = ({ instruction }: { instruction: ToWorker }): void => {
    if (instruction.kind === "prompt") {
      connection.agent
        .request(acp.methods.agent.session.prompt, {
          prompt: [{ text: instruction.text, type: "text" }],
          sessionId: vendorSessionId,
        })
        .then((answered) => {
          // The turn's spend goes ahead of its end, so the app has counted it before it releases the next turn.
          // oxlint-disable-next-line no-underscore-dangle -- `_meta` is ACP's own extension field, named by the protocol
          report({ message: { kind: "turn-usage", sessionId, usage: codexTurnUsageOf({ meta: answered._meta }) } });
          report({ message: { kind: "turn-ended", sessionId, stopReason: answered.stopReason } });
          return undefined;
        })
        .catch((error: unknown) => {
          report({ message: { kind: "failed", message: String(error), sessionId } });
        });
      return;
    }
    if (instruction.kind === "cancel") {
      void connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: vendorSessionId });
      return;
    }
    void close();
  };

  process.on("message", (instruction: unknown) => {
    if (isToWorker(instruction)) {
      act({ instruction });
    }
  });
  // The control plane is gone — quit or killed: nothing may keep running that no window shows.
  process.on("disconnect", () => {
    void close();
  });
  adapter.on("exit", (code) => {
    if (!closing) {
      report({ message: { kind: "failed", message: `the ACP adapter exited (${String(code)})`, sessionId } });
      process.exit(1);
    }
  });
}

const raw = process.env[WORKER_CONFIG_ENV];
let parsed: unknown;
try {
  parsed = raw === undefined ? undefined : JSON.parse(raw);
} catch {
  parsed = undefined;
}
if (!isWorkerLaunchConfig(parsed) || parsed.vendor !== "codex") {
  process.stderr.write(`session worker: ${WORKER_CONFIG_ENV} is missing or malformed\n`);
  process.exit(2);
}
const config = parsed;
serve({ config }).catch((error: unknown) => {
  report({ message: { kind: "failed", message: String(error), sessionId: config.sessionId } });
  process.exit(1);
});
