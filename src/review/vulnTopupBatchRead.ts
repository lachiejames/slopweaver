/**
 * Reading a top-up generation's batch back off its brief — the half of the merge-release gate that knows the brief's
 * format. `./vulnTopupGate.ts` judges what this reads.
 *
 * ## Where "the previous batch" comes from
 *
 * The newest generation's own board row. `topupAsk` writes every batch member as one line of the row's
 * `summary:` — package, then `alert <url>/security/dependabot/<n>` — between {@link TOPUP_BATCH_START} and
 * {@link TOPUP_BATCH_END}, so the board already holds the batch, written by the same module that plans it, and
 * {@link topupBatchFromAsk} reads it back. A second store of the same list would be a second register to keep in
 * step with the first; the round-trip test in `src/__tests__/unit/cli/commands/vulnerabilityFix/topupBrief.test.ts`
 * is what pins the two ends of that format together. The fence is what lets a row's free-text `--instructions`
 * follow the batch: a line there shaped like a member is outside the region read, so it can neither join the batch
 * nor shift its count.
 */
import { err, ok, type Result } from "../lib/result.js";

/**
 * The line that opens a brief's machine-read batch region. Never a dash line, so it can never be read as a member.
 */
export const TOPUP_BATCH_START = "=== batch: one line per member, read back by the merge-release gate ===";

/** The line that closes a brief's machine-read batch region; everything after it is prose the gate never reads. */
export const TOPUP_BATCH_END = "=== end of batch ===";

/**
 * The heading the installation's own instructions sit under, written after the batch. Its FIRST whole-line occurrence
 * is always the generated one, since the instructions follow it, so no fence is ever read past that line.
 */
export const INSTALLATION_INSTRUCTIONS_HEADING = "Installation instructions";

/** One member of a raised batch: the package and the alert that decided it. */
export interface TopupBatchMember {
  readonly packageName: string;
  readonly alertNumber: number;
}

/**
 * One batch line as `topupAsk` writes it: `  - <package> (… alert <url>/security/dependabot/<n>…`. Any
 * indentation is read, because a line dropped for its whitespace would shrink the raised count and release
 * the next batch early — every dash line is a batch line, and one that fails this is
 * refused, never skipped.
 */
const MEMBER_LINE = /^\s*- (\S+) \(.*\balert https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/security\/dependabot\/(\d+)\b/;
const DASH_LINE = /^\s*- /;
/** Every Dependabot alert a line cites — a batch line cites exactly one. */
const ALERT_REF = /\/security\/dependabot\/\d+/g;

/**
 * A line break as a brief stores it: a real one — what the flat reader decodes a quoted `summary:`'s `\n` to — or the
 * two characters `\n` left in a BARE `summary:`, which the reader returns as written (`src/handover/flatScalarCodec.ts`).
 */
const BRIEF_LINE_BREAK = /\r?\n|\\n/;

/**
 * Every dash line of a LEGACY top-up brief — one written before {@link TOPUP_BATCH_START} existed — each a batch
 * line the reader must parse or refuse.
 *
 * A brief written on many lines is split on its line breaks, exactly as written. A brief with NO line break is
 * one `handover register` flattened: an older register collapsed every ask's whitespace,
 * the batch lines included, so a generation reached the board as one line and the gate refused it for listing no
 * batch lines. That shape alone is split before every `- ` a space precedes. The fallback is confined to it
 * because a title can itself carry ` - `, which inside a real line must stay whole; and in a flattened brief a
 * wrong split still fails the member pattern or the `Raise <n>` count, so it is refused rather than read short.
 *
 * @param ask the generation's `summary:`, exactly as registered
 * @returns the dash lines, in brief order
 */
function briefDashLines({ ask }: { ask: string }): readonly string[] {
  const segments = BRIEF_LINE_BREAK.test(ask) ? ask.split(BRIEF_LINE_BREAK) : ask.split(/\s+(?=- )/);
  return segments.filter((candidate) => DASH_LINE.test(candidate));
}

/**
 * The lines a brief's batch is read from: the whole brief for an unfenced one carrying neither marker, the lines
 * between the FIRST start marker and the first end marker after it for a fenced one, or why neither applies.
 *
 * A marker counts only standing as a whole line, so prose quoting one mid-line is not a fence; and a brief carrying a
 * marker anywhere is never read whole, so a fence the reader cannot find refuses rather than falling back to read
 * the installation's instructions as members. A brief carrying {@link INSTALLATION_INSTRUCTIONS_HEADING} is never
 * unfenced, since an unfenced brief carries no instructions, and only text before that heading's first occurrence is
 * searched, so a marker inside the instructions can neither widen the region nor stand in for a lost one. The one
 * shape left unrefusable is a brief with no instructions that lost BOTH fence lines: it reads as unfenced.
 */
type BatchRegion =
  | { readonly kind: "unfenced" }
  | { readonly kind: "fenced"; readonly lines: readonly string[] }
  | { readonly kind: "broken"; readonly problem: string };

/** Select a brief's {@link BatchRegion}. */
function batchRegion({ ask }: { ask: string }): BatchRegion {
  // An unfenced brief carries neither the fence nor the instructions heading, so one carrying the heading ANYWHERE,
  // even flattened onto one line, owes a fence.
  const unfenced = [TOPUP_BATCH_START, TOPUP_BATCH_END, INSTALLATION_INSTRUCTIONS_HEADING].every(
    (marker) => !ask.includes(marker),
  );
  if (unfenced) {
    return { kind: "unfenced" };
  }
  // Only the text before the heading's FIRST occurrence, whole-line or not, can hold the fence: nothing generated before
  // the real heading carries its words, so a marker the installation's own text carries can never stand in for a lost
  // genuine one.
  const headingAt = ask.indexOf(INSTALLATION_INSTRUCTIONS_HEADING);
  const lines = (headingAt === -1 ? ask : ask.slice(0, headingAt)).split(BRIEF_LINE_BREAK);
  const start = lines.findIndex((line) => line.trim() === TOPUP_BATCH_START);
  if (start === -1) {
    return { kind: "broken", problem: "the brief is a fenced one but carries no batch start line" };
  }
  // A close BEFORE the first open means the genuine open was lost, so a later pair is installation text, never the
  // batch.
  if (lines.slice(0, start).some((line) => line.trim() === TOPUP_BATCH_END)) {
    return { kind: "broken", problem: "the brief closes a batch before it opens one" };
  }
  const end = lines.findIndex((line, at) => at > start && line.trim() === TOPUP_BATCH_END);
  if (end === -1) {
    return { kind: "broken", problem: "the brief opens its batch but never closes it" };
  }
  return { kind: "fenced", lines: lines.slice(start + 1, end) };
}

/** How many members `topupAsk`'s opening sentence says the batch holds — it writes `Raise <batch.length> …`. */
const ASK_COUNT = /^Raise (\d+)\b/;

/**
 * The repository a top-up brief's opening sentence names: `Raise <n> vulnerability-fix pull request(s) in
 * <owner/name> as`. The noun is matched loosely, so a row registered under an earlier noun still reads.
 */
const ASK_REPO = /^Raise \d+ [a-z -]+ pull request\(s\) in (\S+) as /;

/** The author a top-up brief's opening sentence names: `… in <owner/name> as <login>, …` — a GitHub login is letters, digits and hyphens. */
const ASK_AUTHOR = /^Raise \d+ [a-z -]+ pull request\(s\) in \S+ as ([A-Za-z0-9-]+)\b/;

/**
 * The author a generation's brief says raised its batch.
 *
 * The gate reads only that author's open pull requests, so a run for another author would see none of the
 * batch's and count every open member unraised, releasing the gate.
 *
 * @param ask the generation's `summary:`, exactly as registered
 * @returns the login, or `undefined` when the opening sentence is not `topupAsk`'s
 */
export function topupAskAuthor({ ask }: { ask: string }): string | undefined {
  return ASK_AUTHOR.exec(ask)?.[1];
}

/**
 * The repository a generation's brief names in its opening sentence.
 *
 * The gate judges only a brief naming exactly the repository it runs for. A slug prefix is shared across
 * hyphenated owner/name pairs, and a colliding row whose opening sentence did not parse was once kept and
 * judged, releasing the wrong repository's gate.
 *
 * @param ask the generation's `summary:`, exactly as registered
 * @returns `owner/name`, or `undefined` when the opening sentence is not `topupAsk`'s
 */
export function topupAskRepo({ ask }: { ask: string }): string | undefined {
  return ASK_REPO.exec(ask)?.[1];
}

/**
 * Read a generation's batch back off the brief `topupAsk` wrote into its board row.
 *
 * Refuses rather than guessing: a batch line that does not carry an alert, a repeated alert, a brief with
 * no batch lines at all, or a member count that is not the `Raise <n>` its opening sentence states plus the
 * backfill it states ({@link BACKFILL_MARKER}), is a format this reader no longer matches. Batch and backfill
 * members come back together, in brief order. A short read shrinks the raised count and releases the gate early,
 * and the count check catches a line in ANY other shape rather than only the ones a pattern anticipates.
 *
 * Splits on a real newline AND on the two-character escape `\n`. The row stores the brief as a double-quoted
 * YAML scalar and the board's flat frontmatter reader (`handover/doc.ts`) hands it back undecoded, so on a
 * real board row every line break is still the escape. MEASURED on
 * a real top-up generation: splitting on the real newline alone found no batch line
 * (repro: `slopweaver vulnerability-fix topup --repo acme/acme-admin --author <login> --model opus --dry-run`).
 * A brief with no line break at all is a flattened one, read by {@link briefDashLines}. A fenced brief is read
 * only between its markers ({@link TOPUP_BATCH_START}), and one whose fence is broken is refused by name.
 *
 * Every alert must be in `repo`: a number is only an alert inside one repository, and reading another
 * repository's number here judges an unrelated alert.
 *
 * @param ask the generation's `summary:`, exactly as registered
 * @param repo the `owner/name` the gate runs for, which every batch line's alert must be in
 * @returns every member in the order the brief lists them, or what did not parse
 */
export function topupBatchFromAsk({ ask, repo }: { ask: string; repo: string }): Result<readonly TopupBatchMember[]> {
  return topupBatchPlan({ ask, repo }).map((plan) => [...plan.batch, ...plan.backfill]);
}

/** A generation's brief read back: its batch, and the backfill lines listed after it. */
export interface TopupBatchPlan {
  readonly batch: readonly TopupBatchMember[];
  readonly backfill: readonly TopupBatchMember[];
}

/**
 * {@link topupBatchFromAsk}'s read, keeping the batch apart from its backfill so the gate can judge a backfill
 * line only where a seat raised it (`./vulnTopupGate.ts`'s `topupJudgedBackfill`).
 *
 * @param ask the generation's `summary:`, exactly as registered
 * @param repo the `owner/name` every line's alert must be in
 * @returns the batch and the backfill, each in brief order, or what did not parse
 */
export function topupBatchPlan({ ask, repo }: { ask: string; repo: string }): Result<TopupBatchPlan> {
  const members: TopupBatchMember[] = [];
  const problems: string[] = [];
  const region = batchRegion({ ask });
  if (region.kind === "broken") {
    problems.push(region.problem);
    return err(problems);
  }
  const regionLines = region.kind === "fenced" ? region.lines : ask.split(BRIEF_LINE_BREAK);
  const dashLines =
    region.kind === "fenced" ? region.lines.filter((line) => DASH_LINE.test(line)) : briefDashLines({ ask });
  for (const line of dashLines) {
    const read = batchLineMember({ line, members, repo });
    if (typeof read === "string") {
      problems.push(read);
    } else {
      members.push(read);
    }
  }
  // The count is checked only over lines that all parsed: a refused line already explains the shortfall.
  if (problems.length > 0) {
    return err(problems);
  }
  const backfill = checkedBackfill({ ask, lines: regionLines, listed: members.length });
  if (typeof backfill === "string") {
    return err([backfill]);
  }
  const batchSize = members.length - backfill;
  return ok({ backfill: members.slice(batchSize), batch: members.slice(0, batchSize) });
}

/** One batch line as a member, or the sentence saying why it is not one. */
function batchLineMember({
  line,
  members,
  repo,
}: {
  line: string;
  members: readonly TopupBatchMember[];
  repo: string;
}): TopupBatchMember | string {
  const match = MEMBER_LINE.exec(line);
  if (match === null) {
    return `a batch line carries no Dependabot alert: ${line.trim()}`;
  }
  if (Array.from(line.matchAll(ALERT_REF)).length > 1) {
    return `a batch line cites more than one Dependabot alert: ${line.trim()}`;
  }
  if (match[2] !== repo) {
    return `a batch line cites an alert in ${match[2]!}, not ${repo}: ${line.trim()}`;
  }
  const alertNumber = Number(match[3]!);
  if (!Number.isSafeInteger(alertNumber)) {
    // Past the safe range two alert numbers round to one, and the gate would read another alert's state.
    return `a batch line cites alert ${match[3]!}, too large to read exactly: ${line.trim()}`;
  }
  if (members.some((member) => member.alertNumber === alertNumber)) {
    return `alert ${String(alertNumber)} is listed twice`;
  }
  return { alertNumber, packageName: match[1]! };
}

/**
 * The sentence that introduces a security brief's backfill lines, as `topupAsk` writes it. Its own text, so the
 * stated count of dash lines is `Raise <n>` plus this `<m>`.
 */
export const BACKFILL_MARKER = "Backfill, in this order, from these";

/** What the backfill sentence tells a seat after its count — fixed text, so the reader can demand all of it. */
const BACKFILL_INSTRUCTION = "raise one only in place of a batch member you skipped.";

/**
 * The backfill sentence exactly as a brief carries it, on a line of its own.
 *
 * @param count how many backfill lines follow it
 * @returns the whole sentence, which the reader counts only when it stands as a whole line
 */
export function backfillSentence({ count }: { count: number }): string {
  return `${BACKFILL_MARKER} ${String(count)}: ${BACKFILL_INSTRUCTION}`;
}

/** One backfill sentence standing as a whole line, with the count it states. */
const BACKFILL_LINE = new RegExp(
  `^\\s*${escapeRegExp({ text: BACKFILL_MARKER })} (\\d+): ${escapeRegExp({ text: BACKFILL_INSTRUCTION })}\\s*$`,
);

/**
 * How many backfill lines a brief states, or why that cannot be read.
 *
 * A brief written before backfill existed states none, and reads as `0`, so every older row keeps the plain
 * `Raise <n>` count. The sentence counts only WHOLE, on a line of its own: an older brief interpolates free text
 * such as an `--e2e-check` name, and one quoting the marker mid-line must not change how that brief reads. A brief with no line break at all — one `handover register` flattened, which only a brief
 * from before backfill existed can be — therefore states none either, whatever it quotes. Two
 * backfill sentences, or a count past the safe-integer range, is a brief this reader no longer matches and is
 * refused, never read as the first — a short count would shrink the raised denominator.
 */
function backfillCount({ lines }: { lines: readonly string[] }): number | string {
  const stated = lines.flatMap((line) => {
    const match = BACKFILL_LINE.exec(line);
    return match === null ? [] : [match];
  });
  if (stated.length === 0) {
    return 0;
  }
  if (stated.length > 1) {
    return `the brief states its backfill ${String(stated.length)} times`;
  }
  const count = Number(stated[0]![1]!);
  if (!Number.isSafeInteger(count)) {
    return `the brief states a backfill of ${stated[0]![1]!}, too large to read exactly`;
  }
  return count;
}

/**
 * How many of the listed lines are backfill, once the brief's own count agrees with the lines it lists; or what
 * is wrong with that count.
 *
 * Every dash line is a member, the batch's and the backfill's alike, and the last `<m>` of them are the
 * backfill's — `topupAsk` writes the backfill section after the batch. `lines` is the batch region: the fenced lines
 * of a fenced brief, so a backfill sentence in the installation's instructions is never counted.
 */
function checkedBackfill({
  ask,
  lines,
  listed,
}: {
  ask: string;
  lines: readonly string[];
  listed: number;
}): number | string {
  if (listed === 0) {
    return "the brief lists no batch lines at all";
  }
  const stated = ASK_COUNT.exec(ask)?.[1];
  if (stated === undefined) {
    return "the brief does not open with how many it raises";
  }
  const backfill = backfillCount({ lines });
  if (typeof backfill === "string") {
    return backfill;
  }
  if (Number(stated) + backfill !== listed) {
    const backfillPart = backfill === 0 ? "" : ` with a backfill of ${String(backfill)}`;
    return `the brief says it raises ${stated}${backfillPart} but lists ${String(listed)} batch line(s)`;
  }
  // The last `<m>` members are the backfill's only when they are the lines UNDER the sentence: a sentence placed
  // anywhere else would make a batch member backfill, judged only where a slot opens,
  // and one stating `0` would make a line under it a batch member.
  const at = lines.findIndex((line) => BACKFILL_LINE.test(line));
  if (at === -1) {
    return backfill;
  }
  const under = lines.slice(at + 1);
  const listedUnder = under.filter((line) => DASH_LINE.test(line)).length;
  if (listedUnder !== backfill) {
    return `the brief states a backfill of ${String(backfill)} but lists ${String(listedUnder)} line(s) under it`;
  }
  return backfill;
}

/** A literal string as a regular-expression source. */
function escapeRegExp({ text }: { text: string }): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
