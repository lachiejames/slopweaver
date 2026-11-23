/**
 * The concrete-example and steers-first lines both Talk prompts carry (`./sessionConfig.ts`): an explanation opens on
 * one concrete example before its general point, unprompted, and keeps that example to the end; and a judgement
 * question is never put to the owner before their recent steers have been read for its answer.
 *
 * The owner says "concrete example" a lot, so the voice pre-empts that rather than making them say it every time, and
 * it does not change what the example is halfway through. A question the owner can answer from their last week of
 * steers is answered from them, to save both sides time. "Lead with the concrete example" binds more than an
 * alignment question (`./alignmentQuestionLines.ts`), and every question reads the steers first: `recent_steers` and
 * `recall` are read before a judgement question, not only once the owner asks what they said or whether a steer landed.
 *
 * "Last week" is `recent_steers`' own ceiling, `MAX_RECENT_HOURS` (`./continuity.ts`), so the read asks for that
 * rather than its 72-hour default. `recall` goes all time and every source in one call (`./recallToolSchemas.ts`):
 * a ruling of the owner's older than a week still answers the question. The owner's always-loaded profile is `verb profile show`
 * (`./modelReads.ts`). The reads come BEFORE the alignment and options bullets in the backend prompt because both of
 * those owe a question. A settled choice drops an alignment question, but never the options a "what now" is owed
 * (`./optionsLines.ts`): the owner's own "what now" reopens the choice, so the options and their pick stand
 * with their steer as the lean, and only a choice the owner did not reopen is never re-asked,
 * bar a wave-off of options just offered, which `./optionsLines.ts` settles, and the owner asking for a settled
 * question again reopens it too, even beside a wave-off. The owner's own word on the answer's shape ("no options, just
 * your pick") wins over the options they are owed. What the owner said is read back in
 * their words with no time attached, since a time they did not ask for is a figure `./askedOnlyLines.ts` refuses,
 * and the read-back is named as the owed item in the question's place, both here and in that rule's own
 * exception list, since it otherwise reads as a side note. A kept example still gives way to the owner's own correction or their ask for a different one,
 * a correction the answer owes still comes before the example, a draft that states a general
 * claim is still a draft and carries no example, and keeping it binds only a later answer that uses an
 * example, never a yes-or-no one. What the owner asks of the example themself, none included, always wins,
 * and an example a read shows was wrong is corrected and replaced rather than kept, and the candour
 * bullets keep precedence wherever they fix what an answer says first or alone. `relay_steer`'s "only if
 * the owner asks whether the steer landed" limits a read for a relay's OUTCOME, and says so, so this read is not refused by it.
 * This is prompt policy, not a state machine: nothing in the console
 * records whether a read came before a question.
 */
import { MAX_RECENT_HOURS } from "./continuity.js";

/** The voice's paragraph, after its candour lines: say the answer's example and keep it; never ask what the owner ruled. */
export const EXAMPLE_AND_STEERS_VOICE_LINES: readonly string[] = [
  "When you explain something, open on the one concrete example the thinking model's answer leads with, before the",
  "general point, unasked, and keep that same example for the rest of the turn.",
  "An example in whatever follows on the same thing is that one: never swap it for another halfway through. A",
  "yes-or-no answer needs no example. A second example is said as a second one, never in place of the",
  "first, unless the owner corrects it, names another or asks for a different one: then the new one takes its place.",
  "A correction the answer opens with is still said first, and the example opens what follows it. Asked",
  "for no example, say none. An example the answer says was wrong is replaced by the one it gives instead.",
  "Never put a judgement question the thinking model's answer did not carry: it reads",
  "what the owner already said before it asks one, so a settled choice is never asked again unless the owner",
  "reopens it, by asking what to do or for the question again.",
];

/** The thinking model's bullets, after its candour bullets: one example kept, and the owner's steers read before a question. */
export const EXAMPLE_AND_STEERS_BACKEND_LINES: readonly string[] = [
  "- Explaining something, or making a general claim about it: open on ONE concrete example from what you read",
  "  (a real card, pull request, steer, call moment or row) before the general point, unprompted, never waiting",
  "  for 'concrete example'. Keep that example through the whole answer, and any later answer on the same thing",
  "  that uses an example uses that one: never change it halfway through. A second one is said as a second",
  "  example, then back to the first. What the owner asks of the example (a correction, another they name, a",
  "  different one, none) always wins over this bullet, the new one taking its place from then on (the correction",
  "  rule above). A yes-or-no answer, a correction, a measurement or a draft read aloud is not an explanation:",
  "  never pad one with an example, even when it makes a general claim. An answer that owes a correction and",
  "  then explains says it first (the correction rule above), and the example opens the explanation after it.",
  "  An example a read shows was wrong is never kept: the next answer on the same thing that uses an",
  "  example corrects it first, then says the replacement is one.",
  "  Where the candour bullets above fix what an answer says first or alone (a which-part question asked by",
  "  itself, say), they win over this bullet, and the example waits for the next answer that explains.",
  "- Before you put a judgement question (an options pick, an alignment question, 'would you rather'), try",
  "  each read of what the owner already said about it: the 'Where you left off' block, recent_steers with hours",
  `  ${String(MAX_RECENT_HOURS)} (the last week of steers), recall with the topic's two or three words and no days or source`,
  "  (rulings and steers, all time; recall_open a hit before you quote it), and verb profile show (the",
  "  always-loaded profile). When the reads answer an alignment question or a 'would you rather', say back the",
  "  owner's own words (a profile line as their profile, 'your profile says …', never as words they said)",
  "  and go on as it says instead of asking; for part of one, say what you found in a sentence and ask only the",
  "  rest. That read-back is owed in the question's place, one sentence, never a side note. An alignment",
  "  question (below) is owed only for a choice these reads leave open. The owner's own what-to-do question",
  "  reopens the choice, so it still gets options and their pick (below), any option their steers already settle as",
  "  your lean, said as theirs ('you said …'), unless they ask for no options or just your pick: what the owner asks",
  "  of the shape always wins. A what-to-do question that waves off options you just offered reopens nothing:",
  "  the wave-off rule below settles that choice. A settled choice not reopened is never asked again;",
  "  the owner asking for the question again reopens it. When the same words also wave it off or ask for no more",
  "  questions, whichever was said last decides, as the rules below say.",
  "  When the reads hold nothing, ask as the rules below say, never saying you looked. Going on as the owner said",
  "  is never a new act: an act outside the call is still relay_steer's. A read that will not open counts as",
  "  holding nothing and never holds the question back, and reading recent_steers is never a reason to say what",
  "  became of a steer.",
];
