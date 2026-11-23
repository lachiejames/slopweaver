/**
 * The Linear workspace slug and team keys this install knows, read from the silver structure directory
 * (`silverStructuresPath`) — what turns a bare `QQQQ-134` into its address, for a Slack or Linear write
 * (`./bareRefContext.ts`) and for a queue card (`handover list --json`'s `referenceContext`).
 *
 * Read best-effort, exactly the way `../profileStore.ts`'s `loadProfile` reads `profile.json`: absence is a
 * normal, expected case (no Linear connected, or `derive` never ran), never an error a caller has to branch on.
 * An absent file only narrows what a key can resolve to.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { silverStructuresPath } from "../corpus/corpusPaths.js";
import { parseJson } from "../lib/jsonParse.js";
import { safeFs } from "../lib/safeBoundary.js";
import { isLinearWorkspaceSlug } from "../outbound/linkify/linearWorkspaceSlug.js";

/**
 * A regular file's text, asked of the one descriptor it is read through. A FIFO here would block a plain
 * `readFileSync` until a writer appears — forever, on `handover list --json` — and a `stat` before the read
 * leaves a window to swap one in. Opening non-blocking and checking THAT
 * descriptor closes both: a FIFO opens at once and is refused before a byte is read.
 *
 * @param path the file
 * @returns its text; throws when it is not a regular file or cannot be read
 */
function readRegularFile({ path }: { path: string }): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error(`${path} is not a regular file`);
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** Whether a value read off disk is an object whose fields can be looked at. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The string `slug` of every LINEAR entity in one directory list, checked field by field rather than assumed: a
 * `null` directory, a list that is not an array or an entity with no string slug reads as nothing, never a throw —
 * A destructure here crashes `handover list --json` on `{"directory":null}`.
 *
 * Linear's alone, because the directory holds every provider's: MEASURED, three orgs (GitHub's with a
 * `null` slug, Linear's `acme`, Slack's `acme-group`) and 51 teams, 27 of them GitHub's — so the first slug
 * was the workspace only by file order (`jq -c '[.directory.orgs[] | {slug, source}]'` over `structures.json`).
 *
 * @param directory the file's `directory` value, whatever it turned out to be
 * @param key which list — `orgs` or `teams`
 * @returns the slugs, in the file's order
 */
function slugsOf({ directory, key }: { directory: unknown; key: "orgs" | "teams" }): readonly string[] {
  if (!isRecord(directory)) {
    return [];
  }
  const list = directory[key];
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((entity: unknown) => {
    if (isRecord(entity) && entity["source"] === "linear" && typeof entity["slug"] === "string") {
      return [entity["slug"]];
    }
    return [];
  });
}

/** The Linear facts a bare key resolves against. */
export interface LinearReferenceFacts {
  /** The workspace's URL slug — `acme` in `linear.app/acme/issue/QQQQ-134` — when `derive` recorded one. */
  readonly workspaceSlug: string | undefined;
  /** Every team key the directory names, so `UTC-5` and `ISO-8601` are never read as issues. */
  readonly teamKeys: readonly string[];
}

/**
 * The Linear workspace slug and team keys, from whatever `derive` last wrote — none when the file is absent,
 * unreadable or carries no directory at all. No workspace either when the directory holds TWO Linear orgs: silver
 * keeps an old workspace's rows beside a new one's, and the team keys carry no org, so `QQQQ-134` addressed to either
 * could open an unrelated issue in the other. Words beat a wrong link.
 *
 * No workspace either when the one slug is not a Linear URL key (`isLinearWorkspaceSlug`). Every consumer
 * interpolates it straight into `https://linear.app/<slug>/issue/<KEY>` — the bare-ref resolver and the console's
 * inline citations (`site/lib/inlineCitations.ts`) — so a slug carrying `/`, `.`, whitespace or a bracket would
 * build a misdirected or broken link from a file any process here can write.
 *
 * @param home the state home the silver directory is read from
 * @returns the facts, empty rather than failing when there are none to read
 */
export function linearReferenceFacts({ home }: { home: string }): LinearReferenceFacts {
  const path = silverStructuresPath({ home });
  const read = safeFs({ execute: () => readRegularFile({ path }), operation: "readSilverStructures", path });
  if (read.isErr()) {
    return { teamKeys: [], workspaceSlug: undefined };
  }
  const parsed = parseJson({ text: read.value });
  if (parsed.isErr() || !isRecord(parsed.value)) {
    return { teamKeys: [], workspaceSlug: undefined };
  }
  const { directory } = parsed.value;
  const workspaces = [...new Set(slugsOf({ directory, key: "orgs" }))];
  const sole = workspaces.length === 1 ? workspaces[0] : undefined;
  return {
    teamKeys: slugsOf({ directory, key: "teams" }),
    workspaceSlug: sole !== undefined && isLinearWorkspaceSlug({ slug: sole }) ? sole : undefined,
  };
}
