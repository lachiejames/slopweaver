import { NextResponse } from "next/server";
import { coalescedRead, processReadMap } from "../../../lib/coalescedRead";
import { refuseUnlessConsoleRead } from "../../../lib/consoleRead";
import {
  SLACK_CHANNEL_TIMEOUT_MS,
  SLACK_CHANNEL_WAIT_MS,
  slackChannelAdmission,
  slackChannelArgv,
} from "../../../lib/slackChannelVerb";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: the channel as `slack channel-view` printed it, or why not. */
export type SlackChannelResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly view: unknown }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/** The name the channel reads are kept under, process-wide, so a dev reload cannot empty it. */
const READS_NAME = "slack-channel";

/**
 * Spawn `slack channel-view` for one channel and read its JSON, stamped when the read STARTS: a read that waited for
 * another channel's never says its arrival time was when it was read.
 */
async function readChannel({ argv, title }: { argv: readonly string[]; title: string }): Promise<SlackChannelResult> {
  const observedAtIso = new Date().toISOString();
  const ran = await spawnVerb({ argv, timeoutMs: SLACK_CHANNEL_TIMEOUT_MS, title });
  if (!ran.ok) {
    return { notMeasured: ran.notMeasured, observedAtIso, ok: false };
  }
  try {
    const view: unknown = JSON.parse(ran.out);
    return { observedAtIso, ok: true, view };
  } catch {
    return { notMeasured: `${title} printed something that is not JSON`, observedAtIso, ok: false };
  }
}

/**
 * Read one Slack channel as it is now, live: `?channel=C…&workspace=<host>.slack.com`, the workspace the chip's
 * link named, which the verb checks its token against.
 *
 * @returns the channel's newest page, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<SlackChannelResult>> {
  const observedAtIso = new Date().toISOString();
  const refused = refuseUnlessConsoleRead({ request });
  if (refused !== undefined) {
    return NextResponse.json(
      { notMeasured: `not the console's own read: ${refused}`, observedAtIso, ok: false },
      { status: 403 },
    );
  }
  const params = new URL(request.url).searchParams;
  const channel = params.get("channel");
  const workspace = params.get("workspace");
  if (channel === null || workspace === null) {
    return NextResponse.json({
      notMeasured: "no channel and workspace were named. Ask with ?channel=<C…>&workspace=<host>.slack.com",
      observedAtIso,
      ok: false,
    });
  }
  const built = slackChannelArgv({ channel, workspace });
  if (built.kind === "refused") {
    return NextResponse.json({ notMeasured: built.why, observedAtIso, ok: false });
  }
  const answer = await coalescedRead({
    ...slackChannelAdmission({ signal: request.signal }),
    busy: (): SlackChannelResult => ({
      notMeasured: `another channel's read was still running after ${String(SLACK_CHANNEL_WAIT_MS / 1000)}s of waiting. Hover again.`,
      observedAtIso,
      ok: false,
    }),
    key: `${workspace}/${channel}`,
    reads: processReadMap<SlackChannelResult>({ name: READS_NAME }),
    run: () => readChannel({ argv: built.argv, title: built.title }),
  });
  return NextResponse.json(answer);
}
