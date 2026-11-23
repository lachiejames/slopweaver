/**
 * The canon stale-reference sweep — catches a skill, command, rule or `AGENTS.md` naming a `slopweaver`
 * verb, flag or repo path that no longer exists.
 *
 * ## The defect this exists for
 *
 * A skill is read as instructions. When a verb is renamed, a flag is dropped, or a file moves, every doc
 * still naming the old shape becomes a confident lie to the next session that reads it — a skill's
 * `SKILL.md` and `AGENTS.md` are amended by hand as changes land, and nothing checks that the amendment
 * actually happened. `helpTruth.test.ts` proves the mechanism works for one surface (CLI usage strings
 * against the real parsers); this proves it for the canon docs themselves, against the same manifest
 * `helpTruth` already trusts as ground truth.
 *
 * ## What counts as a reference
 *
 * Two shapes, both literal text an agent would act on:
 *
 *  - a `` `slopweaver <noun> [<verb>] [--flag ...]` `` inline code span, or an unwrapped line beginning
 *    `slopweaver ` (the shape every fenced `bash` example in this repo's docs uses) — resolved against the
 *    live CLI manifest (noun, then verb, then every `--flag` token against that verb's own advertised
 *    usage).
 *  - a backticked repo path (`src/…`, `docs/…`, `skills/…`, `.claude/…`, or a known root file) — resolved
 *    against the filesystem, trailing `:line` and `#symbol` suffixes stripped first.
 *
 * A placeholder-only fragment (`` `slopweaver <noun> <verb>` ``, describing the SHAPE rather than naming a
 * real verb) resolves to nothing checkable and is silently skipped — the tokenizer only ever inspects
 * literal, lowercase, unbracketed words, so a placeholder can never masquerade as a real noun or verb.
 *
 * ## Why this stays a ratchet
 *
 * The tokenizer is deliberately conservative (see the module docstring on each helper for exactly what it
 * will and will not flag), and the real canon corpus was never written with this checker in mind — the
 * first sweep needs a known-stale allowlist alongside it, shrinking only, exactly like `coverageRatchet.ts`.
 *
 * Pure throughout: every filesystem or git edge (which files count as canon, whether a path exists) is a
 * caller-supplied seam, so this module is unit-tested on inline fixtures and never reads a real file.
 */

import { posix } from "node:path";
import type { NounManifestModule } from "../cli/manifest.js";
import { DEFAULT_VERB } from "../cli/manifest.js";

/** One noun+verb address the live CLI actually serves, carrying the usage string its flags are checked against. */
export interface VerbAddress {
  readonly noun: string;
  /** {@link DEFAULT_VERB} (`""`) for the bare-noun address. */
  readonly verb: string;
  readonly usage: string;
}

/** One reference a canon file makes that does not resolve against the live repository. */
export interface StaleOffender {
  readonly file: string;
  readonly kind: "unknown-noun" | "unknown-verb" | "unknown-flag" | "missing-path";
  /** The exact text as written in the doc, for a reader to grep back to. */
  readonly reference: string;
  readonly detail: string;
}

/** One way a single `slopweaver …` invocation fails to resolve, before it is attributed to any file. */
export interface InvocationOffender {
  readonly kind: "unknown-noun" | "unknown-verb" | "unknown-flag";
  /** The fragment as written, backticked. */
  readonly reference: string;
  readonly detail: string;
}

/** A lowercase, unbracketed word — the only kind of token this sweep ever treats as a literal noun/verb. */
const LITERAL_WORD = /^[a-z][a-z0-9-]*$/;

/** Every `--flag` token in a fragment, deduped. */
const FLAG_TOKEN = /--[a-z][a-z0-9-]*/g;

/** A single-backtick inline code span. Deliberately not multi-line — a fenced block is handled separately. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** Repo-relative filenames referenced bare (no leading directory) often enough to be worth recognising. */
const ROOT_FILES = new Set([
  "AGENTS.md",
  "README.md",
  "CLAUDE.md",
  "package.json",
  "yarn.config.cjs",
  "lefthook.yml",
  "knip.json",
  ".oxlintrc.jsonc",
  ".prettierrc",
  ".nvmrc",
  "tsconfig.json",
]);

/** A backticked span that is plausibly a bare repo-relative path — no spaces, no glob, no URL, no shell flag. */
const PATH_LIKE = /^[\w./-]+$/;

/**
 * One path-shaped run of characters, the unit the line sweep chops a line into. It breaks on whitespace and
 * on every character a path cannot contain — a backtick, a bracket, `#`, `:`, `*`, `$`, `<` — which is what
 * makes one regex enough for all three positions the code-span sweep cannot see: `` `ls docs/` `` yields
 * `docs/`, `[the map](docs/architecture.md)` yields `docs/architecture.md`, and a bare
 * `docs/architecture.md:554` inside a fenced block yields `docs/architecture.md` with the line suffix
 * already gone.
 */
const PROSE_PATH_RUN = /[\w./-]+/g;

/**
 * The characters that mean the run immediately before them may have been truncated by a placeholder rather
 * than ended by one: a glob, an `<angle>` placeholder, a `{brace,expansion}`. See {@link prosePathTokens}.
 */
const PLACEHOLDER_NEXT = new Set(["*", "<", "{"]);

/**
 * This repository's own top-level directories, the only prefixes a non-relative candidate is trusted
 * against. Anything else that merely CONTAINS a slash — a `$SLOPWEAVER_HOME` layout path, a GitHub
 * `owner/repo` placeholder, an npm rule name — is never a repo path and must not be treated as one.
 */
const REPO_TOP_LEVEL = [
  ".baselines/",
  ".claude/",
  ".claude-plugin/",
  ".codex-plugin/",
  ".github/",
  "bin/",
  "config/",
  "docs/",
  "eval/",
  "hooks/",
  "scripts/",
  "skills/",
  "src/",
  "stubs/",
  "templates/",
];

/**
 * Whether a canon surface (`AGENTS.md`, `.claude/rules/*.md`, every markdown file under a skill, and
 * `docs/*.md`) owns this repo-relative path.
 *
 * @param path the repo-relative path
 * @returns true when this sweep is responsible for the file
 */
export function isCanonPath({ path }: { path: string }): boolean {
  if (path === "AGENTS.md") {
    return true;
  }
  if (path.startsWith(".claude/rules/") && path.endsWith(".md")) {
    return true;
  }
  // Every markdown file under a skill, not only its `SKILL.md`: a bundled reference file is loaded as
  // instructions the moment the body links to it, so a CLI invocation that rotted in one is a confident lie
  // told at exactly the point the reader followed a pointer to get the detail.
  if (/^skills\/[^/]+\/.+\.md$/.test(path)) {
    return true;
  }
  return path.startsWith("docs/") && path.endsWith(".md");
}

/**
 * Flatten the live CLI manifest into the flat address list this sweep resolves against — the same
 * `MANIFEST_MODULES` barrel `helpTruth.test.ts` already trusts as ground truth for usage strings.
 *
 * @param modules the manifest barrel
 * @returns one address per noun+verb, `verb: ""` for a bare-noun default
 */
export function addressesFromManifestModules({
  modules,
}: {
  modules: readonly NounManifestModule[];
}): readonly VerbAddress[] {
  return modules.flatMap((module) =>
    Object.entries(module.verbs).map(([verb, entry]) => ({ noun: module.noun, usage: entry.meta.usage, verb })),
  );
}

/** Whether a fragment is a `slopweaver` invocation worth tokenizing, rather than prose or a path. */
function isInvocation({ text }: { text: string }): boolean {
  return text === "slopweaver" || text.startsWith("slopweaver ");
}

/**
 * The leading run of literal (lowercase, unbracketed) words after `slopweaver`, stopping at the first flag,
 * placeholder or punctuation. Only the first two — noun, then verb — are ever resolved; anything past that
 * is a subcommand's own positional argument (`handover gate rebuild`), which this sweep does not model.
 */
function literalTokens({ fragment }: { fragment: string }): readonly string[] {
  const rest = fragment.trim().split(/\s+/).slice(1);
  const literals: string[] = [];
  for (const token of rest) {
    if (!LITERAL_WORD.test(token)) {
      break;
    }
    literals.push(token);
  }
  return literals;
}

/**
 * Every `--flag` token named anywhere in the fragment, deduped, EXCLUDING anything inside a double-quoted
 * substring — `cmux send`'s whole point is typing a quoted string of someone else's flags into a *different*
 * program's terminal (`` `slopweaver cmux send --workspace <ws> "claude --resume <uuid>"` ``), and those
 * belong to `claude`, not to `cmux send`. `--help` is dropped everywhere: every verb accepts it generically,
 * before its own parser ever runs, so no usage string lists it and it must never read as unadvertised.
 */
function flagsIn({ fragment }: { fragment: string }): readonly string[] {
  const unquoted = fragment.replace(/"[^"]*"/g, '""');
  // `matchAll` answers a fragment naming no flag as no matches, never as an absent result.
  return [...new Set(Array.from(unquoted.matchAll(FLAG_TOKEN), (match) => match[0]))].filter(
    (flag) => flag !== "--help",
  );
}

/**
 * Resolve one `slopweaver …` fragment against the live address list, reporting an unknown noun, an unknown
 * verb, or a flag the resolved verb's own usage string does not advertise.
 *
 * A verb token that matches nothing real falls back SILENTLY to the noun's default-verb address, when one
 * exists, rather than reporting `unknown-verb` — `connect <github|slack|linear|notion> --check` dispatches
 * through the bare default, with the source name consumed as the default verb's own positional argument, not
 * as a second verb keyword. This sweep cannot tell that shape apart from a genuine typo of a real subverb
 * name, so for a noun that HAS a default it stays silent on the verb and checks flags against the default's
 * usage instead; a noun with no default at all (most of them) still requires the verb token to match.
 *
 * A bare-noun fragment with no verb token is checked for noun existence only — many nouns are written in
 * prose without a verb (`the `github` noun`), and this sweep has no way to tell that from a genuinely
 * incomplete example, so it stays silent rather than guessing.
 *
 * Only the noun and the FIRST verb word are resolved. A nested sub-command (`github pr update`,
 * `write vanta deactivate`) is checked as `github pr` / `write vanta`, its flags against that verb's whole
 * advertised usage, so a misspelt third word is not caught here.
 *
 * @param fragment the `slopweaver …` text, exactly as it would be typed
 * @param addresses the live CLI address list to resolve against
 * @returns every way the fragment fails to resolve, empty when it names a real noun, verb and flags
 */
export function resolveInvocation({
  fragment,
  addresses,
}: {
  fragment: string;
  addresses: readonly VerbAddress[];
}): readonly InvocationOffender[] {
  const tokens = literalTokens({ fragment });
  if (tokens.length === 0) {
    return [];
  }
  const noun = tokens[0]!;
  const nounAddresses = addresses.filter((address) => address.noun === noun);
  if (nounAddresses.length === 0) {
    return [
      {
        detail: `no noun \`${noun}\` in the CLI manifest`,
        kind: "unknown-noun",
        reference: `\`${fragment}\``,
      },
    ];
  }
  const defaultAddress = nounAddresses.find((address) => address.verb === DEFAULT_VERB);
  if (tokens.length === 1) {
    if (defaultAddress === undefined) {
      // Bare noun, no default verb on record — silently skipped; see the doc comment above.
      return [];
    }
    return flagOffenders({ address: defaultAddress, fragment });
  }
  const exact = nounAddresses.find((address) => address.verb === tokens[1]);
  if (exact !== undefined) {
    return flagOffenders({ address: exact, fragment });
  }
  if (defaultAddress === undefined) {
    // No verb token matched, and this noun has no default to fall back to — a real unknown verb.
    return [
      {
        detail: `no verb \`${tokens[1]!}\` on noun \`${noun}\``,
        kind: "unknown-verb",
        reference: `\`${fragment}\``,
      },
    ];
  }
  return flagOffenders({ address: defaultAddress, fragment });
}

/** {@link resolveInvocation}'s offenders, each attributed to the canon file that names the fragment. */
function invocationOffenders({
  file,
  fragment,
  addresses,
}: {
  file: string;
  fragment: string;
  addresses: readonly VerbAddress[];
}): readonly StaleOffender[] {
  return resolveInvocation({ addresses, fragment }).map((offender) => ({ ...offender, file }));
}

/** Every flag in the fragment the resolved address's own usage string does not advertise. */
function flagOffenders({
  address,
  fragment,
}: {
  address: VerbAddress;
  fragment: string;
}): readonly InvocationOffender[] {
  // A usage string advertising no flag is no matches to `matchAll`, never an absent result.
  const advertised = new Set(Array.from(address.usage.matchAll(FLAG_TOKEN), (match) => match[0]));
  const label = address.verb === DEFAULT_VERB ? address.noun : `${address.noun} ${address.verb}`;
  return flagsIn({ fragment })
    .filter((flag) => !advertised.has(flag))
    .map((flag) => ({
      detail: `\`${flag}\` is not in \`${label}\`'s advertised usage`,
      kind: "unknown-flag" as const,
      reference: `\`${fragment}\``,
    }));
}

/**
 * Reduce a backticked span to a checkable repo-relative path, resolved against the FILE that names it, or
 * `undefined` when the span is not recognisably a repo path at all.
 *
 * Deliberately narrow, because most slash-bearing prose in this repo's docs is NOT a repo path: a Claude
 * Code slash command (`` `/model` ``), a state-home layout description (`` `corpus/members/` `` — real, but
 * relative to `$SLOPWEAVER_HOME`, a different tree entirely), a GitHub CLI placeholder (`` `owner/repo` ``),
 * an npm/eslint rule name (`` `sonarjs/cognitive-complexity` ``). Measured on the real corpus: treating any
 * slash-bearing span as a path candidate produced well over a hundred false positives, nearly all of them
 * one of those four shapes. So a candidate is only ever checked when it is unambiguous — a bare known root
 * filename, an explicit `../`/`./` relative reference (resolved against the file's own directory, the shape
 * a skill doc uses to point at a file beside it), or a path rooted at one of this repo's own top-level
 * directories.
 *
 * @param file the repo-relative path of the doc naming the span, for relative resolution
 * @param span the trimmed backticked text
 * @returns the repo-relative path to check, or `undefined` when the span is not a checkable path
 */
function pathCandidate({ file, span }: { file: string; span: string }): string | undefined {
  if (
    span.length === 0 ||
    span.includes("*") ||
    span.includes("://") ||
    span.startsWith("$") ||
    span.startsWith("-") ||
    span.startsWith("/")
  ) {
    return undefined;
  }
  if (!PATH_LIKE.test(span)) {
    return undefined;
  }
  const withoutSymbol = span.split("#")[0]!;
  const withoutLine = withoutSymbol.replace(/:\d+(-\d+)?$/, "");
  if (withoutLine.length === 0) {
    return undefined;
  }
  if (withoutLine.startsWith("../") || withoutLine.startsWith("./")) {
    return posix.normalize(`${posix.dirname(file)}/${withoutLine}`);
  }
  if (ROOT_FILES.has(withoutLine)) {
    return withoutLine;
  }
  return REPO_TOP_LEVEL.some((prefix) => withoutLine.startsWith(prefix)) ? withoutLine : undefined;
}

/**
 * Every path-shaped token on one line that is rooted at one of this repository's own top-level directories.
 *
 * This is the sweep's SECOND position, and it exists because the first one could not see the three places a
 * dead path actually hid: inside a fenced block (the architecture Layout listed a `commands/` tree
 * that had been deleted), in bare unbackticked prose (three `SKILL.md` `description:` lines pointed at
 * `commands/loop.md`, text every host renders in its skill list before an agent opens a file), and inside a
 * multi-word backticked span (`docs/README.md`'s `` `ls commands/` ``, which {@link PATH_LIKE} rejects for
 * containing a space). All four were live with this test entirely green.
 *
 * `REPO_TOP_LEVEL` is the whole reason this can be line-wide without drowning in the false positives the
 * {@link pathCandidate} comment measures. A slash-bearing token is only ever looked at when it is rooted at
 * a directory this repository owns, so a `$SLOPWEAVER_HOME` layout path, an `owner/repo` placeholder and an
 * `eslint-plugin/rule-name` are not rejected — they are never candidates in the first place.
 *
 * Two shapes the run regex cannot exclude by itself, both measured on the real corpus rather than imagined:
 *
 *  - **A placeholder or expansion sits OUTSIDE the run it truncates.** `hooks/pretooluse-main-checkout-*.ts`
 *    yields `hooks/pretooluse-main-checkout-`, `.claude/worktrees/recipe-child-<slug>` yields
 *    `.claude/worktrees/recipe-child-`, and `templates/slack-app-manifest.{full,agent}.json` yields
 *    `templates/slack-app-manifest` — three real prefixes of three real families, none of them a path. So a
 *    run immediately followed by one of {@link PLACEHOLDER_NEXT} is dropped **unless it ends in `/`**,
 *    because a run that ends in `/` is a whole directory whatever follows it: `src/cli/commands/<verb>/`,
 *    `src/live/turn/stream/{contract,lifecycle}.ts` and `src/__tests__/unit/**` each still get their
 *    directory checked, and the second of those is a directory that does not exist.
 *  - **A double-quoted substring is being handed to another program verbatim**, exactly as {@link flagsIn}
 *    already decides for flags, and for the same reason: `` `ps aux | grep "bin/claude"` `` is a pattern
 *    matched against a process command line, not a file this repository owns. Quoted substrings are blanked
 *    before tokenizing. Nothing here references its own files that way — this repo's docs backtick them.
 *
 * A trailing `.` is stripped last, so a sentence-ending path (`… see docs/README.md.`) still resolves.
 *
 * @param line the raw line, fences and all
 * @returns each token to resolve, in line order
 */
function prosePathTokens({ line }: { line: string }): readonly string[] {
  const unquoted = line.replace(/"[^"]*"/g, '""');
  const tokens: string[] = [];
  for (const match of unquoted.matchAll(PROSE_PATH_RUN)) {
    const run = match[0];
    const next = unquoted[match.index + run.length];
    if (next !== undefined && PLACEHOLDER_NEXT.has(next) && !run.endsWith("/")) {
      continue;
    }
    const token = run.replace(/\.+$/, "");
    if (REPO_TOP_LEVEL.some((prefix) => token.startsWith(prefix))) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Resolve every candidate span as a repo path, reporting each one that does not exist — at most once per
 * resolved path, because the same missing path is normally named by both sweeps on the same line and the
 * ratchet's allowlist keys on `<file>: <detail>`, which cannot tell two copies apart.
 */
function pathOffenders({
  file,
  spans,
  pathExists,
}: {
  file: string;
  spans: readonly string[];
  pathExists: (args: { path: string }) => boolean;
}): readonly StaleOffender[] {
  const reported = new Set<string>();
  const offenders: StaleOffender[] = [];
  for (const span of spans) {
    const candidate = pathCandidate({ file, span });
    if (candidate === undefined || reported.has(candidate) || pathExists({ path: candidate })) {
      continue;
    }
    reported.add(candidate);
    offenders.push({
      detail: `\`${candidate}\` does not exist`,
      file,
      kind: "missing-path",
      reference: `\`${span}\``,
    });
  }
  return offenders;
}

/**
 * Every stale reference one canon file makes: an unresolved `slopweaver` invocation (backticked or a bare
 * `bash`-fence line), and every repo path that does not exist — whether it is backticked alone, buried in a
 * multi-word span, sitting in a fenced block, or written bare in prose (see {@link prosePathTokens}).
 *
 * @param path the file's repo-relative path, for reporting
 * @param content the file's text
 * @param addresses the live CLI address list to resolve invocations against
 * @param pathExists resolves whether a repo-relative path exists
 * @returns every invocation offender in file order, then every missing path in file order
 */
export function scanCanonFile({
  path,
  content,
  addresses,
  pathExists,
}: {
  path: string;
  content: string;
  addresses: readonly VerbAddress[];
  pathExists: (args: { path: string }) => boolean;
}): readonly StaleOffender[] {
  const offenders: StaleOffender[] = [];
  const spans: string[] = [];
  for (const match of content.matchAll(CODE_SPAN)) {
    const span = match[1]!.trim();
    if (span.length === 0) {
      continue;
    }
    if (isInvocation({ text: span })) {
      offenders.push(...invocationOffenders({ addresses, file: path, fragment: span }));
      continue;
    }
    spans.push(span);
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (isInvocation({ text: trimmed })) {
      offenders.push(...invocationOffenders({ addresses, file: path, fragment: trimmed }));
    }
    spans.push(...prosePathTokens({ line }));
  }
  offenders.push(...pathOffenders({ file: path, pathExists, spans }));
  return offenders;
}

/**
 * Format one offender as the stable string the ratchet allowlist matches on.
 *
 * @param offender the offending reference
 * @returns the `<file>: <detail>` line
 */
export function formatOffender({ offender }: { offender: StaleOffender }): string {
  return `${offender.file}: ${offender.detail}`;
}
