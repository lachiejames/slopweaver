import { NextResponse } from "next/server";

import {
  SLACK_CONNECTION_ARGV,
  type SlackConnectionResult,
  slackConnectionResultOf,
} from "../../../lib/slackConnection";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The preflight resolves a token and, when one is present, makes one `auth.test` call; anything near this is hung. */
const TIMEOUT_MS = 20_000;

/**
 * Whether a Slack token is present at all, through the door's own value-free preflight
 * (`../../../lib/slackConnection.ts` says why this and not the secrets store). Read by a Slack thread panel only after
 * its corpus read failed, so a working thread never costs a call.
 *
 * @returns whether a Slack token is present, or why that was not measured
 */
export async function GET(): Promise<NextResponse<SlackConnectionResult>> {
  const observedAtIso = new Date().toISOString();
  const ran = await spawnVerb({
    argv: SLACK_CONNECTION_ARGV,
    timeoutMs: TIMEOUT_MS,
    title: `slopweaver ${SLACK_CONNECTION_ARGV.join(" ")}`,
  });
  if (ran.ok) {
    return NextResponse.json(slackConnectionResultOf({ exitCode: 0, observedAtIso, out: ran.out, why: "" }));
  }
  return NextResponse.json(
    slackConnectionResultOf({ exitCode: ran.exitCode, observedAtIso, out: ran.out, why: ran.notMeasured }),
  );
}
