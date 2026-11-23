/**
 * CODEOWNERS, parsed and matched the way GitHub itself matches it — who is REQUIRED to approve a pull
 * request, computed from the paths it actually changes.
 *
 * ## Why this is computed here, and not read from a picker
 *
 * A picker reading bronze would depend on `codeowners` records the corpus may not hold, and would duplicate an
 * in-repo plugin that can see the file. The curated lane ingests the file (`../corpus/github/curatedFetch.ts`'s
 * `codeownersLive`), and this module does not read bronze at all: it is handed the file's own bytes from a live read of the repository, so it is never one refresh behind. It
 * answers "who is required" with nothing but GitHub's own two inputs.
 *
 * ## The four rules that decide an answer, and the one that is easiest to get wrong
 *
 * 1. **The LAST matching rule wins** — not the union of every matching rule. A repository whose default line
 *    is `* @org/everyone` and whose later line is `/apps/etl @someone` requires `@someone` alone for a file
 *    under `apps/etl`, and reporting both is how a board tells the owner to chase a team that cannot unblock
 *    anything.
 * 2. **A rule with a pattern and NO owners REMOVES ownership** for what it matches. Real lines in the work
 *    repository do exactly this (`/packages/infra/cloud/index.ts # Remove ownership of the main index`),
 *    and reading them as "no rule matched, fall back to the default" inverts their whole purpose.
 * 3. **A pattern with no slash matches at any depth**; a leading slash anchors at the root; a trailing slash
 *    matches everything beneath the directory. This is gitignore's shape, not a substring test.
 * 4. **The pull request's AUTHOR cannot approve their own pull request.** An owner token that resolves to the
 *    author is still reported — it is the truth about the file — but it is reported as unable to satisfy the
 *    requirement, because a row that names the author as the person to chase is a row that never clears.
 *
 * Pure. Every input is a string; the clock, the network and the filesystem are somebody else's problem.
 */

/** One parsed CODEOWNERS rule: the pattern as written, and the owners it names (possibly none). */
export interface CodeownersRule {
  readonly pattern: string;
  readonly owners: readonly string[];
}

/** Which files an owner token was required by, and whether it is a team rather than a person. */
export interface RequiredOwner {
  /** The token exactly as CODEOWNERS spells it, `@`-prefix included. */
  readonly token: string;
  /** A `@org/team` token addresses a set; a `@login` token addresses one account. */
  readonly kind: "team" | "user";
  /** The changed paths whose last matching rule named this token, capped by the caller's own file read. */
  readonly paths: readonly string[];
}

/** Strip a trailing `#` comment and surrounding whitespace from one CODEOWNERS line. */
function withoutComment({ line }: { line: string }): string {
  const at = line.indexOf("#");
  return (at === -1 ? line : line.slice(0, at)).trim();
}

/**
 * Parse CODEOWNERS text into its rules, in file order.
 *
 * Blank and comment-only lines are dropped; a line whose pattern is followed by nothing keeps an empty
 * `owners`, because that is a rule that REMOVES ownership rather than a line with nothing to say.
 *
 * @param content the whole CODEOWNERS file
 * @returns every rule, in the order the file declares them — order is the matching semantics
 */
export function parseCodeowners({ content }: { content: string }): readonly CodeownersRule[] {
  return parseCodeownersLines({ content }).map(({ rule }) => ({
    owners: rule.owners.filter((owner) => owner.startsWith("@")),
    pattern: rule.pattern,
  }));
}

/**
 * Parse CODEOWNERS keeping every owner token, an email address included, and the 1-based line each rule is on,
 * which is how GitHub's CODEOWNERS errors endpoint names the line it ignores.
 *
 * `parseCodeowners` keeps only `@` tokens, so a rule naming its owner by email reads as one that removes
 * ownership. A caller that must not mistake the one for the other reads this instead.
 *
 * @param content the CODEOWNERS file's text
 * @returns every rule GitHub can read, in file order, with its line number
 */
export function parseCodeownersLines({
  content,
}: {
  content: string;
}): readonly { readonly line: number; readonly rule: CodeownersRule }[] {
  const rules: { readonly line: number; readonly rule: CodeownersRule }[] = [];
  for (const [index, raw] of content.split("\n").entries()) {
    const line = withoutComment({ line: raw });
    if (line === "") {
      continue;
    }
    const [pattern = "", ...owners] = line.split(/\s+/);
    // GitHub documents `!` negation and `[ ]` ranges as syntax CODEOWNERS does not take, so such a line decides no
    // file here either. A run of three or more stars is kept, spelled as the one `*` gitignore reads it as, so a
    // consumer comparing a pattern (a catch-all check, say) sees that spelling.
    if (pattern.startsWith("!") || /[[\]]/.test(pattern)) {
      continue;
    }
    rules.push({ line: index + 1, rule: { owners, pattern: pattern.replace(/\*{3,}/g, "*") } });
  }
  return rules;
}

/** Whether one glob segment matches one path segment. `*` spans anything inside a segment, never a slash. */
function segmentMatches({ glob, segment }: { glob: string; segment: string }): boolean {
  const tokens = globTokensOf({ glob });
  // Split by code point, as the glob is, so a character outside the BMP is one character on both sides and `?`
  // takes all of it, never one UTF-16 half.
  const chars = Array.from(segment);
  // The two-pointer wildcard walk: on a miss, the last `*` takes one more character and the rest retries, so the
  // cost is bounded by the glob's length times the segment's, never exponential.
  let at = 0;
  let next = 0;
  let star = -1;
  let starAt = 0;
  while (at < chars.length) {
    const token = tokens[next];
    if (token?.kind === "star") {
      star = next;
      starAt = at;
      next += 1;
      continue;
    }
    if (token !== undefined && tokenMatches({ char: chars[at]!, token })) {
      next += 1;
      at += 1;
      continue;
    }
    if (star === -1) {
      return false;
    }
    next = star + 1;
    starAt += 1;
    at = starAt;
  }
  return tokens.slice(next).every((token) => token.kind === "star");
}

/** One piece of a glob segment: `*`, `?`, or one literal character. */
type GlobToken =
  { readonly kind: "star" } | { readonly kind: "one" } | { readonly kind: "literal"; readonly char: string };

/** Whether one non-star token matches one character. */
function tokenMatches({ token, char }: { token: Exclude<GlobToken, { kind: "star" }>; char: string }): boolean {
  return token.kind === "one" || token.char === char;
}

/**
 * A glob segment's tokens. GitHub's CODEOWNERS takes gitignore's `*` and `?` and documents that `[ ]` ranges, `!`
 * and a `\` escape do not work, so every other character is itself (`parseCodeownersLines` skips a `[ ]` or `!`
 * line, as GitHub skips a line it cannot read).
 */
function globTokensOf({ glob }: { glob: string }): readonly GlobToken[] {
  return Array.from(glob).map((char): GlobToken => {
    if (char === "*") {
      return { kind: "star" };
    }
    if (char === "?") {
      return { kind: "one" };
    }
    return { char, kind: "literal" };
  });
}

/**
 * Whether a glob's segments match a path's segments, from both ends inward.
 *
 * Written as a walk rather than a generated `RegExp` on purpose: the patterns come from a file in somebody
 * else's repository, and turning arbitrary text into a regular expression is how a read of untrusted input
 * becomes a catastrophic backtrack. `**` is the only segment that consumes more than one, and it is handled
 * by recursion at a single point, so the cost stays bounded by the path's own depth.
 */
function segmentsMatch({ globs, segments }: { globs: readonly string[]; segments: readonly string[] }): boolean {
  if (globs.length === 0) {
    return segments.length === 0;
  }
  const [head = "", ...tail] = globs;
  if (head === "**") {
    for (let skip = 0; skip <= segments.length; skip += 1) {
      if (segmentsMatch({ globs: tail, segments: segments.slice(skip) })) {
        return true;
      }
    }
    return false;
  }
  const [first, ...rest] = segments;
  if (first === undefined || !segmentMatches({ glob: head, segment: first })) {
    return false;
  }
  return segmentsMatch({ globs: tail, segments: rest });
}

/**
 * Whether one CODEOWNERS pattern matches one repository-relative path.
 *
 * Two cases, and both are needed: the pattern may name the FILE, or it may name a DIRECTORY that contains it.
 * `/apps/etl` owns `apps/etl/main.ts` exactly as `/apps/etl/` does, which is why the containment test does not
 * depend on a trailing slash. A pattern carrying no slash of its own FLOATS — GitHub matches it against a file
 * or directory of that name at any depth, so `.github` owns `.github/workflows/ci.yml` and
 * `packages/x/.github/x.yml` alike.
 *
 * This is a re-implementation, never GitHub's own matcher: GitHub has no endpoint answering who owns a path, only
 * one listing the lines it cannot read (which `github pr reviewers` refuses on). It closes every shape GitHub's
 * CODEOWNERS docs show, and a run of stars and non-BMP names; a syntax corner they do not document can still
 * differ, and asking GitHub's review-request result after the request is the mechanism that would close it.
 *
 * @param pattern the pattern exactly as CODEOWNERS writes it
 * @param path the changed file's repository-relative path, with no leading slash
 * @returns whether GitHub would consider that rule to match that file
 */
export function patternMatches({ pattern: written, path }: { pattern: string; path: string }): boolean {
  // gitignore reads a run of three or more stars as one `*`, so every check below sees that spelling, never the run.
  const pattern = written.replace(/\*{3,}/g, "*");
  // ONE slash comes off each end, so a doubled one leaves an empty segment no path segment matches: git owns nothing
  // by `/`, `//`, `foo//` or `//foo` — `printf '/\n' > .gitignore && git check-ignore --no-index top.txt` prints nothing.
  const body = pattern.replace(/^\//, "").replace(/\/$/, "");
  if (body === "") {
    return false;
  }
  // A bare `*` floats to every depth, so it owns everything. An anchored `/*` is `docs/*` at the root: the root's
  // direct files only, and it falls through to that rule below.
  if (body === "*" && !pattern.startsWith("/")) {
    return true;
  }
  const globs = body.split("/");
  const floating = !pattern.startsWith("/") && globs.length === 1;
  const segments = path.split("/");
  const starts = floating ? segments.map((_, index) => index) : [0];
  // GitHub's own example: `docs/*` owns a markdown file directly in `docs` but not one a directory below it, so a
  // pattern ending in a bare `*` names a directory's direct files and never contains a deeper one. A trailing
  // slash still names directories (`/docs/*/` owns a file inside any of them), so only the slashless spelling stops.
  const directoriesOnly = pattern.endsWith("/");
  const contains = directoriesOnly || globs.at(-1) !== "*";
  // A trailing `**` names what is INSIDE its directory, so it takes at least one segment, spelled `*` then `**`:
  // `/foo/**` never owns a file called `foo`, `/foo/**/` owns `foo/bar/x.txt` and never `foo/x.txt`, and `/foo/**/**`
  // owns `foo/x.txt` through its middle `**` taking none. Git's own answers — in a scratch repository,
  // `printf '/foo/**/\n' > .gitignore && git check-ignore --no-index foo/x.txt foo/bar/x.txt` prints only the second.
  const inside = globs.at(-1) === "**" ? [...globs.slice(0, -1), "*", "**"] : globs;
  return starts.some((start) => {
    const tail = segments.slice(start);
    // A `**` spans any depth, so the directory a pattern names can be any proper prefix of the path, not only
    // one as long as the pattern: `**/logs` owns `deeply/nested/logs/error.txt`. Bounded by the path's depth.
    const directories = tail.slice(0, -1).map((_, index) => tail.slice(0, index + 1));
    const contained =
      contains && directories.some((directory) => segmentsMatch({ globs: inside, segments: directory }));
    // A trailing slash names a directory, and a changed path is a file, so it is owned only by containment.
    return contained || (!directoriesOnly && segmentsMatch({ globs: inside, segments: tail }));
  });
}

/**
 * The index of the LAST rule matching one path, or `-1` when none does.
 *
 * The index rather than the rule itself, because two rules can be spelled identically and are still two
 * requirements — {@link requiredRules} groups by this index so it never merges them.
 */
function lastMatchingRuleIndex({ rules, path }: { rules: readonly CodeownersRule[]; path: string }): number {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (rule !== undefined && patternMatches({ path, pattern: rule.pattern })) {
      return index;
    }
  }
  return -1;
}

/**
 * The LAST rule matching one path — the one GitHub applies — or undefined when no rule matches.
 *
 * @param rules the parsed rules, in file order
 * @param path the changed file's repository-relative path
 * @returns that rule, owners and pattern both, so a caller can tell the catch-all default from a narrower rule
 */
export function lastMatchingRule({
  rules,
  path,
}: {
  rules: readonly CodeownersRule[];
  path: string;
}): CodeownersRule | undefined {
  const index = lastMatchingRuleIndex({ path, rules });
  return index === -1 ? undefined : rules[index];
}

/**
 * The owners the LAST matching rule names for one path, or none when nothing matches or the match removes
 * ownership.
 *
 * @param rules the parsed rules, in file order
 * @param path the changed file's repository-relative path
 * @returns that file's required owner tokens
 */
export function ownersForPath({ rules, path }: { rules: readonly CodeownersRule[]; path: string }): readonly string[] {
  const index = lastMatchingRuleIndex({ path, rules });
  return index === -1 ? [] : rules[index]!.owners;
}

/** One CODEOWNERS rule a pull request's own changed paths actually invoked. */
export interface RequiredRule {
  /** The pattern exactly as CODEOWNERS spells it. */
  readonly pattern: string;
  /** The owners that rule names — ANY ONE of them satisfies it, which is why the rule is the unit. */
  readonly owners: readonly string[];
  /** The changed paths whose last matching rule is this one. */
  readonly paths: readonly string[];
}

/**
 * Every RULE a pull request's changed paths invoked, in file order.
 *
 * ## Why the rule, and not the owner token, is the unit
 *
 * `requiredOwners` flattens to distinct tokens, which is the right shape for the question "who could
 * approve this" and the wrong one for "what is still owed". GitHub requires one approval PER MATCHING RULE,
 * from any one of that rule's owners — so `/apps @a @b` is satisfied by `@a` alone, while `/apps @a` plus
 * `/infra @b` needs both. A flattened token list cannot tell those apart: it reports `@a @b` either way,
 * and a reader who sees `@a` approve concludes the pull request is ready in the second case, which is the
 * exact shape of a wrong row — one satisfied rule read as all of them.
 *
 * A rule that names NO owners is a removal (see this module's header, rule 2) and requires nothing, so it is
 * left out entirely rather than reported as an empty requirement.
 *
 * @param rules the parsed rules, in file order
 * @param paths the pull request's changed paths
 * @returns one entry per invoked rule, each with the paths that invoked it
 */
export function requiredRules({
  rules,
  paths,
}: {
  rules: readonly CodeownersRule[];
  paths: readonly string[];
}): readonly RequiredRule[] {
  const byIndex = new Map<number, string[]>();
  for (const path of paths) {
    const index = lastMatchingRuleIndex({ path, rules });
    if (index === -1 || rules[index]?.owners.length === 0) {
      continue;
    }
    const existing = byIndex.get(index);
    if (existing === undefined) {
      byIndex.set(index, [path]);
      continue;
    }
    existing.push(path);
  }
  // Every key came from `lastMatchingRuleIndex`, which only ever returns an index it read a rule at — so
  // the assertion is honest rather than a default that would silently mint an unnamed requirement.
  return [...byIndex.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([index, owned]) => ({ owners: rules[index]!.owners, paths: owned, pattern: rules[index]!.pattern }));
}

/**
 * Every owner required across a pull request's changed files, with the files that required each.
 *
 * @param rules the parsed rules, in file order
 * @param paths the pull request's changed paths
 * @returns one entry per distinct owner token, sorted by token so two runs read the same
 */
export function requiredOwners({
  rules,
  paths,
}: {
  rules: readonly CodeownersRule[];
  paths: readonly string[];
}): readonly RequiredOwner[] {
  const byToken = new Map<string, string[]>();
  for (const path of paths) {
    for (const token of ownersForPath({ path, rules })) {
      const existing = byToken.get(token);
      if (existing === undefined) {
        byToken.set(token, [path]);
        continue;
      }
      existing.push(path);
    }
  }
  return [...byToken.entries()]
    .map(([token, owned]) => ({ kind: ownerKind({ token }), paths: owned, token }) satisfies RequiredOwner)
    .toSorted((a, b) => a.token.localeCompare(b.token));
}

/**
 * Whether an owner token addresses a team or a single account.
 *
 * @param token the token as CODEOWNERS spells it
 * @returns `team` for `@org/team`, `user` otherwise
 */
export function ownerKind({ token }: { token: string }): "team" | "user" {
  return token.includes("/") ? "team" : "user";
}

/**
 * Whether an owner token is the pull request's own author, who cannot approve their own pull request.
 *
 * @param token the owner token as CODEOWNERS spells it
 * @param authorLogin the pull request author's GitHub login
 * @returns whether this requirement can never be satisfied by the person it names
 */
export function isSelfOwner({ token, authorLogin }: { token: string; authorLogin: string }): boolean {
  return ownerKind({ token }) === "user" && token.slice(1).toLowerCase() === authorLogin.toLowerCase();
}

/**
 * Whether a repository lands its own pull requests: every CODEOWNERS rule names exactly one owner, and that
 * owner is the pull request's own author.
 *
 * It is never "the repository this CLI is running inside", read off the checkout's `origin` remote — that
 * makes the answer depend on the working directory rather than on the repository. MEASURED from a worktree of
 * the team's shared repository: all twenty of the owner's open pull requests there read `self-merges`, two of
 * them `CONFLICTING` on GitHub, because the shared repository had become "the checkout's own". The rule is about
 * a repository whose sole codeowner is its sole author, so that is the test — computed from the CODEOWNERS the read already fetched, per pull request, with no
 * repository named anywhere in this source.
 *
 * A repository with no CODEOWNERS at all is NOT self-merging: nothing there says nobody else reviews, and a
 * false `self-merges` is the arm that hides a pull request from every ask.
 *
 * @param authorLogin the pull request's author
 * @param rules the repository's parsed CODEOWNERS
 * @returns whether the author is the sole owner of every rule
 */
export function isSoleAuthorRepository({
  authorLogin,
  rules,
}: {
  authorLogin: string;
  rules: readonly { readonly owners: readonly string[] }[];
}): boolean {
  if (rules.length === 0) {
    return false;
  }
  return rules.every((rule) => rule.owners.length === 1 && isSelfOwner({ authorLogin, token: rule.owners[0]! }));
}
