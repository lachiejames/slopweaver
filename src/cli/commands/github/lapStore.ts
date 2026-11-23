/**
 * The throwaway `postgres:17` a lap starts for its store-backed lanes — the service CI's subprocess and
 * desktop-e2e jobs ran — on an ephemeral local port, torn down with the lap.
 *
 * Every lap store carries a docker label so an orphan a killed lap left behind is removed by the next one. That
 * is safe only because the holder of the machine's one lap lock (`./lapLock.ts`) is the only process that ever
 * starts a store.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { LapResource } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { runLapCommand } from "./lapProcess.js";

/** How long the store may take to accept connections; CI's own health check allows 30 tries 2s apart. */
const STORE_READY_ATTEMPTS = 60;
/** The docker label every lap store carries, so the next lap can remove one a killed lap orphaned. */
const STORE_LABEL = "slopweaver-lap-store";

/**
 * The host port `docker port <id> 5432/tcp` reports, from its first line (`127.0.0.1:55012`).
 *
 * @param output the command's whole stdout
 * @returns the port, or `undefined` when no line names one
 */
export function publishedPort({ output }: { output: string }): string | undefined {
  const match = /:(\d+)\s*$/u.exec(output.split("\n")[0]!);
  return match === null ? undefined : match[1];
}

/**
 * The environment the store-backed lanes read, every URL on the one throwaway server — the same variables CI's
 * subprocess and desktop-e2e jobs set against their `postgres:17` service.
 *
 * @param port the host port the store published
 * @returns each variable a store-backed lane reads, mapped to its URL
 */
export function storeUrls({ port }: { port: string }): Readonly<Record<string, string>> {
  const at = `postgresql://postgres:postgres@127.0.0.1:${port}`;
  return {
    DESKTOP_E2E_STORE_ADMIN_URL: `${at}/postgres`,
    DOOR_LEDGER_STORE_PROOF_URL: `${at}/door_ledger_proof`,
    PROFILE_STEERS_PROOF_ADMIN_URL: `${at}/postgres`,
    STORE_PROOF_ADMIN_URL: `${at}/postgres`,
  };
}

/** Wait one second without blocking the event loop. */
async function pause(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
}

/** Remove every labelled lap store still standing; only the lock holder runs this, so each one is an orphan. */
function removeOrphanStores({ cwd }: { cwd: string }): void {
  const orphans = runLapCommand({ args: ["ps", "-aq", "--filter", `label=${STORE_LABEL}`], cwd, file: "docker" });
  for (const id of orphans.isOk() ? orphans.value.split("\n").filter((line) => line.length > 0) : []) {
    runLapCommand({ args: ["rm", "-f", id], cwd, file: "docker" });
  }
}

/** Poll the store until it accepts connections, answering whether it ever did. */
async function storeReady({ cwd, id }: { cwd: string; id: string }): Promise<boolean> {
  for (let attempt = 0; attempt < STORE_READY_ATTEMPTS; attempt += 1) {
    if (
      runLapCommand({
        args: ["exec", id, "pg_isready", "-U", "postgres", "-d", "door_ledger_proof"],
        cwd,
        file: "docker",
      }).isOk()
    ) {
      return true;
    }
    await pause();
  }
  return false;
}

/**
 * Start the throwaway store, removing any orphan first, and wait until it accepts connections.
 *
 * @param cwd the directory docker runs from
 * @returns the store's URLs, whose disposal removes the container, or why it would not come up
 */
export async function startLapStore({
  cwd,
}: {
  cwd: string;
}): Promise<Result<LapResource<Readonly<Record<string, string>>>, LapError>> {
  removeOrphanStores({ cwd });
  const started = runLapCommand({
    args: [
      "run",
      "-d",
      "--rm",
      "--label",
      STORE_LABEL,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=door_ledger_proof",
      "-p",
      "127.0.0.1::5432",
      "postgres:17",
    ],
    cwd,
    file: "docker",
  });
  if (started.isErr()) {
    return err(LapErrors.storeUnavailable({ why: `would not start (is Docker running?): ${started.error.message}` }));
  }
  const id = started.value;
  const dispose = (): Promise<void> => {
    runLapCommand({ args: ["rm", "-f", id], cwd, file: "docker" });
    return Promise.resolve();
  };
  const reported = runLapCommand({ args: ["port", id, "5432/tcp"], cwd, file: "docker" });
  const port = reported.isOk() ? publishedPort({ output: reported.value }) : undefined;
  if (port === undefined) {
    await dispose();
    return err(LapErrors.storeUnavailable({ why: "started but published no port" }));
  }
  if (!(await storeReady({ cwd, id }))) {
    await dispose();
    return err(LapErrors.storeUnavailable({ why: `never accepted connections in ${String(STORE_READY_ATTEMPTS)}s` }));
  }
  return ok({ dispose, value: storeUrls({ port }) });
}
