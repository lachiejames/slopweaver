/**
 * The handover board as `slopweaver github landing` joins it: every row with a STATED branch, keyed by each.
 *
 * Split out of `./landingDeps.ts` along the seam it already had: that file wires the verb's provider and
 * local-state edges, while this one is the board read alone — docs, their run journals and the `repo:` each
 * names. It reads the filesystem and git remotes, and decides nothing about a pull request.
 */

import { originRepositoryOf, repositoryFromGitRemote } from "../../../config.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { derivedRowState } from "../../../handover/derivedRowState.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { statedBranches } from "../../../handover/evaluate.js";
import { type ParsedLedger, runStateOf } from "../../../handover/ledger.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import type { IngestError } from "../../../lib/ingestError.js";
import type { Result } from "../../../lib/result.js";
import { type LandingBoardRow, landingBoardPark } from "../../../review/landingBoard.js";
import { stateHomePaths } from "../../../stateHome.js";

/** A bare `owner/name`, with an optional `.git` — never `~/x`, `null` or anything else with a space in it. */
const BARE_SLUG = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i;

/**
 * The `owner/name` a handover doc's `repo:` value names, or undefined when it names none this can prove.
 *
 * A path resolves through that checkout's own `origin`, so a linked worktree or a fleet checkout resolves to
 * the repository it belongs to rather than reading as a stranger to the declared main checkout — the r3 review
 * of this join measured seven such rows on the live board. A remote URL or a bare slug parses. A path that is
 * gone, `null` or `~/dev/x` resolves to nothing, which the join treats as ambiguous and KEEPS.
 *
 * @param repo the doc's `repo:` value, verbatim
 * @returns the lower-cased `owner/name`, or undefined
 */
function declaredRepoSlug({ repo }: { repo: string }): string | undefined {
  const value = repo.trim();
  if (BARE_SLUG.test(value)) {
    return twoSegmentSlug({ candidate: value });
  }
  const parsed = value.startsWith("/")
    ? originRepositoryOf({ cwd: value })
    : repositoryFromGitRemote({ remoteUrl: value });
  return parsed.isErr() ? undefined : twoSegmentSlug({ candidate: `${parsed.value.owner}/${parsed.value.repo}` });
}

/**
 * A candidate held to the bare `owner/name` shape, since a remote parse lets slashes into the name.
 *
 * The r3 review measured it: `ssh://git@ssh.github.com:443/acme/widgets.git` parsed to `443/acme/widgets`, and a
 * pull request URL to `acme/widgets/pull/N` — each read as ANOTHER repository and dropped this one's own
 * row. Anything but exactly two segments is unprovable, so ambiguous, so kept.
 *
 * @param candidate the `owner/name` a parse produced, possibly with a `.git` in any case
 * @returns the lower-cased `owner/name`, or undefined when the candidate is not that shape
 */
function twoSegmentSlug({ candidate }: { candidate: string }): string | undefined {
  const bare = BARE_SLUG.exec(candidate);
  if (bare === null) {
    return undefined;
  }
  return `${bare[1]!}/${bare[2]!}`.toLowerCase();
}

/**
 * One handover doc as the landing join reads it: its slug, DERIVED status, settlement witness and `repo:`.
 *
 * @param doc the board doc
 * @param journal its run journal as read, whose `closed` and `abandoned` events end a row too
 * @param repoSlugOf what a `repo:` value resolves to, asked once per distinct value
 * @returns the board row
 */
function boardRowOf({
  doc,
  journal,
  repoSlugOf,
}: {
  doc: HandoverDoc;
  journal: Result<ParsedLedger, IngestError>;
  repoSlugOf: (args: { repo: string }) => string | undefined;
}): LandingBoardRow {
  // An unreadable journal derives from the front-matter alone, which still reads a settlement: the
  // derivation is monotone toward terminal, so the worst it can do is miss a `closed` or `abandoned` event.
  // Its RUN is `unreadable` though, never `never-started` — the settle that reads it is irreversible.
  const events = journal.isOk() ? journal.value.events : [];
  const derived = derivedRowState({ doc, events });
  const disposition = journal.isOk()
    ? runDisposition({ events, unreadableLines: journal.value.unreadable })
    : undefined;
  const run = disposition === undefined ? ("unreadable" as const) : disposition.kind;
  const parked = disposition === undefined ? undefined : landingBoardPark({ run: disposition });
  const repoSlug = doc.repo === undefined ? undefined : repoSlugOf({ repo: doc.repo });
  return {
    kind: "row",
    run,
    ...(parked === undefined ? {} : { parked }),
    slug: doc.slug,
    status: derived.status,
    ...(derived.settlementWitness === undefined ? {} : { settlementWitness: derived.settlementWitness }),
    ...(repoSlug === undefined ? {} : { repoSlug }),
  };
}

/**
 * Every handover row with a STATED branch, keyed by each one, each carrying its DERIVED status.
 *
 * Stated is `statedBranches`' two facts: the branch the run journal's `started` event recorded, and the doc's
 * declared `branch:`. An ask row declares none, yet its seat opens a run on its own branch and the pull
 * request rides that branch — MEASURED: 9 of 18 drafts the read called orphaned were each held by
 * a run parked on CI, and `--register --dry-run` would have filed a second row over two in live seats. A doc
 * with neither is simply absent from the map, which is what makes the row read `none?` rather than `none` —
 * see `../../../review/landingBoard.ts`'s {@link LandingBoardRow} for why the difference decides whether
 * spawning an investigation duplicates work. The slug is never a key: that would be inference by name.
 *
 * The status is `derivedRowState`'s, never the `status:` line: a settled ask keeps `status: ready` in its
 * own file on purpose (`../../../handover/askRow.ts`), so the line read here listed ten settled rows as
 * dispatchable work that `cmux spawn` — which derives — then refused. Every row per branch is kept, and
 * `./landingRegister.ts`'s `boardRowForHead` picks one against the head being judged.
 *
 * @param home the state home whose `handovers/` directory holds the board
 * @returns every stating row per branch, in board order; empty when the board could not be read at all
 */
export function readBoardBranches({
  home,
}: {
  home: string | undefined;
}): ReadonlyMap<string, readonly LandingBoardRow[]> {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  const scanned = scanBoard({ handoverDir: paths.handovers });
  if (scanned.isErr()) {
    return new Map();
  }
  const byBranch = new Map<string, LandingBoardRow[]>();
  const resolved = new Map<string, string | undefined>();
  const repoSlugOf = ({ repo }: { repo: string }): string | undefined => {
    if (!resolved.has(repo)) {
      resolved.set(repo, declaredRepoSlug({ repo }));
    }
    return resolved.get(repo);
  };
  for (const doc of scanned.value.docs) {
    const journal = readRunJournal({ runsDir: paths.runs, slug: doc.slug });
    // A journal with undecodable lines still keys on the `started` line it DID decode. One shared home is read by
    // many vintages of this decoder, so an unreadable line is usually a newer kind rather than corruption, and
    // dropping the key would orphan exactly the mixed-vintage journals this join exists to hold. The failure is
    // toward HOLDING a registration back, the direction `../../../review/landingBoard.ts` already takes for an
    // unknown status, and the row's run still reads `unreadable` so closure never treats it as unattended.
    const branches = statedBranches({
      declaredBranch: doc.branch,
      recordedBranch: journal.isOk() ? runStateOf({ events: journal.value.events }).branch : undefined,
    });
    if (branches.length === 0) {
      continue;
    }
    keyRowUnder({ branches, byBranch, row: boardRowOf({ doc, journal, repoSlugOf }) });
  }
  return byBranch;
}

/**
 * File one row under each branch it states, beside any row already filed there.
 *
 * @param branches every branch the row states, recorded first
 * @param byBranch the map being built, mutated in place
 * @param row the board row to file
 */
function keyRowUnder({
  branches,
  byBranch,
  row,
}: {
  branches: readonly string[];
  byBranch: Map<string, LandingBoardRow[]>;
  row: LandingBoardRow;
}): void {
  for (const branch of branches) {
    const stating = byBranch.get(branch);
    if (stating === undefined) {
      byBranch.set(branch, [row]);
    } else {
      stating.push(row);
    }
  }
}
