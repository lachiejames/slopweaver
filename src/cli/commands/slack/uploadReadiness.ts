/**
 * The live upload-readiness poll a Slack write waits on before it attaches a freshly uploaded file — the one
 * piece of production wiring here that talks to `files.info`, kept apart from the profile and mention wiring
 * in `./wiring.ts` because it shares nothing with either.
 */
import { WebClient } from "@slack/web-api";
import { SLACK_UPLOAD_READINESS_GAPS } from "../../../corpus/slack/readinessSchedule.js";
import type { UploadReadiness, UploadReadinessOutcome } from "../../../corpus/slack/writeTransport.js";
import { isRecord } from "../../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../../lib/providerCall.js";

/**
 * ONE `files.info` call, reduced to the three answers the wait actually branches on.
 *
 * Split out of the wait so the wait itself is a schedule and a tally, and this is the only place that knows
 * a file announces itself finished by finally having a non-empty `mimetype`.
 */
async function pollFileReadiness({
  client,
  fileId,
  scopeId,
}: {
  client: WebClient;
  fileId: string;
  scopeId: string;
}): Promise<"ready" | "processing" | { readonly error: string }> {
  const result = await safeProviderCall({
    execute: () => client.files.info({ file: fileId }),
    operation: "slack.files.info",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (!result.isOk()) {
    return { error: result.error.message };
  }
  const file = result.value.file;
  const mimetype = isRecord(file) ? file["mimetype"] : undefined;
  return typeof mimetype === "string" && mimetype.length > 0 ? "ready" : "processing";
}

/**
 * The live upload-readiness poll.
 *
 * A freshly-uploaded file reports an EMPTY mimetype until Slack finishes processing it, and
 * attaching one in that state is what produced the old system's broken previews. Measured on a real
 * workspace: a small PNG needed five polls over ~2.9 seconds; a text file was ready on the first.
 *
 * DELIBERATELY NOT PACED (PR5.2.1b). `files.info` is `tier4`, which is absent from `PACED_CLASSES`, so the
 * loop keeps its own measured cadence rather than being stretched to the registry's 750ms — which would push
 * the ~2.9s readiness window past where it was tuned. The loop cannot run away regardless: it is bounded by
 * {@link SLACK_UPLOAD_READINESS_GAPS} and then gives up. It still waits on the shared block, since a workspace that is
 * genuinely rate-limited should not be polled at all.
 *
 * It reports the PHASE it gave up in, not a bare `false`. "Never finished processing" and "`files.info`
 * never answered at all" are different faults — wait longer versus look at the token, the scope or the rate
 * limit — and two Slack upload failures produced a message that named neither, so
 * nobody could tell which had happened.
 *
 * @param token the Slack bot token
 * @param now the clock, injected so the elapsed wait a failure reports is assertable
 * @returns a bounded poll that reports whether the file became ready, and what it saw if it did not
 */
export function liveReadiness({
  token,
  now = () => Date.now(),
}: {
  token: string;
  now?: () => number;
}): UploadReadiness {
  // devlint: sdk-factory -- the bounded upload-readiness poll needs its own client
  const client = new WebClient(token);
  const scopeId = scopeIdForToken({ token });
  return {
    waitForFile: async ({ fileId }): Promise<UploadReadinessOutcome> => {
      const startedAt = now();
      const gaps = SLACK_UPLOAD_READINESS_GAPS;
      let polls = 0;
      let lastError = "files.info never returned an error, and never returned a mimetype either";
      let everAnswered = false;
      // One more poll than there are gaps: the schedule's sleeps sit BETWEEN calls, never after the last.
      for (let index = 0; index <= gaps.length; index += 1) {
        const answer = await pollFileReadiness({ client, fileId, scopeId });
        polls += 1;
        if (answer === "ready") {
          return { kind: "ready", polls, waitedMs: now() - startedAt };
        }
        if (answer === "processing") {
          everAnswered = true;
        } else {
          lastError = answer.error;
        }
        const gap = gaps[index];
        if (gap !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, gap));
        }
      }
      const waitedMs = now() - startedAt;
      return everAnswered
        ? { kind: "still-processing", polls, waitedMs }
        : { kind: "unreadable", lastError, polls, waitedMs };
    },
  };
}
