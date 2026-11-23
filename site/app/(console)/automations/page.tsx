import type { ReactElement } from "react";

import { PAGE_BODY, PageHead } from "../../../components/console/PageHead";
import { Automations } from "../../../components/live/Automations";

export const metadata = { title: "Automations" };

/**
 * Automations: every automation and corpus sync as one list of collapsed cards, what needs a look first, each
 * opening to its firings, its waits and — for a sync — what its runs found per channel, repository or project.
 *
 * @returns the page
 */
export default function AutomationsPage(): ReactElement {
  return (
    <>
      <PageHead title="Automations" sub="what each automation and sync is doing, and what it found" />
      <div className={PAGE_BODY}>
        <Automations />
      </div>
    </>
  );
}
