/**
 * The value samples in the state home: one `<week>.json` per ISO week under `ledgers/value-samples/`, holding the
 * five asks drawn, each one's cost and outcome, and the owner's answer per ask once recorded.
 *
 * ## One sample per week, kept
 *
 * A week's sample is drawn once and then only read: `value sample` re-run in the same week finds the file and shows
 * it again, so the page and card the owner answers never change under them. A first draw is kept by
 * {@link createSample}, which refuses an existing file, so two overlapping runs keep one sample between them. An answer is merged in by
 * {@link answerSample}, which refuses a different answer for an ask already answered — a recorded answer is the
 * owner's word and is never silently replaced — and accepts the same answer again as a no-op.
 *
 * ## Fail closed
 *
 * An absent file is no sample. A file that will not read, or reads as something other than a sample, is an error —
 * never treated as absent, because a fresh draw over it would discard answers already recorded.
 */
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { type ValueError, ValueErrors } from "./errors.js";
import type { SampledAsk } from "./sample.js";

/** The three answers the owner gives an ask. */
export const VALUE_ANSWERS = ["used", "not-used", "not-yet"] as const;

/** One answer the owner gives an ask. */
export type ValueAnswer = (typeof VALUE_ANSWERS)[number];

/** One recorded answer and when it was recorded. */
interface RecordedAnswer {
  readonly answer: ValueAnswer;
  readonly answeredIso: string;
}

/** One week's sample as stored. */
export interface ValueSample {
  readonly schemaVersion: 1;
  readonly week: string;
  readonly drawnIso: string;
  /** How many asks were eligible, so the page can say five of how many. */
  readonly eligible: number;
  readonly asks: readonly SampledAsk[];
  /** The owner's answers, keyed by ask slug. */
  readonly answers: Readonly<Record<string, RecordedAnswer>>;
}

const MEASURED_COST = z.union([
  z.object({
    known: z.literal(true),
    value: z.object({
      coveredTurns: z.number(),
      totalTurns: z.number(),
      transcripts: z.number(),
      units: z.number(),
    }),
  }),
  z.object({ known: z.literal(false), why: z.string() }),
]);

const SAMPLE_SCHEMA = z.object({
  answers: z.record(z.string(), z.object({ answer: z.enum(VALUE_ANSWERS), answeredIso: z.string() })),
  asks: z.array(
    z.object({
      artifact: z.string().optional(),
      cost: MEASURED_COST,
      prUrls: z.array(z.string()),
      prs: z.array(z.object({ state: z.enum(["OPEN", "MERGED", "CLOSED", "UNREAD"]), url: z.string() })),
      settledIso: z.string(),
      settlement: z.enum(["filed", "answered"]),
      slug: z.string(),
      summary: z.string(),
      witness: z.string().optional(),
    }),
  ),
  drawnIso: z.string(),
  eligible: z.number(),
  schemaVersion: z.literal(1),
  week: z.string().regex(/^\d{4}-W\d{2}$/u),
});

/** A week id is the file name, so it is checked before it reaches a path. */
const WEEK_ID = /^\d{4}-W\d{2}$/u;

/**
 * Where one week's sample is kept.
 *
 * @param home the state home
 * @param week the ISO week, `YYYY-Www`
 * @returns the file's absolute path
 */
export function samplePath({ home, week }: { home: string; week: string }): string {
  return join(stateHomePaths({ home }).valueSamples, `${week}.json`);
}

/**
 * Parse a sample's text. Pure.
 *
 * @param path where it was read, for the error
 * @param text the file's contents
 * @returns the sample, or why it is not one
 */
export function parseSample({ path, text }: { path: string; text: string }): Result<ValueSample, ValueError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return err(ValueErrors.sampleInvalid({ detail: `not JSON: ${String(cause)}`, path }));
  }
  const parsed = SAMPLE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return err(
      ValueErrors.sampleInvalid({ detail: parsed.error.issues.map((issue) => issue.message).join("; "), path }),
    );
  }
  const { asks, ...rest } = parsed.data;
  return ok({
    ...rest,
    asks: asks.map(({ artifact, witness, ...ask }) => ({ ...ask, artifact, witness })),
  });
}

/**
 * The week's sample, or `undefined` when none was drawn. IO edge.
 *
 * @param home the state home
 * @param week the ISO week
 * @returns the sample, `undefined` when absent, or why the file would not read
 */
export function readSample({
  home,
  week,
}: {
  home: string;
  week: string;
}): Result<ValueSample | undefined, ValueError> {
  const path = samplePath({ home, week });
  if (!WEEK_ID.test(week)) {
    return err(ValueErrors.sampleInvalid({ detail: `${week} is not an ISO week id (YYYY-Www)`, path }));
  }
  if (!existsSync(path)) {
    return ok(undefined);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return err(ValueErrors.sampleUnreadable({ cause, path }));
  }
  return parseSample({ path, text });
}

/**
 * Write a week's sample whole, replacing the file atomically. IO edge.
 *
 * @param home the state home
 * @param sample the sample to keep
 * @returns the path written, or why it was not
 */
export function writeSample({ home, sample }: { home: string; sample: ValueSample }): Result<string, ValueError> {
  const path = samplePath({ home, week: sample.week });
  try {
    mkdirSync(stateHomePaths({ home }).valueSamples, { recursive: true });
    writeFileAtomic({ contents: `${JSON.stringify(sample, null, 2)}\n`, path });
  } catch (cause) {
    return err(ValueErrors.sampleUnwritable({ cause, path }));
  }
  return ok(path);
}

/**
 * Keep a freshly drawn sample only when the week has none yet. IO edge.
 *
 * A first draw must never replace a file, because an overlapping run of `value sample` may have written its own
 * sample and had an answer recorded against it while this run was still drawing. So the file is written beside its
 * target and hard-linked into place: the link refuses an existing name, which makes the create exclusive and the
 * file whole at the moment it appears.
 *
 * @param home the state home
 * @param sample the freshly drawn sample
 * @returns `created`, or `exists` when another run kept the week's sample first, or why neither could be done
 */
export function createSample({
  home,
  sample,
}: {
  home: string;
  sample: ValueSample;
}): Result<"created" | "exists", ValueError> {
  const path = samplePath({ home, week: sample.week });
  const staging = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    mkdirSync(stateHomePaths({ home }).valueSamples, { recursive: true });
    writeFileSync(staging, `${JSON.stringify(sample, null, 2)}\n`, { flag: "wx" });
    linkSync(staging, path);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EEXIST" && existsSync(path)) {
      rmSync(staging, { force: true });
      return ok("exists");
    }
    rmSync(staging, { force: true });
    return err(ValueErrors.sampleUnwritable({ cause, path }));
  }
  rmSync(staging, { force: true });
  return ok("created");
}

/**
 * The sample with one answer merged in. Pure. The same answer again is a no-op; a different one is refused.
 *
 * @param sample the week's sample
 * @param slug the ask answered
 * @param answer the owner's answer
 * @param nowIso when it is being recorded
 * @returns the sample to write, unchanged when the answer was already there, or why it is refused
 */
export function answerSample({
  answer,
  nowIso,
  sample,
  slug,
}: {
  answer: ValueAnswer;
  nowIso: string;
  sample: ValueSample;
  slug: string;
}): Result<{ readonly sample: ValueSample; readonly changed: boolean }, ValueError> {
  if (!sample.asks.some((ask) => ask.slug === slug)) {
    return err(ValueErrors.askNotSampled({ slug, week: sample.week }));
  }
  const recorded = sample.answers[slug];
  if (recorded !== undefined) {
    if (recorded.answer === answer) {
      return ok({ changed: false, sample });
    }
    return err(ValueErrors.answerConflict({ offered: answer, recorded: recorded.answer, slug }));
  }
  return ok({
    changed: true,
    sample: { ...sample, answers: { ...sample.answers, [slug]: { answer, answeredIso: nowIso } } },
  });
}

/**
 * Whether every drawn ask carries an answer — the point at which the week's card has nothing left to ask.
 *
 * @param sample the week's sample
 * @returns true once each ask is answered
 */
export function sampleComplete({ sample }: { sample: ValueSample }): boolean {
  return sample.asks.every((ask) => sample.answers[ask.slug] !== undefined);
}
