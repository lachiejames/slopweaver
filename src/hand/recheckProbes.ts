/**
 * The two reads `hand recheck` makes — the effectful edge of `./recheck.ts`, and nothing else.
 *
 * **A sign-in** is ONE visit of the platform's bare origin through the relay every atlas walk attaches by
 * (`../atlas/kit/walkTransport.ts`'s `relayDepsAt`): the same consent token, the same recorded work Chrome profile pin,
 * the same exclusive relay lease. It is the first navigation that platform's own scheduled walk makes on every run, so
 * a recheck adds no new kind of traffic to a provider — the owner's caution about a bot getting locked out of a
 * provider's UI — and it never photographs, clicks or follows a link.
 *
 * The lease wait is SHORT ({@link RECHECK_LEASE_WAIT_SECONDS}), not the walk's: the recheck runs inside a supervisor
 * tick reading with a two-minute budget (`../supervisor/scratch/tickCapture.ts`), and a resync holding the relay is a
 * reason to try again next tick, never to eat the tick. A busy relay is `unread`, and an unread step stays open.
 *
 * **A channel** is `conversations.info` + `conversations.members` under the owner's own Slack token
 * (`../corpus/slack/writeApi.ts`'s membership reader), matched against the owner's recorded Slack user id.
 */
import { join } from "node:path";

import { relayDepsAt } from "../atlas/kit/walkTransport.js";
import { createPlaywrightCliTransport } from "../browser/playwrightCli.js";
import { type RecordedProfilePort, recordedProfilePort } from "../browser/recordedProfile.js";
import { slackUserToken } from "../config.js";
import { makeSlackMembershipReader } from "../corpus/slack/writeApi.js";
import { logger } from "../lib/logger.js";
import { ownerUserIdFromProfile } from "../profileStore.js";
import { stateHomePaths } from "../stateHome.js";
import { realWaitClock } from "../wait/loop.js";

import type { RecheckObservation } from "./recheck.js";
import { browserSessionVerdict, sessionProbeVisit } from "./sessionProbes.js";

/**
 * How long a recheck waits for the relay lease before calling the sign-in unread. A BUDGET, not a measurement: well
 * inside the tick reading's 120s, so the visit itself still fits after the wait.
 */
const RECHECK_LEASE_WAIT_SECONDS = 20;

/** The reads a recheck pass makes, so a test drives the pass over fakes. */
export interface RecheckProbeDeps {
  /** Read whether the owner is signed in at one origin. */
  readonly browserSession: (input: { home: string; origin: string }) => Promise<RecheckObservation>;
  /** Read whether the owner is a member of one channel. */
  readonly slackMember: (input: { home: string; channel: string }) => Promise<RecheckObservation>;
}

/**
 * Visit one origin through the owner's work Chrome and judge the landing.
 *
 * @param home the state home the relay token, the profile pin and the lease live under
 * @param origin the bare origin, one `./sessionProbes.ts` reads
 * @param profiles the door the recorded work profile is read through
 * @returns met on a positive signed-in landing, unmet on a sign-in page or a redirect away, unread on anything else
 */
async function liveBrowserSession({
  home,
  origin,
  profiles,
}: {
  home: string;
  origin: string;
  profiles: RecordedProfilePort;
}): Promise<RecheckObservation> {
  const visit = sessionProbeVisit({ origin });
  if (visit === undefined) {
    return { kind: "unread", why: `no atlas reads the sign-in at ${origin}` };
  }
  const deps = await relayDepsAt({
    home,
    origins: visit.leaseOrigins,
    platform: `hand-recheck:${visit.platform}`,
    profiles,
    scratchDir: join(stateHomePaths({ home }).handSteps, "recheck"),
  });
  if (deps.isErr()) {
    return { kind: "unread", why: deps.error.join("; ") };
  }
  const transport = createPlaywrightCliTransport({
    deps: {
      ...deps.value,
      leaseWait: {
        clock: realWaitClock(),
        emit: (line) => {
          logger.error({ msg: line });
        },
        timeoutSeconds: RECHECK_LEASE_WAIT_SECONDS,
      },
    },
  });
  try {
    const captured = await transport.visit({ photograph: false, settleMs: visit.settleMs, url: `${origin}/` });
    if (captured.isErr()) {
      return { kind: "unread", why: `could not open ${origin}: ${captured.error.message}` };
    }
    const verdict = browserSessionVerdict({
      finalUrl: captured.value.finalUrl,
      origin,
      statusCode: captured.value.statusCode,
    });
    return { kind: verdict.kind === "signed-in" ? "met" : "unmet", observed: verdict.observed };
  } finally {
    await transport.release();
  }
}

/**
 * Read whether the owner is in one channel, under the owner's own Slack token.
 *
 * @param home the state home the owner's token and profile live under
 * @param channel the channel id
 * @returns met when the owner's user id is a member, unmet when it is not, unread when either could not be read
 */
async function liveSlackMember({ home, channel }: { home: string; channel: string }): Promise<RecheckObservation> {
  const token = slackUserToken({ home });
  if (token === undefined) {
    return { kind: "unread", why: "no Slack user token is stored — `slopweaver secrets status` names it" };
  }
  const owner = ownerUserIdFromProfile({ home });
  if (owner === null) {
    return { kind: "unread", why: "the owner's Slack user id is not in the profile, so membership cannot be matched" };
  }
  const membership = await makeSlackMembershipReader({ home, token })({ channel });
  if (membership.kind !== "read") {
    return { kind: "unread", why: `could not read ${channel}'s members: ${membership.cause}` };
  }
  return membership.members.has(owner)
    ? { kind: "met", observed: `the owner is a member of ${channel}` }
    : { kind: "unmet", observed: `the owner is not yet a member of ${channel}` };
}

/**
 * The real reads.
 *
 * @returns the probe seams `hand recheck` runs in production
 */
export function liveRecheckProbes(): RecheckProbeDeps {
  const profiles = recordedProfilePort();
  return {
    browserSession: ({ home, origin }) => liveBrowserSession({ home, origin, profiles }),
    slackMember: liveSlackMember,
  };
}
