/**
 * The BARE-REFERENCE resolver — finding `#N`, `owner/repo#N`, a PR number sitting bare in a
 * merged/open/closed list, a Linear key like `SUP-123`, and a COMPLIANCE CONTROL id like `HRS-52` inside
 * composed text, and turning each into a real link when the context makes that unambiguous.
 *
 * ## The defect this closes
 *
 * A dogfood answer in #dev-alerts listed `"merged, 8: 15632, 15717, 15718, 15721, 15723, 15724, 15897,
 * 15900"` as bare digits, in the SAME message where other references rendered as real links — the owner's
 * ruling was that a bare `#N`/`SUP-123` must never reach an outbound surface as plaintext.
 * The failure was inconsistent linking (some runs typed correctly, some not), so detection has to look at
 * every text run independently rather than short-circuit once a message carries any link at all.
 *
 * ## Two spellings, one core
 *
 * `#N` and `owner/repo#N` are unambiguous AS a reference — nothing else spells that. A bare run of
 * digits is not: "5 servers" is not a PR list. So a digit-only span is only ever a candidate when it sits in
 * a `merged`/`open`/`closed` + colon list, mirroring the exact shape of the incident this module exists to
 * fix. `SUP-123` is unambiguous in FORM but not in REFERENT — `UTC-5` and `ISO-8601` share its shape — so a
 * Linear-key-shaped span is only ever a candidate when its prefix is a team key the caller's context
 * actually names; with no known team keys it is left as ordinary prose, never guessed.
 *
 * ## The third kind, and the whole class it closes
 *
 * The owner's ruling came off a bot answer in the owner's own DM that listed nine compliance control
 * ids — `HRS-52`, `HRS-53`, `DCH-108`, `HRS-56`, `BCD-69`, `CRY-56`, `DCH-111`, `GOV-109`, `TDA-42` — every
 * one of them plain text. Every ticket should be a link, a hyperlink over the text. This door did not miss them. It could
 * not SEE them: a control externalId wears the same `ABC-123` costume as a Linear key, its prefix is a compliance domain rather than a Linear team,
 * and {@link scanLinearKeyRefs} rejects exactly that, silently and correctly. There was no residue to
 * refuse. That is a missing reference CLASS, not a broken matcher, and it recurs for every provider whose
 * ids look like this.
 *
 * So candidacy for a control id is gated on {@link BareRefContext.complianceControls} — the EXACT ids this
 * install's own compliance atlas holds, not a prefix list. Tighter than the Linear gate on purpose, and the
 * reason is measured: of the 228 control ids in this install's atlas (reproduce with
 * `jq -r '.channels["manage-api"].detail.externalId // empty' ~/.slopweaver/atlas/vanta/controls.jsonl`),
 * 25 are bare three-digit numbers (`200` … `224`) and three are `C-1`/`C-200`/`C-201`. Treating those as
 * references would turn "224 tests" into a link. {@link CONTROL_ID_SHAPE} is what excludes them — two to six
 * capitals before the dash — so 200 of the 228 are reachable and the other 28 are deliberately, statedly out
 * of scope because nothing distinguishes them from ordinary prose.
 *
 * ## Resolution is separate from candidacy
 *
 * A span found by {@link scanBareRefs} is a REFERENCE by construction (or it would not have been a
 * candidate at all). Whether it can become a real URL depends on {@link BareRefContext}: `owner/repo#N`
 * always resolves (the slug is explicit); a bare `#N` resolves only when the context names exactly one
 * repo — two or zero is genuinely ambiguous, and this module does not guess. A Linear key resolves only when
 * the context also carries a workspace slug to build the URL from. A control id resolves only when the
 * context carries a real per-control URL for that exact id.
 *
 * A control's URL does not come from the provider, and the route it DOES come from is why this module takes
 * the URL as data instead of building it. Vanta's Manage API returns no link for a control at all —
 * `src/atlas/vanta/projection.ts` records `deepLinkStatus: "unavailable"` on every one, still true after a
 * browser walk, because the walk fills the browser kinds and not the control kind. The real shape was
 * established from Vanta's own web client instead: asking for the controls page redirects to
 * `…/controls?controlId=<providerId>`, a query parameter rather than a path segment (MEASURED,
 * `slopweaver atlas vanta walk`; reproduce with
 * `grep -o '"finalUrl":"[^"]*controls[^"]*"' "$SLOPWEAVER_HOME"/atlas/vanta/browser-pages.jsonl`).
 *
 * The `controlId` in it is the PROVIDER id, never the printed externalId — `DCH-108` is `0syn0001` — so the
 * href cannot be derived from the text at any price, and the caller's own atlas is the only lookup that
 * yields one. That is what makes {@link BareRefContext.complianceControls} a table rather than an allowlist,
 * and it is the second, stronger reason candidacy is gated on it.
 *
 * A control the caller's table does not hold stays ordinary prose, silently, with nothing refused. That is a
 * real hole and it is stated rather than papered over: this module cannot refuse what it cannot recognise,
 * and inventing a route for an id it has never seen is the class of confident wrongness it exists to close.
 * An author is never stuck either way — text that is already `[HRS-52](url)` is excluded from the scan
 * entirely (see {@link ALREADY_LINKED}).
 *
 * ## What "exactly one repo" means: the TEXT wins over the checkout
 *
 * MEASURED: the as-me Slack reply lane resolved a bare five-digit number typed in an acme-admin DM against
 * this repository's own `issues/<number>` URL — the wrong repo, and a dead link, because every
 * caller's {@link BareRefContext} was built from the CLI checkout's own `origin` remote (this repo), and a
 * Slack reply is not scoped to the checkout it was composed from the way a `git`/`gh` command is. The
 * refuse-when-ambiguous gate came first; this closes the DEFAULT that fed it a repo the message was never
 * about. So before "exactly one repo" is asked of `context.repos`, {@link spliceLinks} and
 * {@link bareRefIssuesOfPlainText} first look at the SAME text for a full `github.com/<owner>/<repo>` link
 * already present — a PR the author spelled out in full is the strongest signal of what a bare ref in the
 * same message means. When the text names at least one repo this way, that list REPLACES the caller-supplied
 * `context.repos` for this call; naming none falls back to whatever the caller passed (the checkout's repo,
 * for most callers). Naming two different repos is exactly as ambiguous as `context.repos` naming two, and
 * resolves the same way: not at all.
 *
 * ## A number that CANNOT be one of this repo's own
 *
 * MEASURED on a pull request in this repository: its body cited three `acme/acme-admin` pull
 * requests as bare five-digit numbers, and the pull-request door linked all three into
 * this repository's `issues/…` — three unrelated objects, in a body whose Proof cell read as
 * verified. Both format gates accepted it. "Exactly one repo" held perfectly: a pull request's own repo is
 * named by its form's own target and is never ambiguous, so the sole-repo rule had nothing to refuse.
 *
 * The missing test is MAGNITUDE. That repository's own numbering was three digits; a five-digit number
 * cannot be one of its own. So a caller may supply {@link BareRefContext.attested} — numbers something
 * checkable already proved exist in a repo — and a bare `#N` carrying MORE DIGITS than the largest number
 * attested for the repo it would resolve against does not resolve at all. The digit count is the whole test,
 * deliberately: it is the coarsest bound that still catches a cross-repo cite between repositories two
 * orders of magnitude apart, and being coarse is what keeps it from refusing an ordinary next number.
 *
 * The check is EVIDENCE-GATED, and that is the honest limit rather than an oversight. With nothing attested
 * for the repo, nothing is refused — this cannot invent a repo's scale, and guessing one would be the same
 * class of confident wrongness it exists to close. It is also one-directional: a bare three-digit number on a five-digit
 * repository stays resolvable, because it may genuinely be one of that repository's own.
 *
 * The alternative considered and REJECTED: refuse every bare reference whenever the body links more than one
 * repo. That is the sole-repo rule widened, and it would have refused the hand-fixed body itself —
 * whose bare numbers are legitimate, correct references to its own repository sitting beside links to
 * the other one. Over-refusal on a page that links two repos is already a measured cost of this rule
 * (`src/briefing/bareRef.ts`); spreading it to every pull-request body would buy nothing the magnitude test
 * does not already buy.
 *
 * ## Why this lives outside every outbound schema
 *
 * `../artifact/schema.ts` and `../linear/schema.ts` are static, module-level Zod objects — the same reason
 * `../../cli/aboveFoldDoor.ts` is a DOOR rather than a schema refinement: which repo(s) a turn is about and
 * which Linear workspace it writes into are facts the CLI edge holds, not facts a schema parsing one
 * document in isolation can see. So resolution and residue-checking happen at the same layer aboveFold
 * already lives at, over an already-validated form, right before it renders.
 */

import { githubRefRefusal, isGithubRepoRef } from "./githubRepoRef.js";
import { isInertLinkUrl } from "./inertLinkUrl.js";
import { linearIssueUrl, linearKeyRefusal } from "./linearWorkspaceSlug.js";

/** A GitHub repository coordinate a bare `#N` may resolve against. */
export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

/**
 * One object number KNOWN to exist in a repo, because something checkable already named it — a full
 * `github.com/<owner>/<repo>/(pull|issues|discussions)/<n>` link in the same text, or the pull request a
 * door is writing to.
 *
 * This is the evidence {@link resolveBareRef} weighs a bare `#N`'s MAGNITUDE against. See the module doc's
 * "a number that cannot be one of this repo's own" section.
 */
export interface AttestedNumber extends RepoRef {
  readonly number: number;
}

/** What a caller knows about the turn's destination, for resolving a bare reference into a real link. */
export interface BareRefContext {
  /** The repo(s) the turn is about. A bare `#N` (no explicit owner/repo) resolves only when this has exactly one. */
  readonly repos: readonly RepoRef[];
  /** The Linear workspace's `urlKey`, for building `https://linear.app/<slug>/issue/<KEY>`. */
  readonly linearWorkspaceSlug?: string | undefined;
  /** Every team key the connected Linear workspace has, so `SUP-123` is recognised and `UTC-5` is not. */
  readonly linearTeamKeys?: readonly string[] | undefined;
  /** Numbers already known to exist in a repo, which bound how large a bare `#N` there can plausibly be. */
  readonly attested?: readonly AttestedNumber[] | undefined;
  /**
   * Every compliance control this install's atlas actually holds, so `HRS-52` is recognised and `ISO-9001`
   * is not. Candidacy is the EXACT id, never its prefix — see the module doc's third-kind section for the
   * measurement that made prefix matching unusable here.
   */
  readonly complianceControls?: readonly ComplianceControlRef[] | undefined;
}

/**
 * One compliance control a bare `HRS-52` may resolve against — its own id, and the real per-control URL if
 * the provider gave one.
 *
 * `url: null` is the normal case rather than a defect: Vanta's Manage API hands back no per-control link at
 * all. A null makes the id a RECOGNISED reference that cannot resolve, which is what turns it into a named
 * refusal instead of the silent plaintext the owner found.
 */
export interface ComplianceControlRef {
  readonly id: string;
  readonly url: string | null;
}

/** A bare `#N` or `owner/repo#N` found in text. */
interface GithubRefSpan {
  readonly kind: "githubRef";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  /** Present only for the explicit `owner/repo#N` spelling. */
  readonly owner: string | undefined;
  readonly repo: string | undefined;
  readonly number: number;
}

/** A `SUP-123`-shaped Linear key, already confirmed against the caller's known team keys. */
export interface LinearKeySpan {
  readonly kind: "linearKey";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly key: string;
}

/**
 * An `HRS-52`-shaped compliance control id, already confirmed against the caller's known controls.
 *
 * @internal
 */
export interface ControlIdSpan {
  readonly kind: "controlId";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly id: string;
}

/** One bare reference found in composed text, before resolution decides whether it can become a link. */
export type BareRefSpan = GithubRefSpan | LinearKeySpan | ControlIdSpan;

/** A bare reference resolved to the real object it names. */
interface ResolvedBareRef {
  readonly label: string;
  readonly url: string;
}

/**
 * `owner/repo#N`, or a bare `#N` not already part of a slug form.
 *
 * The alternation puts the slug form first so a single left-to-right pass can never let the bare-`#` arm
 * fire inside `owner/repo#N` and produce two overlapping spans — the same trick `../artifact/typedRuns.ts`
 * uses for its own two patterns.
 */
const GITHUB_HASH_REF =
  /(?<slugOwner>[A-Za-z0-9][A-Za-z0-9._-]*)\/(?<slugRepo>[A-Za-z0-9][A-Za-z0-9._-]*)#(?<slugNumber>\d{1,7})\b|(?<![\w/#])#(?<bareNumber>\d{1,7})\b/g;

/** A `SUP-123`-shaped token — candidacy is decided later, against the caller's known team keys. */
const LINEAR_KEY_SHAPE = /\b(?<linearKey>[A-Z]{2,6}-\d{1,6})\b/g;

/**
 * An `HRS-52`-shaped token — the SAME costume a Linear key wears, which is exactly why the module doc calls
 * this a missing class rather than a broken matcher. Candidacy is decided later, against the caller's known
 * control ids; the shape's job here is only to keep a control id whose own spelling is indistinguishable
 * from prose (`224`, `C-1`) from ever becoming a candidate at all.
 */
const CONTROL_ID_SHAPE = /\b(?<controlId>[A-Z]{2,6}-\d{1,6})\b/g;

/**
 * A `merged`/`open`/`closed` PR list: the keyword, up to 24 characters of lead-in (a count, a colon), then
 * one or more comma-separated bare digit runs. This is the ONLY shape a bare digit run is ever treated as a
 * reference — the exact anatomy of the dogfood incident this module exists to fix, and narrow on purpose so
 * an ordinary sentence with a number in it is never mistaken for a PR list.
 */
const PR_LIST_CONTEXT = /\b(?:merged|open|closed)\b[^\n:]{0,24}:\s*(?<numberList>\d{3,7}(?:\s*,\s*\d{3,7})*)/dgi;

/** One digit run inside an already-matched {@link PR_LIST_CONTEXT} number list. */
const LIST_NUMBER = /\d{3,7}/g;

/** Sort by start, then drop anything that starts before the previous accepted span ended. */
function withoutOverlaps({ spans }: { spans: readonly BareRefSpan[] }): readonly BareRefSpan[] {
  const ordered = spans.toSorted((left, right) => left.start - right.start);
  const kept: BareRefSpan[] = [];
  let cursor = 0;
  for (const span of ordered) {
    if (span.start >= cursor) {
      kept.push(span);
      cursor = span.end;
    }
  }
  return kept;
}

/**
 * The words that make a following `#N` an ALERT number rather than an issue or pull-request number.
 *
 * A Dependabot alert number and a pull-request number are both small integers in the same repository, and
 * this scanner cannot tell them apart from the digits. It used to resolve both the same way, so a body
 * closing a Dependabot alert by its number was silently rewritten to link `/issues/<number>` — a valid link node
 * to the wrong object, which no later gate inspects. MEASURED against these exported functions:
 * that text scanned to `{kind:"githubRef",number:N}` and resolved to `https://github.com/o/r/issues/N`.
 *
 * So a `#N` introduced by one of these words is NOT SCANNED at all. It is left as prose for the caller to
 * replace with a real citation — `../github/dependabotLink.ts` owns that URL and builds it from the number,
 * so the correct link cannot be typed wrong. Refusing to resolve is the deterministic answer here: guessing
 * which of two objects was meant is exactly what produced the defect.
 */
const ALERT_CONTEXT = /(?:alert|advisory|dependabot)\s*$/i;

/** Whether the text immediately before a match introduces it as an alert number. */
function precededByAlertContext({ text, start }: { text: string; start: number }): boolean {
  return ALERT_CONTEXT.test(text.slice(0, start));
}

/** Every `#N` / `owner/repo#N` span in the text, regardless of whether it can later resolve. */
function scanGithubHashRefs({ text }: { text: string }): readonly GithubRefSpan[] {
  const spans: GithubRefSpan[] = [];
  for (const match of text.matchAll(GITHUB_HASH_REF)) {
    // GITHUB_HASH_REF declares named groups, so every match carries `groups`. Its two arms each capture their
    // own number, and only the slug arm captures `slugOwner` — so that group says which arm matched.
    const groups = match.groups!;
    const numberText = groups["slugOwner"] === undefined ? groups["bareNumber"]! : groups["slugNumber"]!;
    const start = match.index;
    if (precededByAlertContext({ start, text })) {
      continue;
    }
    spans.push({
      end: start + match[0].length,
      kind: "githubRef",
      number: Number.parseInt(numberText, 10),
      owner: groups["slugOwner"],
      raw: match[0],
      repo: groups["slugRepo"],
      start,
    });
  }
  return spans;
}

/** Every bare digit run inside a `merged`/`open`/`closed` list, each as its own reference candidate. */
function scanPrListRefs({ text }: { text: string }): readonly GithubRefSpan[] {
  const spans: GithubRefSpan[] = [];
  for (const match of text.matchAll(PR_LIST_CONTEXT)) {
    // `d` flag requested above; `indices` is present whenever a capturing group participated in the match.
    const listRange = (match as RegExpMatchArray & { indices?: { groups?: Record<string, [number, number]> } }).indices
      ?.groups?.["numberList"];
    if (listRange === undefined) {
      continue;
    }
    const [listStart] = listRange;
    // `listRange` came from `indices.groups`, which is set exactly when `match.groups` is — so the same
    // named group is present here too.
    const list = match.groups!["numberList"]!;
    for (const number of list.matchAll(LIST_NUMBER)) {
      const start = listStart + number.index;
      spans.push({
        end: start + number[0].length,
        kind: "githubRef",
        number: Number.parseInt(number[0], 10),
        owner: undefined,
        raw: number[0],
        repo: undefined,
        start,
      });
    }
  }
  return spans;
}

/** Every `SUP-123`-shaped span whose prefix is one of the caller's known team keys. */
function scanLinearKeyRefs({ text, context }: { text: string; context: BareRefContext }): readonly LinearKeySpan[] {
  const known = context.linearTeamKeys;
  if (known === undefined || known.length === 0) {
    return [];
  }
  const knownSet = new Set(known);
  const spans: LinearKeySpan[] = [];
  for (const match of text.matchAll(LINEAR_KEY_SHAPE)) {
    const key = match.groups?.["linearKey"];
    if (key === undefined) {
      continue;
    }
    const prefix = key.slice(0, key.lastIndexOf("-"));
    if (!knownSet.has(prefix)) {
      continue;
    }
    const start = match.index;
    spans.push({ end: start + key.length, key, kind: "linearKey", raw: key, start });
  }
  return spans;
}

/** Every `HRS-52`-shaped span whose whole id is one of the caller's known compliance controls. */
function scanControlIdRefs({ text, context }: { text: string; context: BareRefContext }): readonly ControlIdSpan[] {
  const known = context.complianceControls;
  if (known === undefined || known.length === 0) {
    return [];
  }
  const knownSet = new Set(known.map((control) => control.id));
  const spans: ControlIdSpan[] = [];
  for (const match of text.matchAll(CONTROL_ID_SHAPE)) {
    const id = match.groups?.["controlId"];
    if (id === undefined || !knownSet.has(id)) {
      continue;
    }
    const start = match.index;
    spans.push({ end: start + id.length, id, kind: "controlId", raw: id, start });
  }
  return spans;
}

/**
 * Every bare reference in a piece of composed text, left to right, never overlapping.
 *
 * A candidate here is a REFERENCE by construction — `#N`/`owner/repo#N` unconditionally, a bare digit
 * run only inside a `merged`/`open`/`closed` list, a `SUP-123` shape only when its prefix is a team key
 * `context` actually names, and an `HRS-52` shape only when the WHOLE id is a control `context` actually
 * holds. Whether a candidate can become a real URL is {@link resolveBareRef}'s question, not this function's.
 *
 * A Linear key and a control id wear one costume, so an install whose Linear team key collides with a
 * compliance domain would find one token matching both scans. The Linear spans reach
 * {@link withoutOverlaps} FIRST and its sort is stable, so Linear wins that tie — deliberately, because a
 * Linear key always resolves to a real issue URL while a control id currently resolves to nothing.
 *
 * @param text the composed prose to scan
 * @param context what the caller knows about the destination — `linearTeamKeys` and `complianceControls`
 *   are the two fields that affect candidacy here
 * @returns every span found, in document order
 */
export function scanBareRefs({ text, context }: { text: string; context: BareRefContext }): readonly BareRefSpan[] {
  return withoutOverlaps({
    spans: [
      ...scanGithubHashRefs({ text }),
      ...scanPrListRefs({ text }),
      ...scanLinearKeyRefs({ context, text }),
      ...scanControlIdRefs({ context, text }),
    ],
  });
}

/** The one repo a bare `#N` may resolve against, or undefined when the context is empty or ambiguous. */
function soleRepo({ context }: { context: BareRefContext }): RepoRef | undefined {
  return context.repos.length === 1 ? context.repos[0] : undefined;
}

/**
 * The largest number anything has attested actually exists in one repo, or undefined when nothing has.
 *
 * Undefined is the normal case for most callers and means "no magnitude evidence", never "nothing exists".
 */
function largestAttested({ context, repo }: { context: BareRefContext; repo: RepoRef }): number | undefined {
  // A caller with no magnitude evidence omits `attested`, which attests nothing here either.
  const numbers = context.attested
    ?.filter((entry) => entry.owner === repo.owner && entry.repo === repo.repo)
    .map((entry) => entry.number);
  return numbers === undefined || numbers.length === 0 ? undefined : Math.max(...numbers);
}

/**
 * Whether a bare number is too big to be one of `repo`'s own — strictly more digits than the largest number
 * attested for it. See the module doc's "a number that CANNOT be one of this repo's own" section for why the
 * test is digit count rather than a ratio, and why no attestation means no refusal.
 */
function magnitudeImplausible({
  context,
  repo,
  number,
}: {
  context: BareRefContext;
  repo: RepoRef;
  number: number;
}): boolean {
  const witness = largestAttested({ context, repo });
  if (witness === undefined) {
    return false;
  }
  return String(number).length > String(witness).length;
}

/** A full `github.com/<owner>/<repo>` link, however it is spelled — the anchor for {@link reposNamedInText}. */
const GITHUB_REPO_URL =
  /https?:\/\/github\.com\/(?<owner>[A-Za-z0-9][A-Za-z0-9._-]*)\/(?<repo>[A-Za-z0-9][A-Za-z0-9._-]*)\b/g;

/**
 * Every distinct repo a full `github.com/<owner>/<repo>` link already names in the text, in first-seen
 * order — see the module doc's "the TEXT wins over the checkout" section for why this exists and how a
 * caller's own `context.repos` is overridden by it.
 *
 * @param text the composed text a bare reference is being resolved inside
 * @returns the repos named by a link already present, or empty when the text names none
 */
function reposNamedInText({ text }: { text: string }): readonly RepoRef[] {
  const seen = new Map<string, RepoRef>();
  for (const match of text.matchAll(GITHUB_REPO_URL)) {
    const owner = match.groups?.["owner"];
    const repo = match.groups?.["repo"];
    if (owner === undefined || repo === undefined) {
      continue;
    }
    const key = `${owner}/${repo}`;
    if (!seen.has(key)) {
      seen.set(key, { owner, repo });
    }
  }
  return [...seen.values()];
}

/**
 * A full link to a numbered GitHub object, in any of the three spellings GitHub itself uses. `pull` and
 * `issues` share a numbering sequence, so either one attests the same scale. A repository name may open on
 * `.`, `_` or `-` (an organisation's `.github` repository), an owner may not.
 */
const GITHUB_OBJECT_URL =
  /https?:\/\/github\.com\/(?<owner>[A-Za-z0-9][A-Za-z0-9._-]*)\/(?<repo>[A-Za-z0-9._-]+)\/(?:pull|issues|discussions)\/(?<number>\d{1,7})\b/g;

/**
 * Every object number a full GitHub link in the text proves exists — the magnitude evidence a bare `#N` in
 * the same text is weighed against.
 *
 * @param text the composed text, before anything in it is linkified
 * @returns one attestation per numbered GitHub link found, duplicates included
 */
export function attestedNumbersInText({ text }: { text: string }): readonly AttestedNumber[] {
  const found: AttestedNumber[] = [];
  for (const match of text.matchAll(GITHUB_OBJECT_URL)) {
    const owner = match.groups?.["owner"];
    const repo = match.groups?.["repo"];
    const number = match.groups?.["number"];
    if (owner === undefined || repo === undefined || number === undefined) {
      continue;
    }
    found.push({ number: Number.parseInt(number, 10), owner, repo });
  }
  return found;
}

/**
 * {@link attestedNumbersInText} over a list of URLs a caller already holds structurally — a form's `link`
 * runs, say, whose URLs never appear in any prose this module would otherwise scan.
 *
 * @param urls the URLs to read attestations out of
 * @returns one attestation per numbered GitHub URL, duplicates included
 */
export function attestedNumbersInUrls({ urls }: { urls: readonly string[] }): readonly AttestedNumber[] {
  return urls.flatMap((url) => attestedNumbersInText({ text: url }));
}

/**
 * The context a bare reference in `text` actually resolves against — `context` with `repos` replaced by
 * whatever full `github.com/<owner>/<repo>` link(s) `text` already names, when it names any at all.
 *
 * @param context the caller-supplied context (typically the checkout's own repo)
 * @param text the composed text a bare reference is being resolved inside
 * @returns `context` unchanged when the text names no repo by link; otherwise `context` with `repos` replaced
 */
function contextAnchoredToText({ context, text }: { context: BareRefContext; text: string }): BareRefContext {
  const named = reposNamedInText({ text });
  const fromText = attestedNumbersInText({ text });
  // A caller with no magnitude evidence omits `attested`: then the text's own links are the only witnesses.
  const attested = context.attested === undefined ? fromText : [...context.attested, ...fromText];
  const withAttested: BareRefContext = { ...context, attested };
  return named.length > 0 ? { ...withAttested, repos: named } : withAttested;
}

/**
 * {@link contextAnchoredToText} over URLs a caller already holds STRUCTURALLY — a form whose links live in
 * `link` runs and citation `url` fields rather than in prose. A text scan over such a form sees none of
 * them, because the form's own schema typed every raw URL into a run before the bare-reference pass ran;
 * MEASURED on the turn-answer lane, a body carrying one full pull-request link beside a bare
 * `#N` still refused the bare one, because the link had already become a run the scan cannot read.
 *
 * @param context the caller-supplied context
 * @param urls every URL the form carries, in any order
 * @returns `context` unchanged when no URL names a repo; otherwise `context` with `repos` replaced by the
 *   repo(s) the URLs name, and every numbered GitHub URL among them attested
 */
export function contextAnchoredToUrls({
  context,
  urls,
}: {
  context: BareRefContext;
  urls: readonly string[];
}): BareRefContext {
  return contextAnchoredToText({ context, text: urls.join("\n") });
}

/** One candidate reference and the context it is weighed against — what resolving and refusing both take. */
export interface SpanInContext {
  readonly span: BareRefSpan;
  readonly context: BareRefContext;
}

/**
 * The real link a bare reference names, or undefined when the context cannot resolve it unambiguously.
 *
 * `owner/repo#N` always resolves — the slug is explicit, so nothing needs guessing. A bare `#N` (or a
 * PR-list digit) resolves only when `context.repos` names exactly one repo AND the number is small enough to
 * be one of that repo's own; two or zero repos is a real ambiguity, and a number with more digits than
 * anything `context.attested` proves exists there is a cross-repo cite, both left unresolved rather than
 * guessed. A Linear key resolves only when `context.linearWorkspaceSlug` is also known and Linear-shaped —
 * {@link scanBareRefs} already confirmed the prefix against a known team key. A control id resolves only
 * when its own entry carries a non-null `url`; a provider that hands back no per-control link (Vanta, today)
 * leaves every one of them a named refusal rather than a guessed route. Whatever resolves, its URL must still
 * be inert inside a link (`./inertLinkUrl.ts`), because every one of them came from the context, not the text.
 *
 * @param span the candidate reference
 * @param context what the caller knows about the destination
 * @returns the label and URL to link it as, or undefined when it cannot resolve unambiguously and safely
 */
export function resolveBareRef({ span, context }: SpanInContext): ResolvedBareRef | undefined {
  const resolved = resolveFromContext({ context, span });
  return resolved !== undefined && isInertLinkUrl({ url: resolved.url }) ? resolved : undefined;
}

/** {@link resolveBareRef} before its URL is checked inert. */
function resolveFromContext({ span, context }: SpanInContext): ResolvedBareRef | undefined {
  if (span.kind === "linearKey") {
    const url = linearIssueUrl({ key: span.key, slug: context.linearWorkspaceSlug });
    return url === undefined ? undefined : { label: span.key, url };
  }
  if (span.kind === "controlId") {
    // A context holding no control table, no entry for this id, or an entry with no URL leaves it unresolved.
    const url = context.complianceControls?.find((control) => control.id === span.id)?.url;
    return url == null ? undefined : { label: span.id, url };
  }
  const sole = soleRepo({ context });
  if (
    span.owner === undefined &&
    sole !== undefined &&
    magnitudeImplausible({ context, number: span.number, repo: sole })
  ) {
    return undefined;
  }
  const owner = span.owner ?? sole?.owner;
  const repo = span.repo ?? sole?.repo;
  if (owner === undefined || repo === undefined || !isGithubRepoRef({ owner, repo })) {
    return undefined;
  }
  const label =
    span.owner !== undefined ? `${span.owner}/${span.repo}#${String(span.number)}` : `#${String(span.number)}`;
  return { label, url: `https://github.com/${owner}/${repo}/issues/${String(span.number)}` };
}

/**
 * The refusal a bare reference earns by MAGNITUDE alone, or undefined when magnitude is not what stopped it.
 *
 * @param span the residue span, already known to be a GitHub reference
 * @param context the context the resolver weighed
 * @returns the sentence, naming the witness that made the number impossible, or undefined
 */
function magnitudeRefusal({ span, context }: { span: GithubRefSpan; context: BareRefContext }): string | undefined {
  const sole = soleRepo({ context });
  if (span.owner !== undefined || sole === undefined) {
    return undefined;
  }
  const witness = largestAttested({ context, repo: sole });
  if (witness === undefined || String(span.number).length <= String(witness).length) {
    return undefined;
  }
  const slug = `${sole.owner}/${sole.repo}`;
  const digits = String(String(span.number).length);
  return (
    `${JSON.stringify(span.raw)} would resolve to ${slug}#${String(span.number)}, but the largest number ` +
    `known to exist in ${slug} here is ${String(witness)} — a ${digits}-digit number cannot be one of its ` +
    `own. Write it as "owner/repo#${String(span.number)}" so it points at the repository it is from.`
  );
}

/**
 * Why a surviving bare reference is being refused, in the author's vocabulary rather than the pattern's.
 *
 * Three GitHub refusals, and they are genuinely different problems: nothing to resolve against, a repo to
 * resolve against that this number demonstrably cannot belong to, or one that is not GitHub-shaped at all
 * (`./githubRepoRef.ts`). Reporting either of the last two as the first would send an author hunting for an
 * ambiguity that is not there.
 *
 * @param span the residue span
 * @param context the same context {@link resolveBareRef} weighed, so a refusal can name what it weighed
 * @returns the sentence a refusal carries
 */
export function bareRefRefusalMessage({ span, context }: SpanInContext): string {
  if (span.kind === "linearKey") {
    return linearKeyRefusal({ raw: span.raw, slug: context.linearWorkspaceSlug });
  }
  if (span.kind === "controlId") {
    return (
      `${JSON.stringify(span.raw)} is a compliance control written as plain text, and every ticket or ` +
      "control id in an outbound answer is a hyperlink over its own text (the owner's ruling). " +
      "This door knows the control but has no safe URL for it — the workspace slug its page lives under is " +
      `not resolvable here, or its URL would break the link, so write it yourself as [${span.raw}](url).`
    );
  }
  const magnitude = magnitudeRefusal({ context, span });
  if (magnitude !== undefined) {
    return magnitude;
  }
  const named =
    span.owner !== undefined ? `${span.owner}/${span.repo}#${String(span.number)}` : `#${String(span.number)}`;
  const sole = span.owner === undefined ? soleRepo({ context }) : undefined;
  return githubRefRefusal({ named, raw: span.raw, sole });
}

/**
 * Every reference an UNLINKABLE field carries — a field that renders to the reader as plain text and has no
 * run vocabulary and no url of its own to become a link.
 *
 * Different from {@link bareRefIssuesOfPlainText} in the one way that matters: resolvability is irrelevant
 * here. That function reports only what could NOT resolve, because its callers linkify what could — and a
 * field that cannot hold a link never gets that pass, so a perfectly resolvable `HRS-52` in it still reaches
 * the reader as plain text. MEASURED: a bot answer carried one bare reference above the fold and
 * TEN below it, in grounding prose, and every one of the ten resolved cleanly and was therefore reported by
 * nothing.
 *
 * @param text the field's literal text
 * @param context what the caller knows about the destination — used only to decide what IS a reference
 * @param path the JSON path of the field, for the issue
 * @param remedy what this particular field's author can actually do about it
 * @returns one issue per reference found, in document order
 */
export function bareRefIssuesOfUnlinkableText({
  text,
  context,
  path,
  remedy,
}: {
  text: string;
  context: BareRefContext;
  path: readonly (string | number)[];
  remedy: string;
}): readonly BareRefIssue[] {
  const anchored = contextAnchoredToText({ context, text });
  return scanBareRefs({ context: anchored, text }).map((span) => ({
    message:
      `${JSON.stringify(span.raw)} renders to the reader as plain text here, and every ticket or control ` +
      `id in an outbound answer is a hyperlink over its own text (the owner's ruling). ${remedy}`,
    path,
  }));
}

/** One residue span found inside a plain-string field, with the JSON path a form author needs to find it. */
export interface BareRefIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Every bare reference a plain-string field still carries — there is no run vocabulary a plain string can
 * become, so every candidate here is residue by construction.
 *
 * @param text the field's literal text
 * @param context what the caller knows about the destination
 * @param path the JSON path of the field, for the issue
 * @returns one issue per bare reference found
 */
export function bareRefIssuesOfPlainText({
  text,
  context,
  path,
}: {
  text: string;
  context: BareRefContext;
  path: readonly (string | number)[];
}): readonly BareRefIssue[] {
  const anchored = contextAnchoredToText({ context, text });
  return scanBareRefs({ context: anchored, text })
    .filter((span) => resolveBareRef({ context: anchored, span }) === undefined)
    .map((span) => ({ message: bareRefRefusalMessage({ context: anchored, span }), path }));
}

/** One inclusive-exclusive character range to exclude from scanning — text that is already a link, or code. */
interface ExcludedRange {
  readonly start: number;
  readonly end: number;
}

/** A fenced code block or inline code span in markdown — literal, and never linkified inside. */
const MARKDOWN_CODE = /```[\s\S]*?```|`[^`\n]*`/g;

/**
 * Text that is ALREADY a link, in every spelling this repository emits or a person types.
 *
 * MEASURED on a live Notion page, and it is the root cause of the broken record table that this
 * whole exclusion exists for. Without it, `[DDDD-839](https://linear.app/acme/issue/DDDD-839)` — an
 * ordinary, correct Linear link — comes out of this pass as
 * `[[DDDD-839](https://…/DDDD-839)](https://…/DDDD-839)`, because the scanner found the ticket key TWICE: once
 * as the link's own label, once inside its URL. Notion then renders the nested construct as literal text and
 * the row is broken, while the authored markdown that produced it reads perfectly.
 *
 * It was not a Notion bug and not a table bug. A clean mixed prose-plus-link cell renders correctly (also
 * measured, same day, same page), and a lone-link cell whose label merely EQUALS its URL's last path segment
 * renders correctly too — `[acme](https://www.notion.so/acme)` and `[N](…/pull/<n>)` both came back
 * as working links. What breaks a cell is this pass rewriting a reference that was already linked.
 *
 * Three spellings are excluded, all of them whole:
 *  - `[label](url)` — both halves. A key in the LABEL is already linked; a key in the URL is a path segment,
 *    not a reference to anything.
 *  - Slack's own angle-bracket markup — `<url|label>`, `<url>` (markdown's autolink too), `<mailto:…>`,
 *    `<@U…>`, `<#C…|name>`, `<!here>` — label and all. MEASURED: the as-me `--body` bump
 *    `<https://github.com/acme/acme-admin/pull/<n>|add the Agent CLI package #N>`, the exact PR
 *    mention `slack voice-rules` prescribes, left this pass as a link spliced INSIDE that label. Slack could
 *    not parse the nest and posted literal `<`/`>` around a URL with the label swallowed into it
 *    (`C0SYN000002`/`1790243252.027999`). The arm only guarded a whitespace-free `<https://…>`, so any
 *    label with a space in it was unguarded.
 *  - a naked `https://…` run — a URL typed in prose carries path segments that look exactly like ticket keys
 *    and issue numbers, and rewriting one silently changes where the link points. It stops at `<`, `>` and
 *    `|`, so a bare URL glued to a following `<url|label>` cannot run into that label and end the excluded
 *    range halfway through it.
 *
 * Ordering matters: the inline-link pattern is first so a URL inside one is consumed by it rather than by the
 * naked-URL pattern, which would leave the label unguarded.
 */
const ALREADY_LINKED = /\[[^\]\n]*\]\([^)\n]*\)|<(?:https?:\/\/|mailto:|[@#!])[^<>\n]*>|https?:\/\/[^\s)\]<>|]+/g;

/**
 * Every range a bare-reference scan must not touch: code spans, and anything already a link.
 *
 * @param text the markdown being linkified
 * @returns the ranges to exclude, unsorted and possibly overlapping — `insideAnyRange` needs neither
 */
function codeRanges({ text }: { text: string }): readonly ExcludedRange[] {
  return [...text.matchAll(MARKDOWN_CODE), ...text.matchAll(ALREADY_LINKED)].map((match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
}

/** Whether a span sits entirely inside one of the excluded ranges. */
function insideAnyRange({
  start,
  end,
  ranges,
}: {
  start: number;
  end: number;
  ranges: readonly ExcludedRange[];
}): boolean {
  return ranges.some((range) => start >= range.start && end <= range.end);
}

/** The result of linkifying one markdown string: the rewritten text, and whatever could not resolve. */
interface MarkdownLinkifyResult {
  readonly text: string;
  readonly unresolved: readonly BareRefSpan[];
  /**
   * The context the residue was actually judged against — `context` with its repos anchored to the text, per
   * the module doc's "the TEXT wins over the checkout" section. Carried out so a caller building a refusal
   * message weighs the same facts the resolver did, rather than the pre-anchoring context it passed in.
   */
  readonly context: BareRefContext;
}

/**
 * Rewrite every resolvable bare reference in a markdown string as `[label](url)`, leaving the rest — inside
 * a fenced or inline code span, or genuinely unresolvable — untouched.
 *
 * Byte-identical to the input when it carries no bare reference at all, so this is safe to run on every
 * Linear and Notion body unconditionally.
 *
 * @param text the composed markdown
 * @param context what the caller knows about the destination
 * @returns the rewritten text, plus every reference still bare afterward
 */
export function linkifyMarkdown({ text, context }: { text: string; context: BareRefContext }): MarkdownLinkifyResult {
  return spliceLinks({ context, format: ({ resolved }) => `[${resolved.label}](${resolved.url})`, text });
}

/**
 * Rewrite every resolvable bare reference in a plain string as `<url|label>` — Slack's OWN mrkdwn link
 * syntax, which is what a bare string like the as-me `--body` escape hatch is parsed as (see
 * `../artifact/types.ts`'s `PlainArtifact`). `[label](url)` would show a reader literal brackets there;
 * this is the one spelling Slack itself renders as a link from an unstructured string.
 *
 * @param text the composed message text
 * @param context what the caller knows about the destination
 * @returns the rewritten text, plus every reference still bare afterward
 */
export function linkifySlackMrkdwn({
  text,
  context,
}: {
  text: string;
  context: BareRefContext;
}): MarkdownLinkifyResult {
  return spliceLinks({ context, format: ({ resolved }) => `<${resolved.url}|${resolved.label}>`, text });
}

/**
 * Rewrite every resolvable bare reference in a plain string as its bare URL — the one spelling a field with
 * NO link rendering at all (a Linear project's own `description`, stored and shown as one plain line) can
 * carry: `[label](url)` would show a reader literal brackets, and Slack's `<url|label>` would show literal
 * angle brackets, so the full URL becomes the visible text in its place.
 *
 * @param text the composed single-line field
 * @param context what the caller knows about the destination
 * @returns the rewritten text, plus every reference still bare afterward
 */
export function linkifyPlainUrl({ text, context }: { text: string; context: BareRefContext }): MarkdownLinkifyResult {
  return spliceLinks({ context, format: ({ resolved }) => resolved.url, text });
}

/** The splice loop shared by every plain-string linkify spelling — only how a resolved link is written differs. */
function spliceLinks({
  text,
  context,
  format,
}: {
  text: string;
  context: BareRefContext;
  format: (args: { resolved: ResolvedBareRef }) => string;
}): MarkdownLinkifyResult {
  const anchored = contextAnchoredToText({ context, text });
  const excluded = codeRanges({ text });
  const spans = scanBareRefs({ context: anchored, text }).filter(
    (span) => !insideAnyRange({ end: span.end, ranges: excluded, start: span.start }),
  );
  if (spans.length === 0) {
    return { context: anchored, text, unresolved: [] };
  }
  let out = "";
  let cursor = 0;
  const unresolved: BareRefSpan[] = [];
  for (const span of spans) {
    const resolved = resolveBareRef({ context: anchored, span });
    out += text.slice(cursor, span.start);
    if (resolved === undefined) {
      out += text.slice(span.start, span.end);
      unresolved.push(span);
    } else {
      out += format({ resolved });
    }
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { context: anchored, text: out, unresolved };
}
