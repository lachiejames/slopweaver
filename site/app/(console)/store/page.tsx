import type { ReactElement } from "react";

import { PageHead } from "../../../components/console/PageHead";
import { StoreBrowser } from "../../../components/console/StoreBrowser";

export const metadata = { title: "Store" };

/**
 * Store: a read-only view of what the store database holds — every table with its estimated row count, a table's
 * rows sorted, filtered and paged, its definition, and any row opened whole — read through `slopweaver store
 * tables|rows|row` and never written. Full width rather than the reading column other pages use, since a table's
 * columns are its width.
 *
 * @returns the page
 */
export default function StorePage(): ReactElement {
  return (
    <>
      <PageHead title="Store" sub="what the store database holds, table by table, read-only" />
      <div className="px-8 pt-3 pb-12 max-[760px]:px-4">
        <StoreBrowser />
      </div>
    </>
  );
}
