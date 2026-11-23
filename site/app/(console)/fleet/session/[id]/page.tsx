import type { Metadata } from "next";
import type { ReactElement } from "react";

import { PAGE_BODY, PageHead } from "../../../../../components/console/PageHead";
import { SessionTurnView } from "../../../../../components/live/SessionTurnView";

/**
 * The page's title: which session it is, by the first eight characters of its id, so a desktop tab opened on one is
 * told apart from another session's.
 *
 * @param params the session id off the path
 * @returns the metadata
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Session ${id.slice(0, 8)}` };
}

/**
 * One running session's latest turn, read-only: what it was asked, what it is thinking and saying, and every
 * tool it has called, drawn with AI Elements over its own transcript. Nothing on this page sends.
 *
 * @param params the session id off the path, checked by the route before any verb runs
 * @returns the page
 */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  return (
    <>
      <PageHead title="Session" sub="the latest turns of one running session, read-only" />
      <div className={PAGE_BODY}>
        <SessionTurnView id={id} />
      </div>
    </>
  );
}
