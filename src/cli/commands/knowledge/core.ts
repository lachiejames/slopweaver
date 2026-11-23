/**
 * Usage text for the `knowledge` noun, and the flag spec and parse of `quiz-answer` and `answer`. Pure: no I/O,
 * no clock.
 *
 * Kept apart from the two verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../grant/core.ts` does. Every other per-claim verb keeps its flag spec and parse in
 * `./flagSpecs.ts`, and the four verbs that move the whole register keep theirs in `./registerArgs.ts`.
 */
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `knowledge`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const QUIZ_ANSWER_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["answer", "run", "home"],
};

const ANSWER_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["mark", "why", "correction", "run", "home"],
};

/** `--`-prefixed quiz-answer flags, for the help-truth ratchet. */
export const KNOWLEDGE_QUIZ_ANSWER_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: QUIZ_ANSWER_FLAGS }),
  ...booleanFlagsOf({ spec: QUIZ_ANSWER_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed answer flags, for the help-truth ratchet. */
export const KNOWLEDGE_ANSWER_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: ANSWER_FLAGS }),
  ...booleanFlagsOf({ spec: ANSWER_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** What `knowledge detect --help` prints. */
export const DETECT_USAGE =
  "usage: slopweaver knowledge detect <the task> --term <word> [--term <word> ...] [--slots <n>] \\\n" +
  "         [--ask <channel>/<messageTs> | --out <dir>] [--json]\n" +
  "\n" +
  "Plan a RECALL WAVE: how many Haiku detectives read the register for this task, and what each opens on.\n" +
  "Detectives read the register so the worker does not, and the worker's context\n" +
  "stays clean. This verb counts, plans and writes the briefs. It spawns nothing: you do that.\n" +
  "\n" +
  "  --term    one word the task names, once per flag. A term the register does not match is not a lead\n" +
  "  --slots   your own remaining capacity, when it is smaller than the ceiling\n" +
  "  --ask     the bot turn this wave serves — briefs, reports and wave.json land in its record set, which\n" +
  "            `turn freeze` carries. Without it (and without --out) the wave lands under the detective root\n" +
  "  --out     where the briefs and reports go instead; refused alongside --ask\n" +
  "\n" +
  "  One lead per term that matches something, plus ONE discovery detective always — search stems and has\n" +
  "  no synonyms, so the discovery lead asks in words the task did not use. It is the whole wave when\n" +
  "  nothing matched, which is honest where a confident silence would not be.";

/** What `knowledge recalled --help` prints. */
export const RECALLED_USAGE =
  "usage: slopweaver knowledge recalled <claim-id> --outcome held|broke|unchecked --evidence <text> \\\n" +
  "         [--verdict refuted|changed] [--run <slug>] [--json]\n" +
  "\n" +
  "Account for a memory this session leaned on, and regrade it at the moment the evidence is in hand\n" +
  ". The accounting row and the regrading recording land in ONE transaction.\n" +
  "\n" +
  "  --outcome   held (you checked and it is still true), broke (you checked and it is not), or\n" +
  "              unchecked (you read it and put it to no test — worth counting, not evidence)\n" +
  "  --verdict   REQUIRED when it broke, refused otherwise: refuted (not true) or changed (still a trap,\n" +
  "              but the numbers, names or endpoint moved). There is no default — they say different things\n" +
  "  --evidence  what you observed, or what you did instead of checking\n" +
  "  --run       the board row you are on; defaults to ad-hoc\n" +
  "\n" +
  "  A recall never deletes. A held claim outranks an unrecalled one on the next recall page — retention\n" +
  "  earned by use REORDERS the page and never narrows it.";

/** What `knowledge trace --help` prints. */
export const TRACE_USAGE =
  "usage: slopweaver knowledge trace --domain <slug> --question <text> --probe <cmd> --outcome paid|empty \\\n" +
  "         --evidence <text> [--does-not-prove <text>] [--learner fleet|owner] [--run <slug>] [--redact] [--json]\n" +
  "\n" +
  "Write ONE trace into the memories table: where an investigation looked, and what came back. Not a lesson —\n" +
  "a lesson generalises, a trace only reports, which is what makes it falsifiable.\n" +
  "\n" +
  "  --probe           the EXACT command, pasteable — it is what settles the trace again\n" +
  "  --outcome         paid (it returned something worth reading) or empty (it did not)\n" +
  "  --does-not-prove  required for an empty probe: what the emptiness does not establish\n" +
  "  --learner         defaults to fleet — an investigation's own trace\n" +
  "\n" +
  "  The claim, the behaviour change and the retrieval cue are derived from the probe, the question and the\n" +
  "  outcome, so the same probe for the same question recorded again is the same claim, and a flip from\n" +
  "  empty to paid shows in its history. A remembered dead end never skips a leg: it reorders the work.";

/**
 * Parse `knowledge quiz-answer`'s flags.
 *
 * Positionals are KEPT, because the question id they name is one — the same call `knowledge answer` makes.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeQuizAnswerArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: QUIZ_ANSWER_FLAGS });
}

/**
 * Parse `knowledge answer`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeAnswerArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  // Positionals are KEPT, because the proposal id they name is one. Every other knowledge verb takes its
  // subject as a flag; this one takes it the way `knowledge recall` takes its words, since the id is what
  // they actually say back and a `--proposal` in front of it would be ceremony on a relay.
  return parseFlags({ allowPositionals: true, args: rest, spec: ANSWER_FLAGS });
}

/** What `knowledge record --help` prints. */
export const RECORD_USAGE =
  "usage: slopweaver knowledge record --domain <slug> --claim <text> --verdict confirmed|changed|refuted|untestable|unsettled \\\n" +
  "         --tier 1|2|3|4 --surface api|browser|cli|repo|process --evidence <text> \\\n" +
  "         [--learner fleet|owner] [--repro <command>] [--caveat <text>] [--run <slug>] [--home <dir>] \\\n" +
  "         [--supersedes <claim-id>] [--behaviour-change <text>] [--retrieval-cue <text>] [--redact] [--json]\n" +
  "\n" +
  "Records ONE lesson in the memories table, which needs the store reachable — an unreachable store is a\n" +
  "non-zero exit carrying the reason, never a row that landed nowhere. A lesson is something an\n" +
  "investigation PAID FOR: not re-derivable by a fresh read of the system, and able to be wrong later. If a\n" +
  "fresh API call or file read would give it to the next session, it belongs in an atlas or the corpus instead.\n" +
  "\n" +
  "  --claim     one sentence, phrased so it is true or false rather than merely interesting\n" +
  "  --evidence  what you actually OBSERVED. Never the claim restated\n" +
  "  --repro     the command that settles it again — what makes a re-check a job, not a re-investigation\n" +
  '  --caveat    what the evidence does NOT establish. Omit it rather than writing "none"\n' +
  "  --run       the board row this was learned on; defaults to ad-hoc\n" +
  "  --supersedes  the id of an earlier claim of the same kind this one RETIRES. Recall and list stop\n" +
  "              returning it; re-recording it later brings it back. Copy the id from `knowledge recall`\n" +
  "  --domain    one of `slopweaver knowledge domains`; a folded-in alias is refused naming its home\n" +
  "  --learner   whose lesson it is. Defaults to fleet. `owner` means THEY hold the belief — a claim about\n" +
  "              their own system that they made, recorded on their behalf, and the owner's to correct later\n" +
  "  --behaviour-change  what the next agent does differently for having read this. OPTIONAL here — a\n" +
  "              caller that has not answered the placement question leaves it out, and the row carries\n" +
  "              NULL rather than a guess. `knowledge remember` is the verb that requires it\n" +
  "  --retrieval-cue     the words a task would mention for this to be worth recalling. Optional, likewise\n" +
  "  --redact    redact the row as `knowledge redact` would before it lands; the printed id is the stored one\n" +
  "\n" +
  "  tier 1  irreversible harm, or a measured wrong answer returned as success\n" +
  "  tier 2  silent failure — a wrong answer with no error raised\n" +
  "  tier 3  loud failure — cost, a rate limit, a 404\n" +
  "  tier 4  a convention, a recipe, or a snapshot that moves";

/** What `knowledge list --help` prints. */
export const LIST_USAGE =
  "usage: slopweaver knowledge list [--domain <slug>] [--verdict <v>] [--tier 1|2|3|4] [--surface <s>] \\\n" +
  "         [--learner fleet|owner] [--run <slug>] [--repeats] [--home <dir>] [--json]\n" +
  "\n" +
  "Reads the register from local state. No network, no model.\n" +
  "\n" +
  "  --learner  whose rows to read: the fleet's, or the owner's. Unfiltered shows both, each row labelled.\n" +
  "  --repeats  only lessons recorded MORE THAN ONCE, most-repeated first. A lesson several sessions\n" +
  "             have learned independently is the signal to make it a standing rule or a gate, so no\n" +
  "             future session has to learn it again. It defaults to --learner fleet, because a row of the owner's\n" +
  "             and a row of the fleet's share an id and counting them together would report a repeat\n" +
  "             nobody made.";

/** What `knowledge recall --help` prints. */
export const RECALL_USAGE =
  "usage: slopweaver knowledge recall <words a task mentions> [--domain <slug>] [--kind lesson|preference|trace] \\\n" +
  "         [--learner <who>] [--limit <n>] [--offset <n>] [--json]\n" +
  "\n" +
  "Think back. Full-text search over the memories table — run it EARLY, before investigating a system,\n" +
  "not after the work has gone wrong. Reads Postgres; refuses rather than reporting an empty page when\n" +
  "the store is unreachable, because those two answers lead to opposite next actions.\n" +
  "\n" +
  "  Search stems (sampling matches sampled) and has NO synonyms. A thin page means ask again in the\n" +
  "  words the row itself would have used — it never means nothing was learned here.";

/** What `knowledge remember --help` prints. */
export const REMEMBER_USAGE =
  "usage: slopweaver knowledge remember --kind lesson|preference --placement retrieved \\\n" +
  "         --domain <slug> --claim <text> --evidence <text> --verdict <v> --learner <who> \\\n" +
  "         --behaviour-change <text> --retrieval-cue <text> \\\n" +
  "         [--tier 1|2|3|4 --surface api|browser|cli|repo|process] [--repro <cmd>] [--caveat <text>] \\\n" +
  "         [--run <slug>] [--supersedes <claim-id>] [--redact] [--json]\n" +
  "\n" +
  "Write ONE memory into the RETRIEVED table — the destination most learnings belong in. Read\n" +
  "skills/knowledge/reference/placement.md before you do: it is the one text on where a thing goes.\n" +
  "\n" +
  "  --placement        has no default, and every answer but `retrieved` is refused with the real\n" +
  "                     destination named. Answering is the point; the answer is a reviewable claim\n" +
  "  --behaviour-change what the NEXT agent does differently for having read this\n" +
  "  --retrieval-cue    the words a task would have to mention for this to be worth recalling\n" +
  "  --learner          who learned it — the fleet, or the owner\n" +
  "  --tier/--surface   a LESSON carries both; a PREFERENCE carries neither, and passing one is refused\n" +
  "  --supersedes       an earlier claim of the same kind this one retires from recall and list\n" +
  "  --redact           run the row through `knowledge redact`'s rewrite before it lands\n" +
  "\n" +
  "  A lesson was paid for, is not re-derivable by a fresh read, and can be wrong later. A preference is\n" +
  "  the owner's, anchored to something they actually said, and none of those three things.\n" +
  "\n" +
  "  `knowledge record` is a DIFFERENT verb writing a DIFFERENT place — the append-only lessons file the\n" +
  "  settle gate reads. The fold happens after the backup destination entry clears; it is blocked on\n" +
  "  the backup leg and the live store's migration baseline — two board rows. Until then, both stand.";

/** What `knowledge voice --help` prints. */
export const VOICE_USAGE =
  "usage: slopweaver knowledge voice [--batch <n>] [--source tick-ledger|archive-turn|scratch-turn] \\\n" +
  "         [--out <path>] [--home <dir>] [--json]\n" +
  "\n" +
  "Hands you a bounded batch of THEIR OWN recorded words to read. It proposes nothing and runs no model:\n" +
  "the owner's voice dumps are the source of proposed beliefs, and reading one is a judgement\n" +
  "only a visible session can make. Answer each unit with `knowledge propose`.\n" +
  "\n" +
  "  --batch    how many units to hand over; defaults to 5, because you are going to read them\n" +
  "  --source   read one family instead of all three. The tick ledger is structured and carries an\n" +
  "             instant; an archived turn file is durable; a scratch turn file is copied forward per\n" +
  "             handoff, which is why the same words appear thousands of times\n" +
  "  --out      pin this batch to a file, which `knowledge propose --from` checks a quote against\n" +
  "\n" +
  "Read the watermark first. How many units the scan found and how much of what they have said this\n" +
  "installation holds are different claims, and only the first is one this verb can make.";

/** What `knowledge quiz --help` prints. */
export const QUIZ_USAGE =
  "usage: slopweaver knowledge quiz --sweep <tick-id> [--home <dir>] [--json]\n" +
  "\n" +
  "Cuts THIS sweep's one question out of the fleet's own register, or prints the one it already cut.\n" +
  "One quiz question on the briefing per sweep. Idempotent per sweep by construction —\n" +
  "the page they are reading carries the question's id, and their answer names it.\n" +
  "\n" +
  "  --sweep    the supervisor tick this question belongs to. Required: a verb that invented one would cut\n" +
  "             a question no page ever showed them\n" +
  "\n" +
  "  Only a `confirmed` or `refuted` FLEET lesson can be asked about — a quiz needs an unambiguous\n" +
  "  reference answer, and `unsettled` means the fleet has already said no call could settle the claim.\n" +
  "  The selection is a mechanical rotation, never a reading: least-asked, oldest-asked, worst tier first.\n" +
  "\n" +
  "A register with no eligible lesson records an EMPTY row and says so, which is what stops the next\n" +
  "render re-cutting the same sweep forever.";

/** What `knowledge quiz-answer --help` prints. */
export const QUIZ_ANSWER_USAGE =
  'usage: slopweaver knowledge quiz-answer <quiz-id> --answer "<their exact words>" \\\n' +
  "         [--run <slug>] [--home <dir>] [--json]\n" +
  "\n" +
  "Records what THEY said about this sweep's question. It stores their words and grades NOTHING: deciding\n" +
  "whether their answer is right means assessing the claim, which is a judgement a visible session makes and\n" +
  "records with `knowledge record --learner owner`, supplying a verdict and evidence of its own.\n" +
  "\n" +
  "  --answer   THEIR words, not a session's summary of them\n" +
  "\n" +
  "A second answer to one question is refused. What they said is never overwritten, and a changed mind\n" +
  "belongs in the next sweep — which asks a different question anyway.";

/** What `knowledge answer --help` prints. */
export const ANSWER_USAGE =
  'usage: slopweaver knowledge answer <proposal-id> --mark right|wrong|partly --why "<their words>" \\\n' +
  "         [--correction <text>] [--run <slug>] [--home <dir>] [--json]\n" +
  "\n" +
  "Records what THEY said about one proposed belief — the other end of the briefing's correction block.\n" +
  "The page cannot call back, so their mark reaches the fleet the way every answer of the owner's does: they say it\n" +
  "to the pinned supervisor and a visible session writes it down here.\n" +
  "\n" +
  "  --mark        right, wrong or partly. It is their REACTION, not a verdict: `right` says the fleet read\n" +
  "                their knowledge correctly, never that the claim is true\n" +
  "  --why         THEIR words about it, not a session's summary of them. `right` on its own is a fine answer\n" +
  "  --correction  what they say the claim should have said. Only when they supplied one, never inferred\n" +
  "\n" +
  "Recording their answer records no register row. A lesson owes a verdict and evidence that was OBSERVED,\n" +
  "and neither can be made up from a mark — `knowledge record --learner owner` is the explicit second step.";

/** What `knowledge propose --help` prints. */
export const PROPOSE_USAGE =
  "usage: slopweaver knowledge propose --from <batch> --unit <id> \\\n" +
  "         --domain <slug> --claim <text> --quote <text> --held stated-uncertain|stated-confident \\\n" +
  "         [--run <slug>] [--home <dir>] [--json]\n" +
  "   or: slopweaver knowledge propose --from <batch> --unit <id> --none <why> [--run <slug>] [--json]\n" +
  "\n" +
  "Records what you read out of ONE unit of their speech, into the proposal queue at\n" +
  "$SLOPWEAVER_HOME/knowledge/proposals.jsonl. A proposal is NOT a lesson: a lesson owes evidence that was\n" +
  "observed, a tier and a verdict, and none of the three can be honestly made up from something they said.\n" +
  "It becomes a row of the owner's in the register once THEY have answered it.\n" +
  "\n" +
  "  --quote    the span of THEIR words the claim was read from. Verified to occur in the pinned unit;\n" +
  "             a tidied or paraphrased quote is refused rather than recorded\n" +
  "  --held     stated-uncertain is a belief they flagged as a guess, stated-confident is one they asserted.\n" +
  "             The second is the one a quiz catches, because they would never have thought to ask\n" +
  "  --none     this unit carried no falsifiable belief, and WHY. A first-class answer, not a skip:\n" +
  "             it is what lets the queue finish rather than re-offering the same units forever";
