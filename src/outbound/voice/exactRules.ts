/**
 * Deterministic voice-rule matching over authored prose only.
 *
 * The public repository owns the rule SHAPE. An operator's actual banned characters, words and phrases live
 * in private `profile.json` configuration. Judgement rules do not belong here: this module can prove only an
 * exact literal or lexical match, so cadence, complexity and rhetorical patterns stay in the voice prompt.
 */
import { z } from "zod";

import { hatchFor } from "../../hatch/lookup.js";
import { hatchIncantation } from "../../hatch/types.js";
import { strictForm } from "../strictForm.js";

/**
 * Which name a send goes out under. The AXIS the rule set is split along, and the only one — the owner wants
 * the bot to sound somewhat like the owner and less like Claude, so most rules bind both lanes and a few do not.
 */
export const VOICE_ACTORS = ["me", "bot"] as const;

/** Which name a send goes out under, as the door's own `request.artifact.actor` spells it. */
export type VoiceActor = (typeof VOICE_ACTORS)[number];

/**
 * The lanes a rule binds, on every rule kind.
 *
 * ABSENT means BOTH, and that default is load-bearing rather than a convenience: every rule already written
 * into an operator's private profile keeps binding on both lanes with no file edit, and the measured leak
 * (em-dashes in about one in a hundred sent messages, nearly all agent-authored posts under the owner's own account) was on the
 * bot-shaped paths — so an absent field must not read as "as-me only".
 */
const actorsField = { actors: z.array(z.enum(VOICE_ACTORS)).min(1).optional() };

const literalRuleSchema = strictForm({ ...actorsField, kind: z.literal("literal"), value: z.string().min(1) });
const wordRuleSchema = strictForm({
  ...actorsField,
  kind: z.literal("word"),
  value: z
    .string()
    .min(1)
    .refine((value) => !/\s/u.test(value), "a word rule cannot contain whitespace"),
});
const phraseRuleSchema = strictForm({ ...actorsField, kind: z.literal("phrase"), value: z.string().min(1) });

/**
 * The one rule kind whose POLARITY the other three cannot express: at least one of `anyOf` must APPEAR.
 *
 * Every other kind means "this must not appear", which is the wrong shape for the hedge FLOOR. Measured over
 * hundreds of thousands of spoken words, hedging is the owner's single loudest trait — "I think" 3.98/1k, "probably" 3.40,
 * "maybe" 3.20 — roughly one hedge every 55 words, damping to about a fifth of that in writing but staying
 * the top written tic. The hedge is a correctness guard (a hedged claim cannot be wrong), not padding, so a
 * claim-carrying message with ZERO hedges reads as not-the-owner exactly as much as a stacked one does — a
 * floor as well as a ceiling.
 *
 * The markers themselves are private content and live in the operator's profile, never here.
 */
const atLeastOneRuleSchema = strictForm({
  ...actorsField,
  anyOf: z.array(z.string().min(1)).min(1),
  kind: z.literal("at-least-one"),
});

/**
 * One exact rule: case-sensitive literal text, a case-insensitive word/phrase that must NOT appear, or a set
 * of which at least one MUST appear.
 */
export const exactVoiceRuleSchema = z.discriminatedUnion("kind", [
  literalRuleSchema,
  wordRuleSchema,
  phraseRuleSchema,
  atLeastOneRuleSchema,
]);

/**
 * The journalled hatch for one deliberate outbound artifact that conflicts with the operator's voice rules —
 * a grant one session takes with `slopweaver hatch open`, never an ambient variable.
 *
 * It lives HERE rather than beside the as-me lane that first needed it. Every surface that applies these
 * rules needs the name, and reaching into `cli/commands/slack/dripCore.ts` for a string constant dragged the
 * whole Slack drip module graph into whichever CLI asked — measured at 45 ms of import per consumer, paid
 * again by every test file that loads them.
 */
export const VOICE_RULES_HATCH = "voice-rules";

/** The command every voice-rule refusal names as its one way past, derived from the register row. */
export const VOICE_RULES_ESCAPE = hatchIncantation({ hatch: hatchFor({ id: VOICE_RULES_HATCH }) });

/** An exact voice rule loaded from private operator configuration. */
export type ExactVoiceRule = z.infer<typeof exactVoiceRuleSchema>;

/** One authored prose region, already separated from typed links/code/mentions by its caller. */
export interface AuthoredProse {
  readonly path: string;
  readonly text: string;
}

/** One exact-rule match with enough context for an actionable refusal. */
export interface ExactVoiceRuleFinding {
  readonly path: string;
  readonly rule: ExactVoiceRule;
}

const URL = /(?:https?:\/\/|mailto:|www\.)\S+/giu;
const SLACK_LINK = /<(?:https?:\/\/|mailto:)[^>]+>/giu;
const INLINE_CODE = /`+[^`\n]+`+/gu;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const TECHNICAL_SIGNAL = /[0-9_/@#=]/u;
const NON_WORD_SIGNAL = /[^\p{L}\p{N}\s]/u;

/** Bracketing a token opens with. Stripped before a token is classified, and kept when one is removed. */
const LEADING_PUNCTUATION = /^[([{<'"]+/u;

/** The trailing punctuation the CLASSIFIER discounts when deciding whether a token is an identifier. */
const CLASSIFYING_TRAILING = /[\])}>'",;!?]+$/u;

/**
 * The trailing punctuation kept in the prose when an identifier is removed — {@link CLASSIFYING_TRAILING}
 * plus `.` and `:`, the two a sentence-level rule cannot do without.
 */
const PROSE_TRAILING = /[\])}>'",;!?.:]+$/u;

/** Whether one character continues a lexical word. */
function isWordCharacter({ value }: { value: string | undefined }): boolean {
  return value !== undefined && WORD_CHARACTER.test(value);
}

/** A punctuation-bearing token with an identifier signal is technical data, not authored prose. */
function isTechnicalIdentifier({ token }: { token: string }): boolean {
  const core = token.replace(LEADING_PUNCTUATION, "").replace(CLASSIFYING_TRAILING, "");
  return NON_WORD_SIGNAL.test(core) && TECHNICAL_SIGNAL.test(core);
}

/**
 * One technical identifier removed, with the punctuation AROUND it left where the author put it.
 *
 * Replacing the whole token was silently welding sentences together. `5.2.0.` ends a sentence, `8.6):`
 * closes a bracket and opens a list, and `12.` is a full stop — every one of those tokens classifies as
 * technical, so the old whole-token replacement ate the sentence break with the number. What a
 * sentence-level rule then saw was one 34-word run with an unbalanced bracket and no colon in it, which is
 * a lie about what the author wrote. Measured on both damaged cells of the voice exercise:
 * `yarn tsx` over `authoredProseOf` printed `"… forces basic-ftp to   Four open …"`.
 *
 * The identifier's own text still goes, because that is the whole point of the exemption. Only the
 * surrounding punctuation stays, and CLASSIFYING_TRAILING is deliberately not reused here: widening the set
 * the CORE is taken from would change which tokens count as technical, and this fix changes what is
 * REPLACED, never what is classified.
 */
function withoutIdentifier({ token }: { token: string }): string {
  const opener = LEADING_PUNCTUATION.exec(token);
  const leading = opener === null ? "" : opener[0];
  const closer = PROSE_TRAILING.exec(token.slice(leading.length));
  const trailing = closer === null ? "" : closer[0];
  return `${leading} ${trailing}`;
}

/** Remove inline regions that are not authored voice prose. */
function withoutInlineExemptions({ text }: { text: string }): string {
  const withoutLinksAndCode = text.replace(SLACK_LINK, " ").replace(URL, " ").replace(INLINE_CODE, " ");
  return withoutLinksAndCode
    .split(/(\s+)/u)
    .map((token) => (isTechnicalIdentifier({ token }) ? withoutIdentifier({ token }) : token))
    .join("");
}

/**
 * Split raw text into authored prose, excluding fenced code, quoted third-party lines, URLs, inline code and
 * technical identifiers.
 *
 * @param text the raw or text-run content
 * @param path the caller-owned location prefix
 * @returns the prose regions exact rules are allowed to inspect
 */
export function authoredProseOf({ text, path }: { text: string; path: string }): readonly AuthoredProse[] {
  const prose: AuthoredProse[] = [];
  let fence: "`" | "~" | undefined;
  text.split(/\r?\n/u).forEach((line, lineIndex) => {
    const trimmed = line.trimStart();
    const marker = trimmed.match(/^(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker === "`" || marker === "~") {
      fence = fence === marker ? undefined : marker;
      return;
    }
    if (fence !== undefined || trimmed.startsWith(">")) {
      return;
    }
    const authored = withoutInlineExemptions({ text: line });
    if (authored.trim().length > 0) {
      prose.push({ path: text.includes("\n") ? `${path}.line[${String(lineIndex)}]` : path, text: authored });
    }
  });
  return prose;
}

/** Whether a case-folded word or phrase appears with lexical boundaries on both sides. */
function containsLexicalValue({ text, value }: { text: string; value: string }): boolean {
  let offset = text.indexOf(value);
  while (offset !== -1) {
    const before = offset === 0 ? undefined : text[offset - 1];
    const end = offset + value.length;
    const after = end >= text.length ? undefined : text[end];
    if (!isWordCharacter({ value: before }) && !isWordCharacter({ value: after })) {
      return true;
    }
    offset = text.indexOf(value, offset + 1);
  }
  return false;
}

/** Whether one rule matches one authored prose region — i.e. whether the region BREAKS it. */
function matchesRule({ prose, rule }: { prose: string; rule: ExactVoiceRule }): boolean {
  if (rule.kind === "literal") {
    return prose.includes(rule.value);
  }
  const text = prose.toLocaleLowerCase("en-AU");
  if (rule.kind === "at-least-one") {
    return !rule.anyOf.some((value) => containsLexicalValue({ text, value: value.toLocaleLowerCase("en-AU") }));
  }
  return containsLexicalValue({ text, value: rule.value.toLocaleLowerCase("en-AU") });
}

/**
 * How one rule is NAMED in a finding, a refusal and a ledger row.
 *
 * A single function because three surfaces print it — the pre-door refusal, the door finding's summary and
 * the pain-point ledger's reason — and `at-least-one` has no `value` field for them to interpolate. Reaching
 * for `rule.value` on the union is a compile error now, which is the point: the shape that used to read
 * `JSON.stringify(finding.rule.value)` would have written `undefined` into the ledger.
 *
 * @param rule the rule that fired
 * @returns a one-clause description naming the rule kind and what it asked for
 */
export function voiceRuleLabel({ rule }: { rule: ExactVoiceRule }): string {
  if (rule.kind === "at-least-one") {
    return `carries none of the configured at-least-one voice markers ${voiceRuleSubject({ rule })}`;
  }
  return `matches the configured ${rule.kind} voice rule ${voiceRuleSubject({ rule })}`;
}

/**
 * What one rule is ABOUT, rendered — the banned text, or the set of which one must appear.
 *
 * Separate from {@link voiceRuleLabel} because two surfaces need the subject without the sentence around it:
 * the composing brief renders its own `kind (case-sensitivity): subject` line, and the below-the-fold
 * tally keys a map by rule identity. Both reached for `rule.value` before the fourth kind existed.
 *
 * @param rule the rule to render
 * @returns the rule's configured text, JSON-quoted so leading and trailing spaces are visible
 */
export function voiceRuleSubject({ rule }: { rule: ExactVoiceRule }): string {
  return rule.kind === "at-least-one" ? JSON.stringify(rule.anyOf) : JSON.stringify(rule.value);
}

/**
 * The rules that bind ONE lane — the single place the actor split is applied.
 *
 * The split is a property of a RULE rather than a second array, because a second array in the private
 * profile would be the parallel config this module exists to avoid. A rule declaring no `actors` binds
 * every lane; see {@link exactVoiceRuleSchema}'s `actors` field for why that direction is the safe one.
 *
 * @param rules the operator's whole private rule list
 * @param actor which name this send goes out under
 * @returns the subset that binds this lane, in input order
 */
export function rulesForActor({
  rules,
  actor,
}: {
  rules: readonly ExactVoiceRule[];
  actor: VoiceActor;
}): readonly ExactVoiceRule[] {
  return rules.filter((rule) => rule.actors === undefined || rule.actors.includes(actor));
}

/**
 * Match a private exact-rule list against authored prose regions.
 *
 * @param prose authored prose only, with typed exceptions removed by the caller
 * @param rules the operator's private exact-rule list
 * @returns one finding per matching rule and prose region, in stable input order
 */
export function exactVoiceRuleFindings({
  prose,
  rules,
}: {
  prose: readonly AuthoredProse[];
  rules: readonly ExactVoiceRule[];
}): readonly ExactVoiceRuleFinding[] {
  return prose.flatMap((region) =>
    rules.filter((rule) => matchesRule({ prose: region.text, rule })).map((rule) => ({ path: region.path, rule })),
  );
}
