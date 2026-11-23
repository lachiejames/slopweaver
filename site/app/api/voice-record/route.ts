import { NextResponse } from "next/server";

import { type LiveResult, runLiveVerb } from "../../../lib/liveVerbRun";
import { liveVerbFor } from "../../../lib/liveVerbs";
import { spawnVerb } from "../../../lib/spawnVerb";
import {
  type BatchRun,
  batchItems,
  batchKilledAtDeadline,
  batchReadings,
  VOICE_RECORD_BATCH_ARGV,
  VOICE_RECORD_GROUPS,
} from "../../../lib/voiceRecordBatch";
import {
  VOICE_RECORD_SERVER_DEADLINE_MS,
  type VoiceRecordBody,
  voiceRecordTimeLeftMs,
  voiceRecordVerb,
} from "../../../lib/voiceRecordRead";

/** Never prerendered: each request re-reads the machine. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * One slug read by its own child: its allowlisted live verb (`../../../lib/liveVerbs.ts`), killed at the request's
 * deadline instant (`voiceRecordVerb`), so no child outlives the answer it was started for.
 *
 * @param slug the live slug
 * @param deadlineAtMs the monotonic instant (`performance.now()`) this request's processes are killed at
 * @returns the slug and its reading
 */
async function soloRead({
  slug,
  deadlineAtMs,
}: {
  slug: string;
  deadlineAtMs: number;
}): Promise<readonly (readonly [string, LiveResult])[]> {
  const verb = liveVerbFor({ slug });
  if (verb === undefined) {
    return [[slug, { notMeasured: `no live verb named ${slug}`, observedAtIso: new Date().toISOString(), ok: false }]];
  }
  const bounded = voiceRecordVerb({ deadlineAtMs, nowMs: performance.now(), verb });
  if (bounded === undefined) {
    const notMeasured = `${slug} was not started: the voice record read's deadline had passed`;
    return [[slug, { notMeasured, observedAtIso: new Date().toISOString(), ok: false }]];
  }
  return [[slug, await runLiveVerb({ verb: bounded })]];
}

/**
 * One group's fresh read: its slugs' allowlisted live verbs sent on stdin to ONE `slopweaver console batch` process,
 * killed at the request's deadline instant (`voiceRecordTimeLeftMs`). It is no page flight: a page poll riding it
 * would get the voice's shorter bound in place of its own.
 *
 * @param slugs the group's live slugs, in the order the batch runs them
 * @param deadlineAtMs the monotonic instant (`performance.now()`) this request's processes are killed at, so a wall
 * clock set back never lends a batch more time
 * @returns each slug and its reading
 */
async function batchRead({
  slugs,
  deadlineAtMs,
}: {
  slugs: readonly string[];
  deadlineAtMs: number;
}): Promise<readonly (readonly [string, LiveResult])[]> {
  const verbs = slugs.map((slug) => liveVerbFor({ slug }));
  const timeoutMs = voiceRecordTimeLeftMs({ deadlineAtMs, nowMs: performance.now() });
  let run: BatchRun;
  if (timeoutMs === undefined) {
    run = { launched: false, why: "the voice record read's deadline had passed" };
  } else {
    const outcome = await spawnVerb({
      argv: VOICE_RECORD_BATCH_ARGV,
      stdin: JSON.stringify(batchItems({ verbs })),
      timeoutMs,
      title: "slopweaver console batch",
    });
    run = {
      killedAtDeadline: batchKilledAtDeadline({ deadlineAtMs, nowMs: performance.now(), outcome }),
      launched: true,
      outcome,
    };
  }
  return batchReadings({ receivedAtIso: new Date().toISOString(), run, slugs, verbs });
}

/**
 * Read the voice record: every source the console voice's Queue answer projects from, as a few processes run at once,
 * a group of one as its own child and a larger group as one batch (`VOICE_RECORD_GROUPS`,
 * `../../../lib/voiceRecordBatch.ts`). Always 200 with every slug answered, a source that did not answer named as
 * unmeasured.
 *
 * @returns one live reading per slug
 */
export async function GET(): Promise<NextResponse<VoiceRecordBody>> {
  const deadlineAtMs = performance.now() + VOICE_RECORD_SERVER_DEADLINE_MS;
  const groups = await Promise.all(
    VOICE_RECORD_GROUPS.map((slugs) => {
      const [only] = slugs;
      if (slugs.length === 1) {
        return soloRead({ deadlineAtMs, slug: only });
      }
      return batchRead({ deadlineAtMs, slugs });
    }),
  );
  const body: VoiceRecordBody = { readings: Object.fromEntries(groups.flat()) };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
