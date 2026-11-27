/**
 * Public hygiene gate — scans every working-tree file for generic leak CLASSES (home paths, token shapes,
 * raw workspace-ID patterns, an opaque hex id in a query parameter), prints every hit, and exits non-zero
 * for the ones it REFUSES. It ships as a real feature: it keeps any user or fork from committing their own
 * credentials, and — wherever `IDENTIFIER_VERDICT` reads `refuse` — a real workspace id or a name the committed
 * rules or a provider-location pattern match. A fork's own names join only when it regenerates those rules.
 * Its tree walk and report are `./repoScan.ts`, run in CI on every push and via `slopweaver hygiene`.
 *
 * ## Two verdicts: a credential always fails, an identifier follows `IDENTIFIER_VERDICT`
 *
 * The repository is generic to any checkout (`AGENTS.md` § "no organisation names in what you commit"), so a
 * hit is one of two things. A {@link Pattern.credential} hit, or a denylist hit, is a SECRET and exits
 * non-zero always ({@link isSecretHit}). An IDENTIFIER — a raw workspace id here, or any of the eight kinds
 * `./identifierScan.ts` matches against the rules in `./forbiddenIdentifiers.ts`, hashed names and generic
 * provider locations alike — is refused by
 * {@link isRefusedHit} exactly when {@link IDENTIFIER_VERDICT} is `refuse`; while it reads `report`, each hit
 * prints and passes — this scan's own by its location, a forbidden-identifier hit in a per-kind count. Only the repository and pull-request gates ask `isRefusedHit`: the corpus,
 * salvage and authored-file consumers keep `isSecretHit`, because their subject is the organisation's own data.
 *
 * `raw-workspace-id` matches the eight Slack prefixes `C U A W D G T E` followed by eight or more capitals and
 * digits, at least one of them a digit. A
 * synthetic stand-in {@link isAllowedSyntheticWorkspaceId} names — `…FIXTURE…`, `…0SYN…` and the one documentation
 * example channel id —
 * that this shape matches is still a hit, so `turn freeze` and the cassette tripwire, which refuse every hit,
 * refuse it exactly as before; it reports as `synthetic-workspace-id`, which no gate refuses, so only a real id
 * is ever refused. An all-letter stand-in, such as every prefixed id `turn freeze` mints, is no hit at all. The other identifier
 * classes print and never refuse:
 * a committed absolute home path only works on one machine, and an opaque provider id in a query parameter
 * is state that belongs under `$SLOPWEAVER_HOME` (tools in the codebase, state outside it).
 *
 * It names no organisation: the forbidden-identifier rules are SHA-256 digests and generic location patterns.
 * The PRIVATE, uncommitted denylist at `$SLOPWEAVER_HOME/hygiene-denylist.txt` (one case-insensitive substring
 * per line, read at runtime) holds literal SECRET strings no pattern here can express — a passphrase, a legacy
 * key with no recognisable prefix — and a hit on it fails like any other credential.
 */

import { lstatSync, readFileSync } from "node:fs";
import { slopweaverHome } from "../config.js";
import { isRecord } from "../lib/parsers.js";

import { stateHomePaths } from "../stateHome.js";
import { IDENTIFIER_KINDS } from "./identifierScan.js";

export interface Hit {
  readonly path: string;
  readonly line: number;
  readonly label: string;
  readonly excerpt: string;
}

interface Pattern {
  readonly label: string;
  readonly re: RegExp;
  /**
   * Whether a match is a CREDENTIAL — a secret whose disclosure is itself the harm — rather than an
   * IDENTIFIER, which merely says who or where something is. A credential hit fails here and in
   * `./corpusScan.ts` alike; an identifier's verdict is {@link isRefusedHit}'s in the repository and
   * pull-request gates, and it is reported and passes in every other consumer.
   */
  readonly credential: boolean;
  /**
   * A match this returns true for is SYNTHETIC by construction: it is still a hit, so a consumer refusing
   * every hit still refuses it, but it carries {@link Pattern.syntheticLabel} instead of `label`, which no
   * gate refuses. Set only on a pattern declared with the `g` flag, because the scan walks every match on the
   * line and reports the first real one, falling back to the first synthetic one.
   */
  readonly synthetic?: {
    readonly allow: (args: { value: string }) => boolean;
    readonly label: string;
  };
}

/** The label a synthetic workspace id is reported under: printed like any identifier, refused by no gate. */
export const SYNTHETIC_WORKSPACE_ID_LABEL = "synthetic-workspace-id";

/**
 * Pure: whether a `raw-workspace-id` match is a synthetic id rather than a real one — it carries `FIXTURE`
 * (what `turn freeze` mints, and what a hand-written fixture id spells), carries `0SYN` (the synthetic shape
 * a sanitised record is rewritten to), or is exactly the one documentation example channel id the body spells.
 *
 * @param value the whole matched token
 * @returns true when the token is synthetic, so it reports as {@link SYNTHETIC_WORKSPACE_ID_LABEL}
 */
function isAllowedSyntheticWorkspaceId({ value }: { value: string }): boolean {
  return value.includes("FIXTURE") || value.includes("0SYN") || value === "C0123456789";
}

/**
 * The generic leak-class patterns. Token shapes require a real token suffix so a bare prefix never trips.
 *
 * Deliberately UNANCHORED, for the reason spelled out in `../corpus/redact.ts`: `\b` needs a word/non-word
 * transition before the match, so one preceding letter, digit or underscore makes the pattern miss. These two
 * shapes carried that anchor, which meant a committed `client_secret_<value>` or a concatenated `xsk-<key>` —
 * the commonest real spellings of both — passed the gate. Verified against every file before removing
 * them: unanchoring adds no hit, so the gate is strictly stronger, never noisier.
 *
 * ## Two of them then had to say what a credential actually LOOKS like
 *
 * Unanchoring was measured over THE WHOLE TREE, where it cost nothing. `./corpusScan.ts` pointed the same
 * patterns at 2,226,826 corpus records — human prose, full of URLs — and the cost showed up at once. MEASURED
 * (reproduce with `slopweaver audit hygiene --json`, counting the `leaks` arm by label):
 *
 * - `openai-style-key` as `sk-` + 20 of anything hit **106 records, none of them a key**. Every one was a
 *   slug whose last word ENDS in `sk` followed by an opaque id — `…/Research-Take-Home-Task-<32 hex>`,
 *   `…/Manage-cancer-risk-<32 hex>`, `…/Migration-to-Zendesk-<32 hex>` — plus two design notes quoting the
 *   synthetic `xsk-AAAA…` example from the unanchoring work itself.
 * - `slack-token` as `xox[bp]-` + 10 of `[A-Za-z0-9-]` hit **2 records, neither a token**: the hyphenated
 *   character class makes an English slug (`xoxp-covert-no-banner-footer-…`) match a bot token.
 *
 * Both are now written as the shape the PROVIDER issues rather than as a prefix plus a length floor, which is
 * a sharpening and not a relaxation — no real credential of either kind has ever had the shape that was
 * dropped. An OpenAI key is `sk-` + 48 base62 characters, or one of the `sk-proj-`/`sk-svcacct-`/`sk-admin-`
 * families; a Slack token's first segment after the prefix is always the workspace's numeric team id. Both
 * stay unanchored, so the `xsk-<real key>` concatenation the note above is about still fails the gate.
 * **The first attempt at the family arm was measured WRONG, and the way it was wrong is the lesson.** It was
 * checked by asking, of the records the OLD pattern hit, how many the new one still hit — which answered 0
 * and said nothing at all about `sk-proj-`/`sk-admin-`, a shape the old pattern could never match (its body
 * class has no `-`, so it stopped four characters in). Run UNCONDITIONALLY over the same corpus, that first
 * family arm hit **49 records, every one the Linear slug `…/request-for-zende` + `sk-admin-access…`**. A
 * differential measurement answers "did this get narrower", never "is this right".
 *
 * The final shapes, measured unconditionally over all 2,226,826 records: `sk-` + 48 base62 **0**, the family
 * arm with its uppercase lookahead **0**, `slack-token` **0** — against **106** and **2** for the old
 * spellings — with the six genuine `client-secret` hits untouched. Reproduce every count with
 * `slopweaver audit hygiene --json`, counting the `leaks` arm by label.
 *
 * `../corpus/redact.ts` deliberately keeps the LOOSE spellings. It is the scrubber, not the gate, and its
 * asymmetry runs the other way: over-scrubbing costs a URL slug's fidelity, under-scrubbing writes a secret
 * to disk. A gate's false positive is the expensive one, because it is what makes a red gate unactionable.
 */
const PATTERNS: readonly Pattern[] = [
  { credential: false, label: "absolute-home-path", re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/ },
  // A Slack token is `xox[bp]-<numeric team id>-…`. The numeric segment is what separates it from an English
  // slug, since the body's character class has to admit `-`.
  { credential: true, label: "slack-token", re: /xox[bp]-[0-9]{6,}-[A-Za-z0-9-]{10,}/ },
  // A Slack APP-level token (Socket Mode) is `xapp-<n>-<app id>-<numeric>-<64 hex>`, and a Linear API key is
  // `lin_api_` + exactly 40 base62. Neither had a class until a settings backup carrying one of each reached the
  // authored import, refused only because the same file also held an `xox[bp]-` token. Written as the shape
  // the provider issues, never a prefix plus a floor, so `lin_api_replay-not-real` and a 24-letter test fake
  // both stay out. MEASURED: 0 tracked files and 0 corpus files match either (repro:
  // `git grep -lE "<re>" | wc -l`, and `grep -rlE "<re>" ~/.slopweaver/corpus | wc -l`).
  { credential: true, label: "slack-app-token", re: /xapp-[0-9]+-[A-Z0-9]{8,}-[0-9]{6,}-[a-f0-9]{32,}/ },
  { credential: true, label: "linear-api-key", re: /lin_api_[A-Za-z0-9]{40}(?![A-Za-z0-9])/ },
  { credential: true, label: "github-oauth-token", re: /gh[po]_[A-Za-z0-9]{20,}/ },
  { credential: true, label: "github-pat", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  // `client-secret`, not `notion-secret`: the shape is Notion's integration secret AND a payment provider's
  // client secret (`…_secret_<hash>`), and on the real corpus every hit was the payment one.
  // A label naming the wrong provider sends the reader to the wrong place to revoke.
  { credential: true, label: "client-secret", re: /secret_[A-Za-z0-9]{16,}/ },
  // An OpenAI key is `sk-` + 48 base62, or a `sk-proj-`/`sk-svcacct-`/`sk-admin-` family key. `sk-` plus a
  // 20-character floor is not a key shape — it is the tail of `Task-`, `Risk-`, `Zendesk-` plus an id.
  //
  // The family arm's body class has to admit `-` and `_` (a project key is base64url), which is exactly what
  // makes a URL slug match it: `…/request-for-zende` + `sk-admin-access…` reads as `sk-admin-` plus a body.
  // The lookahead is what separates them — a slug is lowercase-and-hyphens by convention, while a
  // 48-character base64url body with not one uppercase letter has probability (38/64)^48, about 1 in 10^11.
  // Both halves are load-bearing: the length floor alone left all 49 slug hits standing.
  {
    credential: true,
    label: "openai-style-key",
    re: /sk-(?:proj|svcacct|admin)-(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{48,}|sk-[A-Za-z0-9]{48,}/,
  },
  // Raw Slack/Linear-style ID: a C/U/A/W/D/G/T/E prefix (channel, user, app, workspace, DM, group, team,
  // enterprise) + 8+ upper-alnum. Require at least one digit (the lookahead) so all-caps English words like
  // WARRANTIES / COPYRIGHT are not mistaken for IDs. Global, because a synthetic id earlier on a line must
  // not hide a real one after it — see {@link isAllowedSyntheticWorkspaceId}.
  {
    credential: false,
    label: "raw-workspace-id",
    re: /\b(?=[A-Z0-9]*[0-9])[CUAWDGTE][A-Z0-9]{8,}\b/g,
    synthetic: { allow: isAllowedSyntheticWorkspaceId, label: SYNTHETIC_WORKSPACE_ID_LABEL },
  },
  // An opaque 32+-hex identifier assigned to a query parameter whose name's last word is `id`/`ids` —
  // `?id=`, `?account.id=`, `?account_id=`, `?accountId=`, `?labelIds=`. A committed Polly cassette carried
  // the real Cloudflare account id in exactly this position four times, while the same value in the PATH
  // form `accounts/<id>` had already been collapsed, so nothing here ever looked at it.
  //
  // The `[?&]` prefix is what keeps this narrow, and it is a query SEPARATOR rather than the `\b` anchor the
  // note above warns off: a bare 32-hex run is not a leak class this gate can carry (measured over every
  // tracked file, it hits 24 cassettes and a config literal), whereas a hex value a URL has explicitly
  // LABELLED as an id is one. Measured over every file before landing: this pattern hit exactly the
  // four leaked entries in two files and nothing else. Reproduce with:
  //   git ls-files -z | xargs -0 grep -nEI '[?&][A-Za-z0-9_.%-]*[Ii][Dd][Ss]?=[0-9a-fA-F]{32,}'
  { credential: false, label: "id-query-param", re: /[?&][A-Za-z0-9_.%-]*[Ii][Dd][Ss]?=[0-9a-fA-F]{32,}/ },
];

/**
 * The labels whose match is a credential rather than an identifier.
 *
 * Derived from {@link PATTERNS} rather than written out a second time, so a pattern added above cannot
 * silently land in whichever arm a hand-kept list happened to default to — the author has to decide, on the
 * line where the pattern is declared.
 */
export const CREDENTIAL_LABELS: ReadonlySet<string> = new Set(
  PATTERNS.filter((pattern) => pattern.credential).map((pattern) => pattern.label),
);

/**
 * The label {@link scanContent} gives a private-denylist match.
 *
 * @internal — named so {@link isSecretHit} and its test agree on the one label that has no pattern.
 */
export const DENYLIST_LABEL = "denylist";

/**
 * Every label {@link scanContent} can report a REAL hit under — each pattern's own, and the denylist's —
 * derived from {@link PATTERNS} so a pattern added there joins it. A synthetic workspace id is not one.
 */
export const LEAK_LABELS: readonly string[] = [...PATTERNS.map((pattern) => pattern.label), DENYLIST_LABEL];

/**
 * Pure: whether a hit is a SECRET, and so whether it fails a gate.
 *
 * One function rather than `CREDENTIAL_LABELS.has(label) || label === "denylist"` written out at each
 * verdict site: the repository gate, the corpus gate and the pull-request metadata check all have to answer
 * it identically, and the denylist arm is the half that was easy to forget — it carries no pattern, so it is
 * in neither {@link PATTERNS} nor {@link CREDENTIAL_LABELS}, while under the literal-secret mandate its content
 * is exactly a secret.
 *
 * @param label the hit's label
 * @returns true when the hit is a credential or a private-denylist word
 */
export function isSecretHit({ label }: { label: string }): boolean {
  return label === DENYLIST_LABEL || CREDENTIAL_LABELS.has(label);
}

/** Whether a forbidden-identifier hit is reported and passes, or fails the repository and PR gates. */
export type IdentifierVerdict = "report" | "refuse";

/**
 * The forbidden-identifier verdict for the repository and pull-request gates. `report` prints every hit and
 * passes; `refuse` fails on any. One constant, so the two gates can never answer differently, and the prose that
 * describes them names the switch rather than restating its value.
 */
export const IDENTIFIER_VERDICT = "refuse" as IdentifierVerdict;

/**
 * The labels {@link IDENTIFIER_VERDICT} governs — every kind `./identifierScan.ts` reports, and this file's own
 * `raw-workspace-id`. Its synthetic stand-ins report under {@link SYNTHETIC_WORKSPACE_ID_LABEL}, outside this set.
 */
export const REFUSABLE_IDENTIFIER_LABELS: ReadonlySet<string> = new Set<string>([
  ...IDENTIFIER_KINDS,
  "raw-workspace-id",
]);

/**
 * Pure: whether a hit fails the REPOSITORY or PULL-REQUEST gate — a secret always, a forbidden identifier
 * once {@link IDENTIFIER_VERDICT} is `refuse`.
 *
 * Distinct from {@link isSecretHit} on purpose. The corpus and authored-file consumers ask only whether a
 * credential got in, because their subject IS the organisation's own data; the repository, its pull-request text
 * and a worktree salvage pushed to it are what leaves it, so they ask this wider question.
 *
 * @param label the hit's label
 * @returns true when the hit fails the gate
 */
export function isRefusedHit({ label }: { label: string }): boolean {
  return isSecretHit({ label }) || (IDENTIFIER_VERDICT === "refuse" && REFUSABLE_IDENTIFIER_LABELS.has(label));
}

/**
 * The outcome of reading a line-list file. `absent` and `unreadable` are DIFFERENT answers on purpose: the
 * denylist is optional, so a missing file is the normal state of a fresh checkout, but a file that exists and
 * cannot be read is a gate that is about to report clean over words it never loaded.
 */
export type LineListLoad =
  | { readonly kind: "loaded"; readonly lines: readonly string[] }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly path: string; readonly reason: string };

/**
 * Read a newline-delimited list file, distinguishing "no such file" from "could not read it".
 *
 * The previous version collapsed both into `[]`. That is the silent-failure shape this repo keeps paying
 * for: an unreadable denylist produced an empty word list, and the gate then printed `clean` over a tree it
 * had not actually checked for org identifiers.
 *
 * An `ENOENT` is `absent` only when NO name sits at the path. A dangling symlink also reads `ENOENT`, but it is a
 * list somebody configured whose target has gone, so reading it as absent would scan or mask against nothing while
 * reporting clean.
 *
 * @param path the absolute file path to read
 * @param readText the reader (injected so the unreadable branch is testable without chmod)
 * @param nameExists whether any directory entry, a dangling link included, sits at the path — asked only on `ENOENT`
 * @returns the loaded lines, or which of the two failure kinds occurred
 */
export function loadLineListResult({
  path,
  readText,
  nameExists,
}: {
  path: string;
  readText?: (args: { path: string }) => string;
  nameExists?: (args: { path: string }) => boolean;
}): LineListLoad {
  const loaded = loadTextFileResult({
    path,
    ...(readText === undefined ? {} : { readText }),
    ...(nameExists === undefined ? {} : { nameExists }),
  });
  if (loaded.kind !== "loaded") {
    return loaded;
  }
  return {
    kind: "loaded",
    lines: loaded.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#")),
  };
}

/** The outcome of reading one whole text file: its text, no file at all, or a file that could not be read. */
export type TextFileLoad =
  | { readonly kind: "loaded"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly path: string; readonly reason: string };

/**
 * Read one whole text file, distinguishing "no such file" from "could not read it" exactly as
 * {@link loadLineListResult} does, without splitting it: the private-terms reader (`./privateTerms.ts`) needs every
 * physical line, comments included, to number its rows.
 *
 * @param path the absolute file path to read
 * @param readText the reader (injected so the unreadable branch is testable without chmod)
 * @param nameExists whether any directory entry, a dangling link included, sits at the path — asked only on `ENOENT`
 * @returns the whole text, or which of the two failure kinds occurred
 */
export function loadTextFileResult({
  path,
  readText = ({ path: p }) => readFileSync(p, "utf8"),
  nameExists = ({ path: p }) => lstatSync(p, { throwIfNoEntry: false }) !== undefined,
}: {
  path: string;
  readText?: (args: { path: string }) => string;
  nameExists?: (args: { path: string }) => boolean;
}): TextFileLoad {
  try {
    return { kind: "loaded", text: readText({ path }) };
  } catch (error) {
    const code = isRecord(error) ? error["code"] : undefined;
    if (code === "ENOENT" && nameExists({ path })) {
      return { kind: "unreadable", path, reason: "ENOENT: a dangling link sits at the path" };
    }
    if (code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unreadable", path, reason: typeof code === "string" ? code : "read failed" };
  }
}

/**
 * Read the optional private denylist, resolving the home the same way every other module does.
 *
 * The home defaults to {@link slopweaverHome}, NOT to a raw `process.env["SLOPWEAVER_HOME"]` read. That
 * distinction was the whole bug: the resolver falls back to `~/.slopweaver`, the raw read yields `undefined`
 * when the variable is unset, and `scripts/check-hygiene.sh` never sets it — so the private denylist was
 * silently empty in every `yarn validate` and every pre-push.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @param readText the reader (injected for tests)
 * @returns the load outcome; callers must decide what `unreadable` means for them
 */
export function loadDenylistResult({
  home = slopweaverHome(),
  readText,
}: {
  home?: string;
  readText?: (args: { path: string }) => string;
} = {}): LineListLoad {
  return loadLineListResult({
    path: stateHomePaths({ home }).hygieneDenylist,
    ...(readText === undefined ? {} : { readText }),
  });
}

/**
 * The denylist substrings, treating an unreadable list as fatal.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @param readText the reader (injected for tests)
 * @returns the denylist substrings; `[]` only when the file genuinely does not exist
 * @throws when the denylist exists but cannot be read — never silently empty
 */
export function loadDenylist({
  home,
  readText,
}: {
  home?: string;
  readText?: (args: { path: string }) => string;
} = {}): readonly string[] {
  const loaded = loadDenylistResult({
    ...(home === undefined ? {} : { home }),
    ...(readText === undefined ? {} : { readText }),
  });
  if (loaded.kind === "unreadable") {
    throw new Error(unreadableDenylistMessage({ load: loaded }));
  }
  return loaded.kind === "absent" ? [] : loaded.lines;
}

/**
 * The refusal a denylist that exists and cannot be read earns, in one place so the throwing caller and the
 * printing one can never drift apart.
 *
 * @param load the unreadable load outcome
 * @returns the sentence to throw or print
 */
export function unreadableDenylistMessage({ load }: { load: Extract<LineListLoad, { kind: "unreadable" }> }): string {
  return (
    `hygiene: the private denylist at ${load.path} exists but could not be read (${load.reason}). ` +
    `Refusing to scan with an empty denylist — that would report clean over this install's own secret strings.`
  );
}

/**
 * Pure: the one line this gate ALWAYS prints saying whether the private denylist was applied, and with how
 * many words.
 *
 * Stated on a clean run as well as a red one, which is the whole point. Three of the four load outcomes used
 * to be indistinguishable in the output: an ABSENT denylist and one that exists but holds no word both
 * scanned leak CLASSES only and then printed `clean`, with nothing saying the local half never ran. That is
 * what CI does today, twice over and in two different ways — the `build` job sets no `$SLOPWEAVER_HOME` at
 * all, so the list is absent, and the `dev-gate` job runs `slopweaver init`, whose seed is comment lines
 * only, so the list loads EMPTY. Only the `unreadable` outcome ever announced itself (by refusing), so the
 * weakest runs were the quietest ones.
 *
 * It does not FAIL on an empty or absent list, and that is deliberate rather than an omission: the denylist
 * is optional by design — a fork or a fresh checkout legitimately has none, and CI structurally cannot hold
 * one (see `docs/security/hygiene-gate.md` § "Where the private denylist actually applies"). What was missing was never
 * a refusal; it was a reader being able to tell which run they were looking at. An EMPTY list is also the
 * normal state because the mandate is literal secret strings: an install with
 * no unmatchable secret of its own has nothing to put in one.
 *
 * @param load the denylist load outcome
 * @returns the single status line, without a trailing newline
 */
export function denylistStatusLine({ load }: { load: LineListLoad }): string {
  if (load.kind === "absent") {
    return (
      "hygiene: private denylist NOT PRESENT — leak CLASSES only, no local secret strings " +
      "(create $SLOPWEAVER_HOME/hygiene-denylist.txt)"
    );
  }
  if (load.kind === "unreadable") {
    return `hygiene: private denylist UNREADABLE at ${load.path} (${load.reason}) — nothing was applied`;
  }
  if (load.lines.length === 0) {
    return (
      "hygiene: private denylist PRESENT BUT EMPTY — leak CLASSES only, no local secret strings " +
      "(every line is blank or a comment)"
    );
  }
  return `hygiene: private denylist LOADED, ${String(load.lines.length)} word(s) applied`;
}

/**
 * Pure: every leak-class + denylist hit in one file's content, with line numbers. Never throws.
 *
 * Returns EVERY hit, credential and identifier alike. The verdict is the caller's: `./repoScan.ts`'s `runScan` fails on
 * a secret always and on a real workspace id wherever {@link IDENTIFIER_VERDICT} reads `refuse`, reporting
 * the rest (the forbidden-identifier rules are a separate gate's), while `turn freeze` and the cassette
 * tripwire refuse on any hit at all,
 * because a committed fixture is redacted by allowlist and a surviving identifier there means the allowlist
 * missed something.
 *
 * @param path the file's identity for reporting — never read from disk here
 * @param content the already-read text of one file
 * @param denylist the local secret strings, loaded at runtime from the uncommitted home file so this scanner
 *   never has to contain the very words it guards against
 * @returns every hit with its line number, in line order
 */
export function scanContent({
  path,
  content,
  denylist,
}: {
  path: string;
  content: string;
  denylist: readonly string[];
}): readonly Hit[] {
  const hits: Hit[] = [];
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    for (const pattern of PATTERNS) {
      const match = firstMatch({ line, pattern });
      if (match !== undefined) {
        hits.push({ excerpt: match.excerpt, label: match.label, line: index + 1, path });
      }
    }
    const lower = line.toLowerCase();
    for (const needle of denylist) {
      if (lower.includes(needle.toLowerCase())) {
        hits.push({ excerpt: needle, label: DENYLIST_LABEL, line: index + 1, path });
      }
    }
  });
  return hits;
}

/**
 * Pure: one pattern's hit on one line — its first real match, else its first synthetic one under
 * {@link Pattern.synthetic}'s label, so a line that matches at all always yields exactly one hit.
 *
 * @param line one line of a file
 * @param pattern the leak class to apply
 * @returns the matched text and the label it reports under, or `undefined` when nothing on the line matches
 */
function firstMatch({
  line,
  pattern,
}: {
  line: string;
  pattern: Pattern;
}): { excerpt: string; label: string } | undefined {
  const { label, re, synthetic } = pattern;
  if (synthetic === undefined) {
    const excerpt = re.exec(line)?.[0];
    return excerpt === undefined ? undefined : { excerpt, label };
  }
  const matches = [...line.matchAll(re)].map((match) => match[0]);
  const real = matches.find((value) => !synthetic.allow({ value }));
  if (real !== undefined) {
    return { excerpt: real, label };
  }
  const firstSynthetic = matches[0];
  return firstSynthetic === undefined ? undefined : { excerpt: firstSynthetic, label: synthetic.label };
}
