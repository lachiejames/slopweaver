/**
 * A real board and run journal under a throwaway state home, for driving the `handover` lifecycle verbs
 * through their production resolver. The journal is seeded through the production writer, so a test cannot
 * pass against a format the writer does not produce; `snapshotTree` reads back EVERY path and every file's
 * bytes, so a "writes nothing" claim covers the whole home rather than one named file.
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import type { RunEvent } from "../../../../../handover/ledger.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { appendLines } from "../../../../../lib/appendSeparator.js";
import { unwrap } from "../../../../../lib/result.js";
import { ensureDirectory, writeFileAtomic } from "../../../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../../../../../supervisor/session.js";

/** One state home holding a board and a runs directory. */
export interface LifecycleHome {
  readonly home: string;
  readonly handovers: string;
  readonly runsDir: string;
}

/** The opening event every seeded run starts from. */
export const STARTED: RunEvent = {
  atIso: "2026-10-01T09:00:00.000Z",
  branch: "lifecycle-branch",
  docHash: "deadbeef",
  kind: "started",
};

/**
 * Mint a state home with a board carrying `slug` (unless `withDoc` is false) and a journal seeded with `events`.
 *
 * @param homes the per-file registry the caller's `afterEach` empties, so every home is removed
 * @param withDoc false for the orphan case, where the board is empty but the journal remains
 * @param rawLines undecodable lines appended to the journal after the events, verbatim
 * @returns the home and its two directories
 */
export function lifecycleHome({
  homes,
  slug,
  events,
  withDoc = true,
  rawLines = [],
}: {
  homes: string[];
  slug: string;
  events: readonly RunEvent[];
  withDoc?: boolean;
  rawLines?: readonly string[];
}): LifecycleHome {
  const home = mkdtempSync(join(tmpdir(), "sw-lifecycle-"));
  homes.push(home);
  const { handovers, runs: runsDir } = stateHomePaths({ home });
  ensureDirectory({ directory: handovers });
  ensureDirectory({ directory: runsDir });
  if (withDoc) {
    writeFileAtomic({
      contents: [
        "---",
        `slug: ${slug}`,
        "summary: a lifecycle fixture",
        "status: in-progress",
        "---",
        "",
        `# ${slug}`,
        "",
      ].join("\n"),
      path: join(handovers, `${slug}.md`),
    });
  }
  for (const event of events) {
    appendRunEvent({ event, runsDir, slug });
  }
  for (const line of rawLines) {
    appendLines({ durable: true, mode: 0o600, path: join(runsDir, `${slug}.jsonl`), text: `${line}\n` });
  }
  return { handovers, home, runsDir };
}

/**
 * Every path under `root` with its bytes (a directory as `<dir>`), sorted, so two reads compare whole.
 *
 * @param root the directory to walk
 * @returns one `[relative path, content]` pair per entry
 */
export function snapshotTree({ root }: { root: string }): readonly (readonly [string, string])[] {
  const entries: (readonly [string, string])[] = [];
  const walk = ({ dir }: { dir: string }): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        entries.push([relative(root, path), "<dir>"]);
        walk({ dir: path });
      } else {
        entries.push([relative(root, path), readFileSync(path).toString("base64")]);
      }
    }
  };
  walk({ dir: root });
  return entries.toSorted(([a], [b]) => a.localeCompare(b));
}

/**
 * The journal's decoded events for `slug`, in order.
 *
 * @returns the events the production reader decodes
 */
export function journalEvents({ runsDir, slug }: { runsDir: string; slug: string }): readonly RunEvent[] {
  return unwrap(readRunJournal({ runsDir, slug })).events;
}

/**
 * The argv a real `slopweaver handover <verb>` invocation carries.
 *
 * @param rest the slug and flags after the verb
 * @returns the full process argv
 */
export function verbArgv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "cli", "handover", verb, ...rest];
}

/** The two session variables a lifecycle verb reads to identify itself, as they stood at module load. */
const SAVED_SESSION_ENV: Readonly<Record<string, string | undefined>> = {
  [CLAUDE_CODE_SESSION_ID_ENV]: process.env[CLAUDE_CODE_SESSION_ID_ENV],
  [CODEX_THREAD_ID_ENV]: process.env[CODEX_THREAD_ID_ENV],
};

/** Unset both session variables, so a verb run from inside a real session reads as an unidentified one. */
export function clearSessionEnv(): void {
  delete process.env[CLAUDE_CODE_SESSION_ID_ENV];
  delete process.env[CODEX_THREAD_ID_ENV];
}

/** Put both session variables back exactly as they stood at module load. */
export function restoreSessionEnv(): void {
  for (const [name, value] of Object.entries(SAVED_SESSION_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
