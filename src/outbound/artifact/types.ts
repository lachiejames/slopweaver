/**
 * The PROVIDER-AGNOSTIC outbound artifact vocabulary — what to say, never how a platform says it.
 *
 * This module imports NOTHING from `@slack/*` (or any other platform SDK), and a unit test enforces
 * that. The reason is concrete rather than aesthetic: PR6 (Linear), PR7 (GitHub) and PR8 (Notion)
 * reuse these types verbatim and add a renderer. A Slack type leaking in here would force each of
 * them to either duplicate the schema or depend on Slack — which is exactly how the archive ended up
 * smuggling structured payloads through two display-only strings.
 *
 * Optional fields are written `?: T | undefined` rather than `?: T`. Under `exactOptionalPropertyTypes`
 * those differ, and the Zod schemas in `./schema.ts` and `./asMeSchema.ts` infer the former; spelling it out
 * here keeps the hand-written contract and the parsed shape identical instead of needing a cast at the seam.
 *
 * Every text field is PLAIN TEXT. Emphasis is STRUCTURAL, never syntax: a `*bold*` written into one
 * of these strings is a form-fill bug, not markup, because the Slack renderer emits `rich_text` where
 * mrkdwn is inert and asterisks render literally. See the dry-run's advisory warning.
 */

/** One styled run of plain text. Emphasis is a flag, never a character in `text`. */
export interface TextSpan {
  readonly type: "text";
  readonly text: string;
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly code?: boolean | undefined;
  /**
   * Somebody ELSE'S words, carried verbatim — a monitor's title, a ticket's subject — rendered exactly as a
   * text run but not the author's voice, so the voice rules skip it the way they already skip a link's label
   * (`./aboveFold.ts`). Costs its full width against every cap: it is still on the screen. Set ONLY by a
   * DERIVED card that knows which of its runs it quoted — `./runSchema.ts` refuses it on a composed form, so
   * a composer cannot mark its own prose as somebody else's.
   */
  readonly quoted?: boolean | undefined;
}

/** A hyperlink. Only `label` is ever visible, which is why the URL costs nothing against a cap. */
export interface LinkRun {
  readonly type: "link";
  readonly label: string;
  readonly url: string;
  /**
   * Whether the label renders bold. The label IS the bold text, so a bold word and its link are one thing to
   * read rather than two (the bolded group name should "also be a hyperlink").
   */
  readonly bold?: boolean | undefined;
}

/**
 * A mention of a PERSON, by identity-map key — never a platform id and never `<@U…>`. The renderer
 * resolves it. A model filling this form has no syntax for a mention, so it cannot fabricate one.
 */
interface MentionRun {
  readonly type: "mention";
  readonly person: string;
}

/**
 * A mention of a whole Slack USER GROUP, by handle — never `<!subteam^S…>`. The renderer resolves it
 * against the structure index (`../../silver/groupResolver.ts`), which refuses a group that is disabled or
 * empty rather than rendering a mention that reaches nobody.
 *
 * Separate from {@link MentionRun} rather than a `kind` on it, because the two resolve against different
 * indexes, refuse for different reasons, and become different Slack elements. A form that could name a
 * person and a group in one field would make "which did you mean" a question the renderer had to guess at.
 */
interface GroupRun {
  readonly type: "group";
  /** The group's handle (`engineers`), its `@handle`, or its `S…` id. Never its display name. */
  readonly handle: string;
}

/** An `@here` / `@channel` blast. Deliberately NOT something a mention can become. */
interface BroadcastRun {
  readonly type: "broadcast";
  readonly range: "here" | "channel";
}

/** A `[n]` citation chip, pointing at an entry in the artifact's `citations`. */
interface CitationRun {
  readonly type: "citation";
  readonly citationId: string;
}

/** Every inline run an artifact can carry. */
export type InlineRun = TextSpan | LinkRun | MentionRun | GroupRun | BroadcastRun | CitationRun;

/** How many people a possible problem affects, in the three words the owner reads. */
export type ProblemReach = "many" | "a few" | "one";

/**
 * Whether a composed message is about a possible problem, and if so how many it affects — declared by the
 * composer, checked against the form's top region by `./problemReach.ts`.
 */
export type ProblemDeclaration =
  { readonly kind: "none" } | { readonly kind: "possible"; readonly affects: ProblemReach };

/** What a top-level channel post asks of the people reading it — one act, or nothing. */
export type OpeningAsk = "react" | "reply" | "review" | "decide" | "nothing";

/**
 * How a top-level channel post OPENS: the composer's own words saying what it is, then the words saying what it
 * asks of the reader — declared, and checked against the form's top region by `./channelOpening.ts`.
 */
export interface OpeningDeclaration {
  /** The words in the top region that say what this post is, e.g. "a pilot of a bot that triages MFA asks". */
  readonly what: string;
  readonly asks: {
    readonly kind: OpeningAsk;
    /** The words, after `what`, telling the reader what to do — or that nothing is needed of them. */
    readonly text: string;
  };
}

/** A prose paragraph. A bold lead-in is just a `TextSpan` with `bold: true` — no separate concept. */
export interface ParagraphDetail {
  readonly type: "paragraph";
  readonly runs: readonly InlineRun[];
}

/** A bulleted list. Each item is its own run sequence. */
export interface BulletsDetail {
  readonly type: "bullets";
  readonly items: readonly (readonly InlineRun[])[];
}

/**
 * A BULLETLESS list: each item its own line, joined by a plain newline, with no leading glyph Slack adds on
 * its own. For a card whose own composed lead run (an icon, a severity dot, a `[n]` chip) already leads every
 * line — a second, Slack-drawn bullet in front of it reads as decoration competing with the one that carries
 * meaning. Structurally identical to {@link BulletsDetail}; only the render differs.
 */
interface ListDetail {
  readonly type: "list";
  readonly items: readonly (readonly InlineRun[])[];
}

/**
 * Per-column display hints, passed straight through to Slack's own `column_settings` — one entry per column,
 * both fields optional. Slack's own defaults (`left`, unwrapped) apply to a column this array is silent about,
 * either because the array is absent or shorter than the column count.
 */
interface TableColumnSetting {
  readonly align?: "left" | "center" | "right" | undefined;
  /** Whether a cell's text wraps instead of running to the column's natural width. Slack default: false. */
  readonly wrap?: boolean | undefined;
}

/**
 * A table. Bounded by rows x columns, NEVER by character count — a table is not verbose merely for
 * being long. Cell prose gets its own small per-cell bound.
 */
export interface TableDetail {
  readonly type: "table";
  /**
   * The header labels, one per column. An individual label may be the EMPTY STRING: a severity or status
   * column carries self-describing values (`RED`, `✅`) and naming it adds a word that earns nothing. The
   * array itself must still be non-empty — a table needs at least one column — and every row must be exactly
   * as wide as this. See the renderer for how a blank header reaches Slack.
   */
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (readonly InlineRun[])[])[];
  /**
   * Per-column alignment/wrap, when the derivation cares — a wide text column beside a narrow numeric one is
   * the case that needed it: unwrapped text left the numeric column visually cramped for want of room.
   */
  readonly columnSettings?: readonly TableColumnSetting[] | undefined;
}

/** One sub-block of the folded detail. Order is meaningful and preserved by the renderer. */
export type DetailBlock = ParagraphDetail | BulletsDetail | TableDetail | ListDetail;

/**
 * One citation. `sourceRef` is optional and unused in PR5 — it exists so PR10's belief layer can
 * carry provenance without widening this type across four renderers later.
 */
export interface Citation {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly sourceRef?: { readonly source: string; readonly id: string } | undefined;
}

/**
 * The minimum a visible-length calculation needs from a citation. Narrower than {@link Citation} on
 * purpose: it keeps the counting helpers independent of optional-field variance under
 * `exactOptionalPropertyTypes`, and makes it obvious that width depends only on the `[n]` label.
 */
export interface CitationWidth {
  readonly id: string;
  readonly label: string;
}

/** The one canonical thing a message is about. Free-text label — never a PR-shaped type. */
export interface PrimaryLink {
  readonly label: string;
  readonly url: string;
}

/** How an above-the-fold index renders — see {@link UpdateArtifact.indexStyle}. */
export type IndexStyle = "bullet" | "plain" | "ordered";

/**
 * A shipped-work update: the only kind PR5 builds, because it is the only kind with confirmed
 * reference examples. `note` / `answer` / `alert` are named in the roadmap but deliberately unbuilt —
 * a variant designed with no reference is how the first attempt at this PR failed.
 *
 * `detail` is REQUIRED and non-empty, because a card whose `Details` label has nothing behind it was
 * rejected by eye. It is NOT required in order to force a fold: that reading rested on the block-count rule
 * since retracted (`../slack/preview.ts`). A message that must not fold at all is
 * {@link NoFoldArtifact}, which has no `detail` field to require.
 */
export interface UpdateArtifact {
  readonly kind: "update";
  /**
   * A scheduled post's DAY-ONE opening: a few plain lines drawn above the TL;DR, saying this is a trial, how often
   * it posts, where feedback goes and what this post covers in this channel. Plain strings, so
   * the intro can address nobody. Absent on every other post; `../../live/automation/firstFiring.ts` decides when.
   */
  readonly intro?: readonly string[] | undefined;
  readonly tldr: string;
  readonly primaryLink?: PrimaryLink | undefined;
  /**
   * The ABOVE-THE-FOLD index: one scannable, independently clickable line per thing the card is about.
   *
   * It exists because of an arithmetic problem the `tldr` alone cannot solve. The card's chrome is exactly
   * five blocks (author row, divider, lead, divider, detail label) and `detail` starts at the sixth — so
   * EVERY `detail` sub-block sits behind the `Details` label, no matter how short. For a shipped-work update that
   * is correct: there is one thing, and `primaryLink` points at it. For a digest of several independent
   * things it is not: one link above the fold plus a hidden wall was rejected in the field, because a reader
   * cannot triage four alerts without clicking.
   *
   * The mechanism is that a block is atomic, so a list rendered INSIDE the lead block adds no block: these
   * items keep the chrome's own five-block shape exactly as measured while putting per-item links in the
   * region a reader meets first. (The block-count FOLD rule that phrasing once cited was retracted
   * — `../slack/preview.ts` — but the block arithmetic it relies on is unchanged.) A list rather than a
   * table because a table cannot nest inside `rich_text` (probe T1) and would close the block, landing back
   * below the fold.
   *
   * Empty by default: an artifact that omits it renders byte-identically to a pre-index card.
   */
  readonly index: readonly (readonly InlineRun[])[];
  /**
   * Whether `index` renders as Slack's own bulleted list (default), as plain, newline-joined lines with no
   * added glyph, or as Slack's own numbered list. Bulletless is for a card whose own composed lead run already
   * leads every line — a citation chip, a severity dot — where Slack's own bullet in front of it is a second,
   * competing decoration. `ordered` is the colour-coded ranked list, and every line opens with a colour.
   */
  readonly indexStyle?: IndexStyle | undefined;
  readonly detail: readonly DetailBlock[];
  readonly citations: readonly Citation[];
  readonly media: readonly string[];
  /** Whether this card is about a possible problem; when it is, `tldr` names how many it affects. */
  readonly problem?: ProblemDeclaration | undefined;
  /** What this card is and what it asks of the reader; when declared, the intro and `tldr` open with it. */
  readonly opening?: OpeningDeclaration | undefined;
}

/**
 * Every inline run the NO-FOLD form can carry — {@link InlineRun} minus the citation chip, the group
 * mention and the `@here`/`@channel` broadcast.
 *
 * Narrower than {@link DripInlineRun} by one more run, and each omission is a property of the form rather
 * than a preference. A citation chip is bot-card furniture whose footnote lives below a fold this form does
 * not have. A GROUP mention and a BROADCAST both address a room, and every message that needs to render
 * entirely above the fold so far is addressed to ONE PERSON with their own list in it — admitting a shape
 * that reaches a hundred people into the form whose caps assume one person's list is how a per-person DM
 * becomes an accidental announcement. Widen it when a real message needs it, on its own evidence.
 */
export type NoFoldInlineRun = TextSpan | LinkRun | MentionRun;

/**
 * The NO-FOLD bot message: everything visible, nothing behind "Show more".
 *
 * **The rule**, from the policy-acceptance DM in the owner's own bot DM: a card can avoid the "Show more" drop
 * down entirely, with everything above the fold and nothing below it. If the bot DM cannot do that, the Slack
 * schema is missing the form to facilitate it, so the form gets written. And it is a SECOND form rather than a
 * flag because different use cases want different forms to fill: most posts fold, and some must not.
 *
 * So this is a sibling of {@link UpdateArtifact}, not a mode of it, and the two differ in what they can
 * EXPRESS rather than in how they are configured. An update has a `detail` it is required to have, because
 * the fold needs something to hide; this has no below-fold region at all, so there is nothing to put there
 * and no field to put it in. A message that genuinely has more to say than fits above the fold is an
 * update, and the no-fold form's refusal says so rather than truncating it.
 *
 * Three fields, in render order, and the split is the shape the owner asked the policy DM for: an opening
 * line with the action inline, the list as DOT POINTS, and the lines that follow it. They are separate
 * fields rather than one line list because the BULLETS are the part Slack draws a glyph in front of, and a
 * caller that had to say so per line would eventually say it inconsistently.
 */
export interface NoFoldArtifact {
  readonly kind: "no-fold";
  /** The opening line. One run sequence, rendered as the first paragraph. */
  readonly lead: readonly NoFoldInlineRun[];
  /** The dot points. Empty is allowed: not every no-fold message has a list. */
  readonly bullets: readonly (readonly NoFoldInlineRun[])[];
  /** The lines after the list, one paragraph each. Empty is allowed. */
  readonly trailing: readonly (readonly NoFoldInlineRun[])[];
  /** Whether this message is about a possible problem; when it is, `lead` names how many it affects. */
  readonly problem?: ProblemDeclaration | undefined;
  /** What this message is and what it asks of the reader; when declared, `lead` opens with it. */
  readonly opening?: OpeningDeclaration | undefined;
}

/**
 * Every inline run the AS-ME lane can carry — {@link InlineRun} MINUS {@link CitationRun}.
 *
 * Citations are bot-only by owner decision: *"I feel like citations are bot only"*. A human does not
 * footnote themselves, so the chip is not merely discouraged here, it is UNREPRESENTABLE — a `[1]` in an
 * as-me message is a type error rather than a review comment. Should that decision ever soften, this
 * widens to `InlineRun` in one line, which is why it is expressed as a narrowing rather than a new union.
 */
export type DripInlineRun = TextSpan | LinkRun | MentionRun | GroupRun | BroadcastRun;

/**
 * ONE message of a drip: a single unbroken run sequence, and deliberately not a `DetailBlock`.
 *
 * There is no bullets or table variant and no nesting, because the owner's measured answer was that a drip
 * message carries NO internal line breaks at all — *"each message is one run; all visible whitespace comes
 * from the message boundary"*. A structure that cannot hold a newline cannot accidentally grow one.
 */
interface DripMessage {
  readonly runs: readonly DripInlineRun[];
}

/**
 * The AS-ME drip: an ORDERED SEQUENCE of short messages, one or two sentences each.
 *
 * This is a different artifact from {@link UpdateArtifact}, not a styled variant of it. The bot's card is
 * one message carrying everything behind a fold; the human lane is several small messages with no card, no
 * wrapper, no fold and no author chrome — *"much more freeform… a drip feed approach where it's one or two
 * concise sentences in my voice per section"*. Order is a CORRECTNESS property: messages that arrive out of
 * order read as gibberish, which is why the sender awaits each one.
 */
export interface DripArtifact {
  readonly kind: "drip";
  readonly messages: readonly DripMessage[];
  /** Whether this drip is about a possible problem; when it is, the first message names how many it affects. */
  readonly problem?: ProblemDeclaration | undefined;
  /** What this drip is and what it asks of the reader; when declared, the first message opens with it. */
  readonly opening?: OpeningDeclaration | undefined;
}

/**
 * ONE line of a one-card post: a run sequence that renders on its own line, with no glyph in front of it.
 *
 * Structurally a {@link DripMessage}, and deliberately a distinct type rather than a reuse. A drip message
 * is a unit of DELIVERY — it arrives separately, notifies separately, and can be half-sent. A card line is a
 * unit of LAYOUT inside one delivered message. Naming them the same thing is how a caller ends up believing
 * a one-card post drips.
 */
export interface CardLine {
  readonly runs: readonly DripInlineRun[];
}

/**
 * The AS-ME ONE-CARD post: everything in a SINGLE message, with real line breaks.
 *
 * The rule, after a four-message drip in a public channel had to be deleted: a post like this goes out as ONE
 * top-level card as the owner, like a discussion piece, because in a very public place it often serves as a
 * discussion piece as well, and a discussion is much easier when it is only one message.
 *
 * It exists because the two shapes that were already here could each express half of that and neither could
 * express it whole. {@link DripArtifact} refuses a `\n` outright — the gap between MESSAGES is its spacing,
 * which is the mechanical reason a compliant one-message post was UNREPRESENTABLE in the form lane and the
 * escape hatch was the only way to send one. {@link PlainArtifact} takes the newlines and gives up
 * everything else: it is a bare string, so it carries no typed mentions to verify and no typed styling, and
 * this lane has provably posted `*bold*` that rendered as literal asterisks through it.
 *
 * So the line breaks live in the STRUCTURE. `lines` is an ordered list and the renderer supplies the break
 * between them, which keeps the drip form's actual invariant — *a structure that cannot hold a newline
 * cannot accidentally grow one* — while making the shape the owner asked for a first-class form with
 * verified mentions and typed styling, rather than an escape hatch.
 */
export interface OneCardArtifact {
  readonly kind: "one-card";
  readonly lines: readonly CardLine[];
  /** Whether this card is about a possible problem; when it is, the first line names how many it affects. */
  readonly problem?: ProblemDeclaration | undefined;
  /** What this card is and what it asks of the reader; when declared, the first line opens with it. */
  readonly opening?: OpeningDeclaration | undefined;
}

/** How deep one one-list dot point sits: a headline, or a sub-point under one. One level, never more. */
export type ListDepth = 0 | 1;

/**
 * The AS-ME ONE-LIST post: a lead line, a real bulleted list, and the lines that close it — ONE message.
 *
 * The roster shape, and the third as-me form rather than a mode of {@link OneCardArtifact}, because the two
 * differ in what they can EXPRESS. A one-card `line` IS a paragraph, so the renderer puts a blank line
 * between every one of them (the rule on vertical spacing). That is right for three ideas
 * and wrong for ten: a ten-item review roster double-spaced is the wall rule 7 exists to prevent, and a
 * caller cannot opt out of it without a flag that would let one shape claim to be the other.
 *
 * So the LIST is its own field. `bullets` renders as Slack's own `rich_text_list`, single-spaced with its
 * own glyph, exactly as the reference post this form was measured against renders — a vulnerability-fix
 * roster in an alerts channel, whose ten items sit in one message under one lead line.
 *
 * Structurally the as-me sibling of {@link NoFoldArtifact}, and deliberately not a reuse of it: that form is
 * bot-lane chrome with no group mention, and this one is the operator's own name with a subteam ping in its
 * trailing lines. The fields are the same three because the SHAPE is the same three, which is evidence the
 * split is real rather than a coincidence.
 */
export interface OneListArtifact {
  readonly kind: "one-list";
  /** The opening line, rendered as the first paragraph. One run sequence. */
  readonly lead: readonly DripInlineRun[];
  /** The dot points, one run sequence each. Non-empty: a one-list post with no list is a one-card post. */
  readonly bullets: readonly (readonly DripInlineRun[])[];
  /**
   * How deep each dot point sits, index for index with `bullets`: `0` a headline, `1` a sub-point under the
   * nearest headline above it. Absent means every point is a headline. A parallel array rather than nested
   * bullets so that every reader walking `bullets` (each voice, markup and PII check) still sees every word
   * of a sub-point without learning a second shape (four headlines, each
   * with what is in it nested under it).
   */
  readonly depths?: readonly ListDepth[] | undefined;
  /** The lines after the list, one paragraph each. Empty is allowed. */
  readonly trailing: readonly (readonly DripInlineRun[])[];
  /** Whether this post is about a possible problem; when it is, `lead` names how many it affects. */
  readonly problem?: ProblemDeclaration | undefined;
  /** What this post is and what it asks of the reader; when declared, `lead` opens with it. */
  readonly opening?: OpeningDeclaration | undefined;
}

/**
 * Every shape the AS-ME lane can send: the drip sequence, the one-card post, the one-list roster, and the
 * escape hatch.
 *
 * Named as a union rather than spelled out at each of its dozen or so use sites so that adding a shape is
 * one edit here plus the exhaustiveness errors the compiler then raises — which is how the one-card form
 * was added without a single silently-unhandled branch.
 */
export type AsMeArtifact = DripArtifact | OneCardArtifact | OneListArtifact | PlainArtifact;

/**
 * The ESCAPE HATCH: exactly what the human typed, as one message, byte for byte.
 *
 * It exists because schema enforcement that cannot be opted out of would make the as-me lane worse than
 * typing into Slack, which is the bar it has to beat. So this carries a raw string and no structure at all:
 * no runs, no sections, no length preference. The exact voice gate still inspects authored prose, and its
 * named override preserves these bytes unchanged.
 */
export interface PlainArtifact {
  readonly kind: "plain";
  readonly text: string;
}

/**
 * Every artifact this repo can send, discriminated on `kind`.
 *
 * The union exists so the identity helpers (`artifactFingerprint`, the duplicate keys) can hash ANY
 * artifact rather than only a card. Widening them was the alternative to giving the drip its own parallel
 * hashing code, and a second implementation of "canonical JSON, sorted keys, sha256" is exactly the kind of
 * duplicate that drifts silently and then fails to recognise its own prior send.
 */
export type OutboundArtifact = UpdateArtifact | NoFoldArtifact | DripArtifact | PlainArtifact;

/**
 * Every artifact the BOT lane can send: the folded card, and the one that must not fold.
 *
 * Named so the send path can carry "a bot artifact" without carrying the as-me shapes beside it. The
 * discriminant is `kind`, so a `switch` over it fails to compile when a third bot form arrives rather than
 * falling through to the card renderer — which is what a plain widening of `UpdateArtifact` would have done
 * silently.
 */
export type SlackBotArtifact = UpdateArtifact | NoFoldArtifact;
