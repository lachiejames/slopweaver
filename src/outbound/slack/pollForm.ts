/**
 * The POLL form — a Slack-LOCAL artifact, deliberately not part of the shared `artifact/` vocabulary.
 *
 * Why it lives here rather than in `src/outbound/artifact/`: a poll's whole mechanism is *Slack reactions*.
 * The emoji beside each option IS the ballot, and "react to vote" has no meaning on Linear or in a GitHub PR
 * body. The outbound architecture note's own test — *"would a second platform have to WEAKEN this in order to
 * use it?"* — answers itself here, and its judgement call *"name the platform rather than invent a fake
 * cross-platform concept"* says the honest name is `slack/pollForm`, not `artifact/poll`.
 *
 * ## The emoji are NAMES, not characters, and that is the load-bearing decision
 *
 * Each option is labelled with a structural `rich_text` emoji element carrying a `name`. MEASURED live against
 * a real workspace: posting `{ type: "emoji", name: "one" }` comes back from Slack enriched to
 * `{"type":"emoji","name":"one","unicode":"0031-fe0f-20e3"}` — i.e. Slack resolves the name to the keycap
 * itself. A literal `:one:` written into a `text` element is NOT expanded and renders as raw text, which is
 * the same trap `render.ts` documents for `:link:`.
 *
 * The consequence is the reason this design is safe: **a Slack reaction is identified by the same name**. So
 * the string this module writes into the message and the string the counter later matches against are ONE
 * string, and there is no unicode↔name translation table to drift. `:one:` in the corpus is a vote for
 * option 1 because it is literally the same identifier the renderer emitted.
 *
 * Nine is the hard ceiling because the keycap run is where that identity is verified: `one`…`nine` were all
 * confirmed present as real reaction names in the live corpus. A tenth option would need `keycap_ten` (which
 * exists) and then an unmeasured palette beyond it, so the schema stops at nine rather than guessing.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

/**
 * The ballot emoji, in order — each entry is BOTH the `rich_text` emoji name and the Slack reaction name.
 *
 * `zero` is deliberately absent: options are numbered from 1, and a `:zero:` reaction (which does occur in the
 * wild) is therefore never a vote.
 */
export const POLL_OPTION_EMOJI = ["one", "two", "three", "four", "five"] as const;

/** Fewer than two options is not a poll, it is a statement. */
const POLL_MIN_OPTIONS = 2;

/** Every option on the rendered ballot, including the appended escape hatch. */
const POLL_MAX_OPTIONS = POLL_OPTION_EMOJI.length;

/**
 * How many options an AUTHOR supplies. One fewer than the ballot, because the last slot is always
 * {@link POLL_OTHER_LABEL} — see {@link pollBallot}.
 */
export const POLL_MAX_AUTHORED_OPTIONS = POLL_MAX_OPTIONS - 1;

/**
 * The final option, always present and always last, supplied by the BALLOT rather than by the author.
 *
 * A poll exists to start a conversation, not to close one. Without an escape hatch a reader whose answer is
 * none of the listed ones either does not vote (and is invisible) or picks the nearest wrong option (and is
 * miscounted) — and the interesting answer, the one nobody thought to list, is exactly the one worth hearing.
 * Pointing it at the thread is what turns a tally into a discussion.
 *
 * Unskippable by construction, like the footer: it is appended by `pollBallot`, so an author cannot forget it
 * and no poll can ship without a way to say "none of these".
 */
export const POLL_OTHER_LABEL = "Other — explain in replies";

/**
 * The question's ceiling. Generous compared with the card's 180-char TL;DR because a poll has NO fold to sit
 * above (one `rich_text` block cannot fold), so length costs nothing structurally — the cap exists only to
 * keep a question a question rather than an essay.
 */
const POLL_QUESTION_MAX = 300;

/** The `why` line's ceiling — one sentence of context, same reasoning as the question. */
const POLL_WHY_MAX = 300;

/** One option label stays scannable on one line beside its emoji. */
const POLL_OPTION_MAX = 120;

/**
 * Who to notify, if anyone. OPTIONAL by design — a poll you are trialling should not ping anybody, and a poll
 * you want answered usually should.
 *
 * A discriminated union rather than a list of strings, and several kinds rather than one, because the real need
 * is mixed: sometimes a sub-team, sometimes the whole channel, sometimes named people, sometimes several at
 * once. A stringly-typed `"@engineers"` would force every consumer to re-parse the sigil and guess the kind —
 * the same smuggling the outbound architecture note warns about.
 */
export type PollPing =
  /** A Slack user group by HANDLE (`engineers`), resolved to `<!subteam^S…>` at send time. */
  | { readonly kind: "group"; readonly handle: string }
  /** `@here` / `@channel`. Deliberately NOT something a group or person can become. */
  | { readonly kind: "broadcast"; readonly range: "channel" | "here" }
  /** One person by identity-map key, resolved EXACTLY — never a fuzzy name match. */
  | { readonly kind: "person"; readonly person: string };

/**
 * A poll: a question, WHY it is being asked, and the options.
 *
 * `why` is REQUIRED, not optional, and that is a deliberate shape decision rather than politeness. A poll that
 * is only a mechanism is a bounce — the same rule the card's lead follows. Making the reason unskippable in
 * the type means a poll cannot be posted without one, instead of a reviewer noticing it is missing.
 */
export interface PollArtifact {
  readonly kind: "poll";
  readonly question: string;
  readonly why: string;
  readonly options: readonly string[];
  /** Who to notify. Absent means notify nobody, which is the right default for a trial run. */
  readonly ping?: readonly PollPing[] | undefined;
}

/** One option paired with the emoji that votes for it. `position` is 1-based, matching what a reader sees. */
export interface PollBallotEntry {
  readonly position: number;
  readonly emojiName: string;
  readonly label: string;
}

/**
 * Every character that breaks a line, not merely `\n` and `\r`.
 *
 * U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR, U+0085 NEL, and the vertical tab / form feed all break a
 * line in a Slack client. Checking only `[\n\r]` left a hole with a nasty consequence: a label could be visually
 * detached from the ballot emoji above it, so a reader would see option 2 next to the keycap for option 1 and
 * their vote would be counted against the wrong option.
 */
const LINE_BREAK = /[\n\r\u2028\u2029\u0085\v\f]/;

/** A single line of plain text: no line breaks, and not blank once trimmed. */
function pollLine({ max }: { max: number }): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !LINE_BREAK.test(value), {
      // A poll is read as a list, one option per line, so an embedded break silently reflows the ballot and
      // detaches a label from its emoji. Refused for the same reason the drip refuses one.
      message: "a poll line carries no line breaks — the list structure supplies them",
    });
}

/**
 * Why duplicate options are refused rather than de-duplicated, in the author's vocabulary.
 *
 * Two options a voter cannot tell apart make the RESULT meaningless, not merely untidy: whichever emoji they
 * pick, the tally cannot say what they meant. Compared case-insensitively because "Meetings" and "meetings"
 * are indistinguishable to someone scanning a list.
 */
const DUPLICATE_OPTION_MESSAGE =
  "two options are the same once case is ignored — a voter cannot distinguish them, so the tally would be " +
  "meaningless. Make them distinct or drop one.";

/** The indices of the first duplicated option, or nothing. Pure. */
function firstDuplicateIndex({ options }: { options: readonly string[] }): number | undefined {
  const seen = new Set<string>();
  for (const [index, option] of options.entries()) {
    const key = option.trim().toLowerCase();
    if (seen.has(key)) {
      return index;
    }
    seen.add(key);
  }
  return undefined;
}

/**
 * The poll form's schema. Bounds SHAPE only — nothing here reads the words.
 *
 * The option-count ceiling names the reason in its message, because "too many options" without "the ballot
 * emoji are only verified to nine" tells an author nothing about how to proceed.
 */
const pollPingSchema = z.discriminatedUnion("kind", [
  strictForm({ handle: z.string().min(1).max(80), kind: z.literal("group") }),
  strictForm({ kind: z.literal("broadcast"), range: z.enum(["channel", "here"]) }),
  strictForm({ kind: z.literal("person"), person: z.string().min(1) }),
]);

export const pollArtifactSchema: z.ZodType<PollArtifact> = z
  .strictObject({
    kind: z.literal("poll"),
    options: z
      .array(pollLine({ max: POLL_OPTION_MAX }))
      .min(POLL_MIN_OPTIONS)
      .max(
        POLL_MAX_AUTHORED_OPTIONS,
        `a poll carries at most ${String(POLL_MAX_AUTHORED_OPTIONS)} authored options — the ballot appends ` +
          `"${POLL_OTHER_LABEL}" as the last one, so ${String(POLL_MAX_OPTIONS)} chips is the whole ballot. ` +
          "Past five, a reader stops reading and starts scrolling.",
      ),
    ping: z.array(pollPingSchema).max(8).optional(),
    question: pollLine({ max: POLL_QUESTION_MAX }),
    why: pollLine({ max: POLL_WHY_MAX }),
  })
  .superRefine((artifact, ctx) => {
    const duplicate = firstDuplicateIndex({ options: artifact.options });
    if (duplicate !== undefined) {
      ctx.addIssue({ code: "custom", message: DUPLICATE_OPTION_MESSAGE, path: ["options", duplicate] });
    }
  });

/**
 * The ballot: each option paired with the emoji name that votes for it, plus the appended escape hatch.
 *
 * The ONE place the option→emoji correspondence is computed, so the renderer, the dry run, the durable store,
 * the seeding and the counter cannot disagree about it. Positional by construction — option `i` always gets
 * `POLL_OPTION_EMOJI[i]` — which is what makes the mapping reproducible from the stored option list alone.
 *
 * {@link POLL_OTHER_LABEL} is appended here rather than required of the author, so every poll has a way to say
 * "none of these" and to say why in the thread.
 *
 * @param options the validated authored option labels, in author order
 * @returns each option with its 1-based position and its ballot emoji name, escape hatch last
 */
export function pollBallot({ options }: { options: readonly string[] }): readonly PollBallotEntry[] {
  const withOther = options.length === 0 ? options : [...options, POLL_OTHER_LABEL];
  return withOther.map((label, index) => {
    const emojiName = POLL_OPTION_EMOJI[index];
    if (emojiName === undefined) {
      // Unreachable through the schema (which caps at POLL_MAX_OPTIONS), but this function is exported and a
      // silent `?? ""` here would produce an option nobody can vote for — a vote quietly impossible to cast.
      throw new Error(
        `no ballot emoji for option ${String(index + 1)}: a poll carries at most ${String(POLL_MAX_OPTIONS)}`,
      );
    }
    return { emojiName, label, position: index + 1 };
  });
}
