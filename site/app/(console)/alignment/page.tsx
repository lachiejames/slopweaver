import type { ReactElement } from "react";

import { Alignment } from "../../../components/console/Alignment";

export const metadata = { title: "Alignment" };

/**
 * Alignment: every was-this-the-right-call question, off the Queue, each a scene and one freeform reaction.
 *
 * @returns the page
 */
export default function AlignmentPage(): ReactElement {
  return <Alignment />;
}
