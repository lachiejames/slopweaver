/**
 * The one rule about WHETHER A CARD SHOULD EXIST: a card asks the owner only what the supervisor cannot decide.
 *
 * The worked example is a card asking whether the fix that closes a dead session's run gets a pull request.
 * A code fix gets a pull request, and the owner cannot see why it was a question: doctrine already answers
 * it. Rule 1 of `AGENTS.md` authorises a session to land its own work on green CI, so the card spends one
 * of the owner's reads asking permission for something no rule of theirs withholds.
 *
 * That is a different defect from every other half of this gate. The wording is inside every cap; the
 * premise is live; the options are pickable. The card is simply not the owner's to answer.
 *
 * ## Two halves, and only one of them bites
 *
 * **The half that bites** is this one: a question that asks PERMISSION for an act doctrine already authorises
 * is refused, and the refusal names the rule. Both conditions are required, which is what keeps it off a
 * question that merely mentions a pull request — "does 16415 land before or after the stack" asks about
 * ordering and matches no act here, and card two's "does it wait for Codex behind your spend cap" asks about
 * a billing cap only the owner holds rather than about running a pass.
 *
 * **The half that is only a floor** is {@link missingWarrant}: `why you` must name a conflict between the
 * owner's standing rules, or a fact only the owner holds. MEASURED on seven cards: six of the seven already
 * carried one, so this catches a composer who forgot to say why, never one who said it untruthfully. A
 * `why you` asserting "a finding row reaches a pull request only on your word" would pass. State
 * that limit whenever this rule is quoted — a gate whose weaker half is described as its strength is a gate
 * somebody will trust to do work it cannot do.
 *
 * **And its residue is a CLOSED PHRASE LIST, which is the wrong shape for the job.** Every entry below names a
 * family rather than a one-off, and each was added from a real card, but a composer can always write a true
 * warrant in words nobody listed — "No one else knows which tone sounds like you" is one. The fix is
 * structural rather than lexical — a typed
 * `decisionNeed` union with a `standing-rule-conflict` arm and an `owner-held-fact` arm, so the claim is a
 * field rather than a sentence to pattern-match — and it is the named next row, out of scope here because it
 * also retires `--open-prs` carding every open pull request. Until then this half can refuse a good card, and
 * `SLOPWEAVER_ALLOW_CARD_FRAMING` is what a composer reaches for when it does.
 *
 * ## The third arm: the mechanism is not the owner's to pick
 *
 * The owner cares about the outcome, not how it works internally. A card that asks them to choose between
 * implementations — who writes a plan inventory, whether a fix lands tonight as a stopgap — asks for a
 * decision about the build when the fact only the owner holds is the CRITERION and the WINDOW (for example,
 * no sign-in to any of the four plans for a week, with one five-minute fleet-down window acceptable), never
 * the implementation.
 *
 * So {@link mechanismFramed} refuses a question whose choice is between internals. It is deliberately
 * NARROWER than "mentions a mechanism": a card asking whether a polling keep-alive should be replaced at
 * all is a judgement about whether complexity earns its keep rather than a pick between two ways of
 * building the same thing. The noun list
 * below is build internals only, and `mechanism` is absent for exactly that reason.
 *
 * ## Why the list is short, and why it may only grow from a real card
 *
 * Each row below names a rule of `AGENTS.md` that settles the act outright. An act nobody has actually put on
 * a card is an act this list cannot help with, and a guess at one is a guess that will refuse a real
 * question later. So the registry grows the way `./fleetJargon.ts`'s does: from a card that reached the owner.
 *
 * Pure: one question in, one refusal or nothing out.
 */

/**
 * One act this repository's own doctrine authorises without the owner, and the rule that authorises it.
 *
 * @internal — the registry row {@link doctrineSettled} walks; no caller outside this module names the type.
 */
interface SettledAct {
  /** The act, as a refusal names it. */
  readonly act: string;
  /** The act asked about, in the words a card would use. */
  readonly asked: RegExp;
  /** The rule that already settles it, cited so the refusal is checkable rather than assertive. */
  readonly settledBy: string;
}

/**
 * The owner being asked for permission rather than for a judgement.
 *
 * A closed set of openers, because the difference between "does this get a pull request" and "which of these
 * two lands first" is the whole distinction the rule turns on, and only the first is permission.
 */
const PERMISSION =
  /\b(?:do|does|should|shall|may|can|is it (?:ok|okay|fine|alright)|are you happy|do you want|would you like|do you approve|am i)\b/i;

/** Every act doctrine settles, each naming the rule that settles it. */
const SETTLED_ACTS: readonly SettledAct[] = [
  {
    act: "opening a pull request for work that is finished",
    asked:
      // The determiner slot carries its OWN trailing space rather than sitting between `\s+` and `\s*`:
      // adjacent quantifiers over the same character class are what `redos-check` refuses, and they are
      // equivalent here anyway.
      /\b(?:gets?|get|have|has|need|needs|open|opens|opened|opening|raise|raises|raised|warrant|warrants)\s+(?:(?:a|an|its|the|their)\s+)?(?:draft\s+)?(?:pull request|pr)\b/i,
    settledBy: "AGENTS.md rule 1 — a session opens and lands its own work once CI is green",
  },
  {
    act: "landing a pull request whose CI is green",
    asked:
      /\b(?:land|lands|landed|landing|merge|merges|merged|merging)\s+(?:it|them|this|that|the pull request|mine)\b/i,
    settledBy: "AGENTS.md rule 1 — green CI and the best proof feasible at the time are the whole bar",
  },
  {
    act: "running a Codex planning or review pass",
    asked:
      /\b(?:run|runs|do|does|need|needs|want|wants)\s+(?:a\s+|another\s+)?codex\s+(?:pass|plan|review|pre-?mortem)\b/i,
    settledBy: "AGENTS.md rule 9 — pairing with Codex on non-trivial work is standing, not a judgement call",
  },
  {
    act: "updating the skill, rule or doc a change touched",
    asked:
      /\b(?:update|updates|updated|updating|refresh|refreshes|change|changes)\s+(?:the\s+)?(?:canon|skill|rule|reference|AGENTS\.md|doc(?:s|umentation)?)\b/i,
    settledBy: "AGENTS.md canon freshness — the same pull request updates what it changed",
  },
  {
    act: "adding a board row rather than writing a status document",
    asked: /\b(?:add|adds|added|register|registers|registered|write|writes)\s+(?:a\s+)?(?:board\s+)?row\b/i,
    settledBy: "AGENTS.md one board — never write a status document, add a row",
  },
];

/** One act a card asked permission for that doctrine already authorises. */
export interface SettledQuestion {
  /** The act, as the registry names it. */
  readonly act: string;
  /** The rule that settles it. */
  readonly settledBy: string;
}

/**
 * Whether a card's question asks permission for an act doctrine already settles.
 *
 * @param question the card's question, above the fold
 * @returns the act and the rule that settles it, or `undefined` when the question is genuinely the owner's
 */
export function doctrineSettled({ question }: { question: string }): SettledQuestion | undefined {
  if (!PERMISSION.test(question)) {
    return undefined;
  }
  for (const entry of SETTLED_ACTS) {
    if (entry.asked.test(question)) {
      return { act: entry.act, settledBy: entry.settledBy };
    }
  }
  return undefined;
}

/**
 * An artefact of the BUILD, as opposed to an outcome the owner can observe.
 *
 * `mechanism` is deliberately absent — see the file overview. Every entry here is something the owner would
 * have to hold this repository's internals in their head to have an opinion about.
 */
const INTERNALS = new RegExp(
  [
    String.raw`\bimplementation\b`,
    String.raw`\bimplemented\b`,
    String.raw`\bstore paths?\b`,
    String.raw`\bthe convention\b`,
    String.raw`\bas a stopgap\b`,
    String.raw`\bthe inventory\b`,
    String.raw`\bhow (?:it|this|that|they) works?\b`,
    String.raw`\bmigration work\b`,
    String.raw`\bwhich (?:module|verb|helper|field|flag|shape|schema)\b`,
  ].join("|"),
  "i",
);

/** The owner being asked WHO or WHAT does the building, which is a question about the build. */
const WHO_BUILDS =
  /\b(?:who|which session|which row|what)\s+(?:writes|builds|owns|implements|designs|creates|names|picks)\b/i;

/**
 * Whether a card's question asks the owner to choose between implementations rather than to state an outcome.
 *
 * @param question the card's question, above the fold
 * @returns the offending phrase, or `undefined` when the question is about something the owner can observe
 */
export function mechanismFramed({ question }: { question: string }): string | undefined {
  const present = WHO_BUILDS.exec(question)?.[0];
  if (present === undefined) {
    return INTERNALS.exec(question)?.[0];
  }
  return present;
}

/** The shape that replaces a question framed around the build. */
export const MECHANISM_ADVICE =
  "The owner cares about the outcome, not how it works internally. Ask for the criterion the owner would " +
  "judge the result by, or pick the implementation yourself and report it in `recent`.";

/**
 * The gate's refusal for a question framed around the build rather than the outcome.
 *
 * @param phrase the offending phrase {@link mechanismFramed} found
 * @returns one line naming the phrase and what to ask instead
 */
export function mechanismFramedRefusal({ phrase }: { phrase: string }): string {
  return `the question asks the owner to choose between implementations, with "${phrase}". ${MECHANISM_ADVICE}`;
}

/**
 * Every shape that names a reason the decision is the owner's — either a conflict between their rules, or a
 * fact only they hold.
 *
 * A floor, deliberately. See the file overview for the measurement that says so: six of the seven cards this
 * rule was built from already cleared it.
 */
const WARRANT = new RegExp(
  [
    // A fact only the owner holds, or an act only their hands perform.
    String.raw`\bonly you\b`,
    String.raw`\byou alone\b`,
    // "You are the only person who reads these cards" — the same claim said the other way round. Every entry
    // in this list comes from a real card that tripped it; none is guessed.
    String.raw`\bthe only (?:person|one|reader|approver)\b`,
    // The NEGATED exclusivity claim, which is the same claim inverted and is a family rather than a phrase:
    // "no one else knows which tone sounds like you" says exactly what "only you know" says, so the list
    // holds the negated forms beside the positive ones.
    String.raw`\bno[- ]?(?:one|body) (?:else|but you)\b`,
    String.raw`\bno other (?:person|session|one)\b`,
    String.raw`\byour (?:own )?hands?\b`,
    String.raw`\byour keyboard\b`,
    // The owner's authority, named.
    String.raw`\byours to\b`,
    String.raw`\byour call\b`,
    String.raw`\byour word\b`,
    String.raw`\byour (?:rule|ruling|bar|preference|test|goal|name|voice|identity|account)\b`,
    // The owner's identity on an outbound message is a fact only they hold, and "under your name" is how a
    // card says so. It comes from a real card rather than a guess.
    String.raw`\bunder your\b`,
    String.raw`\byou (?:asked|questioned|ruled|set|named|decided|wanted)\b`,
    // A preference nobody has written down.
    String.raw`\bnobody (?:wrote|has written|has recorded)\b`,
    String.raw`\bnot written down\b`,
    String.raw`\bno (?:standing )?rule says\b`,
    String.raw`\bnothing on record\b`,
    // Two of the owner's rules pulling against each other.
    String.raw`\bconflicts?\b`,
    String.raw`\bcontradicts?\b`,
    String.raw`\bdisagrees?\b`,
    String.raw`\bcuts against\b`,
    // Spend and access, which are the owner's by construction.
    String.raw`\bbilling\b`,
    String.raw`\bspend(?:ing)?\b`,
    String.raw`\bcredits?\b`,
    String.raw`\baccess\b`,
    String.raw`\blicen[cs]e\b`,
  ].join("|"),
  "i",
);

/**
 * Whether a card's `why you` names no reason the decision is the owner's at all.
 *
 * @param whyYou the card's `why you` cell, above the fold
 * @returns true when it names neither a conflict between the owner's rules nor a fact only the owner holds
 */
export function missingWarrant({ whyYou }: { whyYou: string }): boolean {
  return !WARRANT.test(whyYou);
}

/**
 * The shape that replaces a card doctrine already answers, worded once for the form and the gate.
 */
export const DOCTRINE_SETTLED_ADVICE =
  "A card exists only where the supervisor, knowing the owner, cannot decide. Move this to `recent` as one " +
  "line saying what was done, and do it.";

/** The shape that replaces a `why you` naming no reason the decision is the owner's. */
export const WARRANT_ADVICE =
  "Name the reason it is the owner's: which two of the owner's standing rules pull against each other, or " +
  "what fact only the owner holds — access, billing, the owner's own hand, a preference nobody has written down.";

/**
 * The gate's refusal for a question doctrine already answers.
 *
 * @param found the act and rule {@link doctrineSettled} reported
 * @returns one line naming the act, the rule that settles it and what to do instead
 */
export function doctrineSettledRefusal({ found }: { found: SettledQuestion }): string {
  return (
    `the question asks permission for ${found.act}, which is already settled by ${found.settledBy}. ` +
    DOCTRINE_SETTLED_ADVICE
  );
}
