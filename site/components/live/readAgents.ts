/**
 * The reader for the agents tile: the open sessions, newest event first, beside how many are tracked. A sibling of
 * `./read.ts`, under every rule its module doc states.
 */
import { bags, isBag, str, sub } from "../../lib/bag";

/** One live session, as the agents tile shows it. */
export interface AgentRow {
  /** `sessionKey` — the only identity every row carries, and unique across the OPEN ones. */
  readonly key: string;
  /**
   * The workspace slug, ABSENT on a session that never had one.
   *
   * Measured — 2,548 sessions tracked, 2,516 closed, 32 open, 17 of those 32 carrying no slug
   * at all. They are stale ledger entries for sessions nobody closed, with no `cwd` and no `bootModel`
   * either. That is a real state of this ledger, not a shape change, so the row survives and the tile
   * shows the key instead. Every number in this file comes from that one reading; re-take it with
   * `slopweaver session list --json` and count `status !== "closed"` in a node one-liner.
   */
  readonly slug: string | undefined;
  readonly status: string;
  readonly model: string;
  readonly lastEventIso: string | undefined;
  /** The repository directory name, which is how a reader tells this repo's work from another's. */
  readonly repo: string | undefined;
  /** The branch the session was spawned on, ABSENT on a hand-opened chat — what a pull request's head joins. */
  readonly branch: string | undefined;
  /** The cmux workspace, when the session has one — the name a seat is known by. */
  readonly workspaceRef: string | undefined;
}

/** The open sessions, and how many the ledger holds in total. */
export interface Agents {
  readonly rows: readonly AgentRow[];
  /** Every session the ledger tracks, open and closed — the denominator the tile prints. */
  readonly tracked: number;
}

/**
 * Which repository a session's working directory belongs to.
 *
 * A worktree path is `<repo>/.claude/worktrees.noindex/<slug>`, so the segment before `.claude` is the
 * repo; a session opened in a main checkout has no `.claude` segment and its last one is.
 *
 * @param cwd the session's own working directory
 * @returns the repository's directory name, or `undefined` when the path says nothing
 */
function repoOf({ cwd }: { cwd: string }): string | undefined {
  const parts = cwd.split("/").filter((part) => part !== "");
  const marker = parts.indexOf(".claude");
  if (marker > 0) {
    return parts[marker - 1];
  }
  return parts[parts.length - 1];
}

/**
 * A row's last event as a sortable number, with a row that never had one sorting last.
 *
 * Zero, and deliberately NOT `-Infinity`, for the unstamped case. The comparator is a subtraction, and
 * `-Infinity - -Infinity` is `NaN` — so two unstamped rows compared against each other hand `Array.sort` a
 * value the spec calls an inconsistent comparator, whose result is then implementation-defined for the
 * WHOLE array rather than for that one pair. Zero is an epoch every real stamp sorts above by 56 years, so
 * the absent case still lands last while the order stays total. No open row on this machine is unstamped
 * today (`slopweaver session list --json`: 0 of 32), which is exactly why it had to be read
 * rather than tested by running it.
 *
 * @param row the session row, whose `lastEventIso` is optional
 * @returns epoch milliseconds, or zero for a row carrying no event or an unparseable one
 */
function eventOrder({ row }: { row: AgentRow }): number {
  if (row.lastEventIso === undefined) {
    return 0;
  }
  const at = Date.parse(row.lastEventIso);
  if (Number.isNaN(at)) {
    return 0;
  }
  return at;
}

/**
 * Project `session list --json` into the agents tile's shape.
 *
 * **Open sessions only, and that is a SELECTION rather than a drop.** The verb reports every session the
 * ledger has ever tracked — 2,548 of them against 32 open, on the reading above. A tile titled "what the
 * agents are doing" that renders all of them answers a different question and does it in a table thousands
 * of rows long, so the filter is the tile's claim. `tracked` carries the denominator so the selection is
 * visible rather than implied, which is the difference between this and the silent dropping the head of
 * this file bans.
 *
 * Rows come back newest event first, because a ledger row last touched two weeks ago is not an agent doing
 * something and the age beside it has to say so.
 *
 * @returns the open sessions with the tracked total, or `undefined` when the payload is not a session list,
 *   or a session in it carries neither of the two fields every row has
 */
export function readAgents(payload: unknown): Agents | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const sessions = bags({ bag: payload, key: "sessions" });
  if (sessions === undefined) {
    return undefined;
  }
  const out: AgentRow[] = [];
  for (const session of sessions) {
    const key = str({ bag: session, key: "sessionKey" });
    const status = str({ bag: session, key: "status" });
    if (key === undefined || status === undefined) {
      return undefined;
    }
    if (status === "closed") {
      continue;
    }
    const slug = str({ bag: session, key: "slug" });
    const bootModel = sub({ bag: session, key: "bootModel" });
    const cwd = str({ bag: session, key: "cwd" });
    const pinned = bootModel === undefined ? undefined : str({ bag: bootModel, key: "model" });
    // A session that never pinned a model is a real state (rule 5's `cmux spawn --model` is required, but a
    // hand-opened chat is not a spawn), so it is NAMED rather than defaulted to a model name. Written as an
    // `if` rather than `pinned ?? "unpinned"` or the ternary that collapses to it: the house ban on silent
    // fallback and oxlint's `prefer-nullish-coalescing` both reject the other two spellings.
    let model = "unpinned";
    if (pinned !== undefined) {
      model = pinned;
    }
    out.push({
      branch: str({ bag: session, key: "branch" }),
      key,
      lastEventIso: str({ bag: session, key: "lastEventIso" }),
      model,
      repo: cwd === undefined ? undefined : repoOf({ cwd }),
      slug,
      status,
      workspaceRef: str({ bag: session, key: "workspaceRef" }),
    });
  }
  out.sort((left, right) => eventOrder({ row: right }) - eventOrder({ row: left }));
  return { rows: out, tracked: sessions.length };
}
