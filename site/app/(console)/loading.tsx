import type { ReactElement } from "react";

import { PAGE_BODY } from "../../components/console/PageHead";
import { ReadingIndicator } from "../../components/console/ReadingIndicator";

/** The skeleton's rows: a head bar, then the cards a console page opens with, each named so React can key it. */
const ROWS = [
  { id: "first", width: "w-full" },
  { id: "second", width: "w-11/12" },
  { id: "third", width: "w-full" },
  { id: "fourth", width: "w-5/6" },
] as const;

/**
 * What a console page draws while its own render is still on the way: a skeleton in the page's place, the sidebar
 * untouched beside it.
 *
 * Measured: a click on a fresh tab showed nothing for one to three seconds. Next commits this the moment a
 * navigation starts on any console route that is not already prefetched whole, so the click moves the page at once
 * rather than when the render arrives (`site/lib/navStall.ts` covers the click that never does).
 *
 * @returns the skeleton
 */
export default function ConsoleLoading(): ReactElement {
  return (
    <div aria-busy="true" data-console-loading="">
      <div className="flex items-center gap-[0.8rem] border-x-0 border-t-0 border-b border-solid border-border sw-glass-plane sw-glass-ground px-8 py-[0.9rem] max-[760px]:px-4">
        <div className="h-[1.15rem] w-32 animate-pulse rounded-[4px] bg-muted" aria-hidden="true" />
        <ReadingIndicator label="Opening the page" block />
      </div>
      <div className={PAGE_BODY}>
        <div className="flex animate-pulse flex-col gap-3 py-4" aria-hidden="true">
          {ROWS.map((row) => (
            <div key={row.id} className={`h-14 rounded-lg bg-muted ${row.width}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
