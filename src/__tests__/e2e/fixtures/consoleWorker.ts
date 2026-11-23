/**
 * One Playwright worker's console: the BUILT console (`site/.next`, from `scripts/docs-site.sh --build`) served by
 * `next start` on a free loopback port, against the worker's own seeded home.
 *
 * One server per worker, never one per run: the console reads `$SLOPWEAVER_HOME` once, when it starts
 * (`site/lib/consoleHome.ts`), so a home cannot be switched under a running server, and two workers sharing a home
 * would share every reading either one records. The build is shared, read-only, by every worker's server.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type PublishedE2ePageFixture, removeE2ePageFixtureFromStore } from "../../../desktop/e2ePageFixtureStore.js";
import { E2E_OBJECTS_API_URL_ENV, E2E_OBJECTS_SERVICE_KEY_ENV } from "../../../store/objects/e2eSelection.js";
import { againstRunStore, assertFixtureRowsGone, REPOSITORY_ROOT, seedWorkerHome } from "./consoleSeed.js";

/** How long a cold `next start` has to answer, bounded well above the 0.2s it takes locally. */
const READY_CAP_MS = 60_000;

/** What Node prints when a server's port is already bound, the one exit a fresh port can cure. */
const PORT_TAKEN = "EADDRINUSE";

/** How many ports a worker tries before refusing; a collision needs two workers racing for the same free port. */
const PORT_ATTEMPTS = 5;

/** How long the server gets after SIGTERM before its process group is killed outright. */
const STOP_GRACE_MS = 5000;

/**
 * The only variables a worker's console inherits from the run, by ALLOWLIST. Everything else is dropped, because the
 * console and every verb it spawns resolve credentials from the environment and from `$HOME`: `githubToken`
 * (`src/config.ts`) reads `GITHUB_TOKEN`/`GH_TOKEN`, then falls back to `gh auth token`, so a local run inherited the
 * developer's own GitHub login and the Queue's automatic refresh could read real GitHub.
 * With `HOME` a throwaway too, no provider is reachable, so a refresh one test sets off fails the same way on every
 * run and cannot change the seeded reading a later test on the same worker reads.
 *
 * `next start` would still load `site/.env*` itself, after this environment is built, so a token a developer keeps
 * there would come back. `__NEXT_PROCESSED_ENV` is the flag Next sets once it has loaded
 * them, so its own children skip the files; set here, the server skips them too. Read it in
 * `site/node_modules/@next/env/dist/index.js`, `processEnv`.
 *
 * `NODE_OPTIONS` is not inherited either: a `--require` preload in it runs inside the server and could set any
 * credential this list drops. The built server needs no loader, and the lane's own
 * `--import tsx` is for Playwright's process, not this one.
 */
const INHERITED_ENV: readonly string[] = ["PATH", "TMPDIR", "LANG", "LC_ALL", "TZ", "CI"];

/**
 * The environment a worker's console runs under: the allowlisted variables, a throwaway `HOME`, and the worker's own
 * state, cache and store.
 *
 * @param fakeHome the throwaway directory standing in for `$HOME`
 * @returns the environment
 */
function workerEnv({
  cache,
  fakeHome,
  home,
  objects,
  storeUrl,
}: {
  cache: string;
  fakeHome: string;
  home: string;
  objects: LaneObjects;
  storeUrl: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return {
    ...env,
    HOME: fakeHome,
    [E2E_OBJECTS_API_URL_ENV]: objects.apiUrl,
    [E2E_OBJECTS_SERVICE_KEY_ENV]: objects.serviceKey,
    SLOPWEAVER_CACHE_HOME: cache,
    SLOPWEAVER_HOME: home,
    SLOPWEAVER_STORE_URL: storeUrl,
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    __NEXT_PROCESSED_ENV: "true",
  };
}

/** The run's loopback Storage (`./fakeObjectStorage.ts`), named explicitly to the console rather than inherited. */
export interface LaneObjects {
  readonly apiUrl: string;
  readonly serviceKey: string;
}

/** One worker's running console. */
export interface ConsoleWorker {
  /** `http://127.0.0.1:<port>`, every spec's base URL. */
  readonly origin: string;
  /** The worker's own `$SLOPWEAVER_HOME`. */
  readonly home: string;
  /** The inert published page seeded into that home. */
  readonly publishedPage: PublishedE2ePageFixture;
  /**
   * The variables the worker's OWN Playwright process takes for its tests: its state home, cache and a throwaway
   * `HOME`. Without them every worker shares the run's lane home and the developer's real `HOME`, so a spec reading
   * `process.env` could reach another worker's state or `~/.slopweaver`.
   */
  readonly processEnv: Readonly<Record<string, string>>;
  /** Stop the server and remove the worker's directories. */
  readonly stop: () => Promise<void>;
}

/**
 * A port nothing is listening on, chosen by the kernel.
 *
 * @returns the port
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the kernel handed back no port"));
        return;
      }
      server.close(() => {
        resolve(address.port);
      });
    });
  });
}

/**
 * Wait until THIS worker's server answers, or refuse with what it printed.
 *
 * Readiness is the worker's own published page served at its own slug, never a file every console serves:
 * `freePort` releases its port before `next start` binds it, so two workers can be handed the same one, and an
 * answer on the port proves only that SOME console is there. Only a
 * server reading this worker's home can serve this slug, so the loser of such a race never reads as ready: its own
 * server exits on the taken port and the wait says so, for the caller to try another.
 *
 * @param origin the server
 * @param page the worker's published page, whose slug no other worker's home holds
 * @param child the server's process, whose exit ends the wait early
 * @param output what it has printed so far
 * @returns `ready`, or `port-taken` when the server exited because another process held the port first
 */
async function untilReady({
  origin,
  page,
  child,
  output,
}: {
  origin: string;
  page: PublishedE2ePageFixture;
  child: ChildProcess;
  output: () => string;
}): Promise<"ready" | "port-taken"> {
  const deadline = Date.now() + READY_CAP_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      if (output().includes(PORT_TAKEN)) {
        return "port-taken";
      }
      throw new Error(`next start exited ${String(child.exitCode)} before answering:\n${output()}`);
    }
    // The page's body is the same fixture in every worker; its PATH is not. Another worker's console has no page
    // under this slug and answers 404, so a 200 here comes from a server reading this worker's home.
    const ours = await fetch(`${origin}${page.framePath}`).then(
      (response) => response.ok,
      () => false,
    );
    if (ours) {
      return "ready";
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`next start did not serve ${page.framePath} within ${String(READY_CAP_MS)}ms:\n${output()}`);
}

/**
 * Stop a server's whole process group: SIGTERM, then SIGKILL after the grace.
 *
 * @param child the server, started as its own group's leader
 */
async function stopGroup({ child }: { child: ChildProcess }): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  process.kill(-pid, "SIGTERM");
  const killed = setTimeout(() => {
    process.kill(-pid, "SIGKILL");
  }, STOP_GRACE_MS);
  await exited;
  clearTimeout(killed);
}

/**
 * Start `next start` on one port as its own process group, keeping the last of what it prints.
 *
 * @param env the worker's environment
 * @param port the loopback port it binds
 * @returns the server and what it has printed so far
 */
function spawnConsole({ env, port }: { env: Record<string, string>; port: number }): {
  readonly child: ChildProcess;
  readonly output: () => string;
} {
  const child = spawn(
    join(REPOSITORY_ROOT, "site", "node_modules", ".bin", "next"),
    ["start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: join(REPOSITORY_ROOT, "site"), detached: true, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let printed = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk: Buffer) => {
      printed = `${printed}${chunk.toString("utf8")}`.slice(-16_384);
    });
  }
  return { child, output: () => printed };
}

/**
 * Take the worker's published page back out of the run's store, then refuse unless no row of it is left.
 *
 * @param home the worker's home, whose store it was published into
 * @param page the worker's published page
 * @param storeUrl the run's store
 */
async function retirePublishedPage({
  home,
  page,
  storeUrl,
}: {
  home: string;
  page: PublishedE2ePageFixture;
  storeUrl: string;
}): Promise<void> {
  const removed = await againstRunStore({
    run: () => removeE2ePageFixtureFromStore({ fixture: page, home }),
    storeUrl,
  });
  if (removed.isErr()) {
    throw new Error(removed.error.message);
  }
  await assertFixtureRowsGone({ slug: page.slug, storeUrl });
}

/**
 * Seed a worker's home and start its console.
 *
 * @param storeUrl the run's store; the worker's own seed and cleanup write only its own page's rows
 * @param objects the run's Storage, handed to the console by name
 * @param workerIndex the worker's index, which names its published page
 * @returns the running console
 */
export async function startConsoleWorker({
  storeUrl,
  objects,
  workerIndex,
}: {
  storeUrl: string;
  objects: LaneObjects;
  workerIndex: number;
}): Promise<ConsoleWorker> {
  const home = mkdtempSync(join(tmpdir(), "sw-e2e-home-"));
  const cache = mkdtempSync(join(tmpdir(), "sw-e2e-cache-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "sw-e2e-user-"));
  const publishedPage = await seedWorkerHome({ home, nonce: `worker-${String(workerIndex)}`, storeUrl });
  const removeDirectories = async (): Promise<void> => {
    try {
      await retirePublishedPage({ home, page: publishedPage, storeUrl });
    } finally {
      rmSync(home, { force: true, recursive: true });
      rmSync(cache, { force: true, recursive: true });
      rmSync(fakeHome, { force: true, recursive: true });
    }
  };
  // `freePort` releases its port before `next start` binds it, so another worker can take it in between. The server that loses exits on EADDRINUSE, and this worker takes a fresh
  // port rather than failing its tests for something another worker did.
  for (let attempt = 1; attempt <= PORT_ATTEMPTS; attempt += 1) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${String(port)}`;
    const { child, output } = spawnConsole({ env: workerEnv({ cache, fakeHome, home, objects, storeUrl }), port });
    const stop = async (): Promise<void> => {
      await stopGroup({ child });
      await removeDirectories();
    };
    let outcome: "ready" | "port-taken";
    try {
      outcome = await untilReady({ child, origin, output, page: publishedPage });
    } catch (error) {
      await stop();
      throw error;
    }
    if (outcome === "ready") {
      const processEnv = {
        HOME: fakeHome,
        SLOPWEAVER_CACHE_HOME: cache,
        SLOPWEAVER_HOME: home,
        XDG_CONFIG_HOME: join(fakeHome, ".config"),
      };
      return { home, origin, processEnv, publishedPage, stop };
    }
  }
  await removeDirectories();
  throw new Error(`next start found its port taken on all ${String(PORT_ATTEMPTS)} attempts`);
}
