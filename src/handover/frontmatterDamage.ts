/**
 * The read-back `editFrontMatterFields` (`./frontmatter.ts`) owes before anything is written: what the edit changed
 * that its caller did not ask it to change.
 *
 * Its own module so the check never shares a line-ownership rule with the rewrite it audits — a rewrite one line out
 * and a check reading lines the same wrong way would agree with each other and pass the loss.
 *
 * Pure: front-matter lines in, refusal sentences out.
 */

import { flatFields, isFrontMatterComment } from "./docFlat.js";
import { isTopLevelKey } from "./docNested.js";
import { announcesBlock } from "./flatScalarCodec.js";

/**
 * What this edit changed that its caller did not ask it to change — empty when the rewrite was surgical.
 *
 * The read-back a destructive path owes, and it is destructive: `editFrontMatterFields` is the only code in the repo
 * that REWRITES a line of someone's front-matter, `handover pause` runs it on rows people wrote by hand, and the
 * board it runs against has no restore — the one off-machine copy of `$SLOPWEAVER_HOME` is a git snapshot
 * holding 190 of 1,580 handover files, with thousands of changes uncommitted since (measured; check it with
 * `git -C ~/.slopweaver log -1 --format=%cs && git -C ~/.slopweaver status --porcelain | wc -l`). The failure being
 * caught is a continuation-boundary that is one line out: authored text disappears, the doc still parses, and nobody
 * notices until the row is read months later.
 *
 * **It compares only what the caller did NOT ask about, and that boundary is the whole design.** Refusing on the
 * re-read doc's problems outright was tried first and was wrong: it rejected `set: [{ status: "paused" }]` on its
 * own, because a paused row owes a `pausedOn:` — a doc the caller is composing across two writes is not corruption,
 * and judging the caller's own values is `./paused.ts`'s job rather than this function's. What remains is what a
 * mis-spliced line actually produces: a key that now appears twice, a comment that is gone, a key the caller
 * never named whose value moved, and an asked key the reader cannot find where it was asked to be.
 *
 * **Every flat key, and every comment.** A fixed list of parsed fields would let
 * a loss under `askedIso:` or `registeredBy:` pass, and a deleted `#` line — no field at all — always.
 * So it compares every key {@link flatFields} reads, as raw folded text, and the
 * comment lines as a multiset, so one surviving copy of a line written twice does not answer for the other.
 *
 * @param slug the row's slug, which each reason names
 * @param before the front-matter's lines as they were
 * @param after the front-matter's lines as the edit would write them
 * @param set the keys the edit was asked to write
 * @param remove the keys the edit was asked to delete
 * @returns one reason per thing the edit changed without being asked to, empty when there are none
 */
export function collateralDamage({
  slug,
  before,
  after,
  set,
  remove,
}: {
  slug: string;
  before: readonly string[];
  after: readonly string[];
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
}): readonly string[] {
  const duplicated = duplicateKeys({ lines: after });
  if (duplicated.length > 0) {
    return duplicated.map(
      (key) => `editing ${slug} would leave "${key}" declared twice, which takes the row off the board`,
    );
  }
  const lost = missingComments({ after, before }).map(
    (line) =>
      `editing ${slug} would also lose the front-matter comment "${line}", which was not in the edit — refusing rather than losing authored text`,
  );
  const asked = new Set<string>([...set.map((field) => field.key), ...remove]);
  const was = flatFields({ lines: before }).fields;
  const now = flatFields({ lines: after }).fields;
  const changed = [...new Set([...was.keys(), ...now.keys()])]
    .filter((key) => !asked.has(key) && was.get(key) !== now.get(key))
    .map(
      (key) =>
        `editing ${slug} would also change "${key}", which was not in the edit — refusing rather than losing authored text`,
    );
  return [...lost, ...changed, ...unreadAsks({ now, remove, set, slug })];
}

/**
 * The asked keys the reader would not read back as asked: a written key it cannot see, or a removed key it still
 * sees. Every other check skips an asked key, so this is the one that would catch a nested value whose own `---`
 * line closes the front matter early and hides a written flat key behind it.
 * `editFrontMatterFields` refuses that value before writing it; this read-back holds independently of that refusal.
 */
function unreadAsks({
  slug,
  now,
  set,
  remove,
}: {
  slug: string;
  now: ReadonlyMap<string, string>;
  set: readonly { readonly key: string }[];
  remove: readonly string[];
}): readonly string[] {
  const unseen = set
    .filter((field) => !now.has(field.key))
    .map((field) => `editing ${slug} would write "${field.key}" where the reader cannot see it — refusing`);
  const lingering = remove
    .filter((key) => now.has(key))
    .map((key) => `editing ${slug} would remove "${key}" and the reader would still read one — refusing`);
  return [...unseen, ...lingering];
}

/**
 * The top-level key a front-matter line declares, spelled as the reader reads it — the name before the colon, any
 * whitespace between them dropped — or `undefined` for a line that declares none.
 *
 * @returns the key's name, or `undefined`
 */
export function declaredKey({ line }: { line: string }): string | undefined {
  return /^([A-Za-z_][\w-]*)\s*:/u.exec(line)?.[1];
}

/** Every top-level key a front-matter block declares more than once, in the order they first appear. */
function duplicateKeys({ lines }: { lines: readonly string[] }): readonly string[] {
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const line of lines) {
    const key = declaredKey({ line });
    if (key === undefined) {
      continue;
    }
    if (seen.has(key) && !twice.includes(key)) {
      twice.push(key);
    }
    seen.add(key);
  }
  return twice;
}

/**
 * The old comment lines the new front-matter no longer carries, one per lost occurrence.
 *
 * Counted, not matched as a set: a provenance note written twice that survives once has still lost a line.
 */
function missingComments({
  before,
  after,
}: {
  before: readonly string[];
  after: readonly string[];
}): readonly string[] {
  const remaining = [...frontMatterComments({ lines: after })];
  return frontMatterComments({ lines: before }).filter((line) => {
    const at = remaining.indexOf(line);
    if (at === -1) {
      return true;
    }
    remaining.splice(at, 1);
    return false;
  });
}

/**
 * The comment lines of a front-matter block, read in order so an indented `#` inside a `>`/`|` block counts as the
 * block's text rather than a comment — the reader's own rule, {@link isFrontMatterComment}.
 */
function frontMatterComments({ lines }: { lines: readonly string[] }): readonly string[] {
  const comments: string[] = [];
  let block = false;
  for (const line of lines) {
    if (isTopLevelKey({ line })) {
      block = announcesBlock({ own: line.slice(line.indexOf(":") + 1).trim() });
      continue;
    }
    if (isFrontMatterComment({ block, line })) {
      comments.push(line);
    }
  }
  return comments;
}
