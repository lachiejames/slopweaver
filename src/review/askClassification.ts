/**
 * Whether one Slack message asked somebody to review one pull request — decided from the message's own
 * words, by rules narrow enough to be wrong out loud.
 *
 * ## The rule the owner gave, and what it forces
 *
 * A message merely containing the link, or the link plus the word review, is NOT an ask. So a tag beside
 * a link cannot decide this, which is why `../review/reviewState.ts` does not decide it that way — and why
 * a dry run that says **"Nothing has been sent to the team"** in its own words is not the ask, and a
 * colleague asking the owner a question is not the owner asking them.
 *
 * Rule 2 forbids a model in a verb, so this module does not attempt to understand a message. It certifies
 * the constructions the owner demonstrably writes, vetoes the shapes that cannot be an ask whatever else they
 * say, and answers `undecided` for everything else — see {@link ../review/evidence.AskDecision}.
 *
 * ## Why the request lexicon is a lexicon and not two grammars
 *
 * MEASURED over the 46 distinct Slack messages linking the owner's 22 open pull requests: a two-construction
 * grammar (`<mentions> pls review <PR>` plus a heading-and-bullets list) certifies 9 of the 17 real asks and
 * abstains on the other 8, because the owner's own voice also writes *"could one of you review"*, *"bump
 * on"*, *"just bumping a 3rd time"*, *"could I pls get a tick on"*, *"could I get another look at"*, *"is
 * ready for review"*, *"one ask, all of it here"* and *"tagging remaining codeowners needed to get this
 * stack over the line"*.
 *
 * A lexicon alone would be the "link plus the word review" rule the owner rejected. What makes this
 * different is that every one of {@link VETOES} runs FIRST and each is a structural fact rather than a
 * reading: who wrote it, which conversation it is in, whether the words were struck through, whether the
 * link is the owner's at all. The lexicon only ever fires on a message that is already the owner's, already
 * addressed to somebody, and already linking the pull request in their own text.
 *
 * Pure. No I/O, no clock, no network.
 */

import type { AskCandidate, AskDecision, MentionRun, TextSpan } from "./evidence.js";

/**
 * The words that make an addressed message about a pull request a REQUEST rather than a remark.
 *
 * Each entry is a named form so a wrong answer names the rule that produced it. Every pattern is anchored on
 * word boundaries and none is nested, so the match cost is linear in the message.
 */
const REQUEST_FORMS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "review", pattern: /\breview(s|ed|ing)?\b/i },
  { id: "bump", pattern: /\bbump(s|ed|ing)?\b/i },
  { id: "a-look", pattern: /\b(a|another)\s+look\b/i },
  { id: "tick", pattern: /\btick\b/i },
  { id: "codeowner", pattern: /\bcode ?owners?\b/i },
  { id: "approve", pattern: /\bapprov(e|es|ed|al|als)\b/i },
  // "following up on this one" is a bump; "as a follow up" is a noun and asks nothing. MEASURED on the fleet
  // gate: the broader `follow(ing)? up` made a closing-the-loop FYI read as a request.
  { id: "following-up", pattern: /\bfollowing\s+up\b/i },
  { id: "one-ask", pattern: /\bone\s+ask\b/i },
  { id: "sign-off", pattern: /\bsign(ed)?[-\s]off\b/i },
  { id: "eyes-on", pattern: /\beyes\s+on\b/i },
];

/**
 * Constructions that REFUSE an ask however well the rest of the message reads.
 *
 * Each was measured on a real message of the owner's. `rather-than-review` is *"bringing this one to you as
 * a product call rather than a code review"*, which contains the word `review` and is the clearest statement
 * in the corpus that a review is NOT what is wanted.
 */
const NEGATIONS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "rather-than-review", pattern: /\b(rather\s+than|instead\s+of|not)\s+(a\s+)?(code\s+)?review\b/i },
  { id: "do-not-review", pattern: /\b(do\s+not|don'?t)\s+review\b/i },
  { id: "nothing-was-sent", pattern: /\bnothing\s+has\s+been\s+sent\b/i },
  // "no review is needed" denies the very thing the lexicon would otherwise read as a request. It is
  // deliberately NOT the broader `\bno\s+review\b`: one of the owner's real asks reads *"it has had no human
  // review at all ... so it needs one of you"*, and a blanket rule refuses it. Found by a Codex review.
  {
    id: "no-review-needed",
    pattern: /\bno\s+(code\s+|human\s+)?(review|approval|tick)\s+(is\s+)?(needed|required|necessary)\b/i,
  },
  { id: "needs-no-review", pattern: /\b(does\s?n[o']?t|do\s+not)\s+need\s+(a\s+)?(code\s+)?review\b/i },
  {
    id: "review-not-needed",
    pattern: /\b(reviews?|approvals?|ticks?)\s+(is|are)\s+not\s+(needed|required|necessary)\b/i,
  },
];

/** How far before a mention run a `cc` may sit and still govern it — long enough for `(CC @name`. */
const CC_LOOKBEHIND = 12;

/** A `cc` marker immediately preceding a mention, which addresses nobody: it copies somebody in. */
const CC_MARKER = /\bcc\b[\s:(]*$/i;

/**
 * Slack's strikethrough run. Non-greedy and bounded to one run so `~a~ ~b~` is two runs rather than one
 * swallowing the text between them — which is exactly the shape of a retracted ask.
 */
const STRIKETHROUGH = /~([^~\n]{1,4000})~/g;

/**
 * Every strikethrough run in a message, as spans over the same string the caller measured everything else in.
 *
 * @param text the author's own visible words
 * @returns each struck run's span, in the order written
 */
function strikethroughSpans({ text }: { text: string }): readonly TextSpan[] {
  const spans: TextSpan[] = [];
  for (const match of text.matchAll(STRIKETHROUGH)) {
    const start = match.index;
    spans.push({ end: start + match[0].length, start, text: match[0] });
  }
  return spans;
}

/** A Slack markup run — a mention, channel, user group, special or link — as `<…>`, bounded and unnested. */
const MARKUP_RUN = /<([^<>\n]{1,2000})>/g;

/**
 * The message with every piece of Slack MARKUP blanked to spaces, so only words the owner typed can carry a request.
 *
 * Offsets are preserved exactly, so every span measured against the authored text still holds. A link's
 * LABEL survives (`<url|pls review>` is the author's words); its URL does not, and neither does the label of a
 * mention, channel or user group — `<#C1|code-review>` and `<!subteam^S1|@platform-codeowners>` name a
 * place or a group, never a request, and `github.com/o/review-service/…` is a path. Each of those
 * would otherwise certify an ask on the word `review` or `codeowner` alone.
 *
 * @param text the author's own visible words, markup included
 * @returns the same string, same length, with markup that is not the author's prose replaced by spaces
 */
function typedWords({ text }: { text: string }): string {
  return text.replaceAll(MARKUP_RUN, (whole: string, inner: string) => {
    const bar = inner.indexOf("|");
    const isLink = !/^[@#!]/.test(inner);
    if (!isLink || bar === -1) {
      return " ".repeat(whole.length);
    }
    return `${" ".repeat(bar + 2)}${inner.slice(bar + 1)} `;
  });
}

/**
 * Whether a span sits inside any of a set of spans.
 *
 * @param inner the span being tested
 * @param outer the spans it might sit inside
 * @returns whether some outer span contains it
 */
function within({ inner, outer }: { inner: TextSpan; outer: readonly TextSpan[] }): boolean {
  return outer.some((span) => inner.start >= span.start && inner.end <= span.end);
}

/**
 * Whether a mention run merely COPIES somebody in rather than addressing them.
 *
 * MEASURED: *"once I get a platform tick (CC @Rosa :eyebrows:)"* carries the request word `tick`
 * and a mention, and is not an ask — the author is noting what they still need, beside somebody they are
 * keeping in the loop. Without this the message certifies as an ask addressed to a person never asked.
 *
 * @param mention the mention run
 * @param text the author's own visible words
 * @returns whether a `cc` marker governs it
 */
function isCarbonCopy({ mention, text }: { mention: MentionRun; text: string }): boolean {
  const from = Math.max(0, mention.span.start - CC_LOOKBEHIND);
  return CC_MARKER.test(text.slice(from, mention.span.start));
}

/**
 * The line a span sits on, as a span of its own, so a recipient can be scoped to the bullet that names it.
 *
 * @param at the offset to locate
 * @param text the author's own visible words
 * @returns the enclosing line's span
 */
function lineSpanAt({ at, text }: { at: number; text: string }): TextSpan {
  const before = text.lastIndexOf("\n", Math.max(0, at - 1));
  const start = before === -1 ? 0 : before + 1;
  const after = text.indexOf("\n", at);
  const end = after === -1 ? text.length : after;
  return { end, start, text: text.slice(start, end) };
}

/**
 * The mentions that address THIS pull request, which is the whole batch-message defect in one function.
 *
 * A message linking ONE pull request addresses it with every mention it carries. A message linking SEVERAL
 * scopes each one to its own LINE — a batch posted to `#dev-alerts` writes one line per pull request, each
 * opening with the reviewer for that line, and reading the union instead names the wrong person. MEASURED:
 * of the five rows in one such message still open, **two chase somebody who was never asked about them**
 * when the first tagged id in the whole message is taken.
 *
 * A multi-link message whose own line names nobody falls back to the mentions written BEFORE the first link
 * — the heading form, *"@Sadie @Jonah ... one ask, all of it here"* followed by a plain list of pull requests.
 *
 * @param candidate the message and the pull request
 * @param addressable the mentions that actually address somebody
 * @returns the Slack ids this message asked about this pull request
 */
function recipientsFor({
  candidate,
  addressable,
}: {
  candidate: AskCandidate;
  addressable: readonly MentionRun[];
}): readonly string[] {
  if (candidate.authoredPrCount <= 1) {
    return [...new Set(addressable.map((mention) => mention.id))];
  }
  const lines = candidate.linkSpans.map((span) => lineSpanAt({ at: span.start, text: candidate.authoredText }));
  const onSameLine = addressable.filter((mention) =>
    lines.some((line) => mention.span.start >= line.start && mention.span.end <= line.end),
  );
  if (onSameLine.length > 0) {
    return [...new Set(onSameLine.map((mention) => mention.id))];
  }
  // A heading is a LINE of its own above the list, so it ends where the first link's line starts. Measured to
  // the first link itself, a mention written before that link on the SAME line — the first pull request's
  // own reviewer — reads as a heading and leaks onto every later line. Found by a fallback review.
  const listStartsAt = lineSpanAt({ at: candidate.firstLinkAt, text: candidate.authoredText }).start;
  const heading = addressable.filter((mention) => mention.span.end <= listStartsAt);
  return [...new Set(heading.map((mention) => mention.id))];
}

/**
 * The three vetoes, each a structural fact about WHO wrote a message and WHERE, never a reading of intent.
 *
 * Order decides only which reason a reader is given; none of them can disagree with another.
 */
const VETOES: readonly {
  readonly id: string;
  readonly why: string;
  readonly fires: (options: { readonly candidate: AskCandidate }) => boolean;
}[] = [
  {
    fires: ({ candidate }) => candidate.conversation === "owner-only",
    id: "owner-only-conversation",
    why: "posted in the conversation between the owner and their own bot, where there is nobody to ask",
  },
  {
    fires: ({ candidate }) => candidate.authorRole === "app",
    id: "app-posted-as-itself",
    why: "an app posted it as itself, so it reports rather than asks",
  },
  {
    fires: ({ candidate }) => candidate.authorRole === "other-human",
    id: "somebody-else-wrote-it",
    why: "somebody else wrote it, so it cannot be the owner asking",
  },
];

/**
 * The request construction a message carries, and whether the only one it carries was struck through.
 *
 * The distinction is the whole point. MEASURED: an author struck out `~@smith @Orrin … pls review
 * <link>~` and wrote `EDIT: not yet` under it, then KEPT a long unstruck body that links the same pull
 * request twice more. A retraction rule asking whether every LINK is struck therefore reports the ask as
 * live. The retraction is a property of the REQUEST, so that is what is tested: a request form outside every struck run stands; one found only inside a struck run was
 * withdrawn.
 *
 * @param text the author's own visible words
 * @returns the standing request, or that the only request found was struck through, or neither
 */
function requestIn({
  text,
}: {
  text: string;
}):
  | { readonly kind: "standing"; readonly id: string; readonly span: TextSpan }
  | { readonly kind: "struck" }
  | { readonly kind: "none" } {
  const struck = strikethroughSpans({ text });
  let sawStruck = false;
  for (const form of REQUEST_FORMS) {
    for (const match of text.matchAll(new RegExp(form.pattern.source, `${form.pattern.flags}g`))) {
      const span = { end: match.index + match[0].length, start: match.index, text: match[0] };
      if (!within({ inner: span, outer: struck })) {
        return { id: form.id, kind: "standing", span };
      }
      sawStruck = true;
    }
  }
  return sawStruck ? { kind: "struck" } : { kind: "none" };
}

/**
 * Whether the message explicitly says a review is NOT what it wants.
 *
 * @param text the author's own visible words
 * @returns the negation's id, or undefined when none fired
 */
function negation({ text }: { text: string }): string | undefined {
  return NEGATIONS.find((entry) => entry.pattern.test(text))?.id;
}

/** A standing request, as {@link requestIn} found it. */
type StandingRequest = Extract<ReturnType<typeof requestIn>, { kind: "standing" }>;

/**
 * Rungs 1–4: the refusals that need nothing but who wrote the message, where, and whether the owner withdrew
 * or denied the request in their own words.
 *
 * @param candidate the message and the pull request
 * @param request the request construction the typed words carry
 * @param words the typed words, markup blanked
 * @returns the certified non-ask, or undefined when none of these rungs decides it
 */
function refusalOf({
  candidate,
  request,
  words,
}: {
  candidate: AskCandidate;
  request: ReturnType<typeof requestIn>;
  words: string;
}): AskDecision | undefined {
  const veto = VETOES.find((entry) => entry.fires({ candidate }));
  if (veto !== undefined) {
    return { kind: "non-ask", ruleId: veto.id, why: veto.why };
  }
  if (request.kind === "struck") {
    return {
      kind: "non-ask",
      ruleId: "struck-through",
      why: "the only request in it is struck through, so the ask was withdrawn",
    };
  }
  const refused = negation({ text: words });
  if (refused !== undefined) {
    return { kind: "non-ask", ruleId: refused, why: "the message says in its own words that it is not a review ask" };
  }
  // In a direct message the audience is the counterpart, so the COUNTERPART's own message answers an ask
  // rather than making one. Belt and braces beside the `other-human` veto, which already catches this
  // wherever the owner's id is configured: without it a reviewer answering ":approved: with one comment"
  // read as a fresh ask, and the row then said a bump was not yet due.
  if (candidate.conversation === "direct-message" && candidate.authorId === candidate.counterpartId) {
    return {
      kind: "non-ask",
      ruleId: "counterpart-replied",
      why: "the other party to this direct message wrote it, so it answers an ask rather than making one",
    };
  }
  return undefined;
}

/**
 * The mentions that actually address somebody — never the author, a `cc`, or a tag the author struck out.
 *
 * A mention inside a struck run addresses nobody: striking the tag out is how an author unaddresses an ask.
 * MEASURED where BOTH tags sit inside `~…~` and the unstruck body kept still says `review` —
 * so testing the request alone reports a withdrawn ask as live.
 *
 * @param candidate the message and the pull request
 * @returns the addressing mention runs, in the order written
 */
function addressableMentions({ candidate }: { candidate: AskCandidate }): readonly MentionRun[] {
  const struckRuns = strikethroughSpans({ text: candidate.authoredText });
  return candidate.mentions.filter(
    (mention) =>
      mention.id !== candidate.authorId &&
      !isCarbonCopy({ mention, text: candidate.authoredText }) &&
      !within({ inner: mention.span, outer: struckRuns }),
  );
}

/**
 * Rung 5: a message carrying no request construction at all.
 *
 * @param candidate the message and the pull request
 * @param addressable the mentions that address somebody
 * @returns a non-ask, or `undecided` when the owner addressed somebody in a message that links it
 */
function withoutRequest({
  candidate,
  addressable,
}: {
  candidate: AskCandidate;
  addressable: readonly MentionRun[];
}): AskDecision {
  if (candidate.linkSpans.length === 0) {
    // A message that reaches the pull request through its thread or a quote, addresses somebody, and asks in a
    // construction the LEXICON has no word for — *"Thanks <@…>, ready for round 2 :pray:"* — is not a certified
    // non-ask. MEASURED: three real re-review asks of the owner's read `asked: no` that way.
    const reachesIndirectly = candidate.quotedPrKeys.length > 0 || candidate.threadPrKeys.length > 0;
    if (reachesIndirectly && addressable.length > 0 && asksInOwnWords({ text: candidate.authoredText }).asks) {
      return {
        kind: "undecided",
        ruleId: "asks-in-a-form-this-read-has-no-word-for",
        why: "the owner addressed somebody and asked, in words the request lexicon does not carry, about a pull request their own words do not link",
      };
    }
    // A DIRECT MESSAGE addresses its counterpart with no tag at all, which is why the ask rungs below read one.
    // Reaching pull requests there through an unfurl, with no request this read knows, is not evidence the owner
    // did not ask: MEASURED on a real DM "in the meantime, got a big stack for ya" above an unfurl of the
    // owner's own nine-pull-request board, which answered a confident "never asked" on six of them.
    // WHO the counterpart is does not gate this. A corpus record never names one — only the live leg does, and
    // `github landing` runs the corpus leg unconditionally — so a rule asking for one abstains on nothing at
    // all. The owner's own bot DM is vetoed at rung 1 wherever the scan has seen the bot post a link in it,
    // which is that veto's own stated bound rather than a guarantee this rung makes.
    // MEASURED: 53 real messages of the owner's move from a certified non-ask to this abstention, 4 pull
    // requests with them, against the 6 a single message answered a confident "never asked" on.
    if (reachesIndirectly && candidate.conversation === "direct-message") {
      return {
        kind: "undecided",
        ruleId: "direct-message-reaches-it-indirectly-without-a-request",
        why: "the owner put this pull request in front of the one other person in a direct message, in words the request lexicon does not carry",
      };
    }
    return {
      kind: "non-ask",
      ruleId: "quoted-link-no-request",
      why: "the owner's own words neither link this pull request nor ask for anything",
    };
  }
  if (addressable.length > 0) {
    return {
      kind: "undecided",
      ruleId: "addressed-without-a-request",
      why: "the owner addressed somebody and linked this pull request in their own words, but asked for nothing this read recognises",
    };
  }
  return {
    kind: "non-ask",
    ruleId: "no-request",
    why: "the owner's own words link it and ask for nothing — no review, look, tick, approval or bump among them",
  };
}

/** How a linkless message reaches a pull request, with the words a row prints for each route. */
const INDIRECT_ROUTES = {
  quote: { noun: "a quote", ruleId: "request-reaches-the-pull-request-through-a-quote" },
  thread: { noun: "its thread's root", ruleId: "request-reaches-the-pull-request-through-its-thread" },
} as const;

/**
 * The request forms that NAME a need rather than ask for an act, which a thread reply cannot certify on.
 *
 * A reply leaves its pull request implicit, so its words have to carry the request themselves. MEASURED on the
 * live landing read: of four replies the thread route certified, the two on a verb form were real
 * (`Bumpity bump @Arlo`, `@… @… bump`), and one on `tick` was the owner explaining a block — *"stays blocked on
 * @platform codeowner tick"*. Those stay `undecided` for a visible session — and so does a reply carrying one
 * ANYWHERE, not only as its first request word: *"I've been bumping this since August, but stays blocked on
 * @platform codeowner tick"* reads `bump` first and is the same explanation.
 */
const NEED_SIGNALS: readonly RegExp[] = [
  /\bticks?\b/i,
  // No leading boundary: a group label spells it `platform_codeowners`, and `_` is a word character.
  /code[\s_-]?owners?/i,
  /\bapprov(e|es|ed|al|als|ing)\b/i,
  /\bsign(s|ed)?[\s_-]?offs?\b/i,
  /\bone\s+ask\b/i,
  /\bblocked\b/i,
  /\bwaiting\s+(on|for)\b/i,
];

/**
 * The first need a message's TYPED words, or the labels of the groups it tags, carry anywhere in them.
 *
 * A SIGNAL list rather than the request lexicon's ids, and deliberately broader: it only ever WITHHOLDS a
 * certification, so reading too much costs an abstention and reading too little costs a false ask. The id
 * list it replaced missed `ticks`, `approval`, `sign-off`, `code-owner` and `platform_codeowners`, each
 * a real false ask in a fallback review's probe.
 *
 * @param text the author's own visible words, markup included
 * @returns the matched words, or undefined when it names no need
 */
function namedNeed({ text }: { text: string }): string | undefined {
  // A user group's LABEL is read here too, unlike everywhere else: "blocked on @platform-codeowners" names the
  // need through the group it tags. A QUOTED line is not the author's words here either, so a colleague's "still
  // blocked on the tick" above the author's own bump cannot withhold it.
  const groupLabels = [...text.matchAll(/<!subteam\^[^|<>\n]{1,200}\|([^<>\n]{1,200})>/g)].map((match) => match[1]!);
  const words = [unquoted({ text: typedWords({ text }) }), ...groupLabels].join("\n");
  for (const signal of NEED_SIGNALS) {
    const found = signal.exec(words);
    if (found !== null) {
      return found[0];
    }
  }
  return undefined;
}

/**
 * The constructions that make an INHERITING reply a request rather than a report of what the author did.
 *
 * A reply leaves its pull request to its thread, so its words are all there is — and the request lexicon reads
 * a report exactly as well as a request: `review(ed|ing)` and `a look` fire on *"reviewed, left some Qs"*,
 * *"Reviewing now @Quinn!"*, *"taking a look now"* and *"Haven't had a look yet"*. MEASURED on the live
 * landing read, five of the replies this route certified were that class, each one a card chasing a
 * colleague for a review the author had just done. The owner's own inheriting asks are a bump or a plain please: *"Bumpity bump @Arlo :pray:"*, *"<@U…> <@U…> bump :pray:"*.
 */
const THREAD_ASK_MARKERS: readonly RegExp[] = [
  /\b(pls|plz|please)\b/i,
  /\b(can|could|would|will)\s+(you|u|one\s+of\s+you|someone|somebody|anyone)\b/i,
  /\b(any\s+chance|do\s+you\s+mind|mind\s+(taking|having|giving))\b/i,
  // The owner's own re-ask forms, MEASURED in the sweep below: "re-review when you get a sec?", "ready for your
  // codeowner review now", "ready for your tick when one of you has 2 min", "Ready whenever you get a chance".
  /\b(when|whenever)\s+(you|one\s+of\s+you)\s+(get|gets|have|has)\s+(a\s+)?(sec|second|min|minute|moment|chance|\d+\s*min)/i,
  /\bready\s+for\s+(your|a|another|round)\b/i,
  /\bre-?review\b/i,
];

/** The one marker that is equally an ASK and a report of having asked — "I've been bumping this since August". */
const BUMP_MARKER = /\bbump(s|ed|ing)?\b/i;

/**
 * Whether an inheriting reply ASKS, rather than reporting an act in the same words.
 *
 * @param text the author's own visible words, markup included
 * @returns whether some request construction addresses the reader
 */
function asksInOwnWords({ text }: { text: string }): { readonly asks: boolean; readonly directly: boolean } {
  const words = unquoted({ text: typedWords({ text }) });
  const directly = THREAD_ASK_MARKERS.some((marker) => marker.test(words));
  return { asks: directly || BUMP_MARKER.test(words), directly };
}

/**
 * The message without the lines it QUOTES, which are somebody else's words however they read.
 *
 * Slack writes a quoted line as `&gt; `, and the projection keeps the entity. MEASURED:
 * 23 of the 350 linkless thread replies the canon page's sweep reads carry a quoted line, and across the whole
 * bronze two of them reach a request construction ONLY inside it — a colleague asking the owner, which this
 * route would read as the owner asking them.
 *
 * @param text the author's words with markup already blanked
 * @returns the same text with every quoted line blanked, offsets preserved
 */
function unquoted({ text }: { text: string }): string {
  return text
    .split("\n")
    .map((line) => (/^\s*(&gt;|>)/.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
}

/**
 * Rung 6: a standing, addressed request that reaches this pull request only through a quote or its thread.
 *
 * **A quote** is read ONE hop, from Slack's own unfurl in the raw payload. Hygiene redacts permalink digits,
 * so two quotes in one channel can collide, and a collision only ever GROWS the quoted set, which withholds
 * certification rather than granting it. MEASURED on the fleet gate: two real asks of the owner's, "could you pls
 * review this one?" and "pls review my E2E speed boost", name their pull request only this way.
 *
 * **A thread** is read from its ROOT only, never from an earlier reply: in Slack a reply's parent is the root,
 * and "@Jasper please review this" under `<PR> is ready` names that pull request the way a reader would. A
 * root linking two pull requests leaves "this" ambiguous, so it abstains. A quote, when there is one, decides
 * first — it is the message's own words pointing somewhere, where the thread is only where it was written.
 *
 * Either way it certifies only when the route names exactly this one pull request.
 *
 * @param candidate the message and the pull request
 * @param addressable the mentions that address somebody
 * @param request the standing request construction
 * @returns the ask when the route names only this pull request, else `undecided`
 */
function throughIndirection({
  candidate,
  addressable,
  request,
}: {
  candidate: AskCandidate;
  addressable: readonly MentionRun[];
  request: StandingRequest;
}): AskDecision {
  const refused = indirectRefusal({ candidate, request });
  if (refused !== undefined) {
    return refused;
  }
  const via = candidate.quotedPrKeys.length > 0 ? "quote" : "thread";
  const route = INDIRECT_ROUTES[via];
  const [only, ...rest] = via === "quote" ? candidate.quotedPrKeys : candidate.threadPrKeys;
  if (only !== candidate.prKey || rest.length > 0) {
    return {
      kind: "undecided",
      ruleId: route.ruleId,
      why: `it asks ("${request.span.text}") but reaches this pull request through ${route.noun}, which does not name it alone`,
    };
  }
  if (addressable.length > 0) {
    return {
      kind: "ask",
      recipients: [...new Set(addressable.map((mention) => mention.id))],
      request: request.span,
      ruleId: `addressed-request-via-${via}:${request.id}`,
    };
  }
  return directMessageDecision({ addressable, candidate, request });
}

/**
 * The refusals an indirect route owes before its keys are read at all — the author's own words, and what they ask for.
 *
 * @param candidate the message and the pull request
 * @param request the standing request construction, quoted in the reason
 * @returns the abstention, or undefined when the unquoted words really do ask for an act
 */
function indirectRefusal({
  candidate,
  request,
}: {
  candidate: AskCandidate;
  request: StandingRequest;
}): AskDecision | undefined {
  // THE REQUEST ITSELF has to stand in the author's own unquoted words, whichever route reaches the pull request.
  // A message whose only request sits in a line it QUOTES is somebody asking the owner — reproduced on a real
  // thread, where the quote route certified an ask OF the colleague who had asked the owner.
  if (requestIn({ text: unquoted({ text: typedWords({ text: candidate.authoredText }) }) }).kind !== "standing") {
    return {
      kind: "undecided",
      ruleId: "request-only-in-a-quote",
      why: "the only request in it is inside a line it quotes, which is somebody else's words",
    };
  }
  // Neither route reaches it at all — a message on the live leg, whose search results carry no attachments, or
  // a reply under a root nobody read. Naming a quote here described evidence that was never there.
  if (candidate.quotedPrKeys.length === 0 && candidate.threadPrKeys.length === 0) {
    return {
      kind: "undecided",
      ruleId: "reaches-the-pull-request-through-nothing-this-read-saw",
      why: `it asks ("${request.span.text}") but the owner's own words do not link this pull request, and neither a quote nor a thread root this read saw names it`,
    };
  }
  const asking = asksInOwnWords({ text: candidate.authoredText });
  if (!asking.asks) {
    return {
      kind: "undecided",
      ruleId: "thread-reply-reports-rather-than-asks",
      why: "a message that leaves its pull request to a quote or its thread has to ask in its own words, and this one reads as a report of what was done",
    };
  }
  // A need the author names while ASKING DIRECTLY is what they are asking FOR — "mind taking this one … just
  // needs your codeowner pass" is an ask, and withholding it lost a real one. A need beside a BUMP alone is
  // the other shape, where the bump is what the author has been doing rather than what they want. Both
  // measured on the owner's corpus.
  const need = asking.directly ? undefined : namedNeed({ text: candidate.authoredText });
  if (need === undefined) {
    return undefined;
  }
  return {
    kind: "undecided",
    ruleId: "thread-reply-names-a-need",
    why: `a message that leaves its pull request to a quote or its thread says "${need}", which names a need rather than asking for an act`,
  };
}

/** The non-ask a channel message addressed to nobody receives, from both rungs that reach it. */
const ADDRESSES_NOBODY: AskDecision = {
  kind: "non-ask",
  ruleId: "addresses-nobody",
  why: "it names nobody — a posted link is not a tag, and an ask has to be addressed to someone",
};

/**
 * Rung 7's direct-message arm: a request with no recipient on this pull request's own line.
 *
 * THE COUNTERPART ANSWERS FOR THE WHOLE MESSAGE OR FOR NONE OF IT. A direct message naming somebody on one
 * pull request's line has scoped its recipients by hand, and handing this pull request the counterpart
 * anyway re-widens exactly what the scoping narrowed. A message that lists two pull requests
 * and tags a person on the first line would otherwise have the second silently inherit that person.
 *
 * @param candidate the message and the pull request
 * @param addressable the mentions that address somebody
 * @param request the standing request construction
 * @returns the counterpart as the ask's recipient, or `undecided` when that would guess
 */
function directMessageDecision({
  candidate,
  addressable,
  request,
}: {
  candidate: AskCandidate;
  addressable: readonly MentionRun[];
  request: StandingRequest;
}): AskDecision {
  if (addressable.length > 0) {
    return {
      kind: "undecided",
      ruleId: "direct-message-scoped-past-this-pull-request",
      why: "it names people on other pull requests' lines in this message and nobody on this one",
    };
  }
  if (candidate.counterpartId === "") {
    return {
      kind: "undecided",
      ruleId: "direct-message-counterpart-unread",
      why: "a direct message asks whoever else is in it, and this read could not name them",
    };
  }
  return {
    kind: "ask",
    recipients: [candidate.counterpartId],
    request: request.span,
    ruleId: `direct-message-request:${request.id}`,
  };
}

/**
 * Whether one message asked somebody to review one pull request.
 *
 * The ladder, in order, and every rung is a rule a wrong answer can be blamed on:
 *
 * 1. **The three vetoes** — who wrote it and which conversation it is in. Structural.
 * 2. **A struck-out request** — the owner withdrawing it in their own hand.
 * 3. **An explicit negation** — the owner saying a review is not what they want.
 * 4. **The counterpart's own reply** in a direct message, which answers an ask rather than making one.
 * 5. **No request at all** — a non-ask, unless the owner ADDRESSED somebody, which is `undecided`: they tagged a
 *    person about the pull request and asked for nothing this read recognises, and a visible session
 *    decides. This rung is what makes an FYI that says `gated on PR review` twice and addresses nobody at
 *    all a certified non-ask rather than an abstention.
 * 6. **The link is not in the owner's own words** — reached through a quote, or through the root of the thread it
 *    replies in. That certifies an ask only when the route names this pull request alone, and it must never
 *    certify a NON-ask on its own: two real asks of the owner's name the pull request only through a quoted Slack
 *    permalink, so a standing request whose route is ambiguous is `undecided`.
 * 7. **An addressed request** — the ask, with its recipients scoped to this pull request; else a direct
 *    message's counterpart; else `undecided` when the direct message's counterpart could not be named, and
 *    a non-ask in a channel nobody was addressed in.
 *
 * Only words the owner TYPED can carry a request or a negation — see {@link typedWords}.
 *
 * @param candidate the message and the pull request, with every span measured against the same string
 * @returns what this message proves about this pull request
 */
export function classifyReviewCandidate({ candidate }: { candidate: AskCandidate }): AskDecision {
  if (candidate.versionsDisagree) {
    return {
      kind: "undecided",
      ruleId: "versions-disagree",
      why: "the corpus holds copies of this message that say different things and nothing orders them",
    };
  }
  const words = typedWords({ text: candidate.authoredText });
  const request = requestIn({ text: words });
  const refused = refusalOf({ candidate, request, words });
  if (refused !== undefined) {
    return refused;
  }
  const addressable = addressableMentions({ candidate });
  if (request.kind !== "standing") {
    return withoutRequest({ addressable, candidate });
  }
  // ADDRESSED-TO-NOBODY OUTRANKS THE QUOTE RULE, and the order is load-bearing: a posted link is not a tag.
  // A bump of an FYI carries the request word `bumping`, addresses nobody, and reaches the pull request only
  // through the message it quotes — and it reads as not an ask. Judged by the quote rule first it abstains
  // instead, and the row stops answering.
  const isDirectMessage = candidate.conversation === "direct-message";
  if (addressable.length === 0 && !isDirectMessage) {
    return ADDRESSES_NOBODY;
  }
  if (candidate.linkSpans.length === 0) {
    return throughIndirection({ addressable, candidate, request });
  }
  const recipients = recipientsFor({ addressable, candidate });
  if (recipients.length > 0) {
    return { kind: "ask", recipients, request: request.span, ruleId: `addressed-request:${request.id}` };
  }
  return isDirectMessage ? directMessageDecision({ addressable, candidate, request }) : ADDRESSES_NOBODY;
}
