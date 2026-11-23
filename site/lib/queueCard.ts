/**
 * One queue row as a fleet-briefing react-now CARD — question, what, why you, options, lean, if silent —
 * derived from the register's own record and nothing else. A row that would be the same sentence on every card of a
 * register is no row: the ask card draws no `why you` and no `if silent`.
 *
 * ## Why this file exists at all
 *
 * The queue section is meant to resemble the fleet briefing, and it earns its place only when it is easy to read
 * first. Measured, off three screenshots of the queue page: the card the owner met was the autonomy ledger's row
 * printed as a `<dl>` — `actionId`, `kind`, `subject`, `why` with absolute scratch paths in it. The shape the owner wants is the one
 * `skills/supervisor/reference/fleet-briefing-shape.md` already gates: a numbered question, a `what`, a
 * `why you`, options A/B/C, a lean, an if-silent, and every detail folded.
 *
 * ## The one rule that shapes every function here
 *
 * **The console runs no model** (`AGENTS.md` rule 2), so every sentence below is either a field the verb
 * printed or a constant belonging to the register. Nothing here composes a rationale, and nothing explains an
 * absence: a field the register cannot fill is `undefined` and the card draws no row for it, because PROBLEM,
 * STAKES and LEAN rows that read "Only a recorded ask carries a problem statement…" on every card are junk.
 * `./briefingCardForm.ts` refuses a card that draws text where its record held none.
 *
 * ## It imports NOTHING, and that is load-bearing
 *
 * The repository's unit lane collects `src/__tests__/unit/**\/*.test.ts`, and the root `tsconfig.json`
 * excludes `site` while resolving modules as `nodenext`; the site's own config resolves as `bundler` and
 * its files import extensionlessly. A test under the unit lane therefore pulls this one file — and only
 * this one — into the root program. With no imports at all it typechecks identically under both
 * resolutions. Add an import here and `yarn typecheck` goes red on a specifier, for a reason that has
 * nothing to do with the change. The input types below are STRUCTURAL for the same reason: the caller
 * passes `AutonomyRow` (`../components/live/readAutonomy.ts`), or `BoardRow`, `HandStep`, `LandingRow` or
 * `HeldDraft` from `site/components/live/read.ts`, straight in.
 *
 * The caps restate `src/briefing/caps.ts` rather than import it (separate Yarn project, and the root
 * tsconfig excludes this tree). That file is the origin and carries the measurement behind
 * each number; `caps.ts` itself restates the repository's sentence cap for the same reason.
 */

/**
 * The longest a card's question may run, in words — `QUESTION_MAX_WORDS` in `src/briefing/caps.ts`.
 *
 * Not enforced by a refusal here, because a register's own question is not ours to reject; it is the bar
 * {@link overCap} reports against so a row that blows it is visible rather than silently long.
 */
export const QUESTION_MAX_WORDS = 30;

/** The longest a `what` may run above the fold, in words — `WHAT_MAX_WORDS` in `src/briefing/caps.ts`. */
export const WHAT_MAX_WORDS = 60;

/** The most sentences a `what` may carry above the fold — `WHAT_MAX_SENTENCES` in `src/briefing/caps.ts`. */
export const WHAT_MAX_SENTENCES = 4;

/**
 * A body of text split at the fold: what is shown, and the whole of it for the fold beneath.
 *
 * `whole` is the WHOLE text rather than the remainder, on purpose — a reader who opens the fold should
 * never have to stitch two halves back together to read one paragraph.
 */
export interface FoldedText {
  readonly aboveFold: string;
  readonly whole: string;
  /** Whether anything was held back; when false, the fold is not drawn at all. */
  readonly folded: boolean;
}

/** One of the card's A/B/C options: what the owner could decide, and how that decision is actually taken. */
export interface CardOption {
  readonly letter: string;
  /** A full sentence naming the decision — never a bare label. */
  readonly sentence: string;
  /** How it is taken: a press on this panel, a command elsewhere, or nothing at all. */
  readonly how: CardHow;
  /**
   * One line naming what taking it COSTS, present only where the register recorded one.
   *
   * A trade-off sits beside every option on an ask waiting on the owner's word,
   * and `slopweaver handover ask --options` is the verb that records it. It is `undefined` on every other
   * card in this file because those options are the PANEL's own affordances — a press, a command, silence —
   * and a trade-off invented for one would be this console authoring a sentence, which `AGENTS.md` rule 2
   * bans outright.
   */
  readonly tradeoff?: string;
}

/**
 * The STAKES row of a card: what deciding puts at risk, who it reaches, and whether the problem still stands.
 *
 * Risk, blast radius and trade-off are what the owner wants at a glance when reacting. `stated` carries the verb's own three lines and
 * the instant the still-real check was confirmed, which the panel ages against its own clock. A card whose
 * register states none carries `undefined` rather than a sentence saying so.
 */
export type CardStakes =
  | {
      readonly kind: "stated";
      readonly risk: string;
      readonly blastRadius: string;
      readonly stillReal: string;
      /** When the check was confirmed — `undefined` only on a row whose publisher could not say. */
      readonly checkedIso: string | undefined;
    }
  | {
      /** A finding pull request's OWN Risk and Blast radius cells, and where it stands — never "still real?", which asks
       * whether a problem stands, not what became of the pull request that answered it. */
      readonly kind: "pull-request";
      readonly risk: string;
      readonly blastRadius: string;
      /** Where the pull request stands: merged, open, draft or closed without merging. */
      readonly status: string;
      /** The read's own instant. */
      readonly checkedIso: string;
    };

/** How an option is taken. A press the panel owns, a command run elsewhere, or silence. */
export type CardHow =
  | { readonly kind: "press"; readonly button: string }
  | { readonly kind: "elsewhere"; readonly command: string | undefined; readonly where: string }
  | { readonly kind: "silence" };

/**
 * What a card's subject DOES, read off a typed field on its record — never guessed from prose.
 *
 * A badge before the title says what kind of thing the owner is being asked to send or decide. The three draft
 * acts are `slack draft record --act`'s; `question` is the one an ask row earns by asking one, where the owner is
 * the one asked.
 */
export type CardAct = "reply" | "bump" | "review-ask" | "question";

/** The badge each act draws before the title. */
export const ACT_BADGE: Readonly<Record<CardAct, string>> = {
  bump: "Bump",
  question: "Question",
  reply: "Reply",
  "review-ask": "Review ask",
};

/** One person a card is addressed to: the Slack member id the chip resolves, and the name drawn when it cannot. */
export interface CardHeadPerson {
  readonly id: string;
  readonly label: string;
}

/**
 * The head of a card, above its question's detail: the act badge, the people row and a plain context line.
 *
 * Every field is a record field or a constant (rule 2). `people` comes from member IDS — the DM peer, or the draft's
 * own person mentions — never from names matched in prose, which is how a name the roster holds twice (Seth Tanner)
 * failed to chip and a name matched mid-sentence drew a chip inside the title.
 */
export interface CardHead {
  /** The badge, or `undefined` on a record that declares none — no badge is never a wrong one. */
  readonly act: CardAct | undefined;
  /** Who it is addressed to, in the draft's own order; empty draws no people row. */
  readonly people: readonly CardHeadPerson[];
  /** The word the people row opens with — {@link peopleVerbOf}. */
  readonly peopleVerb: string;
  /** One plain line: where it lands and what it answers, or `undefined` where the record says nothing. */
  readonly context: string | undefined;
}

/**
 * The word a people row opens with: who a bump nudges, who a review ask asks, who anything else is to.
 *
 * @returns `Nudging`, `Asking` or `To`
 */
export function peopleVerbOf({ act }: { act: CardAct | undefined }): string {
  if (act === "bump") {
    return "Nudging";
  }
  if (act === "review-ask") {
    return "Asking";
  }
  return "To";
}

/**
 * Whether a card draws its people row — the one place the panels ask, so the title's subtitle and the row agree on
 * whether the names already appear.
 *
 * @returns true when the card's head names at least one person
 */
export function drawsPeopleRow({ card }: { card: Pick<BriefingCard, "head"> }): boolean {
  return card.head !== undefined && card.head.people.length > 0;
}

/** One register's row, as the fleet-briefing card shape — every register but the hands one. */
export interface BriefingCard {
  readonly kind: "briefing";
  /**
   * The act badge, the people row and the context line — or `undefined` on a card whose record carries none of
   * them. REQUIRED so no builder can leave it unsaid, exactly as {@link BriefingCard.commands} is.
   */
  readonly head: CardHead | undefined;
  /** One sentence, ending in a question mark — or, on an old row that asks nothing, its lead as written, unlabelled. */
  readonly question: string;
  /** The subject line under the question — the repository and number, the slug, the channel. */
  readonly subject: string;
  /**
   * The background, folded at the measured cap — `undefined` when the record holds none, such as an act recorded
   * before the ledger asked for a plain-words line. On an act card it is the one field drawn above the fold.
   */
  readonly what: FoldedText | undefined;
  /**
   * One line: what is actually wrong or undecided — `undefined` where the register records none.
   *
   * The first third of the SHAPE required of an ask that waits on the owner's word.
   * Only a shaped ASK row, or a finding act's pull request, carries one; inventing a problem statement out of a
   * record's prose is exactly the authoring `AGENTS.md` rule 2 bans, and a sentence saying there is none is
   * junk.
   */
  readonly problem: string | undefined;
  /**
   * One sentence: why this row is the owner's rather than a session's — `undefined` on a message the owner would send
   * as themselves (a held reply, a parked post, a parked review), where it is implied and the sentence reads as
   * robotic, and on an ask, where it is one sentence on every card that the owner never reads.
   */
  readonly whyYou: string | undefined;
  /** Risk, blast radius and still-real — the verb's own, or `undefined` where none are stated. */
  readonly stakes: CardStakes | undefined;
  readonly options: readonly CardOption[];
  /** The verb's own recommendation, or `undefined` where no verb makes one. */
  readonly lean: string | undefined;
  /**
   * What happens if the owner does nothing — derived from the register's contract and one record field — or `undefined`
   * on a register whose answer is the same sentence on every card (an ask: the run stays parked on the owner), which
   * the owner never reads.
   */
  readonly ifSilent: string | undefined;
  /** Every local page the record names, so a panel draws a link where the prose had an absolute path. */
  readonly pages: readonly CardPage[];
  /**
   * Each exact string the owner pastes, drawn whole in a copy block of its own — empty on a card with nothing to paste.
   *
   * A command the owner has to run (a `sudo` line on an ask card, say) belongs in a copy block, never in paragraph text, and a hands card must say where
   * to copy it from. The key is REQUIRED so no card
   * builder can leave it unsaid: an ask carries the command paragraphs its question held (`./askCommands.ts`), and
   * every other register passes `[]`.
   */
  readonly commands: readonly string[];
  /**
   * The concrete examples an ASK card leads with — `undefined` on every other register.
   *
   * Every open ask carries, above its options, a second-person scene the owner can
   * picture — what they were doing, what appeared, what the fleet did or wants to do — ending on the question the card
   * is really asking. REQUIRED so no builder can leave it unsaid, exactly as {@link BriefingCard.commands} is.
   */
  readonly examples: CardExamples | undefined;
}

/**
 * What an ask card draws in its example slot: the recorded scenes, numbered when there is more than one; the row's
 * own line saying it cannot support one; or, on a row that recorded neither, the card saying so plainly rather than
 * inventing a scene its row does not hold.
 */
export type CardExamples =
  | { readonly kind: "scenes"; readonly scenes: readonly string[] }
  | { readonly kind: "gap"; readonly line: string }
  | { readonly kind: "unrecorded" };

/** What an ask card says in its example slot when its row recorded neither a scene nor a gap. */
export const UNRECORDED_EXAMPLE_LINE =
  "No concrete example is recorded on this card yet, and nothing here invents one from its row.";

/** What a step card labels one of its step's own fields. */
export type StepRowLabel =
  | "go to"
  | "if you do nothing"
  | "unblocks"
  | "still here because"
  | "kept because"
  | "could not read"
  | "open"
  | "no address"
  | "where"
  | "done when"
  | "cites";

/**
 * One line of a step card: a label, and one field of the step's record, verbatim. `behind` puts it under the card's
 * disclosure rather than above it — still a row of the card, so every reader of `rows` (the template check, the
 * voice, the chip resolver) keeps seeing it.
 */
export interface StepRow {
  readonly label: StepRowLabel;
  readonly value: string;
  readonly behind?: true;
}

/**
 * One option the ask recorded, exactly as `handover ask --options` wrote it — no `how`, because how an option is
 * taken is the panel's mechanics, and a line of mechanics under every option is the template text this shape bars.
 */
export interface StepOption {
  readonly letter: string;
  readonly sentence: string;
  readonly tradeoff: string;
}

/**
 * One line of a step's checklist (`src/hand/checklist.ts`), verbatim: the sentence, its one command, where the value
 * it needs sits on the page (outermost label first), and the page it happens on.
 */
export interface StepChecklistLine {
  readonly action: string;
  readonly command: string | undefined;
  readonly find: readonly string[] | undefined;
  readonly url: string | undefined;
}

/** The shaped ask a decision step opens, as that ask's own fields and nothing composed around them. */
export interface StepDecision {
  readonly summary: string | undefined;
  readonly problem: string;
  readonly options: readonly StepOption[];
  readonly lean: string;
  /** The ask's three stakes lines, or `undefined` when it recorded none — no row is drawn in their place. */
  readonly stakes: Extract<CardStakes, { kind: "stated" }> | undefined;
}

/**
 * A step only the owner's hands can take, as a card carrying nothing but that step's own record.
 *
 * Drawn as the briefing, a hands card is about 95% generic boilerplate the owner skips, providing 0 value. Every PROBLEM, STAKES, WHY YOU, OPTIONS, LEAN and IF SILENT
 * line on it was one sentence repeated on every step, so this shape has no field that could hold one: its rows are
 * labels over the record's own values, an absent value is no row at all, and `./handCard.ts` refuses a card
 * carrying any text its record did not write.
 */
export interface StepCard {
  readonly kind: "step";
  /** The step's own sentence, as the drawer's heading. */
  readonly question: string;
  /** The step's id, or the slug of the ask it opens. */
  readonly subject: string;
  /**
   * The step's own sentence, whole and as recorded — what a hint or the voice reads, never drawn a second time under
   * the heading.
   */
  readonly what: FoldedText;
  readonly pages: readonly CardPage[];
  readonly copy: string | undefined;
  /** The script the owner runs through, one tickable line each, every command its own copy block — or none. */
  readonly checklist: readonly StepChecklistLine[] | undefined;
  readonly rows: readonly StepRow[];
  /** The ask the step opens, when it opens one. */
  readonly decision: StepDecision | undefined;
}

/** One queue row's card: the fleet briefing, or a hand step's own record. */
export type QueueCard = BriefingCard | StepCard;

/**
 * Count the words in a body of text.
 *
 * @returns the number of whitespace-separated runs
 */
export function wordsOf({ text }: { text: string }): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/u).length;
}

/**
 * Split text into sentences, keeping each terminator with the sentence it ends.
 *
 * Deliberately naive — a full stop followed by whitespace. The console's inputs are a verb's own prose,
 * and the cost of a wrong split here is one sentence too many above the fold, never a cut word: the fold
 * always carries the whole text regardless.
 *
 * @returns the sentences, in order, with no empty members
 */
export function sentencesOf({ text }: { text: string }): readonly string[] {
  const out: string[] = [];
  for (const piece of text.trim().split(/(?<=[.!?])\s+/u)) {
    const sentence = piece.trim();
    if (sentence.length > 0) {
      out.push(sentence);
    }
  }
  return out;
}

/**
 * Cut a body of text at the fold — whole sentences only, never mid-word and never with an ellipsis.
 *
 * The cap and the no-truncation rule compose one way and one way only: sentences are taken until the next
 * one would cross {@link WHAT_MAX_SENTENCES} or {@link WHAT_MAX_WORDS}, and the fold carries the whole
 * text. The edge worth stating: when the FIRST sentence alone is over the word cap it is still shown
 * whole, because `fleet-briefing-shape.md` § "The page never truncates" outranks the cap — a cut sentence
 * drops what the rest of it said, and a long one merely reads long.
 *
 * @param text the record's own prose
 * @returns what is shown, the whole of it, and whether anything was held back
 */
export function foldedText({ text }: { text: string }): FoldedText {
  const whole = text.trim();
  const sentences = sentencesOf({ text: whole });
  const shown: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const next = wordsOf({ text: sentence });
    const overSentences = shown.length >= WHAT_MAX_SENTENCES;
    const overWords = shown.length > 0 && words + next > WHAT_MAX_WORDS;
    if (overSentences || overWords) {
      break;
    }
    shown.push(sentence);
    words += next;
  }
  const aboveFold = shown.join(" ");
  return { aboveFold, folded: aboveFold.length < whole.length, whole };
}

/**
 * Is a one-line field over its cap? What a row reports rather than what it refuses.
 *
 * @param text the field
 * @param max the cap, in words
 * @returns true when the field runs past the cap
 */
export function overCap({ text, max }: { text: string; max: number }): boolean {
  return wordsOf({ text }) > max;
}

/**
 * A record's field text as a card may draw it — `undefined` when it is absent or only blanks, so the card draws no
 * row rather than an empty one.
 *
 * @param text the record's own value for the field
 * @returns the text, or `undefined` when it says nothing
 */
export function saidText({ text }: { text: string | undefined }): string | undefined {
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }
  return text;
}

/**
 * A card's `what`, folded — or `undefined` when the record gave it nothing to say, so no row is drawn.
 *
 * @param text the record's own prose, already made readable
 * @returns the folded text, or `undefined` for an empty one
 */
export function whatOf({ text }: { text: string }): FoldedText | undefined {
  if (text.trim().length === 0) {
    return undefined;
  }
  return foldedText({ text });
}

/**
 * End a sentence in a question mark, without doubling one the text already has.
 *
 * @returns the question
 */
export function asQuestion({ text }: { text: string }): string {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) {
    return trimmed;
  }
  if (trimmed.endsWith(".") || trimmed.endsWith("!")) {
    return `${trimmed.slice(0, -1)}?`;
  }
  return `${trimmed}?`;
}

/** A local page a record names by absolute path — what a panel draws as a link instead of the path. */
export interface CardPage {
  /** The page's own directory name, which is what a reader recognises it by. */
  readonly slug: string;
  readonly url: string;
}

/**
 * Every `.../pages/<slug>/index.html` a record's prose names, as an absolute `file://` address, with any query
 * and fragment after it — `src/pages/url.ts` accepts both, and a link that dropped them would open somewhere else.
 */
const LOCAL_PAGE = /file:\/\/[^\s"<>`]*?\/pages\/(?!\.\.?\/)([A-Za-z0-9._-]+)\/index\.html(?:[?#][^\s"<>`]*)?/gu;

/** Sentence punctuation, a closing bracket or quote: what ends a prose sentence, never an address. */
const TRAILING_PROSE = /[.,;:!?)\]']+$/u;

/**
 * The local pages a record's prose names.
 *
 * @param text the record's own prose
 * @returns each page once, in the order it was named
 */
export function localPagesIn({ text }: { text: string }): readonly CardPage[] {
  const out: CardPage[] = [];
  for (const match of text.matchAll(LOCAL_PAGE)) {
    const [matched, slug = ""] = match;
    const url = matched.replace(TRAILING_PROSE, "");
    if (!out.some((page) => page.url === url)) {
      out.push({ slug, url });
    }
  }
  return out;
}

/**
 * The same prose with every local page address replaced by the page's name.
 *
 * An absolute scratch path mid-sentence is the single worst offender on the open card — it is longer than the
 * sentence around it and says nothing a reader wants. The
 * address is not dropped: {@link localPagesIn} hands it to the panel, which draws it as a link the owner can
 * press, and the fold under every card still carries the record exactly as the verb printed it.
 *
 * @param text the record's own prose
 * @returns the prose with each address as `the <slug> page`
 */
export function withoutLocalPaths({ text }: { text: string }): string {
  let out = text;
  // Longest first, so an address carrying a query is replaced whole before the bare address inside it.
  const pages = localPagesIn({ text }).toSorted((a, b) => b.url.length - a.url.length);
  for (const page of pages) {
    out = out.split(page.url).join(`the ${page.slug} page`);
  }
  return out.replace(/\s+/gu, " ").trim();
}

/**
 * A record's own prose, made readable without changing what it says: page addresses become page names,
 * and what absolute paths remain are shortened to `~/`. The ONE function a card calls, so the two passes
 * cannot be applied in the wrong order — `withoutLocalPaths` has to run first, because a page address is
 * itself an absolute home path and shortening it first would leave `file://~/...` matching nothing.
 *
 * @param text the record's own prose
 * @returns the prose as a card shows it
 */
export function readable({ text }: { text: string }): string {
  return withHomeShortened({ text: withoutLocalPaths({ text }) });
}

/** A home directory spelled absolutely, whatever the account is called on this machine. */
const HOME_PREFIX = /\/(?:Users|home)\/[^/\s]+\//gu;

/**
 * The same prose with every absolute home path shortened to `~/`.
 *
 * The ledger's `why` carries absolute scratch paths, and they make it unreadable — one is forty characters of which the last ten carry the meaning. `~/` is the
 * same path said shortly, so nothing is lost and the sentence around it becomes legible. Separate from
 * {@link withoutLocalPaths}, which drops a page ADDRESS entirely because the panel draws it as a link;
 * here there is nothing to link to, so the path stays and only its prefix goes.
 *
 * @param text the record's own prose
 * @returns the prose with `/Users/<someone>/` and `/home/<someone>/` as `~/`
 */
export function withHomeShortened({ text }: { text: string }): string {
  return text.replace(HOME_PREFIX, "~/");
}

/**
 * The ledger's own `kind` slug as readable words — hyphens and dots become spaces, nothing else changes.
 *
 * MECHANICAL on purpose. MEASURED, the autonomy ledger carried 186 distinct kinds
 * (`slopweaver autonomy list --json`), from `press-merge-when-ready` to
 * `config.claude-permissions-deny`, and a hand-written table of verb phrases over an open vocabulary is a
 * generator of confident lies about what the fleet did. Quoting the field is the only honest projection.
 *
 * @returns the slug with its separators as spaces
 */
export function kindWords({ kind }: { kind: string }): string {
  return kind.replace(/[.\-_]+/gu, " ").trim();
}

/**
 * A subject a reader can place: a GitHub pull-request URL becomes `owner/repo#number`, a Slack archive URL
 * becomes its channel, and anything else is shown as the record wrote it.
 *
 * @returns the label
 */
export function subjectLabel({ subject }: { subject: string }): string {
  const pull = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/u.exec(subject);
  if (pull !== null) {
    // Destructured defaults rather than a cast: the regex cannot match without all three groups, and the
    // root program compiles this file under `noUncheckedIndexedAccess` while `site/` does not.
    const [, owner = "", repo = "", number = ""] = pull;
    return `${owner}/${repo}#${number}`;
  }
  const archive = /^https:\/\/[^/]+\/archives\/([A-Z0-9]+)/u.exec(subject);
  if (archive !== null) {
    const [, channel = ""] = archive;
    return `Slack ${channel}`;
  }
  return subject.replace(/^https:\/\//u, "");
}

/** The board's row, as much of it as a card reads. */
export interface AskRecord {
  readonly slug: string;
  /**
   * The chip for the page the row published its answer at, cited FIRST — built by the caller
   * (`./cardPages.ts`), since this module imports nothing. A required key, so no caller forgets the artifact.
   */
  readonly artifactPage: CardPage | undefined;
  /** The question as recorded, with every command paragraph already lifted into {@link AskRecord.commands}. */
  readonly question: string;
  /**
   * Each command the question carried on lines of its own, one copy block apiece — lifted by the caller
   * (`./askCommands.ts`), since this module imports nothing. Empty on a question carrying none.
   */
  readonly commands: readonly string[];
  readonly reason: string;
  readonly summary: string | undefined;
  readonly priority: string | undefined;
  readonly threadUrl: string | undefined;
  /** `problem` off the row, absent on an ask recorded before the shape existed. */
  readonly problem: string | undefined;
  /** `options` off the row — two to four, each with its trade-off. Empty on an unshaped ask. */
  readonly options: readonly AskRecordOption[];
  /** `lean` off the row, absent on an unshaped ask. In the session's voice, never the owner's word. */
  readonly lean: string | undefined;
  /** `risk` off the row — whole with the next two, or absent with them. */
  readonly risk: string | undefined;
  readonly blastRadius: string | undefined;
  readonly stillReal: string | undefined;
  /** When the still-real check was confirmed, as `handover list --json` publishes it. */
  readonly stillRealIso: string | undefined;
  /** `examples` off the row — one to three second-person scenes, empty when it records none or a gap. */
  readonly examples: readonly string[];
  /** `exampleGap` off the row — its one line saying no truthful scene can be built, absent otherwise. */
  readonly exampleGap: string | undefined;
  /**
   * The destinations of the Slack draft this ask OFFERS, each already resolved to its own send command —
   * `undefined` on an ask that offers no draft, which is most of them.
   *
   * Resolved by the CALLER rather than here, and that is this file's import rule rather than a preference:
   * the command is built by `./askAction.ts` off the wire destination, which this module may not import.
   * What arrives is four strings per destination, and the card decides only where they sit.
   *
   * When it is present it REPLACES {@link AskRecord.options} on the card. The verb derived those options
   * from these same destinations (`src/handover/askActionOptions.ts`), so the two are one fact — and the
   * destination is the half that carries the command, which is what makes the option takeable.
   */
  readonly offered: readonly AskRecordSend[] | undefined;
}

/** One destination of an offered draft, as the panel hands it to the card. */
export interface AskRecordSend {
  /** The option's own sentence — the verb's `label`, which is also the recorded option's text. */
  readonly label: string;
  /** What sending it there costs. */
  readonly tradeoff: string;
  /** The exact `slopweaver slack …` line that would send it. Shown, copied, never pressed here. */
  readonly command: string;
  /** Where it lands, in words — `a new top-level message in C01SDLC`. */
  readonly where: string;
}

/** One recorded option off an ask row, exactly as `handover list --json` publishes it. */
export interface AskRecordOption {
  readonly letter: string;
  readonly option: string;
  readonly tradeoff: string;
}
