/**
 * `slopweaver knowledge detect` — plan a recall wave: how many Haiku detectives read the register for this
 * task, and what each one opens on.
 *
 * Recall is a VERB, and the reading is
 * done by detectives rather than by the worker, so the worker's context stays clean.
 *
 * Like `../store/detect.ts`, this verb DECIDES the wave and launches nothing: it counts, plans, writes one
 * brief per detective and prints the spawn instruction. The visible session spawns the sub-agents itself,
 * which is what keeps rule 2 — no headless model, anywhere — a property of the architecture.
 */
import { join } from "node:path";

import { WAVE_RECORD_FILE, type WaveRoots, waveOutFromFlags, waveRoots } from "../../../detective/waveHome.js";
import { renderRecallBrief } from "../../../knowledge/detect/brief.js";
import { planRecallWave, type RecallLead, type RecallWave } from "../../../knowledge/detect/plan.js";
import { countTermMatches } from "../../../knowledge/memoryStore.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { repeatedFlagValues } from "../../parseFlags.js";

import { DETECT_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeDetectArgs } from "./flagSpecs.js";

/** What one `knowledge detect` invocation asked for. */
export interface DetectArgs {
  readonly task: string;
  readonly terms: readonly string[];
  readonly slots: number | undefined;
  readonly out: string;
  /** Why {@link DetectArgs.out} is somewhere `turn freeze` will not look, or nothing when it is not. */
  readonly outNote: string | null;
  readonly json: boolean;
}

/** One detective's assignment, as the wave writes it down. */
export interface Assignment {
  readonly brief: string;
  readonly report: string;
  readonly lead: RecallLead;
}

/**
 * What the invocation asked for, or every reason it was refused.
 *
 * @param rest the verb's own argv tail
 * @param values the parsed single-value flags
 * @param positionals the argv positionals — the task is all of them, joined
 * @param roots where a wave lands when the caller names no directory — the turn's record set with `--ask`
 * @param nowMs the planning instant, which names the wave's directory
 * @returns the arguments, or the refusals to print
 */
export function detectArgs({
  rest,
  values,
  positionals,
  roots,
  nowMs,
}: {
  rest: readonly string[];
  values: Readonly<Record<string, unknown>>;
  positionals: readonly string[];
  roots: WaveRoots;
  nowMs: number;
}):
  | { readonly args: DetectArgs; readonly refusals?: undefined }
  | { readonly args?: undefined; readonly refusals: readonly string[] } {
  const task = positionals.join(" ").trim();
  const terms = repeatedFlagValues({ name: "term", rest });
  const rawSlots = values["slots"];
  let slots: number | undefined;
  if (typeof rawSlots === "string") {
    slots = Number(rawSlots);
  }
  const landing = waveOutFromFlags({ kind: "recall", nowMs, roots, values });
  const refusals = [
    ...(task.length === 0 ? ["name the task — a wave with no task briefs nobody"] : []),
    ...(terms.length === 0 ? ["--term is required, once per word the task names"] : []),
    ...(slots !== undefined && (!Number.isInteger(slots) || slots < 1)
      ? [`--slots must be a whole number of at least 1, not "${String(rawSlots)}"`]
      : []),
    ...(landing.isErr() ? landing.error : []),
  ];
  if (refusals.length > 0 || landing.isErr()) {
    return { refusals };
  }
  return {
    args: { json: values["json"] === true, out: landing.value.out, outNote: landing.value.note, slots, task, terms },
  };
}

/**
 * Write one brief per detective and hand back where each one lives.
 *
 * Atomic, for `../store/detect.ts`'s reason: a brief half-written by a crash is one a sub-agent would read
 * and act on, and a partly-rendered lead is worse than a missing one.
 *
 * @param args what the invocation asked for
 * @param wave the leads this wave is spawning for
 * @returns one assignment per detective, in spawn order
 */
export function writeBriefs({ args, wave }: { args: DetectArgs; wave: RecallWave }): readonly Assignment[] {
  return wave.leads.map((lead, index) => {
    const ordinal = String(index + 1);
    const report = join(args.out, `report-${ordinal}.md`);
    const brief = join(args.out, `detective-${ordinal}.md`);
    writeFileAtomic({
      contents: renderRecallBrief({
        context: { index: index + 1, reportPath: report, task: args.task, total: wave.leads.length },
        lead,
      }),
      path: brief,
    });
    return { brief, lead, report };
  });
}

/**
 * Write the wave's own record beside its briefs — the one file of a wave `turn freeze` carries.
 *
 * The same record `../store/detect.ts` writes, for its reason: the briefs and reports are prose a fixture's
 * allowlist redactor cannot make safe to commit, so a frozen turn keeps the wave's shape — how many
 * detectives, which term each opened on, where each report lives — dated by `recordedAtIso`.
 *
 * @param args what the invocation asked for
 * @param briefs where each detective's brief and report live
 * @param wave the leads and anything deferred past the ceiling
 * @param recordedAtIso the planning instant
 */
export function writeWaveRecord({
  args,
  briefs,
  wave,
  recordedAtIso,
}: {
  args: DetectArgs;
  briefs: readonly Assignment[];
  wave: RecallWave;
  recordedAtIso: string;
}): void {
  writeFileAtomic({
    contents: `${safeJsonStringify({
      label: "knowledge detect wave record",
      space: 2,
      value: {
        assignments: briefs.map((each) => ({ briefPath: each.brief, reportPath: each.report, term: each.lead.term })),
        deferred: wave.deferred.length,
        detectives: wave.leads.length,
        kind: "recall-wave",
        recordedAtIso,
        task: args.task,
        terms: args.terms,
      },
    })}\n`,
    path: join(args.out, WAVE_RECORD_FILE),
  });
}

/**
 * How one lead is named in the report — its term, or the discovery lead said in words.
 *
 * An `if` rather than `??`: the discovery lead has no term BY DESIGN, and naming that case is the whole
 * difference between a missing value and a deliberate one (`no-silent-fallback`).
 *
 * @param lead the lead to label
 * @returns the term, or the discovery label
 */
function leadLabel({ lead }: { lead: RecallLead }): string {
  if (lead.term === null) {
    return "(discovery)";
  }
  return lead.term;
}

/**
 * The report a planned wave prints.
 *
 * @param briefs where each detective's brief and report live
 * @param task the task the wave is reading for
 * @param wave the leads and anything deferred past the ceiling
 * @param outNote why the wave's directory is somewhere `turn freeze` will not look, or nothing
 * @returns the lines
 */
export function waveLines({
  briefs,
  task,
  wave,
  outNote,
}: {
  briefs: readonly Assignment[];
  task: string;
  wave: RecallWave;
  outNote: string | null;
}): readonly string[] {
  const deferred =
    wave.deferred.length === 0
      ? []
      : [`${String(wave.deferred.length)} lead(s) deferred past the ceiling — carried, not dropped`];
  return [
    `${String(wave.leads.length)} recall detective(s) for "${task}"`,
    "",
    ...briefs.map((each, index) =>
      [
        `${String(index + 1).padStart(3)}. ${leadLabel({ lead: each.lead })} — ${each.lead.why}`,
        `     brief: ${each.brief}`,
        `     report: ${each.report}`,
      ].join("\n"),
    ),
    "",
    ...deferred,
    ...(outNote === null ? [] : [outNote]),
    "Spawn one sub-agent per brief, model haiku, IN PROCESS. Never let one spawn another.",
    "Read the reports yourself, then run the `knowledge recalled` commands they end with.",
  ];
}

/**
 * Run `knowledge detect`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeDetect(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DETECT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeDetectArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: DETECT_USAGE });
    return EXIT_USAGE;
  }
  const { positionals, values } = parsed.value;
  const asking = detectArgs({ nowMs: Date.now(), positionals, rest, roots: waveRoots(), values });
  if (asking.args === undefined) {
    asking.refusals.forEach((problem) => {
      logger.error({ msg: `knowledge detect: ${problem}` });
    });
    logger.error({ msg: DETECT_USAGE });
    return EXIT_USAGE;
  }
  const asked = asking.args;
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge detect: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const counts = await countTermMatches({ client, terms: asked.terms });
    if (counts.isErr()) {
      logger.error({ msg: `knowledge detect: ${counts.error.message}` });
      return EXIT_ERROR;
    }
    const wave = planRecallWave({ counts: counts.value, ...(asked.slots === undefined ? {} : { slots: asked.slots }) });
    const briefs = writeBriefs({ args: asked, wave });
    writeWaveRecord({ args: asked, briefs, recordedAtIso: new Date().toISOString(), wave });
    if (asked.json) {
      logger.out({
        line: safeJsonStringify({
          label: "knowledge detect",
          value: { briefs, counts: counts.value, out: asked.out, outNote: asked.outNote, task: asked.task },
        }),
      });
      return EXIT_OK;
    }
    waveLines({ briefs, outNote: asked.outNote, task: asked.task, wave }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeDetectCommand = defineCommand({ run: runKnowledgeDetect });
