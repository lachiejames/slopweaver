/**
 * Ask the console a test instance will read which conversations its call registry holds, through
 * `site/app/api/talk/held/route.ts`. The registry is in that server's own memory, so a file on disk cannot answer it;
 * the port is the checkout's run record (`scripts/docs-site.sh` writes it, `src/checkouts/consoleBuild.ts` parses
 * it), read each time because a rebuild can swap the server between two reads. Anything short of the route's exact
 * answer is unreadable, never "none held": `src/desktop/heldConversations.ts` says why.
 *
 * **Every live record is asked, and what they hold is the union.** A checkout may carry a record in the cache root
 * and an older one under the home; picking one would let a recycled pid in the first hide a live console named by
 * the second. So each record whose pid is alive is asked, and one unreadable answer makes the whole
 * read unreadable. A recycled pid whose port answers nothing therefore waits and refuses: the safe direction.
 *
 * **No server, nothing held.** The registry lives and dies with its process, and the test instance `--serve`s a
 * console that is down (`desktop/src/consoleServer.ts`), so no record, or only records whose pid is gone, holds
 * nothing: a server started after this read starts empty.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { cachePaths } from "../../../cacheHome.js";
import { consoleRecordKey, parseConsoleRunRecord } from "../../../checkouts/consoleBuild.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { type HeldConversation, parseHeldConversations } from "../../../desktop/heldConversations.js";
import type { ConsoleGet } from "../../../queueRefusals/report.js";
import { stateHomePaths } from "../../../stateHome.js";

/** How long one read of the route may take before it counts as unreachable. */
const HELD_READ_TIMEOUT_MS = 5_000;

/** The route, relative to the console's origin. */
export const HELD_CONVERSATIONS_PATH = "/api/talk/held";

/** The seams a read goes through. */
export interface HeldConversationsDeps {
  readonly get: ConsoleGet;
  /** Whether a process with this pid exists. */
  readonly alive: (options: { readonly pid: number }) => boolean;
  /** A file's text, `undefined` only when there is no such file, or why it could not be read. */
  readonly readText: (options: { readonly path: string }) => Result<string | undefined, string>;
}

/** The real seams: a bounded, uncached GET and a plain file read. */
export const PRODUCTION_HELD_DEPS: HeldConversationsDeps = {
  alive: ({ pid }) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      // EPERM is a process that exists under another user: alive.
      return error instanceof Error && "code" in error && error.code === "EPERM";
    }
  },
  get: async ({ url, timeoutMs }) => {
    // Never followed: a redirect's target is not the registry asked, so its 3xx reads as unreadable.
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, text: await response.text() };
  },
  readText: ({ path }) => {
    try {
      return ok(readFileSync(path, "utf8"));
    } catch (error: unknown) {
      // Only a missing file is absent; any other failure may be hiding a live console's record.
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return ok(undefined);
      }
      return err(error instanceof Error ? error.message : String(error));
    }
  },
};

/**
 * The origins of every live console recorded for `checkout`: the cache root's record and the home's older one.
 *
 * @param checkout the checkout whose console the test instance reads
 * @param home the state home holding the older records
 * @param cacheRoot the cache root holding `docs-site/`, this process's own when `undefined`
 * @param deps the seams
 * @returns each `http://localhost:<port>` whose recorded pid is alive, none when no record names one, or why a record
 *   could not be read or is not this checkout's
 */
function liveConsoleOrigins({
  checkout,
  home,
  cacheRoot,
  deps,
}: {
  checkout: string;
  home: string;
  cacheRoot: string | undefined;
  deps: HeldConversationsDeps;
}): Result<readonly string[], E2eCallError> {
  const key = `${consoleRecordKey({ root: checkout })}.json`;
  const current = cachePaths(cacheRoot === undefined ? {} : { root: cacheRoot }).docsSite;
  const origins = new Set<string>();
  for (const path of [join(current, key), join(stateHomePaths({ home }).homeDocsSite, key)]) {
    const read = deps.readText({ path });
    if (read.isErr()) {
      return err(E2eCallErrors.conversationsUnreadable({ detail: `${path} could not be read: ${read.error}` }));
    }
    if (read.value === undefined) {
      continue;
    }
    const record = parseConsoleRunRecord({ text: read.value });
    if (record === undefined || record.worktree !== checkout) {
      return err(E2eCallErrors.conversationsUnreadable({ detail: `${path} is not this checkout's console record` }));
    }
    if (deps.alive({ pid: record.pid })) {
      origins.add(`http://localhost:${String(record.port)}`);
    }
  }
  return ok([...origins]);
}

/**
 * Ask one console's registry what it holds.
 *
 * @param origin the console's `http://localhost:<port>`
 * @param deps the seams
 * @returns what it holds, or why its answer could not be read
 */
async function askRegistry({
  origin,
  deps,
}: {
  origin: string;
  deps: HeldConversationsDeps;
}): Promise<Result<readonly HeldConversation[], E2eCallError>> {
  const url = `${origin}${HELD_CONVERSATIONS_PATH}`;
  let answer: { status: number; text: string };
  try {
    answer = await deps.get({ timeoutMs: HELD_READ_TIMEOUT_MS, url });
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    return err(E2eCallErrors.conversationsUnreadable({ detail: `${url} could not be reached: ${why}` }));
  }
  if (answer.status !== 200) {
    return err(E2eCallErrors.conversationsUnreadable({ detail: `${url} answered ${String(answer.status)}` }));
  }
  return parseHeldConversations({ text: answer.text, url });
}

/**
 * Read the conversations every live console recorded for the checkout holds.
 *
 * @param checkout the checkout whose console the test instance reads
 * @param home the state home holding the older run records
 * @param cacheRoot the cache root holding `docs-site/`, this process's own when `undefined`
 * @param deps the seams
 * @returns every conversation held, across them, or why any one could not be read
 */
export async function readHeldConversations({
  checkout,
  home,
  cacheRoot,
  deps,
}: {
  checkout: string;
  home: string;
  cacheRoot: string | undefined;
  deps: HeldConversationsDeps;
}): Promise<Result<readonly HeldConversation[], E2eCallError>> {
  const origins = liveConsoleOrigins({ cacheRoot, checkout, deps, home });
  if (origins.isErr()) {
    return err(origins.error);
  }
  const held: HeldConversation[] = [];
  for (const origin of origins.value) {
    const asked = await askRegistry({ deps, origin });
    if (asked.isErr()) {
      return err(asked.error);
    }
    for (const conversation of asked.value) {
      held.push(conversation);
    }
  }
  return ok(held);
}
