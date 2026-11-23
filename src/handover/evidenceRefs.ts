/**
 * What a row's `evidence:` items NAME in a repository: source paths, slopweaver verbs, and pull requests.
 *
 * Two readers share it. `../cli/commands/handover/staleEvidenceGate.ts` refuses to REGISTER a finding whose
 * evidence paths the trunk already rewrote under the seat, and `./trunkMoved.ts` holds an already-registered
 * finding off the ready set once the trunk has moved what its evidence names since it was asked. Both ask the
 * same question at different instants, so the reading of an evidence item is one function rather than two.
 *
 * Every extraction here is EXACT — a reference is a path, a verb the row's own checkout declares, or a pull
 * request naming an `owner/name` — never a resemblance. Fuzzy matching is the class this repository forbids,
 * and a hold built on one would starve the ready set of work nobody had answered.
 *
 * Pure: strings in, references out. Resolving a verb to its run module is `./manifestVerbs.ts`.
 */

/** One slopweaver verb an evidence item names, as `<noun> <verb>`. */
export interface VerbRef {
  readonly noun: string;
  readonly verb: string;
}

/** One pull request an evidence item names, with the repository it names. */
export interface PullRef {
  readonly owner: string;
  readonly name: string;
  readonly number: number;
}

/** Everything a row's evidence names that the trunk could have moved. */
export interface EvidenceRefs {
  readonly paths: readonly string[];
  readonly verbs: readonly VerbRef[];
  readonly pulls: readonly PullRef[];
}

/**
 * The evidence items that name source files in THIS repository.
 *
 * Deliberately conservative, and modelled on `../cmux/baseFreshness.ts`'s own path test: an item counts only
 * when it carries a `/`, no whitespace, no `#`, and is neither absolute, home-relative, a URL, a flag, nor
 * prefixed with a `<scheme>:` label. A row is refused or held on these, so a false positive here costs a
 * session a refusal it cannot act on — the bar to clear is "unmistakably a path".
 *
 * The `#` clause is the one that was MEASURED rather than reasoned: `acme/acme-admin#<n>` clears every
 * other test — it carries a slash, no whitespace and no scheme — and handed to git as a pathspec it
 * matches nothing and exits 0, so the effect would be benign while the module header and
 * `skills/handover/reference/finding-page.md` both claim such a ref is "not a path" and outside the
 * criterion. A doc that is true only by accident is the shape this repository treats as a defect, so the
 * criterion says what the docs say.
 *
 * A trailing `:<line>` or `:<line>:<column>` is dropped: `src/handover/settleCardErrors.ts:186` names that
 * file, and handed to git whole it is a pathspec matching nothing — measured on
 * `handover-settle-refuses-every-ask-filed-from-a`, whose fix touched both of its `:<line>` items.
 * A leading `./` is dropped too, because git's `--name-only` prints `src/a.ts` for a `./src/a.ts` pathspec and
 * the two would never compare equal.
 *
 * @param evidence the row's raw `evidence:` items
 * @returns the items that are repo-relative source paths, in first-seen order, deduplicated
 */
export function codeEvidencePaths({ evidence }: { evidence: readonly string[] }): readonly string[] {
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const raw of evidence) {
    const item = raw
      .trim()
      .replace(/:\d+(?::\d+)?$/u, "")
      .replace(/^(?:\.\/)+/u, "");
    const looksLikePath =
      item.length > 0 &&
      !/[\s]/u.test(item) &&
      item.includes("/") &&
      !item.includes("#") &&
      !item.startsWith("/") &&
      !item.startsWith("~") &&
      !item.startsWith("-") &&
      !/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(item);
    if (looksLikePath && !seen.has(item)) {
      seen.add(item);
      kept.push(item);
    }
  }
  return kept;
}

/** A noun or verb token as the CLI spells one: lower case, digits and hyphens. */
const TOKEN = "[a-z][a-z0-9-]*";

/**
 * The slopweaver verbs an evidence item names: a `verb:<noun> <verb>` item, or `slopweaver <noun> <verb>`
 * anywhere inside free text — `the-pr-above-the-fold-gate-refuses-the` named `slopweaver github vuln body`
 * inside one long item, and the fix that answered it changed that verb's own run module.
 *
 * @param evidence the row's raw `evidence:` items
 * @returns the verbs, deduplicated, in first-seen order
 */
function evidenceVerbs({ evidence }: { evidence: readonly string[] }): readonly VerbRef[] {
  const found: VerbRef[] = [];
  const seen = new Set<string>();
  const patterns = [
    new RegExp(`^verb:\\s*(${TOKEN})\\s+(${TOKEN})`, "gu"),
    new RegExp(`\\bslopweaver\\s+(${TOKEN})\\s+(${TOKEN})`, "gu"),
  ];
  for (const item of evidence) {
    for (const pattern of patterns) {
      for (const match of item.trim().matchAll(pattern)) {
        const noun = match[1]!;
        const verb = match[2]!;
        const key = `${noun} ${verb}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ noun, verb });
        }
      }
    }
  }
  return found;
}

/**
 * The pull requests an evidence item names WITH their repository — `owner/name#N` or a GitHub pull URL. A bare
 * `#N` names no repository and is not read. The host must be exactly `github.com`: `notgithub.com/…` or a
 * subdomain is another site, and so is a path under another host,
 * `example.com/github.com/…` — so it opens the token or follows `http(s)://` itself. The
 * number ends where a URL or a sentence does, so a number followed directly by letters, or by a dot and
 * letters, names nothing while a number followed by `/files`, by `#…`, or closing a sentence still names it.
 *
 * @param evidence the row's raw `evidence:` items
 * @returns the pull requests, deduplicated, in first-seen order
 */
function evidencePulls({ evidence }: { evidence: readonly string[] }): readonly PullRef[] {
  const found: PullRef[] = [];
  const seen = new Set<string>();
  const patterns = [
    /(?:(?<=(?:^|[\s(<["'`])https?:\/\/(?:www\.)?)|(?<![^\s(<["'`]))github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?=$|[\s/#?)>\],;:"'`]|\.(?:$|\s))/gu,
    /(?<![/\w.-])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)(?=$|[\s)>\],;:"'`]|\.(?:$|\s))/gu,
  ];
  for (const item of evidence) {
    for (const pattern of patterns) {
      for (const match of item.matchAll(pattern)) {
        const pull = { name: match[2]!, number: Number(match[3]!), owner: match[1]! };
        const key = `${pull.owner}/${pull.name}#${String(pull.number)}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          found.push(pull);
        }
      }
    }
  }
  return found;
}

/**
 * Everything a row's evidence names that the trunk could have moved since.
 *
 * @param evidence the row's raw `evidence:` items
 * @returns its paths, verbs and pull requests — each empty when it names none
 */
export function evidenceRefs({ evidence }: { evidence: readonly string[] }): EvidenceRefs {
  return {
    paths: codeEvidencePaths({ evidence }),
    pulls: evidencePulls({ evidence }),
    verbs: evidenceVerbs({ evidence }),
  };
}
