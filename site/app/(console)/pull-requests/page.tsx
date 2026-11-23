import type { ReactElement } from "react";

import { PullRequests } from "../../../components/live/PullRequests";

export const metadata = { title: "Pull requests" };

/**
 * Pull requests: the owner's open ones in this workspace, under one state selector, each card with its next act, its ask
 * trail and a suggested reviewer.
 *
 * It opens like the Queue, straight into its cards, so its one heading is for a screen reader and for the two
 * walks that read "drawn" as a heading on screen (`src/consoleProfile/plan.ts`'s `PAGE_LANDED`, and `desktop e2e`).
 *
 * @returns the page
 */
export default function PullRequestsPage(): ReactElement {
  return (
    <>
      <h1 className="sr-only">Pull requests</h1>
      <PullRequests />
    </>
  );
}
