/**
 * Start the session control plane at app boot: find the packaged pieces a worker needs, listen on the owner-only
 * socket, and end every hosted session as the app quits. A control plane that cannot listen is a problem the menu bar
 * shows, never a crash — the app's other work goes on, and a `--harness app` verb gets a refusal naming the socket.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { app } from "electron";
import { err, errAsync, ok, type Result, type ResultAsync } from "neverthrow";

import { childEnv } from "./consoleEndpoint";
import type { CheckoutError } from "./errors";
import { run } from "./fleetProcess";
import { handleSessionRequest } from "./sessionControl";
import { appHarnessSocketPath } from "./sessionControlProtocol";
import { endEverySession, recordRecoveryTo } from "./sessionHosting";
import { recoveryJournalPath } from "./sessionRecoveryStore";
import { listenSessionSocket } from "./sessionSocketServer";
import type { SessionPaths } from "./workerLaunchOf";

/** `cmux close` on an app session: the worker's own close is bounded well inside this. */
const CLOSE_TIMEOUT_MS = 60_000;

/** What boot hands the control plane. */
export interface SessionControlBootHost {
  /** The checkout whose `bin/slopweaver` records a card's Stop in the ledger. */
  readonly checkout: () => Result<string, CheckoutError>;
  readonly titleFor: (options: { readonly page: string }) => string;
  readonly reportProblem: (options: { readonly problem: string }) => void;
}

/**
 * Where the worker's pieces are: inside the installed app, or the desktop tree's own `node_modules` in a dev run.
 *
 * @param packaged whether this is the installed app
 * @param resources the app's Resources directory
 * @param appPath the app's own root (`app.getAppPath()`)
 * @param buildDirectory the directory this compiled module sits in
 * @returns each vendor's worker entry and the binary it drives
 */
export function sessionPaths({
  packaged,
  resources,
  appPath,
  buildDirectory,
}: {
  packaged: boolean;
  resources: string;
  appPath: string;
  buildDirectory: string;
}): SessionPaths {
  const codexWorker = join(buildDirectory, "sessionWorker", "codexAcpWorker.js");
  const claudeWorker = join(buildDirectory, "sessionWorker", "claudeAgentWorker.js");
  if (packaged) {
    const harness = join(resources, "session-harness");
    return {
      claude: { claudePath: join(harness, "claude", "claude"), workerEntry: claudeWorker },
      codex: {
        adapterEntry: join(harness, "codex-acp.js"),
        codexPath: join(harness, "codex", "bin", "codex"),
        workerEntry: codexWorker,
      },
    };
  }
  const modules = join(appPath, "node_modules");
  const vendor = join(modules, "@openai", "codex-darwin-arm64", "vendor", "aarch64-apple-darwin");
  return {
    claude: {
      claudePath: join(modules, "@anthropic-ai", "claude-agent-sdk-darwin-arm64", "claude"),
      workerEntry: claudeWorker,
    },
    codex: {
      adapterEntry: join(modules, "@agentclientprotocol", "codex-acp", "dist", "index.js"),
      codexPath: join(vendor, "bin", "codex"),
      workerEntry: codexWorker,
    },
  };
}

function closeThroughVerb({
  checkout,
  handle,
  ledgerHome,
}: {
  checkout: string;
  handle: string;
  ledgerHome: string | undefined;
}): ResultAsync<void, string> {
  // The spawn's own state home, when it named one, so the close lands on the ledger row the spawn wrote.
  const homeArgs = ledgerHome === undefined ? [] : ["--home", ledgerHome];
  return run({
    cwd: checkout,
    label: join(checkout, "bin", "slopweaver"),
    launch: ({ done, options }) =>
      execFile(
        join(checkout, "bin", "slopweaver"),
        ["cmux", "close", "--harness", "app", handle, ...homeArgs],
        // SIGKILL at the timeout: a stopped helper holds a SIGTERM pending forever, and the card's fallback stop
        // waits on this one settling.
        { ...options, killSignal: "SIGKILL" },
        done,
      ),
    timeoutMs: CLOSE_TIMEOUT_MS,
  }).andThen((ran) => (ran.code === 0 ? ok(undefined) : err(ran.stderr.trim())));
}

/**
 * Listen for `--harness app` verbs.
 *
 * @param bootHost what the control plane reaches in the rest of the app
 */
export async function startSessionControl({ bootHost }: { bootHost: SessionControlBootHost }): Promise<void> {
  if (process.getuid === undefined) {
    bootHost.reportProblem({ problem: "Sessions control plane: this platform has no user id to own its socket" });
    return;
  }
  const { directory, socket } = appHarnessSocketPath({ root: "/tmp", uid: process.getuid() });
  recordRecoveryTo({ path: recoveryJournalPath({ userData: app.getPath("userData") }) });
  const host = {
    childEnvironment: () => childEnv({ home: homedir(), inherited: process.env }),
    closeThroughVerb: ({
      handle,
      ledgerHome,
    }: {
      readonly handle: string;
      readonly ledgerHome: string | undefined;
    }): ResultAsync<void, string> => {
      const checkout = bootHost.checkout();
      if (checkout.isErr()) {
        return errAsync("no checkout is chosen, so the close could not be recorded");
      }
      return closeThroughVerb({ checkout: checkout.value, handle, ledgerHome });
    },
    paths: sessionPaths({
      appPath: app.getAppPath(),
      buildDirectory: __dirname,
      packaged: app.isPackaged,
      resources: process.resourcesPath,
    }),
    titleFor: bootHost.titleFor,
  };
  const listening = await listenSessionSocket({
    directory,
    handle: (envelope) => handleSessionRequest({ envelope, host }),
    socket,
  });
  if (listening.isErr()) {
    bootHost.reportProblem({ problem: `Sessions control plane: ${listening.error}` });
    return;
  }
  const server = listening.value;
  app.on("will-quit", () => {
    endEverySession();
    server.close();
  });
}
