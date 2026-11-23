/**
 * The react-now card's voice half: which of its regions are authored PROSE, and what the packing and voice
 * rules every other outbound door already applies find in them.
 *
 * It is a leaf under `./reactNowCard.ts` rather than part of it because the card's five `dl.f` fields are
 * exactly the set a voice cell can name, so the labels and the union belong beside the code that reads
 * them — `./reactNowCard.ts` widens {@link DlField} into its own `CardField` rather than the other way
 * round, which keeps the edge one-directional.
 *
 * ## An option's letter is structure, not prose
 *
 * The voice rules see each option's BODY as its own cell rather than the whole `options` field as one. The
 * `A:`/`B:` markers are this form's own syntax, so feeding them to the colon-list rule would refuse every
 * correctly-shaped card ever written. That is the same call `../outbound/github/aboveFold.ts` and
 * `../outbound/artifact/aboveFold.ts` make: only the form knows which of its runs are authored prose.
 */
import { type AboveFoldFinding, aboveFoldFindings } from "../outbound/voice/aboveFold.js";
import type { ExactVoiceRule } from "../outbound/voice/exactRules.js";
import { splitOptions } from "./cardOptions.js";
import { aboveFoldText } from "./text.js";

/**
 * The five `dl.f` fields a card declares, by the key this module and its parent both write.
 *
 * @internal — `./reactNowCard.ts` widens this into its own `CardField`; no caller outside the two names it.
 */
export type DlField = "what" | "whyYou" | "options" | "lean" | "ifSilent";

/** Each `dl.f` field's rendered label, which is how a parsed card's field map is keyed. */
export const DL_FIELD_LABELS: Readonly<Record<DlField, string>> = {
  ifSilent: "if silent",
  lean: "lean",
  options: "options",
  what: "what",
  whyYou: "why you",
};

/**
 * Every region a voice defect can name — the `dl.f` fields plus the bolded `.q` question line.
 *
 * @internal — the field {@link VoiceDefect} carries; no caller outside this module names it directly.
 */
export type VoiceField = DlField | "question";

/**
 * One collapsed voice defect, naming the card field a composer has to go and fix.
 *
 * @internal — the row {@link voiceDefects} returns for `./reactNowCard.ts` to push; no other caller names it.
 */
export interface VoiceDefect {
  readonly field: VoiceField;
  readonly reason: string;
}

/**
 * The packing and voice rules every other outbound door already applies, over each above-fold field.
 *
 * Findings are COLLAPSED to one defect per field and rule, carrying how many times the rule fired. A wall of
 * text breaks the same rule in every sentence, so an honest report of one card was 24 near-identical
 * lines — a gate against walls of text whose own refusal was a wall of text. The count is the useful part;
 * the twenty-third restatement of the correction is not.
 *
 * @param fields the card's `dl.f` field map, keyed by rendered label
 * @param push the parent's own defect sink, which widens each field onto its `CardField`
 * @param questionRaw the card's `.q` markup, absent when it carries no question
 * @param rules the exact voice rules this door applies
 */
export function pushVoiceDefects({
  fields,
  push,
  questionRaw,
  rules,
}: {
  fields: ReadonlyMap<string, string>;
  push: (defect: VoiceDefect) => void;
  questionRaw: string | undefined;
  rules: readonly ExactVoiceRule[];
}): void {
  for (const defect of voiceDefects({ fields, questionRaw, rules })) {
    push(defect);
  }
}

/** Every voice cell's findings, collapsed to one defect per field and rule. */
function voiceDefects({
  fields,
  questionRaw,
  rules,
}: {
  fields: ReadonlyMap<string, string>;
  questionRaw: string | undefined;
  rules: readonly ExactVoiceRule[];
}): readonly VoiceDefect[] {
  const cells = voiceCells({ fields, questionRaw });
  const collapsed = new Map<string, { path: string; message: string; times: number }>();
  for (const finding of aboveFoldFindings({ cells, rules })) {
    const key = collapseKey({ finding });
    const seen = collapsed.get(key);
    const first = seen === undefined ? finding.message : seen.message;
    const before = seen === undefined ? 0 : seen.times;
    collapsed.set(key, { message: first, path: finding.path, times: before + 1 });
  }
  return [...collapsed.values()].map((finding) => ({
    field: fieldOfPath({ path: finding.path }),
    reason: voiceReason({ finding }),
  }));
}

/**
 * Which rule in which cell one finding belongs to, so collapse is per field AND rule.
 *
 * Every exact voice rule shares the one code `voice-rule`, so the code alone would fold two different rules
 * in one cell into one row and report the first as firing twice. Its message is built from the rule alone
 * (`voiceRuleLabel`), so it names the rule. A structural message can carry a per-occurrence count — a long
 * sentence's word total — so a structural rule keys on its code, which already names it.
 */
function collapseKey({ finding }: { finding: AboveFoldFinding }): string {
  if (finding.code === "voice-rule") {
    return `${finding.path}|${finding.code}|${finding.message}`;
  }
  return `${finding.path}|${finding.code}`;
}

/** One collapsed voice finding as a refusal line, naming how many times the rule fired when it fired more than once. */
function voiceReason({ finding }: { finding: { path: string; message: string; times: number } }): string {
  if (finding.times === 1) {
    return `${finding.path}: ${finding.message}`;
  }
  return `${finding.path}: ${String(finding.times)} times — ${finding.message}`;
}

/** One voice cell per above-fold region, with each option's body split out from its structural letter. */
function voiceCells({
  fields,
  questionRaw,
}: {
  fields: ReadonlyMap<string, string>;
  questionRaw: string | undefined;
}): readonly { path: string; text: string }[] {
  const cells: { path: string; text: string }[] = [];
  if (questionRaw !== undefined) {
    cells.push({ path: "question", text: aboveFoldText({ html: questionRaw }) });
  }
  for (const field of ["what", "whyYou", "lean", "ifSilent"] as const) {
    const raw = fields.get(DL_FIELD_LABELS[field]);
    if (raw !== undefined) {
      cells.push({ path: field, text: aboveFoldText({ html: raw }) });
    }
  }
  const optionsRaw = fields.get("options");
  if (optionsRaw !== undefined) {
    for (const option of splitOptions({ text: aboveFoldText({ html: optionsRaw }) })) {
      cells.push({ path: `options.${option.letter}`, text: option.body });
    }
  }
  return cells.filter((cell) => cell.text.length > 0);
}

/** Every field a voice cell's path can name, keyed by the path head this module itself writes. */
const FIELD_OF_PATH: Readonly<Record<string, VoiceField>> = {
  ifSilent: "ifSilent",
  lean: "lean",
  options: "options",
  question: "question",
  what: "what",
  whyYou: "whyYou",
};

/** Which card field a voice cell's path belongs to, so a defect names a field a composer can go and fix. */
function fieldOfPath({ path }: { path: string }): VoiceField {
  const head = path.split(".")[0];
  if (head === undefined) {
    return "question";
  }
  const field = FIELD_OF_PATH[head];
  // A path head this module never writes cannot be attributed to a `dl.f` field, so the defect is reported
  // against the question rather than guessed onto one of them.
  if (field === undefined) {
    return "question";
  }
  return field;
}
