import type { ReactElement } from "react";

import { PAGE_BODY, PageHead } from "../../../components/console/PageHead";
import { Fleet } from "../../../components/live/Fleet";

export const metadata = { title: "Fleet" };

/**
 * Fleet: what the fleet did, is doing and does next, behind one Past / Now / Next switch — Now by default. Anything
 * that needs the owner stays on the queue, and nothing here reorders the work: the owner steers through the supervisor.
 *
 * @returns the page
 */
export default function FleetPage(): ReactElement {
  return (
    <>
      <PageHead title="Fleet" sub="what the fleet did, is doing, and does next" />
      <div className={PAGE_BODY}>
        <Fleet />
      </div>
    </>
  );
}
