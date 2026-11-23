/**
 * The readers for the two people-shaped payloads the pull-request rows join on: seats (`session depth
 * --json`) and pictures (`identity avatars --json`). Kept out of `read.ts`, which is already the largest
 * file under `site/`; the rule at its top applies here unchanged — a row that will not parse refuses the
 * whole reading.
 */

import { type Bag, bags, isBag, str } from "../../lib/bag";

/** One seat as `session depth --json` prints it: the Claude session id and the names it goes by. */
export interface DepthRow {
  readonly sessionId: string;
  readonly workspaceRef: string | undefined;
  readonly title: string | undefined;
  readonly slug: string | undefined;
  readonly cwd: string | undefined;
}

/**
 * Read `session depth --json`'s rows.
 *
 * @returns the seats, or `undefined` when the payload is not the document
 */
export function readDepth(payload: unknown): readonly DepthRow[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "rows" });
  if (rows === undefined) {
    return undefined;
  }
  const out: DepthRow[] = [];
  for (const row of rows) {
    const sessionId = str({ bag: row, key: "sessionId" });
    if (sessionId === undefined) {
      return undefined;
    }
    out.push({
      cwd: str({ bag: row, key: "cwd" }),
      sessionId,
      slug: str({ bag: row, key: "slug" }),
      title: str({ bag: row, key: "title" }),
      workspaceRef: str({ bag: row, key: "workspaceRef" }),
    });
  }
  return out;
}

/** One person's picture as `identity avatars --json` prints it. */
export interface AvatarRow {
  readonly source: string;
  readonly nativeId: string;
  readonly name: string | undefined;
  readonly avatarUrl: string;
  readonly bot: boolean;
}

/** The roster, keyed by `<source>:<nativeId>` so a GitHub login and a Slack id never collide. */
export interface Avatars {
  readonly byId: ReadonlyMap<string, AvatarRow>;
  readonly count: number;
}

/**
 * The key a row is looked up by.
 *
 * @returns `<source>:<nativeId>`
 */
export function avatarKey({ source, nativeId }: { source: string; nativeId: string }): string {
  return `${source}:${nativeId}`;
}

/**
 * Read one avatar row.
 *
 * @returns the row, or `undefined`
 */
function avatarOf({ bag }: { bag: Bag }): AvatarRow | undefined {
  const source = str({ bag, key: "source" });
  const nativeId = str({ bag, key: "nativeId" });
  const avatarUrl = str({ bag, key: "avatarUrl" });
  const bot = bag["bot"];
  if (source === undefined || nativeId === undefined || avatarUrl === undefined || typeof bot !== "boolean") {
    return undefined;
  }
  return { avatarUrl, bot, name: str({ bag, key: "name" }), nativeId, source };
}

/**
 * Read `identity avatars --json`.
 *
 * @returns the roster, or `undefined` when the payload is not the document
 */
export function readAvatars(payload: unknown): Avatars | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const people = bags({ bag: payload, key: "people" });
  if (people === undefined) {
    return undefined;
  }
  const byId = new Map<string, AvatarRow>();
  for (const bag of people) {
    const row = avatarOf({ bag });
    if (row === undefined) {
      return undefined;
    }
    byId.set(avatarKey({ nativeId: row.nativeId, source: row.source }), row);
  }
  return { byId, count: byId.size };
}
