/**
 * The legs of `session-start` that read after the board: the cycle pass, the Slack bronze scan, Gmail and GitHub,
 * in that order — the order the run read them in before it had a `--deadline`, so a run given none reads live
 * state at the same moments it always did. The three live ones are each raced against the run's
 * `--deadline` (`../../../sessionStart/deadline.ts`); a leg the deadline arrives before or during reads as empty,
 * and says so on the list as a `couldNotSee` line and in `cutShort`.
 *
 * The cycle pass is cut whole, local proposals included: it runs as one call (`./cycleRead.ts`) and an abandoned
 * call yields nothing. The Slack bronze scan is synchronous, so no timer fires inside it: it asks the deadline
 * between chunks itself (`./slackScan.ts`), and this module only runs it in its place. The board is not here: it
 * always runs, because it is the list.
 */
import { ok, type Result } from "../../../lib/result.js";
import { beforeDeadline, cutShortLine, type RunDeadline } from "../../../sessionStart/deadline.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { type CycleRead, readCycleProposals } from "./cycleRead.js";
import type { SessionStartError } from "./errors.js";
import { type GithubRead, readGithubPullRequests } from "./githubRead.js";
import { type GmailRead, productionGmailListSeam, readGmailThreads } from "./gmailRead.js";
import type { SlackRead } from "./slackRead.js";

/** What the legs read, and which of them the deadline cut. */
export interface LiveLegs {
  readonly cycle: CycleRead;
  readonly slack: SlackRead;
  readonly mail: GmailRead;
  readonly github: Result<GithubRead, SessionStartError>;
  /** The legs cut, in the words the list prints, in the order they were read. */
  readonly cut: readonly string[];
}

/**
 * Read the cycle, Slack, mail and GitHub legs in that order, each live one raced against the deadline.
 *
 * @param home the state home
 * @param nowIso the instant the list is judged at
 * @param verify whether the cycle pass re-reads live
 * @param deadline the run's deadline
 * @param deadlineMs the same deadline as an instant, for the line a cut leg prints; undefined when none was given
 * @param scanSlack the synchronous Slack bronze scan, run between the cycle and mail legs; it asks the deadline itself
 * @returns each leg's read, an empty one for a live leg cut, and which were cut
 */
export async function readLiveLegs({
  home,
  nowIso,
  verify,
  deadline,
  deadlineMs,
  scanSlack,
}: {
  home: string;
  nowIso: string;
  verify: boolean;
  deadline: RunDeadline;
  deadlineMs: number | undefined;
  scanSlack: () => SlackRead;
}): Promise<LiveLegs> {
  const cut: string[] = [];
  const cutLine = ({ part }: { part: string }): string => {
    cut.push(part);
    // A leg is only ever cut by a deadline the run was given.
    return cutShortLine({ deadlineMs: deadlineMs!, part });
  };
  const cycleRaced = await beforeDeadline({
    deadline,
    work: async () => readCycleProposals({ home, identityRoster: identityRosterPort(), nowIso, verify }),
  });
  const cycle: CycleRead =
    cycleRaced.kind === "done"
      ? cycleRaced.value
      : { couldNotSee: [cutLine({ part: "your Linear cycle" })], inputs: [], proposalsRead: 0 };
  const slack = scanSlack();
  if (slack.cut === true) {
    cut.push("your Slack threads");
  }
  const mailRaced = await beforeDeadline({
    deadline,
    work: async () => readGmailThreads({ home, nowIso, seam: productionGmailListSeam() }),
  });
  const mail: GmailRead =
    mailRaced.kind === "done"
      ? mailRaced.value
      : { answeredAfterOwner: 0, couldNotSee: [cutLine({ part: "your mail" })], inboxRead: 0, inputs: [] };
  const githubRaced = await beforeDeadline({ deadline, work: async () => readGithubPullRequests({ home, nowIso }) });
  const github: Result<GithubRead, SessionStartError> =
    githubRaced.kind === "done"
      ? githubRaced.value
      : ok({
          couldNotSee: [cutLine({ part: "your open pull requests" })],
          inputs: [],
          pullRequestsRead: 0,
          waitingOnSomebodyElse: 0,
        });
  return { cut, cycle, github, mail, slack };
}
