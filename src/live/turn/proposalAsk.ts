/**
 * The PROPOSAL ASK — an ask that proposes creating, adopting or standing something up, and the
 * present-state check such an ask has to run before it costs the thing it is proposing.
 *
 * ## The incident this exists for
 *
 * The only owner-BAD answer of the real-world tagging dogfood. The bot was asked what
 * standing a repository up would cost — and answered it from inside a checkout whose own `git remote -v`
 * names that very repository, which by then held 102 pull requests. It ran `catalog` and `audit run`, read
 * that repository's own docs to compose its egress and platform bullets, and not one of its five bullets,
 * nor its "What I could not see", mentions that the thing already exists. The evidence was one command
 * away — `slopweaver github search "is:pr" --repo <owner>/<repo>` — and nothing made it look.
 *
 * The generalisation, which is the point of putting it here rather than in a review note: **a question of
 * the form "should we do X / what would X cost" gets answered from the corpus and the code without any
 * present-state check on whether X has already happened.** `AGENTS.md` says history is a source the bot
 * READS and never the author of the answer, and that "why did the staging pool exhaust" is answered by
 * going and looking. A proposal needs the same going-and-looking, and its first leg is existence.
 *
 * ## Why the existing `truthMode` pairing did not catch it
 *
 * It cannot, and this is the sharp part. That turn's decision declared `truthMode: "current"` and named two
 * AVAILABLE current-truth legs (`catalog`, `audit`), so `invalidTruthMode` passed it — correctly, by its own
 * rule. But `catalog` answers "what can this build do" and `audit` answers "how much is in the local
 * corpus" — both `sourceClass: "artifact"`, this installation describing itself. Neither can ever answer
 * "does `<owner>/<repo>` exist". Current-truth is not the same property as existence-establishing: a leg can be
 * perfectly live about THIS INSTALLATION and blind to the world the proposal is about. So the check here is
 * on the source CLASS — see {@link EXISTENCE_ESTABLISHING_SOURCE_CLASSES} — not on `truthMode`.
 *
 * ## The trust boundary
 *
 * {@link classifyProposalAsk} reads the owner's own addressing text and nothing else. That keeps it on the
 * `controlPlane` side of `judgement.ts`'s `TrustLabeledContext` split. It would in
 * fact be safe either way — the only thing firing can do is ADD a requirement, never select a need, raise a
 * tier or oblige a response, and a constraint that narrows what the bot does needs no one's authority — but
 * routing quoted thread text into a control-plane classifier is the shape the split exists to make
 * impossible, so it is not done here either.
 *
 * ## What this is, honestly: a tripwire, not a fence
 *
 * The detector is a phrase list. It will miss proposals worded around it, and it will fire on the odd
 * retrospective ("should we have done X"). Both are acceptable, and asymmetrically so: a miss costs exactly
 * what today already costs, while a false fire costs one extra existence-establishing leg on an answer that
 * is almost always better for having one. It is deliberately NOT a model call — rule 2 — and deliberately
 * not a subject extractor: guessing which noun is being proposed would put a fabricated name into a refusal
 * message, and the session composing the answer already knows the name.
 */
import type { SourceCapability } from "../../route/profile.js";

/**
 * The source classes that can establish whether a named thing already exists.
 *
 * The dividing line is whether a leg reads the world OUTSIDE this Slopweaver process. `provider` (GitHub,
 * Slack, Linear, Notion and whatever a private profile adds), `repository` (branches, CI, the checkout
 * itself) and `atlas` (the estate map) all do. The other three cannot, by construction rather than by
 * configuration:
 *
 * - `corpus` records what WAS true — the whole invariant `judgement.ts`'s `DecisionTruthMode` exists
 *   to keep, applied here to the one question a proposal turns on;
 * - `artifact` describes this INSTALLATION and nothing outside it — `catalog` the build's own command
 *   surface, `audit` how many records its corpus holds and how fresh they are. That is why `catalog` was the
 *   wrong leg, and why `audit` was wrong for the same reason rather than for being historical: it reads a
 *   count, never a record;
 * - `orchestration` describes this installation's own board and queues, not the world the ask is about.
 */
export const EXISTENCE_ESTABLISHING_SOURCE_CLASSES: ReadonlySet<SourceCapability["sourceClass"]> = new Set([
  "provider",
  "repository",
  "atlas",
]);

/**
 * One matcher for proposal wording, paired with the family it belongs to so a refusal can say which half of
 * the ask tripped it.
 *
 * Two families, because they carry different amounts of signal on their own:
 *
 * - `deliberation` — the ask is weighing a decision ("should we", "is it worth", "what would it cost"). This
 *   is proposal-shaped by itself; there is nothing else it could be.
 * - `standing-up` — the ask names the act of bringing a thing into existence ("stand this up", "roll out",
 *   "migrate to"). This is NOT proposal-shaped by itself, because the same verbs carry ordinary how-to asks
 *   ("how do I set up my env"), so {@link classifyProposalAsk} additionally requires a first-person-plural
 *   subject before it fires: a proposal is something WE might do. The incident's own wording, "what does
 *   standing this up cost", is caught by the `deliberation` family regardless.
 *
 * Every pattern is written with `\b` word boundaries and a small filler allowance rather than as a bare
 * substring, so `standing this up` matches while `standup` does not. The filler carries its own trailing
 * whitespace (`(?:(?:this|it)\s+)?up`) rather than sitting between `\s+` and `\s*` — two adjacent quantified
 * whitespace runs are polynomial backtracking, which the `redos-check` gate refuses.
 */
const PROPOSAL_PATTERNS: readonly { readonly family: ProposalFamily; readonly pattern: RegExp }[] = [
  { family: "deliberation", pattern: /\bshould (?:we|i|the team|they)\b/i },
  { family: "deliberation", pattern: /\b(?:is|would) it worth\b/i },
  { family: "deliberation", pattern: /\bworth (?:doing|building|adopting|the effort)\b/i },
  { family: "deliberation", pattern: /\bdo we want to\b/i },
  { family: "deliberation", pattern: /\bwhat would it take\b/i },
  {
    family: "deliberation",
    pattern: /\bwhat (?:would|does|will) (?:it|this|that|standing (?:this|it) up|setting (?:this|it) up) cost\b/i,
  },
  { family: "deliberation", pattern: /\bhow much would (?:it|this|that)\b/i },
  { family: "deliberation", pattern: /\bmake the case for\b/i },
  { family: "deliberation", pattern: /\b(?:a )?propos(?:e|al) (?:to|for)\b/i },
  { family: "deliberation", pattern: /\bwhy (?:don't|dont|do not) we\b/i },
  { family: "standing-up", pattern: /\bstand(?:ing)?\s+(?:(?:this|it|that|one|them)\s+)?up\b/i },
  { family: "standing-up", pattern: /\bspin(?:ning)?\s+(?:(?:this|it|that|one|them)\s+)?up\b/i },
  { family: "standing-up", pattern: /\bset(?:ting)?\s+(?:(?:this|it|that|one|them)\s+)?up\b/i },
  { family: "standing-up", pattern: /\broll(?:ing)?\s+(?:(?:this|it|that|one|them)\s+)?out\b/i },
  { family: "standing-up", pattern: /\badopt(?:ing)?\b/i },
  { family: "standing-up", pattern: /\bbring(?:ing)?\s+(?:this|it|that|them)\s+(?:in|into)\b/i },
  { family: "standing-up", pattern: /\bmigrat(?:e|ing) to\b/i },
  { family: "standing-up", pattern: /\bswitch(?:ing)? to\b/i },
  { family: "standing-up", pattern: /\bintroduc(?:e|ing) a\b/i },
];

/**
 * The first-person-plural subject a `standing-up` match additionally needs before it counts as a proposal.
 *
 * "how do I set up my env" is a how-to and its right answer may well be this build's own docs; "should we
 * set up a second queue" is a proposal and its right answer starts by checking whether one is already there.
 * The pronoun is what separates them, and it is cheap enough to be worth the one extra condition.
 */
const COLLECTIVE_SUBJECT = /\b(?:we|us|our)\b/i;

/** @internal Which half of a proposal ask the wording belongs to — see {@link PROPOSAL_PATTERNS}. */
export type ProposalFamily = "deliberation" | "standing-up";

/** @internal A proposal-shaped ask, and the wording that made it one. */
export interface ProposalAsk {
  readonly family: ProposalFamily;
  /** The matched wording, quoted verbatim from the ask so a refusal can point at it. */
  readonly trigger: string;
}

/**
 * Whether an ask proposes creating, adopting or standing something up — and if so, the wording that says so.
 *
 * Reads the owner's own addressing text alone; see this file's header for why. `deliberation` wording fires
 * on its own; `standing-up` wording fires only alongside a first-person-plural subject
 * ({@link COLLECTIVE_SUBJECT}). Deliberation is checked first in both cases, so an ask carrying both reports
 * the deliberation half — that is the half naming the decision being weighed.
 *
 * @param text the ask as asked, tags already stripped
 * @returns the proposal shape and its trigger, or `undefined` for an ask that proposes nothing
 */
export function classifyProposalAsk({ text }: { text: string }): ProposalAsk | undefined {
  const collective = COLLECTIVE_SUBJECT.test(text);
  for (const family of ["deliberation", "standing-up"] as const) {
    if (family === "standing-up" && !collective) {
      return undefined;
    }
    for (const candidate of PROPOSAL_PATTERNS.filter((entry) => entry.family === family)) {
      const match = candidate.pattern.exec(text);
      if (match !== null) {
        return { family, trigger: match[0] };
      }
    }
  }
  return undefined;
}

/**
 * The extra guidance a PROPOSAL-shaped ask gets in its routing brief — nothing at all for every other ask.
 *
 * Rendered only when {@link classifyProposalAsk} fires, for two reasons. It tells the judging session that this
 * ask reads as a proposal, which is the observation the owner-BAD turn never made; and it keeps
 * every other brief exactly the length it is today, which the always-on budget cares about.
 *
 * @param text the owner-addressing text the brief carries, classified here
 * @returns the guidance lines, or nothing when the ask proposes nothing
 */
export function proposalAskLines({ text }: { text: string }): readonly string[] {
  const proposal = classifyProposalAsk({ text });
  if (proposal === undefined) {
    return [];
  }
  const classes = [...EXISTENCE_ESTABLISHING_SOURCE_CLASSES].join("/");
  return [
    `THIS ASK PROPOSES SOMETHING — it says "${proposal.trigger}", so it assumes the thing does not exist yet.`,
    "That assumption is the first present-state claim your answer rests on, and every cost, risk and day-one",
    `bullet under it is void if the thing is already there. So name at least one REQUIRED ${classes}-class`,
    "leg that can go and look. Three kinds of leg cannot establish that a named thing is absent: one that only",
    "describes this installation (`catalog`, and `audit` — which counts the corpus's records without reading",
    "one), a HISTORICAL leg (the world model records what WAS true), and an OPTIONAL leg nobody has to run.",
    "A decision without a required one is REFUSED.",
    "",
    "Your answer must then carry a `premiseChecks` entry — what you looked for, what you found, and when.",
    "",
  ];
}

/**
 * The legs among those named that could actually establish whether the proposed thing already exists.
 *
 * @param capabilityIds the ids a decision named as needs
 * @param capabilities every capability the context offered, available and historical alike
 * @returns the named ids whose capability is existence-establishing, in the order they were named
 */
export function existenceEstablishingLegs({
  capabilityIds,
  capabilities,
}: {
  capabilityIds: readonly string[];
  capabilities: readonly SourceCapability[];
}): readonly string[] {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  return capabilityIds.filter((id) => {
    const capability = byId.get(id);
    return capability !== undefined && EXISTENCE_ESTABLISHING_SOURCE_CLASSES.has(capability.sourceClass);
  });
}
