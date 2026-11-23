/**
 * `slopweaver store detect` — probe the store for a question, then say how many detectives to fan out and
 * what each one starts on.
 *
 * The one verb in this family that decides something rather than reporting something, and it deliberately
 * decides only the WAVE: which leads exist, how many detectives that comes to, and the brief each is
 * handed. It launches no model, spawns no process and writes nothing outside the run directory it is
 * given — the visible bot-turn session reads the briefs and invokes the sub-agents itself, which is what
 * keeps rule 2 (no headless model, anywhere) a property of the architecture rather than a promise.
 *
 * ## Why the sizing lives behind a verb rather than in the skill text
 *
 * Because a number a skill asks an agent to compute is a number that comes out differently every turn. The
 * rule — one lead per `(keyword, source)`, never one per shape, plus one discovery lead, clamped to the
 * session's own remaining capacity — is in `src/detective/fanout.ts` with the reasoning, is unit-tested
 * against 0, 3, 7 and 29 positive leads, and is read here. The skill says WHEN to call this; it does not
 * re-derive what it answers.
 */

import { join } from "node:path";

import { renderBrief } from "../../../detective/brief.js";
import { planWave, type Wave } from "../../../detective/fanout.js";
import { judgeName, type NameFinding, planNameForms } from "../../../detective/nameProbe.js";
import { WAVE_RECORD_FILE, type WaveRoots, waveOutFromFlags, waveRoots } from "../../../detective/waveHome.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { readerExecute } from "../../../store/atlas/probeRun.js";
import { connectStore, type StoreReader } from "../../../store/client.js";
import type { ProbeReport } from "../../../store/probe/result.js";
import { runProbe } from "../../../store/probe/run.js";
import type { ProbeSubject } from "../../../store/probe/sql.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags, repeatedFlagValues } from "../../parseFlags.js";
import { storeTail } from "./core.js";
import { type OutsideLegs, outsideLegs } from "./detectLegs.js";
import { type DetectAssignment, waveLines } from "./detectLines.js";
import { type Parsed, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";
import { HUMAN_WHOLE_STORE_PROBE } from "./probeCore.js";

const DETECT_USAGE =
  "usage: slopweaver store detect <question> --term <t> [--term <t> ...] [--name <n> --variant <v> ...] [--slots <n>] [--recalled <line>] [--ask <channel>/<messageTs> | --out <dir>] [--json]";

/** What a `store detect` invocation asked for. */
export interface DetectArgs {
  readonly question: string;
  readonly terms: readonly string[];
  readonly slots: number | undefined;
  readonly recalled: readonly string[];
  /**
   * The person the question names, as the question wrote it, when the session judged that name ambiguous
   * in free text. Absent when it did not — this step never fires on its own.
   */
  readonly name: string | null;
  /**
   * The other forms of {@link DetectArgs.name} the session's judgment proposed — a spelling, a surname, a
   * nickname a thread uses, the shape a transcript would have mangled it into. Probed alongside the
   * question's own keywords, so the leads are sized on whichever of them the corpus actually holds.
   */
  readonly variants: readonly string[];
  readonly out: string;
  /** Why {@link DetectArgs.out} is somewhere `turn freeze` will not look, or nothing when it is not. */
  readonly outNote: string | null;
  readonly json: boolean;
}

/**
 * Parse `store detect`.
 *
 * @param rest the verb's own argv tail
 * @param roots where a wave lands when the caller names no directory — the turn's record set with `--ask`
 * @param nowMs the planning instant, which names the wave's directory
 * @returns what it asked for, or every reason it was refused
 */
export function parseDetectArgs({
  rest,
  roots,
  nowMs,
}: {
  rest: readonly string[];
  roots: WaveRoots;
  nowMs: number;
}): Parsed<DetectArgs> {
  const terms = repeatedFlagValues({ name: "term", rest });
  const recalled = repeatedFlagValues({ name: "recalled", rest });
  const variants = repeatedFlagValues({ name: "variant", rest });
  // The list flags are read above, so they are declared `repeatable` here and the parser's own single value
  // for each is deliberately unused.
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: {
      boolean: ["json"],
      repeatable: ["term", "recalled", "variant"],
      string: ["term", "recalled", "variant", "name", "slots", "out", "ask"],
    },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values, positionals } = flags.value;
  const question = positionals.join(" ").trim();
  const rawSlots = values["slots"];
  const slots = rawSlots === undefined ? undefined : Number(rawSlots);
  const rawName = values["name"];
  const name = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : null;
  const landing = waveOutFromFlags({ kind: "store", nowMs, roots, values });
  const refusals = [
    ...(question.length === 0 ? [StoreCommandErrors.waveQuestionMissing().message] : []),
    ...(terms.length === 0 ? [StoreCommandErrors.waveTermMissing().message] : []),
    ...(slots !== undefined && (!Number.isInteger(slots) || slots < 1)
      ? [StoreCommandErrors.slotsInvalid({ got: String(rawSlots) }).message]
      : []),
    // A variant is a form OF something, so one with no `--name` names nothing and would be probed as an
    // ordinary keyword while looking like a name step that ran. Refuse it rather than half-run the step.
    ...(name === null && variants.length > 0 ? [StoreCommandErrors.variantNeedsName().message] : []),
    ...(landing.isErr() ? landing.error : []),
  ];
  if (refusals.length > 0 || landing.isErr()) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: refusals }));
  }
  return ok({
    json: values["json"] === true,
    name,
    out: landing.value.out,
    outNote: landing.value.note,
    question,
    recalled,
    slots,
    terms,
    variants,
  });
}

/**
 * The one probe the whole wave is sized from: the question's keywords, then every name form not already
 * among them.
 *
 * Deduplicated because a session that types `--term barton --variant barton` is being careful rather
 * than wrong, and a duplicated subject would double a source's leads and hand two detectives the same rows.
 *
 * @param terms the question's own keywords
 * @param forms the name forms the pre-planning step is probing, empty when it is not running
 * @returns the probe subjects, keywords first
 */
function probeSubjects({
  terms,
  forms,
}: {
  terms: readonly string[];
  forms: readonly string[];
}): readonly ProbeSubject[] {
  const seen = new Set(terms);
  const extra = forms.filter((form) => {
    const fresh = !seen.has(form);
    seen.add(form);
    return fresh;
  });
  return [...terms, ...extra].map((term) => ({ kind: "term", term }));
}

/**
 * Print every refusal, then the usage.
 *
 * @param lines every reason the invocation was refused
 * @returns the exit code to return
 */
function refuse({ lines }: { lines: readonly string[] }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: DETECT_USAGE });
  return EXIT_USAGE;
}

/**
 * Probe for a question, plan the wave, and write one brief per detective.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreDetect(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DETECT_USAGE });
    return EXIT_OK;
  }
  const args = parseDetectArgs({ nowMs: Date.now(), rest, roots: waveRoots() });
  if (args.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: args.error }) });
  }
  const opened = await connectStore({ max: 1 });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    return await detectWithStore({ args: args.value, reader: client });
  } finally {
    await client.close();
  }
}

/**
 * The half of `store detect` that has an open store: probe, judge the name, plan the wave, write the briefs.
 *
 * Split out of {@link runStoreDetect} so the argv handling and the connection lifetime stay readable beside
 * each other rather than wrapping this whole body in a `try`.
 *
 * @param args what the invocation asked for
 * @param reader the open store connection, closed by the caller either way
 * @returns the process exit code
 */
async function detectWithStore({ args, reader }: { args: DetectArgs; reader: StoreReader }): Promise<number> {
  const nameStep = planNameForms({ name: args.name, variants: args.variants });
  // The name's forms join the question's own keywords in ONE probe rather than getting a second pass: the
  // wave is sized off this matrix, so a form probed separately would be a form the leads cannot see.
  const subjects: readonly ProbeSubject[] = probeSubjects({ forms: nameStep.forms, terms: args.terms });
  const probe = await runProbe({ plan: { ...HUMAN_WHOLE_STORE_PROBE, subjects }, reader });
  if (probe.isErr()) {
    logger.error({ msg: probe.error.message });
    return EXIT_ERROR;
  }
  const outside = await outsideLegs({
    execute: readerExecute({ reader }),
    home: slopweaverHome(),
    nowMs: Date.now(),
    terms: args.terms,
  });
  const finding =
    args.name === null || nameStep.forms.length === 0
      ? null
      : judgeName({ asked: args.name, forms: nameStep.forms, probe: probe.value });
  const wave =
    args.slots === undefined
      ? planWave({ extra: outside.leads, probe: probe.value })
      : planWave({ extra: outside.leads, probe: probe.value, slots: args.slots });
  const briefs = writeBriefs({ args, finding, wave });
  writeWaveRecord({ args, briefs, wave });
  emitWave({ args, briefs, finding, nameSkipped: nameStep.skipped, outside, probe: probe.value, wave });
  return EXIT_OK;
}

/**
 * Print the planned wave, as a `--json` document or as the human report.
 *
 * Its own function rather than the tail of {@link detectWithStore} because that function is what
 * `max-function-lines` measured over the cap once a third outside leg arrived, and this is the seam the
 * gate found: everything above it DECIDES the wave, and everything here only says it.
 *
 * @param args what the invocation asked for
 * @param briefs where each detective's brief and report live
 * @param finding what the pre-planning name step came to, or nothing when it did not run
 * @param nameSkipped why the name step did not run despite being asked for
 * @param outside what every source that is not the corpus contributed
 * @param probe the corpus counts the wave was sized from
 * @param wave the leads, the deferrals and the cells too wide to be either
 */
function emitWave({
  args,
  briefs,
  finding,
  nameSkipped,
  outside,
  probe,
  wave,
}: {
  args: DetectArgs;
  briefs: readonly DetectAssignment[];
  finding: NameFinding | null;
  nameSkipped: string | null;
  outside: OutsideLegs;
  probe: ProbeReport;
  wave: Wave;
}): void {
  if (args.json) {
    logger.out({
      line: safeJsonStringify({
        label: "detective wave",
        value: {
          atlas: outside.atlas,
          briefs,
          datadog: outside.datadog,
          hex: outside.hex,
          name: { finding, skipped: nameSkipped },
          out: args.out,
          outNote: args.outNote,
          probe,
          wave,
        },
      }),
    });
    return;
  }
  waveLines({
    outNote: args.outNote,
    briefs,
    datadogAge: outside.datadog.age === null ? null : outside.datadog.age.line,
    datadogNote: outside.datadog.note,
    hexNote: outside.hex.note,
    atlasNote: outside.atlas.note,
    finding,
    nameSkipped,
    question: args.question,
    wave,
  }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Write one brief per detective and hand back where each one lives.
 *
 * The write goes through the atomic module rather than `writeFileSync`, which is the door-coverage rule and
 * is also the right shape here: a brief half-written by a crash is a brief a sub-agent would read and act
 * on, and a partly-rendered lead is worse than a missing one.
 *
 * @param args what the invocation asked for
 * @param wave the leads this wave is spawning for
 * @param finding what the pre-planning name step came to, carried into every brief
 * @returns one assignment per detective, in the order they are spawned
 */
function writeBriefs({
  args,
  wave,
  finding,
}: {
  args: DetectArgs;
  wave: Wave;
  finding: NameFinding | null;
}): readonly DetectAssignment[] {
  return wave.leads.map((lead, index) => {
    const ordinal = String(index + 1);
    const report = join(args.out, `report-${ordinal}.md`);
    const brief = join(args.out, `detective-${ordinal}.md`);
    writeFileAtomic({
      contents: renderBrief({
        context: {
          index: index + 1,
          nameFinding: finding,
          question: args.question,
          recalled: args.recalled,
          reportPath: report,
          total: wave.detectives,
        },
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
 * The briefs and reports are prose quoting what the detectives read, unredacted at source, and a fixture's
 * redactor is an allowlist over JSON keys that cannot make prose safe to commit. So the record is what a
 * frozen turn keeps: how many detectives, which source each was sent to, and where each report lives, dated
 * by `recordedAtIso` so a freeze cut before the wave withholds it.
 *
 * @param args what the invocation asked for
 * @param briefs where each detective's brief and report live
 * @param wave the leads, the deferrals and the cells too wide to be either
 */
function writeWaveRecord({
  args,
  briefs,
  wave,
}: {
  args: DetectArgs;
  briefs: readonly DetectAssignment[];
  wave: Wave;
}): void {
  writeFileAtomic({
    contents: `${safeJsonStringify({
      label: "store detect wave record",
      space: 2,
      value: {
        assignments: briefs.map((each) => ({
          briefPath: each.brief,
          keyword: each.lead.keyword,
          reportPath: each.report,
          source: each.lead.source,
        })),
        deferred: wave.deferred.length,
        detectives: wave.detectives,
        kind: "store-wave",
        question: args.question,
        recordedAtIso: new Date().toISOString(),
        terms: args.terms,
        tooWide: wave.tooWide.length,
      },
    })}\n`,
    path: join(args.out, WAVE_RECORD_FILE),
  });
}

export const storeDetectCommand = defineCommand({ run: runStoreDetect });
