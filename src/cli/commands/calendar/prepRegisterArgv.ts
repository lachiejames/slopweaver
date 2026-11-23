/**
 * The `handover register` argv a meeting owed a brief becomes — pure, so the row `calendar prep-due` writes is
 * checkable without a calendar, a board or a clock. The workspace comes from the calendar's own account: one on
 * the organisation's domain is the team's meeting, and any other states nothing rather than a guess.
 */
import { accountWorkspace, workspaceRegisterArgv } from "../../../handover/workspace.js";
import { type PrepDueMeeting, prepAsk, prepRowSlug } from "../../../live/calendar/prepDue.js";
import type { Organisation } from "../../../organisation/core.js";

/**
 * The `handover register` argv that puts one meeting's brief on the board.
 *
 * @param meeting the meeting owed a brief
 * @param home the state home the board lives under
 * @param repo the checkout the seat is cut from
 * @param askedIso when this pass asked
 * @param account the calendar's Google account, which says whose work the meeting is
 * @param organisation the organisation whose Google domain the account is judged against
 * @returns the whole argv `handover register` takes, its `node slopweaver` head included
 */
export function prepRegisterArgv({
  meeting,
  home,
  repo,
  askedIso,
  account,
  organisation,
}: {
  meeting: PrepDueMeeting;
  home: string;
  repo: string;
  askedIso: string;
  account: string;
  organisation: Organisation;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    prepAsk({ meeting }),
    "--dispatch",
    "--slug",
    prepRowSlug({ eventId: meeting.event.id }),
    "--asked-iso",
    askedIso,
    ...workspaceRegisterArgv({
      stated: accountWorkspace({ account, organisation, what: "the meeting this brief is for" }),
    }),
    "--repo",
    repo,
    "--home",
    home,
  ];
}
