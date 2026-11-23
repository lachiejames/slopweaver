/**
 * The vulnerability-fix ROSTER post, composed as a typed as-me form.
 *
 * One top-level message: the row's own lead line, one dot point per open pull request reading
 * `[<reviewer>] <#number> <what it bumps> [<evidence mark>]`, and — when the row asks for them with
 * `--include-alert-counts` — the remaining critical/high/medium/low counts closing it, so the trend is readable
 * across posts. The lead, the counts, the reviewer and the evidence are each the row's choice; none is a default.
 *
 * ## A line names a person only when the row picks one, and the post tags no group
 *
 * With `--reviewer-strategy mapped-codeowners` each line names the one person it asks, chosen by
 * `../../review/vulnReviewerChoice.ts`; with no strategy {@link VulnDigestLine.person} is `undefined` and the line
 * opens on its pull request. There is no group-shaped input to this module at all.
 *
 * ## Everything here is pure, and that is the point
 *
 * Nothing in this module reads, fetches or sends. It takes the roster, the reviewer each line addresses and
 * the alert counts, and returns the {@link OneListArtifact} the as-me door validates and renders. So the
 * shape of a post that goes out unattended every day is decided by code a test can run, rather than by
 * whichever session happened to compose it — which is what `AGENTS.md` rule 7 means by the schema enforcing
 * shape rather than review.
 *
 * ## Why the counts are a closing line rather than a table
 *
 * They are there so the trend reads day over day, which is a comparison a reader makes
 * across posts, not within one. Four numbers on one line at the same place in every post is the shape that
 * comparison actually needs; a table would put them behind a fold the as-me lane does not have.
 *
 * ## Why a bullet drops the pull request's own CVSS score
 *
 * A FULL roster does not fit the card cap with it. MEASURED on the ten pull requests standing
 * in `acme/acme-admin`: the card came to 1038 visible chars against the 1000 cap and the schema refused
 * it, so the day's post could not carry the set it exists to carry. Reproduce both halves:
 *
 * ```bash
 * slopweaver vulnerability-fix roster --repo acme/acme-admin --author octocat --json   # ten subjects
 * slopweaver vulnerability-fix digest --repo acme/acme-admin --author octocat \
 *   --channel <id> --post --dry-run                                                          # the card's width
 * ```
 *
 * The score is the one thing on a line that is both restated elsewhere in the same post — the closing
 * sentence carries severity as the aggregate the owner actually asked to read day over day — and carried
 * by what the line already links to, since the convention puts it in the pull request's own title. That is
 * precisely the cut the width refusal names: state the thing, link the detail, rather than restate it.
 */
import type { DripInlineRun, OneListArtifact } from "../artifact/types.js";
import { visibleLengthOfRuns } from "../artifact/visibleLength.js";

/** One unmet piece of a line's evidence, as the card shows it: a short label, linked when a run stands behind it. */
export interface VulnDigestMarkItem {
  readonly label: string;
  readonly url: string | undefined;
}

/**
 * What a line's evidence says, as the card shows it.
 *
 * `passed` is every evidence leg the row configured clearing: one cheap label of its own (`e2e` linked to the run
 * when the end-to-end suite is configured, `CodeRabbit green` when only the review bot is). `unproven` is
 * anything else, and carries every unmet piece — at least one, by its type — so the reader sees on the line
 * itself what still stands between it and a review. A failing check never stops the
 * post; a pull request whose checks fail goes out with that said in brackets beside it, and is dealt with after.
 */
export type VulnDigestMark =
  | { readonly kind: "passed"; readonly label: string; readonly url: string | undefined }
  | { readonly kind: "unproven"; readonly items: readonly [VulnDigestMarkItem, ...VulnDigestMarkItem[]] };

/**
 * One roster line: who to ask, which pull request, and what it bumps.
 *
 * @internal — reached through {@link VulnDigestInput}, which is what a caller builds.
 */
export interface VulnDigestLine {
  readonly number: number;
  readonly url: string;
  /** What the pull request bumps, as its own title states it. */
  readonly subject: string;
  /**
   * The one person the line asks, by identity-map key — `../../review/vulnReviewerChoice.ts` decides who — or
   * `undefined` when the row picks no reviewer strategy, and the line names nobody.
   */
  readonly person: string | undefined;
  /**
   * What the pull request's evidence says, when the invocation read any.
   *
   * A reviewer once asked whether E2Es ran on a line because the
   * CI comment they usually read was missing, and the answer was a link to the run. Carried on the line so
   * that question never needs asking.
   */
  readonly mark?: VulnDigestMark;
}

/** The open-alert counts that close the post, in the order the owner named them. */
export interface VulnSeverityCounts {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

/** Everything the post is composed from. */
export interface VulnDigestInput {
  readonly lines: readonly VulnDigestLine[];
  /** The open-alert counts the post closes on, or `undefined` when the row did not ask for them. */
  readonly counts: VulnSeverityCounts | undefined;
  /** The line the post opens on, in the installation's own words — `--post-lead`. */
  readonly lead: string;
  /** The most visible chars a subject may carry before it is shortened; every subject whole when absent. */
  readonly subjectMax?: number;
}

/**
 * Compose the roster post: the lead, one dot point per line, and the counts closing it when asked for.
 *
 * @param input the lead, the roster lines and the counts
 * @returns the as-me one-list form, ready for the door to validate
 */
export function vulnDigestForm({ input }: { input: VulnDigestInput }): OneListArtifact {
  return {
    bullets: input.lines.map((line) => rosterBullet({ line, subjectMax: input.subjectMax })),
    kind: "one-list",
    lead: [{ text: input.lead, type: "text" }],
    trailing: input.counts === undefined ? [] : [[{ text: countsSentence({ counts: input.counts }), type: "text" }]],
  };
}

/**
 * One dot point: the reviewer when the row picks one, the pull request as a linked `#number`, and what it bumps.
 *
 * The `#number` is a LINK run carrying the pull request's own URL rather than a bare `#<number>`. A bare one is
 * ambiguous in a repository where an alert number and a pull-request number are both small integers — the
 * same reason `skills/vulnerability-fix/SKILL.md` refuses a bare `#N` for an alert — and in Slack it is not
 * a reference at all, merely text.
 *
 * @param line the roster line
 * @param subjectMax the most visible chars its subject may carry, when the card had to shorten subjects
 * @returns the runs of one dot point
 */
function rosterBullet({
  line,
  subjectMax,
}: {
  line: VulnDigestLine;
  subjectMax: number | undefined;
}): readonly DripInlineRun[] {
  const subject = shortenSubject({ max: subjectMax, subject: bulletSubject({ subject: line.subject }) });
  const asks: readonly DripInlineRun[] =
    line.person === undefined
      ? []
      : [
          { person: line.person, type: "mention" },
          { text: " ", type: "text" },
        ];
  return [
    ...asks,
    { label: `#${String(line.number)}`, type: "link", url: line.url },
    ...subjectRuns({ subject: ` ${subject}` }),
    ...(line.mark === undefined ? [] : markRuns({ mark: line.mark })),
  ];
}

/**
 * The evidence mark closing a dot point, every run behind it one click away.
 *
 * A PASSED line carries its mark's own short label rather than a sentence. MEASURED on ten pull
 * requests standing in `acme/acme-admin`: the card came to 928 visible chars of its 1000, so ten marks have 72
 * chars between them, and the ordinary case is the one that has to be cheap. Anything unproven is spelled out
 * in one pair of round brackets, each unmet piece in turn — `(e2e failed; CodeRabbit pending)` — because that
 * is the line a reader should stop on, and the owner asked for exactly that: a bracket
 * beside it saying it is failing. Reproduce the width with `vulnerability-fix digest … --post --dry-run`.
 *
 * @param mark what the shell judged the pull request's evidence to say
 * @returns the separator and the mark
 */
function markRuns({ mark }: { mark: VulnDigestMark }): readonly DripInlineRun[] {
  if (mark.kind === "passed") {
    if (mark.url === undefined) {
      return [{ text: ` ${mark.label}`, type: "text" }];
    }
    return [
      { text: " ", type: "text" },
      { label: mark.label, type: "link", url: mark.url },
    ];
  }
  const runs: DripInlineRun[] = [];
  let pending = " (";
  mark.items.forEach((item, index) => {
    if (index > 0) {
      pending += "; ";
    }
    if (item.url === undefined) {
      pending += item.label;
      return;
    }
    runs.push({ text: pending, type: "text" }, { label: item.label, type: "link", url: item.url });
    pending = "";
  });
  runs.push({ text: `${pending})`, type: "text" });
  return runs;
}

/** What came off a card that did not fit whole, so the caller can say it out loud. */
export interface VulnDigestTrim {
  /** The whole card's width, which forced the trim. */
  readonly fullWidth: number;
  /** Whether passed evidence marks came off — false when no line carried one. */
  readonly passedMarksDropped: boolean;
  /** The card's width with only the marks it must keep: every unproven one. */
  readonly requiredMarksWidth: number;
  /** The subject length the card fits at, when even that card did not fit. */
  readonly subjectMax: number | undefined;
  /** Whether every unproven bracket collapsed to `(failing)`, because no subject length fitted them whole. */
  readonly marksCompacted: boolean;
}

/**
 * The shortest a subject is cut to. Below it a subject stops naming both its verb and its package, so a card
 * that fits only there is refused by the send rather than sent saying nothing.
 */
const SUBJECT_FLOOR = 24;

/**
 * The post, as much of it as fits the card's cap: whole, then without the passed evidence marks, then with
 * every long subject shortened as little as fits. An unproven mark never comes off.
 *
 * A passed mark comes off first because it is the one part that loses none of what the post exists to say —
 * the pull requests, who each asks, what still stands in the way of each, and the counts. An unproven mark IS
 * part of what the post says: every roster line is posted whatever its evidence reads, so the
 * bracket beside a failing line is the only place a reader learns it is failing. A batch whose own titles run
 * long can still overflow, so the subjects over a length come off next, each at a word, ending in `…`: the
 * linked `#number` carries the full title one click away. MEASURED on the ten pull requests standing
 * in `acme/acme-admin`: 1224 visible chars with marks and 1184 without, against the 1000 cap, and before
 * this rung that batch had no post. The largest length that fits is taken, so a subject is shortened only as far
 * as the card needs. A card that fits at no length down to {@link SUBJECT_FLOOR} collapses every unproven
 * bracket to `(failing)` and tries again, whole then shortened, because a post refused for its width is the one
 * outcome the rule that nothing gates the post rules out. Only a card that does not fit even then goes back over the cap.
 *
 * @param input the roster lines and the counts
 * @param cardVisibleMax the as-me card's whole-message visible ceiling the send will validate against
 * @returns the form to send, and what came off it when the whole card did not fit
 */
export function vulnDigestFormWithin({ input, cardVisibleMax }: { input: VulnDigestInput; cardVisibleMax: number }): {
  readonly form: OneListArtifact;
  readonly trim: VulnDigestTrim | undefined;
} {
  const form = vulnDigestForm({ input });
  const fullWidth = oneListWidth({ form });
  if (fullWidth <= cardVisibleMax) {
    return { form, trim: undefined };
  }
  const requiredInput = { ...input, lines: input.lines.map((line) => withoutPassedMark({ line })) };
  const required = vulnDigestForm({ input: requiredInput });
  const trim: VulnDigestTrim = {
    fullWidth,
    marksCompacted: false,
    passedMarksDropped: input.lines.some((line) => line.mark?.kind === "passed"),
    requiredMarksWidth: oneListWidth({ form: required }),
    subjectMax: undefined,
  };
  if (trim.requiredMarksWidth <= cardVisibleMax) {
    return { form: required, trim };
  }
  const shortened = shortestFitting({ cardVisibleMax, input: requiredInput });
  if (shortened !== undefined) {
    return { form: shortened.form, trim: { ...trim, subjectMax: shortened.subjectMax } };
  }
  if (!requiredInput.lines.some((line) => line.mark?.kind === "unproven")) {
    return { form: required, trim };
  }
  const compactInput = { ...requiredInput, lines: requiredInput.lines.map((line) => withCompactMark({ line })) };
  const compact = vulnDigestForm({ input: compactInput });
  const compactTrim: VulnDigestTrim = { ...trim, marksCompacted: true };
  if (oneListWidth({ form: compact }) <= cardVisibleMax) {
    return { form: compact, trim: compactTrim };
  }
  const compactShortened = shortestFitting({ cardVisibleMax, input: compactInput });
  if (compactShortened !== undefined) {
    return { form: compactShortened.form, trim: { ...compactTrim, subjectMax: compactShortened.subjectMax } };
  }
  return { form: compact, trim: compactTrim };
}

/**
 * The card at the largest subject length down to {@link SUBJECT_FLOOR} that fits, if any length does.
 *
 * @param input the roster lines the card carries, marks as they are to be sent
 * @param cardVisibleMax the as-me card's whole-message visible ceiling
 * @returns the fitting form and the length it fits at, or `undefined` when none down to the floor fits
 */
function shortestFitting({
  input,
  cardVisibleMax,
}: {
  input: VulnDigestInput;
  cardVisibleMax: number;
}): { readonly form: OneListArtifact; readonly subjectMax: number } | undefined {
  const longest = Math.max(0, ...input.lines.map((line) => bulletSubject({ subject: line.subject }).length));
  for (let subjectMax = longest - 1; subjectMax >= SUBJECT_FLOOR; subjectMax -= 1) {
    const shortened = vulnDigestForm({ input: { ...input, subjectMax } });
    if (oneListWidth({ form: shortened }) <= cardVisibleMax) {
      return { form: shortened, subjectMax };
    }
  }
  return undefined;
}

/**
 * One line with an unproven mark collapsed to a single `(failing)`, linked to the first unmet piece that has a run.
 *
 * The last rung before the card gives up width it cannot: every line still says, in brackets beside it, that
 * it is failing, and a link costs only its label, so the first run stays a click
 * away for nothing.
 *
 * @param line the roster line, its passed mark already off
 * @returns the line with its bracket at its shortest
 */
function withCompactMark({ line }: { line: VulnDigestLine }): VulnDigestLine {
  if (line.mark?.kind !== "unproven") {
    return line;
  }
  const linked = line.mark.items.find((item) => item.url !== undefined);
  return { ...line, mark: { items: [{ label: "failing", url: linked?.url }], kind: "unproven" } };
}

/**
 * One line without its mark when that mark is a passed one, and unchanged otherwise.
 *
 * @param line the roster line
 * @returns the line the card may carry when it has to give width back
 */
function withoutPassedMark({ line }: { line: VulnDigestLine }): VulnDigestLine {
  if (line.mark?.kind !== "passed") {
    return line;
  }
  const { number, person, subject, url } = line;
  return { number, person, subject, url };
}

/**
 * One subject cut to at most `max` visible chars at its last whole word, closed with `…` so the cut shows.
 *
 * A word boundary rather than a clause: cutting at the first comma turns "bump foo, bar and baz" into "bump foo",
 * which reads as whole and says less. A scoped package stays whole too, so {@link subjectRuns} never meets a
 * half `@scope/` that the render check would read as a handle. A cut never ends on a joining word either:
 * MEASURED on the same ten, half the cuts read `…, past the…` until those came off with it.
 *
 * @param subject the subject, its trailing score already off
 * @param max the most visible chars it may carry, or `undefined` to leave it whole
 * @returns the subject, shortened only when it is over `max`
 */
function shortenSubject({ subject, max }: { subject: string; max: number | undefined }): string {
  if (max === undefined || subject.length <= max) {
    return subject;
  }
  const space = subject.lastIndexOf(" ", max - 1);
  return `${withoutJoiningTail({ text: space > 0 ? subject.slice(0, space) : subject.slice(0, max - 1) })}…`;
}

/**
 * A cut subject with its trailing punctuation and any joining words before it taken off, first word kept.
 *
 * @param text the subject as cut at a word
 * @returns it ending on a word that carries meaning
 */
function withoutJoiningTail({ text }: { text: string }): string {
  const trimmed = text.replace(/[,;:]+$/, "");
  const space = trimmed.lastIndexOf(" ");
  if (space <= 0 || !JOINING_WORDS.has(trimmed.slice(space + 1).toLowerCase())) {
    return trimmed;
  }
  return withoutJoiningTail({ text: trimmed.slice(0, space) });
}

/** Words that only join what follows, so a cut ending on one leaves the reader mid-phrase. */
const JOINING_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "onto",
  "or",
  "past",
  "so",
  "the",
  "to",
  "under",
  "with",
]);

/**
 * A one-list form's visible width, measured the way the as-me schema's whole-card cap measures it.
 *
 * @param form the composed post
 * @returns the summed visible width of the lead, every bullet and every trailing line
 */
function oneListWidth({ form }: { form: OneListArtifact }): number {
  return [form.lead, ...form.bullets, ...form.trailing].reduce(
    (total, runs) => total + visibleLengthOfRuns({ citations: [], runs }),
    0,
  );
}

/** An npm SCOPED package name — `@hono/node-server`, `@fastify/reply-from` — as a subject spells one. */
const SCOPED_PACKAGE = /@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/gi;

/**
 * The subject as runs, with every scoped package name styled as CODE rather than left as plain text.
 *
 * MEASURED, and the reason this exists rather than a plain span: with the full ten-line roster
 * composed, `storedRenderIssues` (`./renderCheck.ts`) refused the post four times over — `"@faker-js"`,
 * `"@hono"`, `"@fastify"` and `"@grpc"` each read as a handle-shaped token that Slack would render as inert
 * plain text, so "nobody is notified by it". That guard is right about the rendering and right to run; what
 * it caught is that a package scope is not an attempt to address anybody. A code-styled element is the
 * escape the check itself declares, and it is also the correct typography — a package name is code.
 *
 * Reproduce: compose the digest over a repository whose roster carries a scoped package, before and after.
 *
 * ```bash
 * slopweaver vulnerability-fix digest --repo acme/acme-admin --author octocat \
 *   --channel <id> --post --dry-run
 * ```
 *
 * @param subject the dot point's text, leading space included
 * @returns the runs it becomes — one plain span when it names no scoped package
 */
function subjectRuns({ subject }: { subject: string }): readonly DripInlineRun[] {
  const runs: DripInlineRun[] = [];
  let cursor = 0;
  for (const match of subject.matchAll(SCOPED_PACKAGE)) {
    const start = match.index;
    if (start > cursor) {
      runs.push({ text: subject.slice(cursor, start), type: "text" });
    }
    runs.push({ code: true, text: match[0], type: "text" });
    cursor = start + match[0].length;
  }
  if (cursor < subject.length) {
    runs.push({ text: subject.slice(cursor), type: "text" });
  }
  return runs;
}

/** The trailing `(CVSS 8.7)` the pull-request title convention carries, which a bullet does not repeat. */
const TRAILING_CVSS = / \(CVSS \d+(?:\.\d+)?\)$/;

/**
 * One line's subject, with the score the post states in aggregate and links in full taken off the end.
 *
 * A subject that does NOT end in one is returned unchanged rather than trimmed at some other boundary: the
 * pattern is anchored because the same parenthetical mid-sentence would be part of what the pull request
 * says it does, and cutting there would change the sentence rather than shorten the line.
 *
 * @param subject what the pull request's own title says it bumps
 * @returns the text the dot point carries
 */
function bulletSubject({ subject }: { subject: string }): string {
  return subject.replace(TRAILING_CVSS, "");
}

/**
 * The closing sentence: what is still open, worst first, always all four tiers.
 *
 * A tier at zero is STATED rather than dropped, for the same reason the vulnerability-fix body states an
 * empty colour tier: a reader comparing today's post with yesterday's is reading the numbers as a series,
 * and a series with a missing term reads as a number that was not measured rather than one that reached
 * zero.
 *
 * @param counts the open alerts by GitHub's own severity enum
 * @returns the sentence that closes the post
 */
function countsSentence({ counts }: { counts: VulnSeverityCounts }): string {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  return (
    `${String(total)} open dependabot alerts left: ` +
    `${String(counts.critical)} critical, ${String(counts.high)} high, ` +
    `${String(counts.medium)} medium, ${String(counts.low)} low`
  );
}
