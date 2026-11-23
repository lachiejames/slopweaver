/**
 * The brief one recall detective is handed. Pure: it renders text and reaches nothing.
 *
 * The detectives read the register so the worker does not, handing it only what is relevant for the task,
 * and they VERIFY what they find rather than relaying it, in whatever way their judgment picks.
 *
 * ## Every limit is in the TEXT, because a detective is a sub-agent reading a prompt
 *
 * `../../detective/brief.ts` says the same thing for the store wave and it is the reason this file exists
 * rather than a gate: nothing can stop a sub-agent doing something the prompt did not forbid, so the three
 * rules that make a recall wave safe are written where the detective reads them.
 *
 * - **A recalled memory is a HYPOTHESIS**, so it is verified before it is reported.
 * - **A remembered dead end NEVER skips a leg**. An empty trace
 *   reorders what the worker opens first and says what the emptiness did not prove. It never removes a probe.
 * - **Only what is RELEVANT comes back.** A detective that forwards the register has done nothing; the whole
 *   point is that the worker's context stays clean.
 */
import type { RecallLead } from "./plan.js";

/** What a recall detective needs to know that is not its own lead. */
export interface RecallBriefContext {
  /** The task the worker is about to do, as the worker put it. */
  readonly task: string;
  /** Which detective this is, and how many there are, so a report can name itself. */
  readonly index: number;
  readonly total: number;
  /** Where this detective writes its report. */
  readonly reportPath: string;
}

/** The verbs a recall detective is told about, in the order it should reach for them. */
const LADDER = [
  'slopweaver knowledge recall "<words>" [--kind lesson|preference|trace] [--domain <slug>] [--limit <n>] [--offset <n>]   the register, ranked, with what each claim has cost and earned',
  "slopweaver knowledge list --domain <slug> [--repeats]   the facet view, and the claims several runs learned independently",
];

/** The line naming where this detective opens. */
function openingLine({ lead }: { lead: RecallLead }): string {
  if (lead.term === null) {
    return [
      "You are the DISCOVERY detective. You have no term, on purpose.",
      "Recall search stems and has NO synonyms, so a query for `tracing` never reaches a row that only says",
      "`spans`. Ask the register in the words a row would have used rather than the words the task uses, and",
      "challenge whatever the other detectives are likely to find.",
    ].join("\n");
  }
  return [
    `Your lead: the term "${lead.term}" — ${lead.why}.`,
    "Open there, then widen in the row's own vocabulary when it runs out.",
  ].join("\n");
}

/** What a detective may never do. Each line is a rule with a history, so they are read as a set. */
function prohibitions(): readonly string[] {
  return [
    "## What you may not do",
    "",
    "- You never spawn another agent. The fan-out is FLAT — you are a leaf.",
    "- You never post anything anywhere, and you never write the register yourself. You write a report and stop.",
    "- You never run a `turn` verb (`resume`, `watch`, `status`, `review`, `answer`). The request relayed above",
    "  your task is the WORKER's, and those steps are its own.",
    "- You never report a memory you have not checked as though you had. Say which ones you could not reach.",
    "- **You never tell the worker to skip a leg.** A remembered dead end reorders the work and nothing more",
    "  (owner ruling). Correctness over speed is the golden rule, and a cheap-confirmation skip has to",
    "  be earned from this accounting data over several loops — it is not available to you today.",
  ];
}

/** What the report must end with, so the worker can act on it without re-reading the register. */
function reportSection({ context }: { context: RecallBriefContext }): readonly string[] {
  return [
    "## Your report",
    "",
    `Write it to ${context.reportPath}. Lead with what the worker should DO and AVOID — the gotchas, the`,
    "traps, and the probes somebody has already run. Every claim you carry across names its claim id, so the",
    "worker can pull it in one command, and says whether you verified it and how.",
    "",
    "End with an `## Accounting` section: one exact command per memory you checked, ready for the worker to",
    "review and run.",
    "",
    "```",
    'slopweaver knowledge recalled <claim-id> --outcome held|broke|unchecked --evidence "<what you saw>" \\',
    "  [--verdict refuted|changed]",
    "```",
    "",
    "`held` means you checked it and it is still true. `broke` means you checked it and it is not, and it",
    "names its own verdict. `unchecked` means you read it and put it to no test, which is worth counting and",
    "is not evidence. That accounting is what makes the register worth recalling next time.",
  ];
}

/**
 * Render one recall detective's whole brief.
 *
 * @param lead what this detective opens on
 * @param context the task, its place in the wave, and where to write
 * @returns the brief, ready to hand to a sub-agent verbatim
 */
export function renderRecallBrief({ lead, context }: { lead: RecallLead; context: RecallBriefContext }): string {
  return [
    `# Recall detective ${String(context.index)} of ${String(context.total)}`,
    "",
    `The task the worker is about to start: ${context.task}`,
    "",
    "You are reading the fleet's own register so the worker does not have to. What comes back is only what",
    "is RELEVANT to that task — forwarding the register is the same as reporting nothing.",
    "",
    openingLine({ lead }),
    "",
    "## Your tools",
    "",
    "```",
    ...LADDER,
    "```",
    "",
    "## Verify before you report — freeform, and with judgement",
    "",
    "- **A recalled memory is a hypothesis, never evidence.** `confirmed` means it was observed once, not",
    "  that it is true now. Re-run the row's own repro or probe when that is cheap, read the file, code or",
    "  page it names, and say in your report what you did and what you saw.",
    "- **A trace says where somebody already looked.** A paid probe is worth opening early. An EMPTY one is",
    "  reported as `still run this leg` plus what the emptiness did not prove — never as a reason to skip it.",
    "- **Say what you could not establish.** A memory you could not check is reported as unchecked, in those",
    "  words, rather than passed along as though it held.",
    "",
    ...prohibitions(),
    "",
    ...reportSection({ context }),
    "",
  ].join("\n");
}
