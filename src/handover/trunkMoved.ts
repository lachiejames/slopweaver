/**
 * Whether the trunk has moved what a ready FINDING's evidence names since it was asked — the reconcile-time
 * hold that keeps a seat from being spent learning what the trunk already knows.
 *
 * ## The defect, measured
 *
 * Six ready p1 finding rows were seated within one hour, and every one had been answered before its seat
 * booted; each cost a boot, a worktree and a plan draw to find that out (row
 * `the-board-s-ready-set-does-not-read`). Four of the six named, in their own `evidence:`, something a trunk
 * commit after their `askedIso` had changed:
 *
 * - `no-slopweaver-verb-submits-a-github-review-approve` — `src/cli/commands/github/reviewerArgs.ts`, changed by
 *   a later trunk commit;
 * - `handover-settle-refuses-every-ask-filed-from-a` — `settleCardRun.ts:74` and `settleCardErrors.ts:186`,
 *   both changed by the fix itself;
 * - `codex-review-fallback-prepare-and-plan-fallback-prepare` — `verb:codex status --check`, whose run module
 *   changed seven times;
 * - `the-pr-above-the-fold-gate-refuses-the` — `slopweaver github vuln body` in free text, whose run module
 *   the fix changed.
 *
 * Re-measure any of them with `git log --since=<askedIso> origin/main -- <path>` against the row's own
 * front matter. The other two stay residue, named rather than discovered: `the-nightly-fleet-import-exits-1-
 * every-night` named only `state:` items, and `token-pass-20-9-of-the-window-s` was answered by a ruling
 * written in canon prose, which no exact reference reaches.
 *
 * ## A hold, never a settlement
 *
 * A commit touching a named file proves the file moved, not that the finding was answered — the same line
 * `./boardEvidence.ts` draws between a probe passing and scope shipping. So this module only takes the row
 * OFF the ready set (`./rowStanding.ts`'s `trunkMoved` arm) and names the commits; a session reads them and
 * either settles the row or records `handover recheck <slug> --still-real "<check>"`, which moves the row's
 * floor past them. A false hold costs one recheck, and a seat on an answered row costs a boot — that ratio is
 * why the criterion may be wide on files and must stay exact on references.
 *
 * Pure: docs, commits and manifest texts in, holds out. `../cli/commands/handover/trunkMovedRead.ts` reads git.
 */

import { pathsOverlap } from "../cmux/baseFreshness.js";
import type { BoardSection } from "./boardTypes.js";
import type { HandoverDoc } from "./doc.js";
import type { EvidenceRefs, PullRef } from "./evidenceRefs.js";

/** One trunk commit, as `git log --name-only` printed it — `paths` is empty when the log named none. */
export interface TrunkCommit {
  readonly sha: string;
  readonly iso: string;
  /** The committer email — `noreply@github.com` when GitHub itself wrote the commit landing a pull request. */
  readonly committer: string;
  readonly subject: string;
  readonly paths: readonly string[];
}

/** One thing a row's evidence names, and the trunk commits after its floor that moved it. */
export interface TrunkMove {
  /** The reference as a reader would recognise it: the path, `verb <noun> <verb>`, or `owner/name#N`. */
  readonly ref: string;
  readonly commits: readonly TrunkCommit[];
}

/** The `owner/name` a checkout's `origin` points at. */
export interface RepoSlug {
  readonly owner: string;
  readonly name: string;
}

/**
 * Whether a composed row is one this hold judges: an unsettled FINDING ask, ready to run, with a checkout.
 *
 * Findings only, and that is a choice rather than a gap. Every measured case was a finding, and an ask the
 * owner made is their own word — holding that on a file having moved is the riskier direction to be wrong in.
 *
 * @param doc the row's own doc
 * @param section the board section it composed to
 * @returns true when the trunk should be read for it
 */
export function isTrunkCheckCandidate({ doc, section }: { doc: HandoverDoc; section: BoardSection }): boolean {
  return (
    section === "RUN NOW" &&
    doc.kind === "ask" &&
    doc.origin === "finding" &&
    doc.settlement === undefined &&
    doc.repo !== undefined
  );
}

/**
 * The first instant whose trunk commits are news to this row, on a whole second because git dates a commit to
 * the second. After a recheck it is the START OF THE NEXT SECOND: the session just re-ran the finding against
 * the trunk, so a commit in its own second is one it saw, and the recheck releases the hold. Before one it is the START OF THE ASK'S OWN SECOND: a commit there may have landed after the
 * ask, and holding is the safe side. The residue of that one-second resolution is a
 * commit landing later in a recheck's own second, which is not read. A recheck WINS outright rather than racing
 * the ask instant — a skewed future `askedIso` must not hide the commits after it.
 *
 * @param doc the row's own doc
 * @returns the floor, or `undefined` when the row carries no readable instant — such a row cannot be judged
 */
export function trunkCheckFloor({ doc }: { doc: HandoverDoc }): string | undefined {
  const readable = (iso: string | undefined): iso is string => iso !== undefined && !Number.isNaN(Date.parse(iso));
  if (readable(doc.trunkRecheckedIso)) {
    return new Date(floorSecondMs({ floorIso: doc.trunkRecheckedIso }) + 1000).toISOString();
  }
  if (readable(doc.askedIso)) {
    return new Date(floorSecondMs({ floorIso: doc.askedIso })).toISOString();
  }
  return undefined;
}

/** The committer email GitHub writes on a commit it made landing a pull request, squash, merge or queue. */
const GITHUB_COMMITTER = "noreply@github.com";

/**
 * The header git prints per commit: a record mark, then fields split by NUL. NUL because a subject or an email
 * may carry any other control character, and one carrying the old U+001F separator dropped its commit.
 */
export const TRUNK_LOG_FORMAT = "%x1e%H%x00%cI%x00%ce%x00%s";

/** The byte each of git's single-letter C escapes stands for. */
const GIT_C_ESCAPES: Readonly<Record<string, number>> = {
  '"': 0x22,
  "\\": 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
};

/**
 * A `--name-only` path line as the path itself. `core.quotePath=false` stops git escaping non-ASCII bytes, but it
 * still C-quotes a path holding `"`, `\` or a control character, octal-escaping any byte it has no letter for — so
 * a quoted line is decoded back to its bytes and read as UTF-8.
 *
 * @param line one path line, trimmed
 * @returns the path git meant
 */
export function unquoteGitPath({ line }: { line: string }): string {
  if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) {
    return line;
  }
  const body = line.slice(1, -1);
  const bytes: Buffer[] = [];
  let at = 0;
  while (at < body.length) {
    const char = body[at]!;
    if (char !== "\\") {
      const codePoint = body.codePointAt(at)!;
      const raw = String.fromCodePoint(codePoint);
      bytes.push(Buffer.from(raw, "utf8"));
      at += raw.length;
      continue;
    }
    const octal = /^[0-7]{3}/u.exec(body.slice(at + 1));
    if (octal !== null) {
      bytes.push(Buffer.from([Number.parseInt(octal[0], 8)]));
      at += 4;
      continue;
    }
    const letter = body[at + 1];
    if (letter === undefined) {
      return line;
    }
    const escaped = GIT_C_ESCAPES[letter];
    if (escaped === undefined) {
      return line;
    }
    bytes.push(Buffer.from([escaped]));
    at += 2;
  }
  return Buffer.concat(bytes).toString("utf8");
}

/**
 * Parse `git log --format=<TRUNK_LOG_FORMAT> [--name-only]` output, line by line. A header is a line OPENING
 * with the record mark: `%s` never spans lines, and git quotes a path holding a control character, so neither a
 * subject nor a path line can open one.
 *
 * @param text the raw log
 * @returns one commit per header, in log order, with the path lines under it; a malformed header is dropped with
 *   its paths
 */
export function parseTrunkLog({ text }: { text: string }): readonly TrunkCommit[] {
  const commits: TrunkCommit[] = [];
  let paths: string[] | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("\u001e")) {
      const [sha, iso, committer, ...subject] = line.slice(1).split("\u0000");
      if (sha === undefined || iso === undefined || committer === undefined || subject.length === 0) {
        paths = undefined;
        continue;
      }
      paths = [];
      commits.push({ committer, iso, paths, sha, subject: subject.join("\u0000") });
      continue;
    }
    const path = line.trim();
    if (paths !== undefined && path.length > 0) {
      paths.push(unquoteGitPath({ line: path }));
    }
  }
  return commits;
}

/**
 * The `owner/name` an `origin` URL names, for either GitHub spelling. The host must be exactly `github.com`, so
 * `evilgithub.com` or a subdomain is another site whose pull numbers are not GitHub's,
 * and `github.com` must BE the host — the URL's first, after an optional scheme and user — never a path segment
 * under another one. Matched case-insensitively, because a scheme and a host are.
 * After a scheme the userinfo may carry a `user:password` colon; the scp
 * form's user may not, since its colon ends the host.
 *
 * @param url `git remote get-url origin`, trimmed
 * @returns the slug, or `undefined` when the URL is not a GitHub repository
 */
export function originSlug({ url }: { url: string }): RepoSlug | undefined {
  const match =
    /^(?:[a-z+]+:\/\/(?:[^@/]+@)?|(?:[^@/:]+@)?)github\.com(?::\d+\/|[:/])([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/iu.exec(
      url.trim(),
    );
  if (match === null) {
    return undefined;
  }
  return { name: match[2]!, owner: match[1]! };
}

/** Whether a pull request names the checkout's own repository. */
function namesOrigin({ pull, origin }: { pull: PullRef; origin: RepoSlug | undefined }): boolean {
  return (
    origin !== undefined &&
    pull.owner.toLowerCase() === origin.owner.toLowerCase() &&
    pull.name.toLowerCase() === origin.name.toLowerCase()
  );
}

/**
 * A floor instant cut to its whole second. Git dates a commit to the second while a floor carries milliseconds,
 * so a commit made later in the floor's own second would read as before it and hold nothing. A commit IN that second counts as after the floor, the side that holds rather than offers.
 *
 * @returns the floor's second, in epoch milliseconds
 */
export function floorSecondMs({ floorIso }: { floorIso: string }): number {
  return Math.floor(Date.parse(floorIso) / 1000) * 1000;
}

/** The commits in or after the floor's second, deduplicated by sha, in log order. */
function afterFloor({
  commits,
  floorIso,
}: {
  commits: readonly TrunkCommit[];
  floorIso: string;
}): readonly TrunkCommit[] {
  const floor = floorSecondMs({ floorIso });
  const seen = new Set<string>();
  return commits.filter((commit) => {
    if (seen.has(commit.sha) || !(Date.parse(commit.iso) >= floor)) {
      return false;
    }
    seen.add(commit.sha);
    return true;
  });
}

/**
 * What the trunk moved, of everything a row's evidence names, after the row's floor.
 *
 * @param refs what the row's evidence names (`./evidenceRefs.ts`)
 * @param verbModules each named verb's run module, keyed `<noun> <verb>`, holding only the verbs that resolved
 * @param floorIso the row's {@link trunkCheckFloor}
 * @param commits the trunk commits the read returned — path-bearing ones for files, subjects for pull requests
 * @param origin the checkout's own `owner/name`, or `undefined` when it could not be read
 * @param unseen the commits the trunk carries that the row's recheck tip did not, when it recorded one and git
 *   could list them: a commit outside it was already seen, so it holds nothing whatever date it carries — a
 *   future-dated one otherwise sat after every recheck instant and no recheck released the row
 * @returns one move per reference the trunk changed, empty when nothing it names moved
 */
export function trunkMovesFor({
  refs,
  verbModules,
  floorIso,
  commits,
  origin,
  unseen,
}: {
  refs: EvidenceRefs;
  verbModules: ReadonlyMap<string, string>;
  floorIso: string;
  commits: readonly TrunkCommit[];
  origin: RepoSlug | undefined;
  unseen?: ReadonlySet<string> | undefined;
}): readonly TrunkMove[] {
  const dated = afterFloor({ commits, floorIso });
  const recent = unseen === undefined ? dated : dated.filter((commit) => unseen.has(commit.sha));
  const touching = ({ path }: { path: string }): readonly TrunkCommit[] =>
    recent.filter((commit) => commit.paths.some((changed) => pathsOverlap({ changed, docPath: path })));
  const moves: TrunkMove[] = [];
  for (const path of refs.paths) {
    moves.push({ commits: touching({ path }), ref: path });
  }
  for (const verb of refs.verbs) {
    const module = verbModules.get(`${verb.noun} ${verb.verb}`);
    if (module !== undefined) {
      moves.push({ commits: touching({ path: module }), ref: `verb ${verb.noun} ${verb.verb} (${module})` });
    }
  }
  for (const pull of refs.pulls.filter((candidate) => namesOrigin({ origin, pull: candidate }))) {
    // A squash subject ends `(#N)`; GitHub's merge-commit subject opens `Merge pull request #N from `.
    // Either counts only when GitHub COMMITTED it: a direct push with a hand-written `(#N)`
    // subject is not #N landing. MEASURED over every one of 400
    // slopweaver and 1000 acme-admin trunk commits — `git log origin/main -400 --format=%ce | sort | uniq -c`.
    // RESIDUE: the committer field is unauthenticated, so a commit FORGING that email and
    // pushed straight to a protected trunk still reads as #N landing. Only GitHub's web-flow signature proves
    // more, and verifying it needs gpg and GitHub's key on every machine; the cost of a forged hold is one row
    // held with its commit printed, which `handover recheck` releases.
    const suffix = `(#${String(pull.number)})`;
    const mergePrefix = `Merge pull request #${String(pull.number)} from `;
    moves.push({
      commits: recent.filter(
        (commit) =>
          commit.committer === GITHUB_COMMITTER &&
          (commit.subject.trimEnd().endsWith(suffix) || commit.subject.startsWith(mergePrefix)),
      ),
      ref: `${pull.owner}/${pull.name}#${String(pull.number)}`,
    });
  }
  return moves.filter((move) => move.commits.length > 0);
}

/** One held row: its slug, for a reader, and what moved under it. */
export interface TrunkHeldRow {
  readonly slug: string;
  readonly moves: readonly TrunkMove[];
}

/** How many commits a held row's line names per reference before it says how many more. */
const COMMITS_SHOWN = 2;

/**
 * One held row as a reader sees it: the slug, then each reference and the commits that moved it.
 *
 * @param slug the held row
 * @param moves what {@link trunkMovesFor} found for it
 * @returns the line, with no trailing newline
 */
function trunkMovedRowLine({ slug, moves }: { slug: string; moves: readonly TrunkMove[] }): string {
  const parts = moves.map((move) => {
    const shown = move.commits.slice(0, COMMITS_SHOWN).map((commit) => `${commit.sha.slice(0, 10)} ${commit.subject}`);
    const more = move.commits.length > COMMITS_SHOWN ? ` +${String(move.commits.length - COMMITS_SHOWN)} more` : "";
    return `${move.ref}: ${shown.join("; ")}${more}`;
  });
  return `  ${slug} — ${parts.join(" | ")}`;
}

/**
 * The lines that say what the trunk-moved hold did, so it is never a silent drop in the ready count.
 *
 * @param held each held row's slug and moves, by doc path
 * @param unread each checkout whose trunk could not be read, with why and the rows offered unchecked
 * @param pullsUnchecked each readable checkout whose cited pull requests could not be checked — its origin names
 *   no GitHub repository or did not read, or its trunk subjects did not — with why and the rows whose paths and
 *   verbs were still checked
 * @param maxRows how many held rows to name before counting the rest, or `undefined` to name every one — the header
 *   always carries the whole count either way
 * @returns zero or more lines
 */
export function trunkMovedLines({
  held,
  unread,
  pullsUnchecked,
  maxRows,
}: {
  held: ReadonlyMap<string, TrunkHeldRow>;
  unread: readonly { readonly repo: string; readonly why: string; readonly slugs: readonly string[] }[];
  pullsUnchecked: readonly { readonly repo: string; readonly why: string; readonly slugs: readonly string[] }[];
  maxRows: number | undefined;
}): readonly string[] {
  const lines: string[] = [];
  if (held.size > 0) {
    lines.push(
      `(${String(held.size)} ready finding row(s) held — the trunk changed what their evidence names since they ` +
        "were asked. Read the commits: settle a row they answered, or `slopweaver handover recheck <slug> " +
        '--still-real "<what you re-ran>"` to offer it again.)',
    );
    const rows = [...held.values()].toSorted((a, b) => a.slug.localeCompare(b.slug));
    const named = maxRows === undefined ? rows : rows.slice(0, maxRows);
    for (const row of named) {
      lines.push(trunkMovedRowLine({ moves: row.moves, slug: row.slug }));
    }
    if (named.length < rows.length) {
      lines.push(`  … and ${String(rows.length - named.length)} more (--full or --json for all of them)`);
    }
  }
  for (const gap of unread) {
    lines.push(
      `(the trunk of ${gap.repo} could not be read — ${gap.why} — so ${String(gap.slugs.length)} ready finding ` +
        "row(s) there are offered without the trunk-moved check.)",
    );
  }
  for (const gap of pullsUnchecked) {
    lines.push(
      `(the pull requests ${String(gap.slugs.length)} ready finding row(s) in ${gap.repo} cite were not checked — ` +
        `${gap.why} — but their paths and verbs were.)`,
    );
  }
  return lines;
}
