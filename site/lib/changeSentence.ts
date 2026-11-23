/**
 * One landed change as a sentence the owner can read: the squash title without its `fix(voice):` prefix, opening on a
 * capital and closing on a full stop, with the part of the product it touched kept apart as a label. Pure.
 *
 * A line has only about twenty characters to show a change, so a commit hash (eight of them) and a PR number (five)
 * spend them on nothing the owner can read, and the change could otherwise only be told by opening the PR on an external site. This repository's pull-request titles are already behaviour
 * sentences behind a conventional-commit prefix, so the sentence is the title itself; no model runs in the page
 * (rule 2), and none is needed.
 */

/** A conventional-commit prefix: its type, an optional scope, an optional breaking mark, then the colon. */
const PREFIX = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?!?:\s+(?<rest>\S.*)$/u;

/**
 * The prefix types the notes name, so a fix and a new thing read apart (the desktop, the UI and bug fixes).
 * Every other type — `chore`, `docs`, `refactor` — names nothing the owner would act on, so it gets no
 * label.
 */
const KINDS: ReadonlyMap<string, ChangeSentence["kind"]> = new Map([
  ["feat", "New"],
  ["fix", "Fix"],
]);

/**
 * A commit hash a title carries inside it ("restore <hash>", "revert <hash>"): a standalone run of 7 to 40 hex
 * digits with at least one letter in it, bounded by anything not a letter or digit — an
 * underscore included, which `\b` would count as part of a word. A run of decimal digits alone reads as
 * the number it far more likely is ("2026100 reloads"), and the rare word spelled only in a–f ("defaced") is read as a
 * hash too — a misread word costs less than a hash shown.
 */
const HASH = /(?<![0-9a-z])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![0-9a-z])/giu;

/** A change as the release notes read it. */
export interface ChangeSentence {
  /** The part of the product it touched, from the title's scope (`Voice`), or `undefined` when the title names none. */
  readonly area: string | undefined;
  /** `Fix` for a `fix:` title, `New` for a `feat:` one, `undefined` for any other or none. */
  readonly kind: "Fix" | "New" | undefined;
  /** The change in one sentence, capitalised and closed. */
  readonly sentence: string;
}

/**
 * Turn a squash title into the sentence the release notes show.
 *
 * @param title the commit's title, its ` (#N)` suffix already split off (`titleAndPullRequest`)
 * @returns the sentence, the area its scope names, and whether it is a fix or something new
 */
export function changeSentence({ title }: { title: string }): ChangeSentence {
  const trimmed = title.trim();
  // An optional group is absent at runtime when it did not match, whatever the index signature claims.
  const groups: Partial<Record<"rest" | "scope" | "type", string>> | undefined = PREFIX.exec(trimmed)?.groups;
  let rest = trimmed;
  let area: string | undefined;
  let kind: ChangeSentence["kind"];
  if (groups !== undefined) {
    rest = groups.rest!;
    kind = KINDS.get(groups.type!);
    const scope = groups.scope;
    if (scope !== undefined) {
      // A scope that is or carries a hash names no area worth a label, so it gives none.
      const hashFree = scope.replaceAll(HASH, "") === scope;
      if (hashFree) {
        area = capitalise({ text: scope.trim().replaceAll("-", " ") });
      }
    }
  }
  const unhashed = rest.replaceAll(HASH, "a commit");
  return { area, kind, sentence: closed({ text: capitalise({ text: unhashed }) }) };
}

/**
 * The text with its first letter in capitals.
 *
 * @returns the text, unchanged past its first character
 */
function capitalise({ text }: { text: string }): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The text ending on terminal punctuation — a full stop added only when it has none.
 *
 * @returns the closed sentence
 */
function closed({ text }: { text: string }): string {
  if (/[.!?…]["'”’)]?$/u.test(text)) {
    return text;
  }
  return `${text}.`;
}
