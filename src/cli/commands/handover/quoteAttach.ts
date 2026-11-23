/**
 * `handover quote <slug> --anchor <anchor>` — tie a row registered with no anchor to the owner's turn it came from, so
 * its Queue card leads with the owner's words instead of "Nothing records whose words are behind this".
 *
 * A card always carries the quote that led to it.
 * `profile words` finds the turn; this writes `anchor:` and the quote in one write, so a row is never left anchored
 * and unquoted. A `transcript:` turn also re-dates `askedIso` to when the owner typed it, since `handover register` derives
 * that instant from the same turn; every other scheme leaves it as registered.
 *
 * **Refused, never guessed:** a row that already has an anchor (re-anchoring changes what the row IS), an archived
 * row (it is off the queue), an anchor whose words would not read whole (a quote that says "unread" is not the
 * card the owner asked for), a supervisor turn that is only the console typing a relay (the relay is the owner's words' record), and
 * a transcript turn typed while that session did not hold the supervisor pin — the same turn `profile words` refuses.
 *
 * An anchor the row already relates as a further steer is refused too: the card would quote the same words twice.
 *
 * Dry by default, like the bulk run. The row is re-read, re-judged and rebuilt under its one lock (`./boardRowLock.ts`)
 * immediately before the write, so no other row writer can interleave and none is written over.
 */
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { ok } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { frontMatterFence, type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { FrontMatterErrors } from "../../../handover/frontmatterErrors.js";
import { bothSpellingsOf, type HisWords, OWNER_WORDS_KEYS, ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import { steerAnchor } from "../../../handover/hisWordsSteers.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import { readExactDoc } from "../../../handover/store.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { withBoardRowLock } from "./boardRowLock.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { rowBytesAsText, wordsToAttach } from "./quoteAttachRead.js";
import { damageBeyondTheGroup, quoteVerdict, textWithHisWords } from "./quotePlan.js";

/** What an attach would write, judged against one exact text of the row. */
export interface AttachPlan {
  readonly slug: string;
  readonly path: string;
  readonly anchor: string;
  readonly words: HisWords;
  /** The new `askedIso`, or `undefined` when the row's stays as it is. */
  readonly askedIso: string | undefined;
  /** The row as it was read when planned; the write re-judges the row as it reads under the lock. */
  readonly before: string;
  readonly after: string;
}

/** The row's text with the anchor, any re-dated `askedIso`, and the owner's words written in — or why it cannot be. */
function attachedText({
  doc,
  text,
  words,
}: {
  doc: HandoverDoc;
  text: string;
  words: HisWords;
}): { readonly after: string; readonly askedIso: string | undefined } | { readonly refusals: readonly string[] } {
  let askedIso: string | undefined;
  if (ownerWordsSchemeOf({ anchor: words.anchor }) === "transcript" && doc.askedIso !== undefined) {
    askedIso = words.atIso;
  }
  // The anchor edit normalises line endings, so the bulk writer's check runs on the bytes as read, before it: a CRLF row
  // would otherwise have every line rewritten where `handover quote` refuses it.
  const damage = damageBeyondTheGroup({ keys: bothSpellingsOf({ keys: OWNER_WORDS_KEYS }), text });
  if (damage.length > 0) {
    return { refusals: frontMatterErrorLines({ error: FrontMatterErrors.editWouldDamage({ damage }) }) };
  }
  const set = [{ key: "anchor", value: words.anchor }];
  if (askedIso !== undefined) {
    set.push({ key: "askedIso", value: askedIso });
  }
  const anchored = editFrontMatterFields({ path: doc.path, remove: [], set, text });
  if (anchored.isErr()) {
    return { refusals: frontMatterErrorLines({ error: anchored.error }) };
  }
  const verdict = quoteVerdict({ doc: parseHandoverDoc({ path: doc.path, text: anchored.value }), read: ok(words) });
  if (!("record" in verdict)) {
    return { refusals: [`the anchored row reads as ${verdict.kind}, so no quote would be written`] };
  }
  const quoted = textWithHisWords({ path: doc.path, record: verdict.record, text: anchored.value });
  if (quoted.isErr()) {
    return { refusals: frontMatterErrorLines({ error: quoted.error }) };
  }
  return { after: quoted.value, askedIso };
}

/**
 * Whether the row's front matter declares an `anchor:` key at all. The parser reads an empty one as no anchor, so
 * `doc.anchor` alone would let an attach overwrite a declaration somebody left blank.
 */
function declaresAnchor({ text }: { text: string }): boolean {
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return false;
  }
  return /^anchor\s*:/mu.test(fence.normalised.slice(0, fence.closeIndex));
}

/**
 * Plan one attach: read the row and the anchor, refuse what must not be written, and build the new text.
 *
 * @param slug the row
 * @param anchor the owner's turn to tie it to
 * @param handoverDir the board directory
 * @param home the Slopweaver home the talk records live under
 * @param projectsDir `~/.claude/projects`, where a transcript anchor's session lives
 * @returns the plan, or every reason it was refused
 */
export function planAttach({
  slug,
  anchor,
  handoverDir,
  home,
  projectsDir,
}: {
  slug: string;
  anchor: string;
  handoverDir: string;
  home: string;
  projectsDir: string;
}): AttachPlan | { readonly refusals: readonly string[] } {
  if (!isSafeSlug({ slug })) {
    return { refusals: [`${slug} is not a row's slug — a slug is a plain name inside the board directory`] };
  }
  const found = readExactDoc({ handoverDir, slug });
  if (found.isErr()) {
    return { refusals: [found.error.message] };
  }
  if (found.value === undefined) {
    return { refusals: [`no row is named ${slug}`] };
  }
  const { archived, doc } = found.value;
  if (archived) {
    return { refusals: [`${slug} is archived, so it has no card to quote on`] };
  }
  if (doc.anchor !== undefined) {
    return {
      refusals: [`${slug} already anchors on ${doc.anchor} — re-anchoring changes what the row is, so it is refused`],
    };
  }
  const words = wordsToAttach({ anchor, home, projectsDir });
  if ("refusals" in words) {
    return words;
  }
  const read = rowBytesAsText({ path: doc.path });
  if (typeof read !== "string") {
    return read;
  }
  return judgeAttach({ anchor, path: doc.path, slug, text: read, words });
}

/**
 * Judge one attach against one exact text of the row and build what it would write. Run once over the row as planned,
 * and again by {@link writeAttachAt} over the row as it reads under its lock, which is the judgement the write obeys.
 */
function judgeAttach({
  anchor,
  path,
  slug,
  text,
  words,
}: {
  anchor: string;
  path: string;
  slug: string;
  text: string;
  words: HisWords;
}): AttachPlan | { readonly refusals: readonly string[] } {
  // Judged on the bytes about to be rewritten: the row the board read may have gained an anchor since.
  const current = parseHandoverDoc({ path, text });
  if (current.anchor !== undefined || declaresAnchor({ text })) {
    return {
      refusals: [`${slug} already declares an anchor: line, empty or not — fill it by hand or remove it first`],
    };
  }
  if (current.hisWordsSteers.some((steer) => steerAnchor({ steer }) === anchor)) {
    return { refusals: [`${slug} already relates ${anchor} as a further steer, so its card would quote it twice`] };
  }
  const built = attachedText({ doc: current, text, words });
  if ("refusals" in built) {
    return built;
  }
  return { after: built.after, anchor, askedIso: built.askedIso, before: text, path, slug, words };
}

/**
 * Write a plan under the row's one lock (`./boardRowLock.ts`): the row is re-read and the attach re-judged and rebuilt
 * over that read inside the lock, so a steer related, or any other row edit made, at the same moment is kept rather
 * than written over, and a row anchored since the plan is refused.
 *
 * @returns every reason nothing was written — empty when it was
 */
function writeAttach({ plan }: { plan: AttachPlan }): readonly string[] {
  const locked = withBoardRowLock({ path: plan.path, write: ({ target }) => writeAttachAt({ plan, target }) });
  if (locked.isErr()) {
    return [locked.error.message];
  }
  return locked.value;
}

/** {@link writeAttach}'s read, judgement and write, run under the lock against the real file the lock was taken on. */
function writeAttachAt({ plan, target }: { plan: AttachPlan; target: string }): readonly string[] {
  const now = rowBytesAsText({ path: target });
  if (typeof now !== "string") {
    return now.refusals;
  }
  const locked = judgeAttach({ anchor: plan.anchor, path: plan.path, slug: plan.slug, text: now, words: plan.words });
  if ("refusals" in locked) {
    return locked.refusals;
  }
  try {
    writeFileAtomic({ contents: locked.after, path: target });
  } catch (cause: unknown) {
    return [`could not write ${plan.path}: ${String(cause)}`];
  }
  return [];
}

/** Where the attach mode's lines go: a result to `out`, a refusal or a failure to `fail`. */
interface QuoteAttachSink {
  readonly out: (line: string) => void;
  readonly fail: (line: string) => void;
}

/** The verb's own sink — stdout for a result, stderr for a refusal. */
export const QUOTE_ATTACH_LOGGER: QuoteAttachSink = {
  fail: (msg) => {
    logger.error({ msg });
  },
  out: (line) => {
    logger.out({ line });
  },
};

/** The usage mistakes the attach mode refuses before reading anything. */
function attachUsageProblems({ slugs, check }: { slugs: readonly string[]; check: boolean }): readonly string[] {
  const usage: string[] = [];
  if (slugs.length !== 1) {
    usage.push(`--anchor ties one row to the owner's words — name exactly one slug, got ${String(slugs.length)}`);
  }
  // `readExactDoc` joins the slug onto the board directory and trusts its caller to have checked it.
  slugs
    .filter((slug) => !isSafeSlug({ slug }))
    .forEach((slug) => {
      usage.push(`${slug} is not a row's slug — a slug is a plain name inside the board directory`);
    });
  if (check) {
    usage.push("--check reads the board's quotes, so it cannot be given with --anchor");
  }
  return usage;
}

/** Print what an attach did or would do. */
function printAttach({
  plan,
  apply,
  problems,
  json,
  sink,
}: {
  plan: AttachPlan;
  apply: boolean;
  problems: readonly string[];
  json: boolean;
  sink: QuoteAttachSink;
}): void {
  const wrote = apply && problems.length === 0;
  if (json) {
    const { anchor, askedIso, slug } = plan;
    const value = { anchor, applied: apply, askedIso, atIso: plan.words.atIso, problems, slug, wrote };
    sink.out(safeJsonStringify({ label: "handover quote --anchor", value }));
    return;
  }
  let verb = "would anchor";
  if (wrote) {
    verb = "anchored";
  }
  let redated = "";
  if (plan.askedIso !== undefined) {
    redated = `, askedIso re-dated to ${plan.askedIso}`;
  }
  sink.out(
    `handover quote: ${plan.slug} — ${verb} on ${plan.anchor} and quoted the owner's words of ${plan.words.atIso}${redated}`,
  );
  problems.forEach((line) => {
    sink.fail(`handover quote: ${plan.slug} — nothing written: ${line}`);
  });
  if (!apply) {
    sink.out("handover quote: dry run — add --apply to write it");
  }
}

/**
 * Run the attach mode of `handover quote`.
 *
 * @param slugs the positionals — exactly one is required
 * @param anchor the owner's turn to tie the row to
 * @param check whether `--check` was given, which this mode refuses
 * @param apply write, rather than print what would be written
 * @param json one JSON document instead of lines
 * @param handoverDir the board directory
 * @param home the Slopweaver home
 * @param sink where result and refusal lines go
 * @returns 0 when planned or written, 1 when refused or a write or mirror failed, 2 on a usage mistake
 */
export async function runQuoteAttach({
  slugs,
  anchor,
  check,
  apply,
  json,
  handoverDir,
  home,
  sink,
}: {
  slugs: readonly string[];
  anchor: string;
  check: boolean;
  apply: boolean;
  json: boolean;
  handoverDir: string;
  home: string;
  sink: QuoteAttachSink;
}): Promise<number> {
  const usage = attachUsageProblems({ check, slugs });
  usage.forEach((line) => {
    sink.fail(`handover quote: ${line}`);
  });
  if (usage.length > 0) {
    return EXIT_USAGE;
  }
  // The same Claude home `profile words` reads, so an anchor it prints is one this can attach.
  const projectsDir = join(claudeHomeDir(), "projects");
  const plan = planAttach({ anchor, handoverDir, home, projectsDir, slug: slugs[0]! });
  if ("refusals" in plan) {
    plan.refusals.forEach((line) => {
      sink.fail(`handover quote: ${line}`);
    });
    return EXIT_ERROR;
  }
  let problems: readonly string[] = [];
  let mirrorFailed = false;
  if (apply) {
    problems = writeAttach({ plan });
  }
  if (apply && problems.length === 0) {
    mirrorFailed = await mirrorAfterWrite({ home, path: plan.path, verb: "quote" });
  }
  printAttach({ apply, json, plan, problems, sink });
  if (problems.length > 0 || mirrorFailed) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}
