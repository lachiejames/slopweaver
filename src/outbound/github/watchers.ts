/**
 * WHO IS WATCHING each pull request, folded from the checks-read register — the source behind the
 * pull-request page's watched column ("which PRs are watched" is part of the trust class).
 *
 * A pull request is WATCHED when a visible session holds `github checks --wait` or `--until` on it: that
 * run writes a `watching` row on its first read and a `watch-done` row when its loop returns. THE READER
 * LANDED BEFORE THE WRITER: the register is one file under the shared home that every session's build
 * parses and fails closed on, so the row kinds reached main first and `github checks` began writing
 * them in the pull request after. A
 * session that died writes nothing, so a `watching` older than the verb's own `--timeout-seconds` ceiling
 * with no `watch-done` from the same session is reported STALE, never watching. Everything else says
 * "read <instant> by <who>, not watched", from the last `read` row — derived, never omitted.
 */
import type {
  ChecksReadRow,
  ChecksWatchDoneRecord,
  ChecksWatchingRecord,
  ChecksWatchMode,
} from "./checksReadLedger.js";

/**
 * One open or stale watcher of a pull request.
 *
 * @internal reached through {@link PullRequestWatch}
 */
export interface PullRequestWatcher {
  readonly session: string;
  readonly sinceIso: string;
  readonly mode: ChecksWatchMode;
  readonly headSha: string;
  /** True when `nowIso` is past the row's own timeout ceiling and no `watch-done` arrived — a dead session. */
  readonly stale: boolean;
}

/**
 * The last time anybody read a pull request's checks, and what the rollup said then.
 *
 * @internal reached through {@link PullRequestWatch}
 */
export interface PullRequestLastRead {
  readonly atIso: string;
  readonly headSha: string;
  readonly rollup: string;
}

/** What the register says about one pull request: its watchers, and the last read of it. */
export interface PullRequestWatch {
  readonly repo: string;
  readonly number: number;
  readonly watchers: readonly PullRequestWatcher[];
  readonly lastRead: PullRequestLastRead | undefined;
}

/** One instant as epoch milliseconds; a row's instant already passed `Date.parse` when it was read. */
function ms({ iso }: { iso: string }): number {
  return Date.parse(iso);
}

/**
 * Fold the register into one entry per pull request that has ever been watched or read.
 *
 * A watcher is OPEN when no later `watch-done` from the same session names the same pull request; two
 * sessions watching one pull request are two watchers, and a done from one never closes the other. Entries
 * come out in the order the register first named each pull request, watchers in the order they began.
 *
 * @param rows every row of the register, in the order written
 * @param nowIso the instant staleness is judged at — the caller's clock, so a test can pin it
 * @returns one entry per pull request the register names in a watch or a read row
 */
export function watchersOf({
  rows,
  nowIso,
}: {
  rows: readonly ChecksReadRow[];
  nowIso: string;
}): readonly PullRequestWatch[] {
  const keyOf = ({ repo, number }: { repo: string; number: number }): string => `${repo}#${String(number)}`;
  const order: string[] = [];
  const watchers = new Map<string, PullRequestWatcher[]>();
  const lastReads = new Map<string, PullRequestLastRead>();
  const identity = new Map<string, { repo: string; number: number }>();
  const note = (row: { repo: string; number: number }): string => {
    const key = keyOf(row);
    if (!identity.has(key)) {
      identity.set(key, { number: row.number, repo: row.repo });
      order.push(key);
    }
    return key;
  };
  const listFor = ({ key }: { key: string }): PullRequestWatcher[] => {
    let list = watchers.get(key);
    if (list === undefined) {
      list = [];
      watchers.set(key, list);
    }
    return list;
  };
  const now = ms({ iso: nowIso });
  for (const row of rows) {
    if (row.kind === "raised") {
      continue;
    }
    const key = note(row);
    if (row.kind === "read") {
      lastReads.set(key, { atIso: row.atIso, headSha: row.headSha, rollup: row.rollup });
    } else {
      applyWatchRow({ list: listFor({ key }), now, row });
    }
  }
  return order.map((key) => {
    const { number, repo } = identity.get(key)!;
    return { lastRead: lastReads.get(key), number, repo, watchers: listFor({ key }) };
  });
}

/**
 * Open a watcher on a `watching` row, or close the same session's watcher on a `watch-done`.
 *
 * @param list the pull request's open watchers, mutated in place
 * @param now the judging instant as epoch milliseconds
 */
function applyWatchRow({
  list,
  now,
  row,
}: {
  list: PullRequestWatcher[];
  now: number;
  row: ChecksWatchingRecord | ChecksWatchDoneRecord;
}): void {
  if (row.kind === "watching") {
    const ceiling = ms({ iso: row.atIso }) + row.timeoutSeconds * 1000;
    list.push({
      headSha: row.headSha,
      mode: row.mode,
      session: row.session,
      sinceIso: row.atIso,
      stale: now > ceiling,
    });
    return;
  }
  const closing = list.findIndex((watcher) => watcher.session === row.session);
  if (closing !== -1) {
    list.splice(closing, 1);
  }
}
