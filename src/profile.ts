/**
 * The persona/profile seed persisted at `$SLOPWEAVER_HOME/profile.json`. Deliberately THIN and generic
 * for now (D3: built for me, dogfooded — not a generalised multi-user config): who the agent acts as,
 * the git namespace its PRs come from, and which sources it draws on. Later PRs (voice/persona, PR13)
 * grow it; PR1 only reserves the shape + a strict parser so a hand-edited file fails loudly, not silently.
 *
 * Validation is a Zod schema at the parse edge (per-field `error:` keeps the messages domain-specific and
 * leak-free). The public {@link Profile} type stays an explicit `readonly` interface — the house style for
 * a produced contract — with the schema kept in agreement. Pure: `parseProfile` narrows an already-parsed
 * JSON value, no I/O.
 */
import { isAbsolute } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "./lib/result.js";
import { type ExactVoiceRule, exactVoiceRuleSchema } from "./outbound/voice/exactRules.js";
import {
  datadogSchema,
  githubSchema,
  linearSchema,
  type MetricsProducerConfig,
  type RepositoryTitleShape,
} from "./profileProviders.js";

/** The profile schema version; bump with a migration. A file at a different version is rejected, not coerced. */
export const PROFILE_SCHEMA_VERSION = 1;

const SOURCES_ERROR = "profile.json sources must be an array of strings";
const SLACK_BOT_ERROR = "profile.json slackBot must be an object; its id lists and ownerUserId must be strings";

/** A string-array field with a shared domain error (used for the owner-bot id lists). */
const stringArray = z.array(z.string({ error: SLACK_BOT_ERROR }), { error: SLACK_BOT_ERROR });

/*
 * The outbound CARD chrome (PR5): the author row, banner colour, fold label and metadata event type.
 *
 * It lives in the profile rather than in code because it is PER-PERSON configuration — a different
 * operator wants a different bot name, emoji and colour, so a literal here is wrong for every install but
 * one. (It used to say "because this is a public repo", which stopped being true at the org migration; the
 * per-install argument is the one that was doing the work.) Every field has a neutral default so an existing
 * profile keeps validating untouched; the defaults are deliberately generic, not anyone's real bot.
 */
/**
 * The STOCK metadata event types.
 *
 * Exported because they are not merely defaults: an operator who renames theirs (to keep this tool's name off
 * a message their team sees) would otherwise orphan every card already posted under the stock name, since the
 * lifecycle guard recognises its own work BY event type. The lifecycle keeps accepting these for reading, so a
 * rename changes what new posts carry without stranding old ones. See `cardEventTypes`.
 */
export const DEFAULT_CARD_METADATA_EVENT_TYPE = "slopweaver_card_v1";

/** See {@link DEFAULT_CARD_METADATA_EVENT_TYPE}. */
export const DEFAULT_PROGRESS_METADATA_EVENT_TYPE = "slopweaver_progress_v1";

/** See {@link DEFAULT_CARD_METADATA_EVENT_TYPE}. */
export const DEFAULT_POLL_METADATA_EVENT_TYPE = "slopweaver_poll_v1";

/** See {@link DEFAULT_CARD_METADATA_EVENT_TYPE}. Distinct so a turn's working message is editable only as one. */
export const DEFAULT_TURN_METADATA_EVENT_TYPE = "slopweaver_turn_v1";

const cardChromeSchema = z.object({
  authorEmoji: z.string().min(1).default(":robot_face:"),
  authorLabel: z.string().min(1).default("slopweaver"),
  bannerColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "profile.json slackBot.cardChrome.bannerColor must be a #rrggbb hex colour")
    .default("#8B5CF6"),
  detailLabel: z.string().min(1).default("*Details*"),
  metadataEventType: z.string().min(1).default(DEFAULT_CARD_METADATA_EVENT_TYPE),
});

/**
 * The standalone progress chrome — a shape nothing renders.
 *
 * The spinner it configured (a bar, a count, an elapsed clock) was a SECOND live-progress shape beside the
 * turn card, and a worker whose card path had dead-ended reached for it in a public channel. The owner's
 * ruling: one progress-card shape in `src/outbound`, every other shape deleted rather than
 * deprecated. So the renderer, its store and the `slack progress` verb family are gone.
 *
 * This schema survives for exactly one reason, and it is not nostalgia: an operator's `profile.json` on
 * disk already carries the block, and `metadataEventType` is the `event_type` a spinner an old run left
 * standing in a channel is still wearing. `slack delete` compares against it
 * (`cli/commands/slack/wiring.ts`'s `standaloneProgressEventTypeFromProfile`), which is the only way those
 * messages come down. Parsing a field nobody renders is cheaper than refusing to load a profile that has it.
 */
const progressChromeSchema = z.object({
  barWidth: z.number().int().min(1).max(20).default(5),
  emojiFallback: z.string().min(1).default("⏳"),
  emojiShortcode: z
    .string()
    .regex(/^:[a-z0-9_+-]+:$/i, "profile.json slackBot.progressChrome.emojiShortcode must look like :name:")
    .optional(),
  metadataEventType: z.string().min(1).default(DEFAULT_PROGRESS_METADATA_EVENT_TYPE),
});

/**
 * The POLL chrome. One field today, and a section of its own rather than a field on the card's chrome,
 * because a poll's `event_type` must stay DISTINCT from the card's and the progress message's — that
 * distinctness is what lets `slack delete` tell a live poll apart from a finished card.
 */
const pollChromeSchema = z.object({
  metadataEventType: z.string().min(1).default(DEFAULT_POLL_METADATA_EVENT_TYPE),
});

/**
 * The CAPTURE-REACTION chrome — the emoji the listener reacts with the INSTANT it captures an addressed
 * mention, before any turn work has started.
 *
 * It exists because the gap between a tag arriving and the working message appearing is real — the owner
 * measured it at tens of seconds even for a question the corpus matched nothing for — and a silent bot in
 * that window is indistinguishable from a broken one. `reactions.add` is near-instant, so it is the
 * earliest signal the tagger can get.
 *
 * `emoji` is a bare reaction NAME, no colons — the shape `reactions.add` takes on the wire (unlike the
 * `:shortcode:` chrome fields, which are mrkdwn). It defaults to `"eyes"`, the owner's own suggestion, so a
 * workspace that has configured nothing still gets the signal.
 */
const captureReactionSchema = z.object({
  emoji: z.string().min(1).default("eyes"),
});

/**
 * The COMPLETION-REACTION chrome — the emoji that REPLACES {@link captureReactionSchema}'s on the original
 * tagged message once the turn's answer has actually posted.
 *
 * It exists because the capture reaction alone leaves the tagger with no way to tell "still working" from
 * "answered" without opening the thread: the eyes reaction is expected to turn into a tick once the reply
 * lands, and without this it never did. `emoji` is the same bare
 * `reactions.add` shape {@link captureReactionSchema} uses. It defaults to `"white_check_mark"`, Slack's own
 * green tick, so a workspace that has configured nothing still gets the signal.
 */
const completionReactionSchema = z.object({
  emoji: z.string().min(1).default("white_check_mark"),
});

/**
 * The STOPPED-REACTION chrome — the emoji that replaces {@link captureReactionSchema}'s when a turn reaches
 * a terminal state WITHOUT an answer: the door refused the send, the draft was held for review, the turn
 * failed, or a dispatched session was abandoned.
 *
 * It is a third emoji rather than "leave the capture one alone", because `:eyes:` means "seen, working on
 * it" — so leaving it standing over a turn that will never answer tells the reader the one thing that is
 * not true, and is the collapsed-thread half of the daily failure `live/turn/indicators.ts` documents. It
 * defaults to `"warning"`, which renders everywhere and reads as "this needs you" rather than as a failure
 * of the person who asked.
 */
const stoppedReactionSchema = z.object({
  emoji: z.string().min(1).default("warning"),
});

/**
 * The ACKNOWLEDGED-REACTION chrome — the emoji that replaces {@link captureReactionSchema}'s when a turn
 * judged the ask and decided NOTHING WAS OWED in reply.
 *
 * The third terminal ending, and it exists because the other two both lie about this one outcome. Measured
 * twice, across two different sessions and two different asks: a turn reached
 * `triaged-no-response` and left its capture emoji standing, so a settled ask went on advertising "seen,
 * working on it" until someone hand-corrected it. Forced to choose an ending by hand, the loop had only
 * {@link completionReactionSchema}'s tick — which OVERSTATES, since nothing was answered — and
 * {@link stoppedReactionSchema}'s warning, which understates by reading as an error the asker should act
 * on. The owner objected to that warning reading from the other side of the glass, independently and
 * unprompted, which is what made this a third emoji rather than a re-use of an existing one.
 *
 * It defaults to `"ack"` on the owner's own call. That is a CUSTOM workspace emoji rather than a Unicode
 * one, so unlike the other three defaults it is not guaranteed to resolve in a workspace that has not
 * added it — `reactions.add` answers `invalid_name` if it is missing, which `settleTagReaction` reports as
 * an unsettled reaction rather than swallowing. Point this field at any name the workspace does have.
 */
const acknowledgedReactionSchema = z.object({
  emoji: z.string().min(1).default("ack"),
});

/**
 * The FOR-A-HUMAN-REACTION chrome — the emoji that replaces {@link captureReactionSchema}'s when a turn
 * judged the ask and deliberately LEFT IT FOR A PERSON to answer.
 *
 * The fourth terminal ending, and it is not {@link acknowledgedReactionSchema}'s with a different picture.
 * `:ack:` says nothing is owed; this says a reply IS owed and a person should give it — the bot sitting in a
 * channel where people answer each other. The owner's call, for the whole bot rather than one pilot
 * channel. Reading it as `:ack:` would tell the asker their message needs nothing when it needs a human.
 *
 * It defaults to `"for-a-human"`, a CUSTOM workspace emoji the owner added, with the same failure
 * posture as `"ack"`: a workspace without it answers `invalid_name`, which `settleTagReaction` reports.
 */
const forAHumanReactionSchema = z.object({
  emoji: z.string().min(1).default("for-a-human"),
});

/**
 * The STAND-DOWN reaction — what the bot puts on a message in a thread it is witnessing when somebody there
 * tells it it is in the way, or to stop. It is the WHOLE answer: the owner's ruling is a reaction and never a
 * sorry-I'll-stop reply, after which the bot stops witnessing that thread.
 *
 * Not a lifecycle reaction: the message it lands on is not an ask, so nothing ever converges it away. It
 * defaults to `"zipper_mouth_face"`, a Unicode emoji, because a dedicated one may need adding to the
 * workspace — the default works before anyone has, and this field points at a custom one once someone does.
 */
const standDownReactionSchema = z.object({
  emoji: z.string().min(1).default("zipper_mouth_face"),
});

/**
 * The AS-ME drip preferences (PR5.1) — per person, never constants.
 *
 * These are preferences rather than facts: they differ from person to person, and everyone who onboards to
 * Slopweaver brings their own. So the sentence length, the message
 * count and the cadence are CONFIG with neutral defaults, and PR10's belief layer is where a learned value
 * would eventually come from.
 *
 * Unlike the card's caps — every one of which is measured against a real reference message — these have no
 * reference corpus behind them yet. They are a defensible starting shape, stated as such.
 */
const dripSchema = z.object({
  /**
   * Milliseconds between messages. One to two seconds, and the reason is ORDERING, not theatre: sent too fast,
   * messages can arrive out of order, which is worse than a pause. Ordering is additionally guaranteed by awaiting each send, so this is defence in depth; `0` is
   * permitted for tests and is not a sanctioned way to post.
   */
  intervalMs: z.number().int().min(0).max(60_000).default(1500),
  /** How many messages one drip may carry. A drip is a handful of lines, not a broadcast. */
  maxMessages: z.number().int().min(1).max(20).default(8),
  /** The visible-character ceiling for ONE message — "a concise sentence or two", as a number. */
  messageVisibleMax: z.number().int().min(1).max(3000).default(300),
  /**
   * The visible-character ceiling for a drip's SOLE message — a link plus a short paragraph, posted as one
   * top-level announce rather than several conversational lines. `messageVisibleMax` is deliberately left
   * alone for this case: the owner's ruling is that a proposal or discussion piece goes out as
   * ONE message, never a split sequence, and a "concise sentence or two" cap sized for a multi-message drip
   * would force exactly the split that ruling forbids. Two measurements against a real teaser motivate the
   * default: the authored paragraph alone ran 520 visible chars at 101 words, and the paragraph plus its
   * link merged into one message ran 633 chars at 107 words. 1000 gives a 100-word teaser (the owner's own
   * cap, `TEASER_MAX_WORDS` in `./outbound/proposal/schema.ts`) headroom for both a link label at Slack's
   * own 120-character cap AND prose running longer per word than the measured example.
   */
  soleMessageVisibleMax: z.number().int().min(1).max(3000).default(1000),
  /**
   * The visible-character ceiling for a whole ONE-CARD post — every line of it added together, line breaks
   * excluded. Deliberately the SAME number as `soleMessageVisibleMax` and not a new one: a one-card post is
   * that same shape (one top-level announce, a link plus a short paragraph) with its line breaks made
   * structural, so the two measurements behind that default carry over unchanged. Bounding the whole card
   * rather than each line is the point — a per-line cap is fragmenting pressure, which is what the one-card
   * form exists to remove.
   */
  cardVisibleMax: z.number().int().min(1).max(3000).default(1000),
  /**
   * How many lines one card may carry. The same bound as `maxMessages` and for the same reason: it exists
   * only to stop an unbounded list, and the card's real bound is `cardVisibleMax`, which a caller cannot
   * satisfy by adding lines.
   */
  maxLines: z.number().int().min(1).max(20).default(8),
  /**
   * How many dot points one `{"kind":"one-list"}` roster may carry.
   *
   * A bound of its own rather than a share of `maxLines`, because a roster's length is a property of the
   * WORLD it reports rather than of how much the author chose to write: ten open pull requests is ten dot
   * points whether or not the lead and closing lines happen to be short. The default is the review roster
   * this form was measured against — the owner's own alerts-channel post, ten items — and the ceiling
   * keeps it a roster rather than a dump. `cardVisibleMax` is still the real bound, and a caller cannot
   * satisfy it by adding dot points.
   */
  maxBullets: z.number().int().min(1).max(25).default(10),
});

/**
 * The operator's voice configuration: the exact deterministic bans the send door ENFORCES, plus a pointer
 * to the RESPONSE-SHAPE guidance a composing session is briefed with but which the Slack send refuses nothing
 * on. (`gmail draft --reply-to` gates one of its conditions from the code side — `redundantOpeningQuote.ts` —
 * without reading this file.)
 *
 * The two are deliberately different kinds. `exact` is a gate; `shapeMemoryFile` is advice. Mixing them
 * would either turn judgement into a refusal or make a reader think a ban is only a suggestion.
 */
const voiceSchema = z.object({
  exact: z.array(exactVoiceRuleSchema).default([]),
  /**
   * An ABSOLUTE path to the operator's own response-shape memory — the file whose body
   * `slopweaver slack voice-rules` prints above the `exact` list so the three skills that promise "the
   * operator's full voice guidance" resolve to something.
   *
   * A POINTER rather than the prose, and that is the same split `./outbound/voice/composerBrief.ts`
   * already makes: the repository owns the shape of the configuration and never a word of the operator's
   * own voice. One authoritative text lives in their memory corpus; nothing here copies it, so the two
   * cannot drift. Absent on every install that has configured nothing, which is the UNCONFIGURED case and prints
   * as such rather than as a failure.
   *
   * Relative is REFUSED rather than resolved: a path resolved against the caller's working directory reads
   * differently from a hook, a subprocess and an interactive session, so the one that resolves by accident
   * is the bug this refusal prevents.
   */
  shapeMemoryFile: z
    .string()
    .min(1)
    .refine((value) => isAbsolute(value), { message: "must be an absolute path" })
    .optional(),
  /**
   * Whether a SINGLE as-me message must put a blank line between its paragraphs
   * (`./outbound/voice/paragraphSpacing.ts`).
   *
   * Off by default and on in the operator's own `profile.json`, exactly as `exact` ships empty: the repo
   * owns the rule's shape, and whether an operator writes that way is their content to declare. The owner's
   * ruling: a one-card message in their voice is written with blank lines between paragraphs, and that is a
   * voice rule.
   */
  paragraphSpacing: z.boolean().default(false),
});

/**
 * The conversation a live RENDER PROOF is posted to, read back, and deleted from — the owner's own bot DM
 * on this install.
 *
 * CONFIG rather than a constant, and that is the tools-in-the-codebase / state-outside-it rule deciding it
 * rather than a preference: a workspace conversation id is one install's own, so a literal here is wrong for
 * every other install.
 *
 * Absent means the proof cannot run, which REFUSES the send it guards rather than skipping it — see
 * `src/outbound/slack/renderProof.ts` for why that arm fails closed and which named variable clears it.
 */
const renderProofSchema = z.string().min(1).optional();

/** The owner's own posting preferences and exact rules, as distinct from the bot's chrome. */
const slackMeSchema = z.object({
  drip: dripSchema.prefault({}),
  renderProofChannel: renderProofSchema,
  voice: voiceSchema.prefault({}),
});

/**
 * The ONE conversation an automation's PROMPT may be posted into — the owner's own bot DM on this install.
 *
 * The owner's ruling. An `investigate` row's prompt is the bot's own instructions, and it is
 * posted as a real message because the posted ts is the ask's address (`live/automation/investigate.ts`). Posted
 * into a TEAM channel, that is the room reading what the bot was told to do — which is what happened, and the
 * owner had it deleted because it embarrassed them in public.
 *
 * CONFIG rather than a constant for exactly the reason {@link renderProofSchema} is: a workspace
 * conversation id is one install's own. It sits on `slackBot` rather than `slackMe` because the prompt is
 * posted `--as bot` and its privacy is a property of the bot's addressable identity — sharing
 * `renderProofChannel` would mean retiring render proof silently disarms this gate.
 *
 * Absent means no automation prompt may be posted at all, which REFUSES the send rather than skipping
 * the check — the same fail-closed arm `outbound/slack/renderProof.ts` takes, and for the same reason.
 */
const promptChannelSchema = z.string().min(1).optional();

/**
 * The owner-bot block. THREE independent concerns share it: the COSMETIC chrome, me-to-me resolution, and
 * the bot's own addressable identity — worth stating because the last two look coupled (both are "ids the
 * bot owns") and are not.
 *
 * `ownerUserId` is OPTIONAL, and that is the fix for a real trap rather than a loosening. It used to be
 * required, so setting a purely cosmetic `cardChrome.authorLabel` forced an operator to also put their real
 * Slack user id in the file — a personal identifier demanded by a change that renders a bot's display name.
 * It is only meaningful as the id a matched bot post resolves TO, so it is required exactly when something
 * could match: a non-empty `botUserIds`/`appIds`/`botIds`. Chrome-only profiles now carry no identifier.
 *
 * `selfUserIds` is deliberately NOT one of those id lists, and carries no `ownerUserId` requirement of its
 * own: it only lets an `--as me` send address the bot itself (see `outbound/slack/mentionIndex.ts`), and
 * arming that is not a reason to also arm me-to-me's rewrite of the bot's OWN authored corpus records back
 * to the owner — a real, separate behaviour change an operator did not ask for just by wanting to tag the
 * bot in a DM.
 */
const slackBotSchema = z
  .object(
    {
      acknowledgedReaction: acknowledgedReactionSchema.prefault({}),
      appIds: stringArray.default([]),
      botIds: stringArray.default([]),
      botUserIds: stringArray.default([]),
      captureReaction: captureReactionSchema.prefault({}),
      cardChrome: cardChromeSchema.prefault({}),
      completionReaction: completionReactionSchema.prefault({}),
      forAHumanReaction: forAHumanReactionSchema.prefault({}),
      ownerUserId: z.string({ error: SLACK_BOT_ERROR }).optional(),
      pollChrome: pollChromeSchema.prefault({}),
      progressChrome: progressChromeSchema.prefault({}),
      promptChannel: promptChannelSchema,
      selfHandles: stringArray.default([]),
      selfUserIds: stringArray.default([]),
      standDownReaction: standDownReactionSchema.prefault({}),
      stoppedReaction: stoppedReactionSchema.prefault({}),
      witnessBotHandles: stringArray.default([]),
    },
    { error: SLACK_BOT_ERROR },
  )
  .superRefine((slackBot, ctx) => {
    const declaresIds = slackBot.appIds.length > 0 || slackBot.botIds.length > 0 || slackBot.botUserIds.length > 0;
    if (declaresIds && slackBot.ownerUserId === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "profile.json slackBot declares bot ids for me-to-me resolution but no ownerUserId — there is " +
          "nothing for a matched bot post to resolve TO. Add ownerUserId, or drop the id lists to keep the " +
          "declaration cosmetic.",
        path: ["ownerUserId"],
      });
    }
    // The two JUDGED endings make opposite claims to the asker — nothing owed, or a person owes the answer — so
    // one name for both would show the asker the wrong one. Other emoji may collide (`./live/turn/
    // lifecycleReactions.ts` says why that is harmless); these two may not (the owner's ruling).
    if (slackBot.forAHumanReaction.emoji === slackBot.acknowledgedReaction.emoji) {
      ctx.addIssue({
        code: "custom",
        message:
          `profile.json slackBot.forAHumanReaction and acknowledgedReaction are both :${slackBot.acknowledgedReaction.emoji}: — ` +
          "a tag left for a person would read as nothing owed. Give them different emoji.",
        path: ["forAHumanReaction", "emoji"],
      });
    }
  });

/**
 * A MAIN CHECKOUT this install is expected to keep current and correctly installed.
 *
 * It is configuration rather than a constant for two independent reasons, and both are load-bearing. This is
 * a public repository, so a real absolute path or a real long-lived branch name has no business being a
 * literal in it; and the set differs per operator — one machine has one checkout, another has a second repo
 * whose work lives on a long-lived branch periodically rebased onto its own trunk. Defaults to an empty list,
 * so an existing profile keeps validating untouched and every reader simply reports nothing.
 */
const mainCheckoutSchema = z.object({
  /** Absolute path of the checkout's own main worktree. */
  path: z.string().min(1, "profile.json mainCheckouts[].path must be a non-empty absolute path"),
  /**
   * A SECOND ref this branch is expected to be periodically rebased onto — for a long-lived branch that
   * forked from a trunk which keeps moving. Never REBASED onto without a human: auto-rebasing is explicitly
   * out of scope (see `docs/main-checkouts/cwd-safety-and-scope.md`). It is READ, though, as this checkout's own trunk name by
   * the `PreToolUse` branch guard, which refuses a switch off it — the alternative was a module constant
   * reading `"main"`, which inverted that guard for every checkout pinned somewhere else.
   */
  rebaseOnto: z.string().min(1).optional(),
  /** The ref to measure "behind" against; omitted means the branch's own configured upstream. */
  upstream: z.string().min(1).optional(),
});

/**
 * The channels where a fleet top-level post has to be defensible on its face, or does not go out.
 *
 * A channel a lot of people read is high stakes for its signal-to-noise ratio, so a post there has to be
 * defensible to the owner before it goes out. `outbound/slack/highStakesChannel.ts` is what reads it. CONFIG rather than a
 * constant for the reason {@link promptChannelSchema} is: a channel id is one install's own. Defaults to none,
 * so a profile written before this existed still validates and gates nothing until a channel is named.
 */
const slackHighStakesSchema = z.object({
  channels: z
    .array(
      z.object({
        /** The channel's Slack id — a public `C…` or a private `G…`. */
        id: z.string().regex(/^[CG][A-Z0-9]+$/, "profile.json slackHighStakes.channels[].id must be a C… or G… id"),
        /** How a refusal names it to a reader — `#defects`. */
        name: z.string().min(1, "profile.json slackHighStakes.channels[].name must be a non-empty channel name"),
      }),
    )
    .default([]),
});

/**
 * Where the organisation's own incident system announces itself, which `slopweaver org-health read` reads
 * (`orgHealth/read.ts`). CONFIG rather than a constant for the reason {@link promptChannelSchema} is: a channel id is
 * one install's own. Defaults to none, which every read reports `unmeasurable` rather than reading as no incidents.
 */
const orgHealthSchema = z.object({
  incidentChannelId: z
    .string()
    .regex(/^[CG][A-Z0-9]+$/, "profile.json orgHealth.incidentChannelId must be a C… or G… id")
    .optional(),
});

/** The parse-edge schema. Object-level + per-field `error:` reproduce the domain-specific messages exactly. */
const profileSchema = z.object(
  {
    datadog: datadogSchema.prefault({}),
    displayName: z.string({ error: "profile.json displayName must be a string" }),
    github: githubSchema.prefault({}),
    gitNamespace: z.string({ error: "profile.json gitNamespace must be a string" }),
    id: z.string({ error: "profile.json id must be a string" }),
    linear: linearSchema.prefault({}),
    mainCheckouts: z.array(mainCheckoutSchema, { error: "profile.json mainCheckouts must be an array" }).default([]),
    orgHealth: orgHealthSchema.prefault({}),
    schemaVersion: z.literal(PROFILE_SCHEMA_VERSION, {
      error: (issue: { readonly input: unknown }) =>
        `profile.json schemaVersion must be ${String(PROFILE_SCHEMA_VERSION)}, got ${JSON.stringify(issue.input)}`,
    }),
    slackBot: slackBotSchema.optional(),
    // Defaulted rather than optional: `slackBot` stays optional because a profile that has never seen Slack
    // should not carry an invented `ownerUserId`, whereas there is no "as-me is off" state. The lane runs
    // with the operator's preferences and exact rules or with their neutral defaults. Optionality here is
    // NOT the me-to-me switch; the id lists are. See the `slackBot` doc comment above.
    slackHighStakes: slackHighStakesSchema.prefault({}),
    slackMe: slackMeSchema.prefault({}),
    sources: z.array(z.string({ error: SOURCES_ERROR }), { error: SOURCES_ERROR }),
  },
  { error: "profile.json is not a JSON object" },
);

/** The persona/profile seed. Fields are generic; empty strings are the un-set default. */
export interface Profile {
  /** Schema version — must equal {@link PROFILE_SCHEMA_VERSION}. */
  readonly schemaVersion: number;
  /** A stable local id for the persona the agent acts as (default `"me"`). */
  readonly id: string;
  /** Human display name for the persona (empty until set). */
  readonly displayName: string;
  /** The git author/namespace PRs and commits are attributed to (empty until set). */
  readonly gitNamespace: string;
  /** The corpus sources this profile draws on (e.g. `github`); empty until set. */
  readonly sources: readonly string[];
  /**
   * The main checkouts this install keeps current and correctly installed — read by `slopweaver checkout
   * status`/`sync` and by `doctor`. Empty when the operator has declared none, which every reader treats as
   * "nothing to report" rather than as a fault. Never carries a real path in the repo: the values live only
   * under `$SLOPWEAVER_HOME`.
   */
  readonly mainCheckouts: readonly {
    readonly path: string;
    readonly upstream?: string | undefined;
    readonly rebaseOnto?: string | undefined;
  }[];
  /**
   * The owner's own Slack bot identity (PR4.5 me-to-me), the bot's own addressable identity (the as-me
   * door), and the outbound card's chrome, when configured.
   *
   * Three independent things share this key, which is worth stating because two of them look coupled and
   * are not: the `cardChrome` fields are COSMETIC (the author row, colour, fold label) and take effect on
   * their own; me-to-me rewriting needs a non-empty `botUserIds`/`appIds`/`botIds` PLUS `ownerUserId`; and
   * `selfUserIds` needs neither — it only lets an `--as me` send mention the bot itself. Declaring chrome
   * plus the required `ownerUserId` and no id lists changes nothing about how the corpus attributes
   * authorship.
   *
   * Never carries a real identifier in the repo — the seed template ships blank and a real value lives only
   * under `$SLOPWEAVER_HOME`.
   */
  readonly slackBot?: {
    readonly cardChrome: {
      readonly authorEmoji: string;
      readonly authorLabel: string;
      readonly bannerColor: string;
      readonly detailLabel: string;
      readonly metadataEventType: string;
    };
    /** Required only when an id list below is non-empty — see the schema. Absent ⇒ chrome-only. */
    readonly ownerUserId?: string | undefined;
    /**
     * The one conversation an automation's PROMPT may be posted into. Absent on an install that has not
     * set one, which refuses every such post rather than admitting it somewhere public.
     */
    readonly promptChannel?: string | undefined;
    readonly botUserIds: readonly string[];
    readonly appIds: readonly string[];
    readonly botIds: readonly string[];
    /**
     * The bot's own Slack user id(s) — its classic bot user and its app user, when they differ — that an
     * `--as me` send may mention. Independent of `ownerUserId`/`botUserIds`/`appIds`/`botIds`: declaring
     * this arms NOTHING about me-to-me authorship rewriting, only that one addressable key.
     */
    readonly selfUserIds: readonly string[];
    /**
     * The bot's own Slack HANDLES, as the owner's turns name it (`<name>-bot`), so a turn naming the bot by handle reads as
     * one about Slack (`profile/slackPlace.ts`). Empty ⇒ only the role word `the bot` does.
     */
    readonly selfHandles: readonly string[];
    /**
     * The Slack HANDLES of the configured peer bots whose tagged threads the listener witnesses — silently,
     * posting only what is material with proof (`skills/witness`). A handle, never an id: `listen` resolves
     * each against the member directory to exactly one current bot row at start, and refuses to start on a
     * missing, ambiguous or non-bot one. Empty ⇒ witnessing is inert.
     */
    readonly witnessBotHandles: readonly string[];
    /** The poll's chrome. Its `metadataEventType` stays DISTINCT from the card's and the progress one's. */
    readonly pollChrome: {
      readonly metadataEventType: string;
    };
    /** The capture-reaction chrome — the emoji reacted at capture, before any turn work. Defaults to `"eyes"`. */
    readonly captureReaction: {
      readonly emoji: string;
    };
    /**
     * The completion-reaction chrome — the emoji that REPLACES {@link captureReaction}'s once the turn's
     * answer has posted. Defaults to `"white_check_mark"`.
     */
    readonly completionReaction: {
      readonly emoji: string;
    };
    /**
     * The stopped-reaction chrome — the emoji that replaces {@link captureReaction}'s when a turn ends
     * WITHOUT an answer (refused, held, failed, abandoned). Defaults to `"warning"`.
     */
    readonly stoppedReaction: {
      readonly emoji: string;
    };
    /**
     * The acknowledged-reaction chrome — the emoji that replaces {@link captureReaction}'s when a turn
     * judged the ask and owed no reply. Defaults to `"ack"`, a CUSTOM workspace emoji.
     */
    readonly acknowledgedReaction: {
      readonly emoji: string;
    };
    /**
     * The for-a-human-reaction chrome — the emoji that replaces {@link captureReaction}'s when a turn
     * judged the ask and left it for a person to answer. Defaults to `"for-a-human"`, a CUSTOM workspace emoji.
     */
    readonly forAHumanReaction: {
      readonly emoji: string;
    };
    /**
     * The stand-down reaction — the bot's whole answer when a thread it witnesses tells it it is in the way.
     * Defaults to `"zipper_mouth_face"`. Not a lifecycle reaction.
     */
    readonly standDownReaction: {
      readonly emoji: string;
    };
    /** The transient progress message's chrome (PR5.2). `emojiShortcode` absent ⇒ the unicode fallback. */
    readonly progressChrome: {
      readonly barWidth: number;
      readonly emojiFallback: string;
      readonly emojiShortcode?: string | undefined;
      readonly metadataEventType: string;
    };
  };
  /**
   * The owner's own AS-ME posting preferences (PR5.1). Always present — every field has a default, so a
   * profile written before this existed still validates and still gets working numbers.
   */
  readonly slackMe: {
    /** The conversation a live render proof is posted to and deleted from. Absent on an install that has not set one. */
    readonly renderProofChannel?: string | undefined;
    readonly drip: {
      readonly intervalMs: number;
      readonly maxMessages: number;
      readonly messageVisibleMax: number;
      readonly soleMessageVisibleMax: number;
      readonly cardVisibleMax: number;
      readonly maxLines: number;
      readonly maxBullets: number;
    };
    /**
     * The exact deterministic bans the send door enforces, plus a pointer to the advisory response-shape
     * guidance. The values are private content; this repository owns only their shape.
     */
    readonly voice: {
      readonly exact: readonly ExactVoiceRule[];
      /** Whether a single as-me message must put a blank line between its paragraphs. */
      readonly paragraphSpacing: boolean;
      /** Absolute path to the operator's response-shape memory, absent when none is configured. */
      readonly shapeMemoryFile?: string | undefined;
    };
  };
  /** The channels a fleet top-level post must be defensible in, or not go out. Empty until one is named. */
  readonly slackHighStakes: {
    readonly channels: readonly { readonly id: string; readonly name: string }[];
  };
  /** Where the organisation's incident system announces itself. Always present; its channel absent until named. */
  readonly orgHealth: {
    readonly incidentChannelId?: string | undefined;
  };
  /** This install's Datadog org. Always present; its site absent until set, and refused rather than defaulted. */
  readonly datadog: {
    readonly site?: string | undefined;
    /** The metrics producers `datadog produce` may run, keyed by name; empty until one is declared. */
    readonly metricsProducers: Readonly<Record<string, MetricsProducerConfig>>;
    /** Monitor tags marking infrastructure-as-code ownership; empty by default, which leaves the guard inert. */
    readonly iacManagedTags: readonly string[];
  };
  /** This install's GitHub conventions. Always present; no repository's title shape is set until named. */
  readonly github: {
    readonly titleShapes: Readonly<Record<string, RepositoryTitleShape>>;
  };
  /** This install's Linear conventions. Always present; no team key is the organisation's own until named. */
  readonly linear: {
    readonly teamKeys: readonly string[];
  };
}

/**
 * Parse + validate an already-decoded JSON value into a {@link Profile}. Strict: a non-object, a wrong
 * `schemaVersion`, or a mistyped field is an error (so a corrupt hand-edit surfaces at read time).
 * Unknown extra fields are ignored — Zod strips them, matching the seed's forward-compatible intent.
 *
 * @param value a parsed JSON value (e.g. from `readJsonFile`)
 * @returns the validated profile, or an error listing every violation
 */
export function parseProfile({ value }: { value: unknown }): Result<Profile> {
  const parsed = profileSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message));
  }
  const {
    datadog,
    displayName,
    github,
    gitNamespace,
    id,
    linear,
    mainCheckouts,
    orgHealth,
    schemaVersion,
    sources,
    slackBot,
    slackHighStakes,
    slackMe,
  } = parsed.data;
  // Build the readonly contract explicitly: the optional `slackBot` is conditionally spread (so it never
  // reaches the value as an explicit `undefined` under exactOptionalPropertyTypes).
  return ok({
    datadog,
    displayName,
    github,
    gitNamespace,
    id,
    linear,
    mainCheckouts,
    orgHealth,
    schemaVersion,
    slackHighStakes,
    slackMe,
    sources,
    ...(slackBot !== undefined ? { slackBot } : {}),
  });
}
