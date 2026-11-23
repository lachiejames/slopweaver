import type { ReactElement } from "react";

import { PAGE_BODY, PageHead } from "../../../components/console/PageHead";
import { WorkstreamCandidates } from "../../../components/live/WorkstreamCandidates";
import { WorkstreamTiles } from "../../../components/live/WorkstreamTiles";

export const metadata = { title: "Workstreams" };

/**
 * Workstreams: the owner's outcomes as one list of collapsed cards, at risk first, each opening to its bar and dated story.
 *
 * Static, so the sidebar link prefetches it whole. It opens no board row: a citation chip carrying the older
 * `/workstreams?row=<slug>` address draws as the row's words (`lib/citationDisplay.ts`).
 *
 * @returns the page
 */
export default function WorkstreamsPage(): ReactElement {
  return (
    <>
      <PageHead title="Workstreams" sub="whose move each one is, and where it has got to" />
      <div className={PAGE_BODY}>
        {/* Above the tiles, under `#candidates`: a yes here becomes a discovery tile below. */}
        <WorkstreamCandidates />
        <WorkstreamTiles />
      </div>
    </>
  );
}
