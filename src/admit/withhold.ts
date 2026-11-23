/**
 * WITHHOLD — the door's third outcome, and the seam a judgement layer plugs into.
 *
 * The bot answers whoever addresses it with the OWNER's lens over the corpus, minus the private lane the store's
 * `bot` role cannot read at all (`../store/policies.ts`). The risk left is that it SAYS something
 * in the wrong room. So the control here is on what the bot says, never on what it may read: this gate adds no
 * public/private tiers, no per-channel visibility and no partitioning. A reply is composed as normal, then judged.
 *
 * ## The decision: one whitelist, both directions
 *
 * This used to ship two independently-built mechanisms that never referenced each other: a responder
 * whitelist (`responders.json`) deciding who may ADDRESS the bot at all, and this file's own
 * `ownerOnlyJudgement` deciding — unconditionally, with no reference to that whitelist — that only the
 * profile's `slackBot.ownerUserId` may ever receive a real reply. That split let a whitelisted non-owner be
 * admitted through the front gate and still receive no answer, a live gap the owner asked to resolve rather
 * than leave implicit. {@link whitelistJudgement} is the fix: `responders.json` is now the SINGLE source of
 * truth for both questions. There is no owner carve-out — if the owner is not on the list, the owner's own
 * replies are withheld too, exactly like anyone else's.
 *
 * ## Why this is a door GATE rather than a fourth `DoorStatus`
 *
 * `DoorStatus` already has the shape this needs. A `warn` means the effect did NOT run and the caller is handed
 * a self-correctable finding carrying an override token; `throughDoor` returns a discriminated union whose
 * `result` field only EXISTS when `performed: true`, so a withheld reply cannot be read as a sent one by
 * accident — the type refuses it. Bolting a fourth status on would have duplicated all of that and left two
 * ways to express "not sent".
 *
 * It is a `warn` and not a `hold` for the constraint that governs every risk gate in this repo: block by
 * default, always with a break-glass. A `hold` is the irreversible-harm core and is deliberately unwaivable,
 * which would make "I looked at it, send it" impossible. A warn's override token is the break-glass, and the
 * door RECORDS every override it waives, so releasing a held draft is itself in the audit trail.
 *
 * ## What a judgement may NEVER be — the standing owner rule on tact
 *
 * The seam above is an open invitation, and this is the one thing it may never be filled with. A judgement
 * here NEVER withholds a reply because the answer ranks, compares or names colleagues, because it reads as
 * unkind, or because the question should not have been asked in the room it was asked in. The rule applies
 * even to whether the bot should answer "who has been slowest to close out their assigned tickets" in a
 * public channel: it is not the bot's responsibility to dictate what is asked, the onus is on the human who
 * asks a ranking question in public, and the bot's job is the most accurate, citation-backed answer to the
 * question asked.
 *
 * So the functionality is never reduced or revoked, here or anywhere downstream of here. What a judgement may
 * legitimately decide is the reply's SITUATION — is this asker permitted to receive an answer at all — which
 * is exactly what {@link whitelistJudgement} does and the whole of what this repository ships. A private
 * repository supplying a finer-grained one is bound by the same line.
 * `skills/loop-bot/reference/tact-is-the-askers-onus.md` carries the rule for the session composing the
 * answer, `docs/doctrine-rationale/accurate-answer.md` its verbatim anchor, and `docs/security/withholding-a-reply.md` § "Withholding a reply"
 * states it as a property of this gate.
 *
 * ## Who may SEE each fact is not decided here
 *
 * {@link ReplyContext} carries the asker, the channel and the draft's first line — never the channel's readers,
 * the evidence's provenance or what each reader can already reach — so passing this gate establishes that the
 * asker may receive a reply, never that every reader may see every fact in it. That is the owner's standing
 * rule, judged by the composing session (`../live/turn/replyDisclosure.ts`, printed into every
 * brief and resume) and by its reviewer (`../live/turn/review.ts` § 9). It sits on the far side of the tact
 * line above: it governs who sees a fact, never what an answer is about.
 *
 * ## What this file does NOT contain
 *
 * The owner's preferences, voice, or beliefs. Those are content, they belong to a private work repository, and
 * they must never be written into this public one. What ships here is the mechanism — the verdict and the
 * gate — plus the one judgement this repository is allowed to decide unilaterally: reply only to whoever the
 * responder whitelist already trusts to command the bot.
 */
import { admitResponder, type ResponderWhitelist } from "../live/listen/whitelist.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * Which surface a reply is bound for.
 *
 * Structurally identical to `MentionSurface`, and deliberately declared here rather than imported from the
 * listener: the door is the trust spine and nothing in it may depend on a Slack transport. The two unions are
 * assignable both ways, so the value flows across the seam with no conversion.
 */
export type ReplySurface = "channel" | "dm";

/**
 * Everything a judgement is allowed to see about a reply before it goes out.
 *
 * A `type` rather than an `interface` on purpose — it rides inside a {@link DoorArtifact}, which is an index
 * signature, and only a type alias carries the implicit one that assignment needs.
 */
export type ReplyContext = {
  /** Where the reply would land. */
  readonly surface: ReplySurface;
  /** The channel id it would land in. */
  readonly channel: string;
  /** The Slack user id that addressed the bot. An id, never a name — identity resolves by exact match only. */
  readonly askedBy: string;
  /** The question as asked, after addressing was stripped. */
  readonly question: string;
  /** The draft's above-the-fold line — what the reader would have seen first. */
  readonly draftTldr: string;
};

/**
 * Send, or withhold and say why.
 *
 * A discriminated union so a judgement cannot express "withhold, reason unknown". The reason is the product:
 * it is what lands in the queue, in the thread and in the ledger, and a held draft nobody can explain is a
 * held draft nobody will ever release.
 */
type SendVerdict =
  { readonly kind: "send" } | { readonly kind: "withhold"; readonly code: string; readonly reason: string };

/**
 * The judgement seam — a plain injected function, which is the whole extension point.
 *
 * The plugin ships {@link whitelistJudgement} below. A private work repository could still supply a different
 * one — finer-grained than "is this asker on the responder whitelist", say — but nothing here needs to know
 * whether it does.
 */
export type ReplyJudgement = (input: { reply: ReplyContext }) => SendVerdict;

/** The finding code a withheld reply fires. */
export const WITHHOLD_CODE = "withhold.reply";

/** The token `$SLOPWEAVER_DOOR_OVERRIDE` must carry to release a withheld reply. The break-glass. */
export const WITHHOLD_OVERRIDE = "withhold.reply:v1";

/** The artifact field a request carries its reply context in. Absent ⇒ this gate has nothing to judge. */
export const REPLY_ARTIFACT_FIELD = "reply";

/**
 * The shipped judgement — the ONLY one this plugin ships, and the one wired in unconditionally. Sends when
 * `reply.askedBy` is on the SAME responder whitelist that already decided whether to admit this ask in the
 * first place; withholds everyone else, with no owner carve-out. An owner not on the whitelist is withheld
 * exactly like anyone else — under this judgement the whole decision is "is the asker on the list", and a
 * whitelist that cannot answer that question (absent, unreadable, or empty) has not established anything it
 * could act on, so `admitResponder` already refuses every identity in that case.
 *
 * @param whitelist the loaded responder whitelist — the SAME one gating who may address the bot
 * @param openOverride whether the journalled `responder-allow-open` grant is open — the caller's job to read
 * @returns the judgement
 */
export function whitelistJudgement({
  whitelist,
  openOverride,
}: {
  whitelist: ResponderWhitelist;
  openOverride: boolean;
}): ReplyJudgement {
  return ({ reply }) => {
    const decision = admitResponder({ openOverride, userId: reply.askedBy, whitelist });
    return decision.admitted
      ? { kind: "send" }
      : {
          code: WITHHOLD_CODE,
          kind: "withhold",
          reason: `${reply.askedBy} is not on the responder whitelist, so this reply cannot be shown to be going to someone permitted to receive one (${decision.why})`,
        };
  };
}

/**
 * Whether a value carries every field a {@link ReplyContext} declares.
 *
 * @param value the artifact field to narrow
 * @returns true when it is a whole reply context
 */
export function isReplyContext(value: unknown): value is ReplyContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const reply = value as Partial<ReplyContext>;
  return (
    (reply.surface === "channel" || reply.surface === "dm") &&
    typeof reply.channel === "string" &&
    typeof reply.askedBy === "string" &&
    typeof reply.question === "string" &&
    typeof reply.draftTldr === "string"
  );
}

/** The warn finding a withheld reply produces, carrying the judgement's own reason. Pure. */
function withholdFinding({ verdict }: { verdict: { readonly code: string; readonly reason: string } }): DoorFinding {
  return {
    code: verdict.code,
    correction:
      "the draft is queued — read it with `slopweaver queue show <id>` and send it with " +
      "`slopweaver queue release <id>`, which sets " +
      `SLOPWEAVER_DOOR_OVERRIDE=${WITHHOLD_OVERRIDE} so the release is recorded in the door ledger`,
    override: WITHHOLD_OVERRIDE,
    severity: "warn",
    summary: verdict.reason,
  };
}

/**
 * Build the withhold gate over a judgement.
 *
 * It fires ONLY on a request whose artifact carries a {@link ReplyContext}. That is what keeps the working
 * message, the checklist advances, the thread title and the held notice itself out of scope — a withheld
 * answer must still leave something visible where the person is, and a gate that judged every write could not
 * post it.
 *
 * @param judge the judgement to apply
 * @returns the pure gate
 */
export function withholdGate({ judge }: { judge: ReplyJudgement }): DoorGate {
  return (request) => {
    const reply = request.artifact[REPLY_ARTIFACT_FIELD];
    if (!isReplyContext(reply)) {
      return [];
    }
    const verdict = judge({ reply });
    return verdict.kind === "send" ? [] : [withholdFinding({ verdict })];
  };
}
