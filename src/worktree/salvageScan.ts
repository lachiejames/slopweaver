/**
 * The secrets scan a salvage runs over exactly what its push would send — in place of the salvaged tree's own
 * `pre-push` hook.
 *
 * ## Why the tree's own hook was the wrong gate
 *
 * A salvage reaches trees over a week old, and their `pre-push` hook is the hook as it stood a week ago:
 * lefthook reads the TREE's `lefthook.yml`, which runs the tree's own `yarn validate:local` with the tree's
 * own code. MEASURED on the first salvage of that night's `worktree prune --apply --budget 240m`:
 * one supervisor chair's tree spent about eight minutes inside that hook — the whole `dev lint`, from
 * before the lane was narrowed — and then went red on a `.oxlintrc.jsonc` its pinned oxlint no longer
 * accepted. The tree was KEPT, correctly, and so would every one of the 32 slopweaver trees behind it have
 * been: a class whose every member costs eight minutes and then fails spends a fifteen-minute nightly budget
 * on two trees and reclaims nothing. The witness is the run's own log —
 * `grep -n "pre-push gate\|KEPT" <apply log>`.
 *
 * ## What the hook was FOR, and what this keeps of it
 *
 * `lefthook.yml` says it in capitals: that hook is a SECRETS SCAN and a working-tree check. The working-tree
 * check stays where it was, in `pushAndVerify`'s `refuseDirtyWorkingTree`. The secrets half is this file:
 *
 *  - **Today's scanner, not the tree's.** `scanContent` and `isSecretHit` are this build's, with this
 *    machine's private denylist, so a pattern added yesterday applies to a tree cut last week.
 *  - **Every blob the destination's default branch does not already carry, never a rendered diff.** `git log -p` was the
 *    first design and a Codex pre-mortem broke it twice against real git: a merge
 *    commit whose conflict resolution wrote a key renders no patch at all, and a file marked `-diff` renders
 *    as `Binary files … differ`. `rev-list --objects` walks OBJECTS, so a merge resolution, a `-diff` file and
 *    a secret added in one commit and deleted in the next are each a blob it lists.
 *  - **Against the destination's DEFAULT branch alone, read from the URL the push goes to.** Every other
 *    boundary Codex tried broke against real git. `--not --remotes` drops a commit some OTHER remote carries.
 * A local tracking ref still hides a branch deleted on the remote.
 * A live `ls-remote` of every ref still hides one deleted between the scan and the push.
 * And `ls-remote <name>` asks `remote.<name>.url` while the push goes to `pushurl`
 * — and a remote may carry several push urls, every one of which the push reaches while the
 *    scan read one, or be re-pointed between the scan and the push. So
 *    `./salvagePush` resolves ONE literal url before the scan — a remote whose one push url is not its fetch
 *    url, or whose url names no ssh or https host a key or certificate binds, declines outright — and the scan, the push and its read-back all name that url. The default branch is protected on both
 *    repositories and only moves forward, so a commit
 *    it carried at scan time is still carried when the push lands. Everything any other branch carries is
 *    scanned, which costs a longer scan and never a missed blob. The residues, stated: a force-push over the
 *    protected default branch inside that window, and the hosted repository deleted, transferred or
 *    recreated at the same path inside it — each needs an admin of the destination repository.
 *  - **The sha, not the name.** The scan reads one commit and the push sends that same commit
 *    (`./salvagePush`'s `salvagePushArgs`), so nothing that moves HEAD in between is ever sent.
 *  - **The graph the push sends, not a substituted one.** Every read runs `--no-replace-objects`: a local
 *    `refs/replace/*` makes `rev-list` and `cat-file` answer a clean stand-in while the push publishes the
 *    original. And the push carries `--recurse-submodules=no`, because a submodule's objects are
 *    in a database this scan never opens, and `--no-follow-tags`, because a tag's message is
 *    not a blob either.
 *  - **Names, headers and messages, not only bodies.** A file NAMED like a token, a clean file renamed to one
 *    and the salvage branch name built from the tree's own name are all published and none is inside a blob,
 * so the scan also reads `git log -z -r --raw --no-abbrev --root --no-renames --diff-merges=separate` over
 *    the same range, and the branch name itself. `-z` is what makes those the bytes the push sends: without it
 *    git C-quotes a name holding a backslash or a quote, `core.quotePath=false` or not, so `a\b` was scanned
 *    as `"a\\b"`. A commit's author, committer, signature and message are in the
 *    commit OBJECT, so every commit in the range is read raw beside the blobs.
 *  - **Every path a blob is published at, not the first.** `rev-list --objects` names an object once, at the first
 *    path its walk meets, and the repository-content scanner forgives by path. So the raw walk above also maps each
 *    blob a range commit writes to every path it writes it at (`./salvageMetadata`), and the identifier scan judges
 *    each copy at its own path. That includes a blob the destination's default branch already reaches, which the
 *    listing leaves out: written at a new path, it is read for that judgement alone. A secret is scanned once per
 *    LISTED object, since that scanner reads no path — a blob the default branch reaches is not secret-scanned,
 *    because its bytes are already published there. A walk that does not parse declines rather than leave a copy
 *    unjudged, and a submodule entry declines on its own line.
 *  - **The repository gate's identifier verdict too.** The destination is the public repository, so a forbidden
 *    identifier that gate would refuse wherever `IDENTIFIER_VERDICT` reads `refuse` declines here as well: an
 *    uncommitted file naming an organisation is otherwise published by the push that preserves it.
 *
 * What it does NOT keep is the rest of `validate:local` — corpus hygiene, the handover register, the secrets
 * registry and the card voice. None of those reads a byte this push sends, so a salvage no longer waits on
 * this machine's private state being healthy to preserve somebody's work. That narrowing is the point.
 *
 * A secret or identifier refusal names the class and the path, never the matched text, and withholds a path that
 * itself matches either scanner — `./salvageFindings` judges the texts this file reads and words the line; a refusal
 * to LOOK names what could not be read, an identifier scanner that threw included. Neither quotes content — a decline line is printed
 * to a terminal and a slot log, and quoting the secret there would be the leak this exists to stop. Git's own
 * failure messages quote their argv, url included, so `./salvagePush`'s `withheldIfSecret` masks a url's
 * userinfo and withholds any reason still matching a credential.
 */
import { execFileSync } from "node:child_process";

import { transportGitEnv } from "../admit/gitTransport.js";
import type { IdentifierScanner } from "../hygiene/identifierScan.js";
import type { Hit, LineListLoad } from "../hygiene/scan.js";
import { GIT_MAX_BUFFER } from "./pruneGit.js";
import { parseCatFileObjects } from "./salvageCatFile.js";
import {
  blobSecretHits,
  identifierDecline,
  identifierHitsOrDecline,
  type SalvageIdentifierHit,
  type SalvageText,
  secretDecline,
} from "./salvageFindings.js";
import { HOOKS_OFF } from "./salvageHooksOff.js";
import { METADATA_LOG, parseSalvageMetadata } from "./salvageMetadata.js";

/** One blob or commit the scan reads, and what it is reachable as — the path is for the report only. */
export interface SalvageBlob {
  readonly sha: string;
  readonly path: string;
  /** A commit object, which `rev-list` prints with no path: its headers carry a person on every commit. */
  readonly commit: boolean;
}

/** How many blobs one `cat-file --batch` is asked for, so one answer stays well inside {@link GIT_MAX_BUFFER}. */
const BLOB_BATCH = 200;

/** How long one git read may take before the scan declines rather than holding the run. */
const GIT_READ_TIMEOUT_MS = 120_000;

/** A full object name at the start of a `rev-list --objects` line, SHA-1 or SHA-256. */
const OBJECT_LINE = /^([0-9a-f]{40}|[0-9a-f]{64})(?: (.*))?$/;

/** What a commit object's hits are attributed to, since a commit has no path. */
const COMMIT_OBJECT = "a commit's headers or message";

/**
 * Every tip an `ls-remote` answer names — what the destination carries, and so what the push need not scan.
 *
 * Pure. A peeled tag line (`<sha>\t<ref>^{}`) names a commit the tag reaches and is kept like any other.
 *
 * @param listing the command's stdout
 * @returns each tip once
 */
export function remoteTips({ listing }: { listing: string }): readonly string[] {
  const tips = new Set<string>();
  for (const line of listing.split("\n")) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t/.exec(line);
    if (match !== null) {
      tips.add(match[1]!);
    }
  }
  return [...tips];
}

/**
 * The `rev-list --stdin` input for "every object `sha` reaches that no tip reaches" — one revision a line,
 * so a remote with thousands of refs never meets an argv limit.
 *
 * @param sha the commit about to be pushed
 * @param tips what the destination carries
 * @returns the stdin text
 */
export function revListInput({ sha, tips }: { sha: string; tips: readonly string[] }): string {
  return [sha, ...tips.map((tip) => `^${tip}`), ""].join("\n");
}

/**
 * The objects in a `rev-list --objects --filter=object:type=blob` listing whose bytes the scan reads.
 *
 * Pure. A blob prints as `<name> <path>`; a commit prints as a bare name and is KEPT, because its raw bytes
 * carry an author, a committer, a signature and a message, all published and none inside a blob.
 * A path carrying a newline splits across lines. The blob is still found by its own line, so the attribution is
 * shortened, never the scan; a tail that itself reads as an object line only adds an object to read, which git then
 * answers or the scan declines.
 *
 * @param listing the command's stdout
 * @returns each object once, in listing order
 */
export function newBlobsIn({ listing }: { listing: string }): readonly SalvageBlob[] {
  const seen = new Set<string>();
  const blobs: SalvageBlob[] = [];
  for (const line of listing.split("\n")) {
    const match = OBJECT_LINE.exec(line);
    if (match === null || seen.has(match[1]!)) {
      continue;
    }
    seen.add(match[1]!);
    const [, sha, path] = match;
    blobs.push(
      path === undefined ? { commit: true, path: COMMIT_OBJECT, sha: sha! } : { commit: false, path, sha: sha! },
    );
  }
  return blobs;
}

/** The git reads the scan needs, injected so the decisions below are provable against a literal answer. */
export interface SalvageScanEdges {
  /** Every blob and commit the pushed sha reaches that no destination tip does, as `rev-list` lists them. */
  readonly listBlobs: () => string;
  /**
   * Every changed path over the same range with the blob each writes, as `git log -z --raw --no-abbrev` prints
   * them, NUL-separated and never quoted. A path is published by the push just as a blob is, and it is inside no
   * blob and no commit object; the blob beside it is what lets a blob be judged at every path it is published at.
   */
  readonly listMetadata: () => string;
  /** `cat-file --batch` over the named objects; throws on failure. */
  readonly readBlobs: (args: { shas: readonly string[] }) => Buffer;
}

/** One object's text as read, still carrying its name, so its other published paths can be found. */
interface ReadSalvageText extends SalvageText {
  readonly sha: string;
}

/**
 * Read one batch of blobs as text, or say why the scan cannot go on. An object answered as another kind than asked
 * for — anything but a commit for a commit, anything but a blob for a blob — declines like a missing one, since its
 * bytes are not the ones the push sends under that name.
 *
 * @param edges the git reads
 * @param batch the blobs to read
 * @returns each blob's name, report path and text, or the decline reason
 */
function readBatch({
  edges,
  batch,
}: {
  edges: SalvageScanEdges;
  batch: readonly SalvageBlob[];
}): readonly ReadSalvageText[] | string {
  let output: Buffer;
  try {
    output = edges.readBlobs({ shas: batch.map((blob) => blob.sha) });
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : "git could not be asked";
    return `what it would push could not be read for the secrets scan — ${why}; nothing was pushed`;
  }
  const contents = parseCatFileObjects({ output });
  const answered = (blob: SalvageBlob): boolean => contents?.get(blob.sha)?.type === (blob.commit ? "commit" : "blob");
  if (contents === null || !batch.every(answered)) {
    return "git did not answer every object the push would send, so they went unscanned — nothing was pushed";
  }
  return batch.map((blob) => ({
    commit: blob.commit,
    content: contents.get(blob.sha)!.content.toString("utf8"),
    path: blob.path,
    sha: blob.sha,
  }));
}

/**
 * Every blob a range commit writes that the listing does not name — one the destination's DEFAULT branch already
 * reaches, since that branch's tip (`ls-remote <url> HEAD`) is the one revision the listing negates. Its bytes are
 * already published there, but a path it is written at may not be, and the identifier scanner forgives by path, so
 * each is read and judged at every path the range writes it at.
 *
 * Pure. The difference decides what must be READ, never what may be trusted: a blob it names that git then cannot
 * answer declines like any other. The report path is the first path written, which {@link textsAtEveryPath} joins
 * with the rest, so every path judged comes from the raw walk.
 *
 * @param blobs the objects the listing named
 * @param pathsByBlob every path each blob a range commit writes is written at
 * @returns each unlisted written blob once, in walk order
 */
function unlistedWrittenBlobs({
  blobs,
  pathsByBlob,
}: {
  blobs: readonly SalvageBlob[];
  pathsByBlob: ReadonlyMap<string, readonly string[]>;
}): readonly SalvageBlob[] {
  const listed = new Set(blobs.map((blob) => blob.sha));
  return [...pathsByBlob]
    .filter(([sha]) => !listed.has(sha))
    .map(([sha, written]) => ({ commit: false, path: written[0]!, sha }));
}

/**
 * Each blob once per distinct path it is published at — the path `rev-list` named it under and every path a commit
 * in the range writes it at — so a scanner that forgives by path judges every copy at its own. A commit stays one.
 *
 * Pure. The content is shared, never re-read.
 *
 * @param read the batch as read
 * @param pathsByBlob every path each blob a range commit writes is written at
 * @returns the texts the identifier scan reads
 */
function textsAtEveryPath({
  read,
  pathsByBlob,
}: {
  read: readonly ReadSalvageText[];
  pathsByBlob: ReadonlyMap<string, readonly string[]>;
}): readonly SalvageText[] {
  return read.flatMap((text) => {
    const written = pathsByBlob.get(text.sha);
    if (text.commit || written === undefined) {
      return [text];
    }
    return [...new Set([text.path, ...written])].map((path) => ({ ...text, path }));
  });
}

/**
 * Scan what a salvage's push would send, answering why it must not, or `null` when it may.
 *
 * Every failure to LOOK declines — the rule the prune applies to every fact it could not read. A listing git
 * would not produce, a blob it would not return and a denylist that exists but cannot be read are each a scan
 * that did not happen, and pushing on one would be pushing unscanned. A secret declines first; a forbidden
 * identifier the repository gate would refuse declines next, by `./salvageFindings`' `identifierHitsOrDecline`.
 *
 * @param edges the git reads, real or scripted
 * @param denylist the private denylist's load outcome, read once per run by the caller
 * @param identifiers the repository-content identifier scanner, built once per run by the caller
 * @param refName the salvage branch the push creates, which is published too and is built from the tree's name
 * @returns the decline reason, or `null` when nothing refused leaves
 */
export function salvageScanDecline({
  edges,
  denylist,
  identifiers,
  refName,
}: {
  edges: SalvageScanEdges;
  denylist: LineListLoad;
  identifiers: IdentifierScanner;
  refName: string;
}): string | null {
  if (denylist.kind === "unreadable") {
    return `the private denylist at ${denylist.path} could not be read (${denylist.reason}), so what it would push went unscanned — nothing was pushed`;
  }
  let listing: string;
  try {
    listing = edges.listBlobs();
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : "git could not be asked";
    return `what it would push could not be listed for the secrets scan — ${why}; nothing was pushed`;
  }
  const words = denylist.kind === "loaded" ? denylist.lines : [];
  let raw: string;
  try {
    raw = edges.listMetadata();
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : "git could not be asked";
    return `the paths it would push could not be listed for the secrets scan — ${why}; nothing was pushed`;
  }
  const metadata = parseSalvageMetadata({ output: raw });
  if (typeof metadata === "string") {
    return metadata;
  }
  const names: readonly SalvageText[] = [
    { commit: false, content: refName, path: "the salvage branch name" },
    { commit: false, content: metadata.changedPaths, path: "the changed paths" },
  ];
  return contentDecline({
    blobs: newBlobsIn({ listing }),
    edges,
    identifiers,
    names,
    pathsByBlob: metadata.pathsByBlob,
    words,
  });
}

/**
 * Read every blob in batches and scan it, with the published names, for a secret first and a forbidden identifier next.
 *
 * A secret is scanned once per LISTED object — every one the destination's default branch does not reach, whatever
 * other destination ref carries it — since that scanner reads no path; an identifier
 * once per path the object is published at, since the repository-content scanner forgives by path. A blob a range
 * commit writes that the destination's default branch already reaches is read too, for its identifiers alone and
 * never for a secret: its bytes are on that protected, forward-only branch already, and only a path it is newly
 * written at is new.
 *
 * @param blobs the blobs the push would send
 * @param edges the git reads
 * @param identifiers the repository-content identifier scanner
 * @param names the texts published without being inside any blob: the branch name and the changed paths
 * @param pathsByBlob every path each blob a range commit writes is written at, from the raw metadata walk
 * @param words the private denylist's lines
 * @returns the decline reason, or `null` when nothing refused leaves
 */
function contentDecline({
  blobs,
  edges,
  identifiers,
  names,
  pathsByBlob,
  words,
}: {
  blobs: readonly SalvageBlob[];
  edges: SalvageScanEdges;
  identifiers: IdentifierScanner;
  names: readonly SalvageText[];
  pathsByBlob: ReadonlyMap<string, readonly string[]>;
  words: readonly string[];
}): string | null {
  const hits: Hit[] = blobSecretHits({ blobs: names, denylist: words }).slice();
  const first = identifierHitsOrDecline({ identifiers, texts: names });
  if (typeof first === "string") {
    return first;
  }
  const named: SalvageIdentifierHit[] = first.slice();
  for (let start = 0; start < blobs.length; start += BLOB_BATCH) {
    const read = readBatch({ batch: blobs.slice(start, start + BLOB_BATCH), edges });
    if (typeof read === "string") {
      return read;
    }
    const more = identifierHitsOrDecline({ identifiers, texts: textsAtEveryPath({ pathsByBlob, read }) });
    if (typeof more === "string") {
      return more;
    }
    hits.push(...blobSecretHits({ blobs: read, denylist: words }));
    named.push(...more);
  }
  const held = heldIdentifierHits({
    edges,
    held: unlistedWrittenBlobs({ blobs, pathsByBlob }),
    identifiers,
    pathsByBlob,
  });
  if (typeof held === "string") {
    return held;
  }
  named.push(...held);
  if (hits.length > 0) {
    return secretDecline({ denylist: words, hits, identifiers });
  }
  return named.length > 0 ? identifierDecline({ denylist: words, hits: named, identifiers }) : null;
}

/**
 * Read every written blob the listing left out in batches and judge its identifiers at each path the range writes it
 * at — never its secrets, whose bytes the destination's default branch already publishes.
 *
 * @param edges the git reads
 * @param held the blobs from {@link unlistedWrittenBlobs}
 * @param identifiers the repository-content identifier scanner
 * @param pathsByBlob every path each blob a range commit writes is written at
 * @returns the refused identifier hits, or the decline reason when a read or the scanner failed
 */
function heldIdentifierHits({
  edges,
  held,
  identifiers,
  pathsByBlob,
}: {
  edges: SalvageScanEdges;
  held: readonly SalvageBlob[];
  identifiers: IdentifierScanner;
  pathsByBlob: ReadonlyMap<string, readonly string[]>;
}): readonly SalvageIdentifierHit[] | string {
  const named: SalvageIdentifierHit[] = [];
  for (let start = 0; start < held.length; start += BLOB_BATCH) {
    const read = readBatch({ batch: held.slice(start, start + BLOB_BATCH), edges });
    if (typeof read === "string") {
      return read;
    }
    const more = identifierHitsOrDecline({ identifiers, texts: textsAtEveryPath({ pathsByBlob, read }) });
    if (typeof more === "string") {
      return more;
    }
    named.push(...more);
  }
  return named;
}

/**
 * The real git reads, run in the salvaged worktree with every hook and monitor off.
 *
 * Listing asks the url the push goes to for its default branch (`ls-remote <url> HEAD`), fetches
 * that branch's objects without writing a ref, then walks from the pushed sha with that tip negated.
 * `--ignore-missing` drops a tip still absent after the fetch — the walk then reaches further and scans more,
 * never less.
 *
 * @param cwd the worktree the push goes from
 * @param url the one literal url the push goes to, resolved by the caller before the scan
 * @param sha the exact commit the push will send
 * @returns the two edges
 */
export function gitSalvageEdges({ cwd, url, sha }: { cwd: string; url: string; sha: string }): SalvageScanEdges {
  const options = {
    cwd,
    // The push's own environment, never `gitEnv()`: that keeps `GIT_CONFIG_*`, which could rewrite the url
    // this reads and not the one the push sends to.
    env: transportGitEnv(),
    maxBuffer: GIT_MAX_BUFFER,
    stdio: "pipe" as const,
    timeout: GIT_READ_TIMEOUT_MS,
  };
  const git = ({ args }: { args: readonly string[] }): string =>
    execFileSync("git", [...HOOKS_OFF, ...args], { ...options, encoding: "utf8" });
  // Asked once and shared, so the blobs and the metadata are read over ONE range.
  let tips: readonly string[] | null = null;
  const destinationTips = (): readonly string[] => {
    if (tips === null) {
      tips = remoteTips({ listing: git({ args: ["ls-remote", url, "HEAD"] }) });
      if (tips.length > 0) {
        git({ args: ["fetch", "--quiet", "--no-write-fetch-head", "--no-auto-maintenance", url, "HEAD"] });
      }
    }
    return tips;
  };
  return {
    // Two walks over one range: the blob filter drops every commit but the tip it was handed (reproduced), so every commit is listed by a walk of its own, one bare name a line.
    listBlobs: () =>
      [["--objects", "--filter=object:type=blob"], []]
        .map((walk) =>
          execFileSync(
            "git",
            [...HOOKS_OFF, "--no-replace-objects", "rev-list", ...walk, "--ignore-missing", "--stdin"],
            { ...options, encoding: "utf8", input: revListInput({ sha, tips: destinationTips() }) },
          ),
        )
        .join("\n"),
    listMetadata: () =>
      execFileSync("git", [...HOOKS_OFF, ...METADATA_LOG], {
        ...options,
        encoding: "utf8",
        input: revListInput({ sha, tips: destinationTips() }),
      }),
    readBlobs: ({ shas }) =>
      execFileSync("git", [...HOOKS_OFF, "--no-replace-objects", "cat-file", "--batch"], {
        ...options,
        input: `${shas.join("\n")}\n`,
      }),
  };
}
