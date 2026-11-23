/**
 * A Renovate update title taken apart — what it bumps and the version it bumps it to — so `github bump-drive`'s
 * `renovate-merged` arm (`./bumpSupersede.ts`) can tell one merged Renovate update covers an open bump of the owner's.
 *
 * Pure: a title in, its parts out.
 */

/** A Renovate update title taken apart: what it bumps, and the `to <target>` it bumps it to when it names one. */
export interface RenovateTitleParts {
  readonly subject: string;
  /** The token after `to`, verbatim (`v3.0.124`, `^0.13.0`, a digest), or absent for a group with no target. */
  readonly target: string | undefined;
}

/**
 * The head of a Renovate update title, in the shape its `config:recommended` preset writes: a conventional-commit
 * type with a `deps` scope, then `update`. What follows is the subject and its suffixes, which
 * {@link renovateTitleParts} peels off with plain string checks — one regular expression spanning the whole title
 * backtracked polynomially (`redos-check`).
 */
const RENOVATE_HEAD = /^[a-z]+\(deps\): update /i;

/**
 * A Renovate update title taken apart: the text after `update` and an optional `dependency`, less any trailing
 * `[security]`-style tags, a `(major)`-style note and a `to <version>`, peeled in that order from the end.
 *
 * @param title the pull request's title, exactly as Renovate wrote it
 * @returns the subject and target, or `undefined` when the title is not an update Renovate wrote (lock file
 *   maintenance, a pin, a hand-written title)
 */
export function renovateTitleParts({ title }: { title: string }): RenovateTitleParts | undefined {
  const spaced = title.trim().split(/\s+/).join(" ");
  const head = RENOVATE_HEAD.exec(spaced);
  if (head === null) {
    return undefined;
  }
  let rest = spaced.slice(head[0].length);
  if (rest.toLowerCase().startsWith("dependency ")) {
    rest = rest.slice("dependency ".length);
  }
  while (rest.endsWith("]") && rest.lastIndexOf(" [") > 0) {
    rest = rest.slice(0, rest.lastIndexOf(" ["));
  }
  if (rest.endsWith(")") && rest.lastIndexOf(" (") > 0) {
    rest = rest.slice(0, rest.lastIndexOf(" ("));
  }
  let target: string | undefined;
  const to = rest.lastIndexOf(" to ");
  if (to > 0 && !rest.slice(to + " to ".length).includes(" ")) {
    target = rest.slice(to + " to ".length);
    rest = rest.slice(0, to);
  }
  const subject = rest.trim();
  if (subject.length === 0) {
    return undefined;
  }
  return { subject, target };
}
