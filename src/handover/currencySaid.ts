/**
 * The currency reading's `said` half: the owner's own words for every turn a row names, once per turn, so a card quotes
 * the owner rather than printing a pointer (`./currency.ts` § {@link SaidText}).
 */
import type { IntakeReport } from "../supervisor/intake.js";
import type { VoiceRelayIntake } from "../talk/relayIntake.js";
import type { CurrencyRow, SaidText, VoiceUnread } from "./currency.js";
import type { StandingRead } from "./currencyStanding.js";
import { hisWordsExcerpt } from "./hisWords.js";

/**
 * One record's words as the reading stores them: the shared excerpt, with an end the SOURCE already lost marked cut
 * even when the excerpt itself kept everything it was given.
 *
 * @param text the owner's words as the source holds them
 * @param headLost the source kept only the end of what the owner said
 * @param tailLost the source kept only the start of what the owner said
 * @returns the words, or `undefined` when nothing but whitespace is left
 */
function saidText({
  text,
  headLost,
  tailLost,
}: {
  text: string;
  headLost: boolean;
  tailLost: boolean;
}): SaidText | undefined {
  const excerpt = hisWordsExcerpt({ headLost, text });
  if (excerpt === undefined) {
    return undefined;
  }
  if (tailLost && excerpt.cut === "none") {
    return { cut: "end", text: excerpt.words };
  }
  return { cut: excerpt.cut, text: excerpt.words };
}

/**
 * Every word each source read, by pointer, with which end of it the source's record lost.
 *
 * @param intake the chair's turns
 * @param relays the voice relays that never reached the chair
 * @param voice the call words the chair has not read
 * @param standing the owner's standing rulings, memories and owner profile
 * @returns one record per word, in source order
 */
function saidRecordsOf({
  intake,
  relays,
  voice,
  standing,
}: {
  intake: IntakeReport;
  relays: VoiceRelayIntake;
  voice: VoiceUnread;
  standing: StandingRead;
}): readonly { pointer: string; text: string; headLost: boolean; tailLost: boolean }[] {
  const records: { pointer: string; text: string; headLost: boolean; tailLost: boolean }[] = [];
  if (intake.kind === "read") {
    for (const { turn } of intake.finding.turns) {
      records.push({ headLost: false, pointer: turn.pointer, tailLost: turn.tailCut === true, text: turn.text });
    }
  }
  if (relays.kind === "read") {
    for (const relay of relays.relays) {
      records.push({
        headLost: relay.heardTruncated === true,
        pointer: relay.anchor,
        tailLost: relay.heardTailCut === true,
        text: relay.heard,
      });
    }
  }
  if (voice.kind === "read") {
    for (const word of voice.words) {
      records.push({ headLost: false, pointer: word.pointer, tailLost: word.cut, text: word.text });
    }
  }
  for (const entry of standing.entries) {
    records.push({ headLost: false, pointer: entry.pointer, tailLost: false, text: entry.text });
  }
  return records;
}

/**
 * The owner's words for every pointer the rows name — a chair turn's text, a call word's text, what the voice heard on a
 * relay — once each, and nothing for a pointer no row names.
 *
 * @param rows the cards' readings, whose words name the pointers
 * @param intake the chair's turns
 * @param relays the voice relays that never reached the chair
 * @param voice the call words the chair has not read
 * @param standing the owner's standing rulings, memories and owner profile, which a row's standing changes name
 * @returns the words by pointer
 */
export function saidOf({
  rows,
  intake,
  relays,
  voice,
  standing,
}: {
  rows: readonly CurrencyRow[];
  intake: IntakeReport;
  relays: VoiceRelayIntake;
  voice: VoiceUnread;
  standing: StandingRead;
}): Readonly<Record<string, SaidText>> {
  const named = new Set(rows.flatMap((row) => [...row.since.words, ...row.since.standing].map((each) => each.pointer)));
  const said: Record<string, SaidText> = {};
  for (const { pointer, text, headLost, tailLost } of saidRecordsOf({ intake, relays, standing, voice })) {
    const shaped = named.has(pointer) ? saidText({ headLost, tailLost, text }) : undefined;
    if (shaped !== undefined) {
      said[pointer] = shaped;
    }
  }
  return said;
}
