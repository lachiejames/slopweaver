/**
 * What every Queue panel shares: the header and row it is handed, the record disclosure's name, the act footer's
 * sentence, and the `refused` prop each panel derives from its row.
 */
import type { ReactNode } from "react";

import type { CardProperties } from "../../lib/cardPropertiesTypes";
import type { QueueRow } from "../../lib/queueRows";
import type { ReasonWords } from "../../lib/quotedReason";

/** What every panel's header carries, built once by the queue and handed to the register's own panel. */
export interface Head {
  readonly label: string;
  readonly title: ReactNode;
  readonly meta: ReactNode;
  /** The owner's words on the card look by look, folded, when it has taken a lap (`./CardLaps.tsx`). */
  readonly note: ReactNode;
  readonly onClose: () => void;
}

/** What every panel needs from the row it was opened on, beyond its own record. */
export interface PanelCommon {
  /** The row, with its Linear-style properties (`../../lib/cardProperties.ts`) that head the "Read from" column. */
  readonly row: QueueRow & { readonly properties: CardProperties };
  readonly gone: boolean;
  readonly head: Head;
  /** Every address the row carries (`cardAddresses`), so each number and key its sentences name links. */
  readonly known: readonly string[];
}

/**
 * What every panel's record disclosure calls itself.
 *
 * It does not say "as the verb printed it", because the record's fields are drawn as
 * short labelled lines, and a field too long to be a line draws its head with the whole behind "show all"
 * (`site/lib/recordLines.ts`), so expanding it never gives a wall of text.
 */
export const RECORD_SUMMARY = "what the record carries, field by field";

/** The sentence every act footer ends on. */
export const FOOT_NOTE =
  "Each button runs one slopweaver verb on this machine and says what it wrote. Nothing here launches a model.";

/**
 * A panel's `refused` prop from its row's form (`../../lib/briefingCardForm.ts`): a card that would draw a field its
 * record does not hold draws the refusal instead of the field. The form's own words travel, never the voice's
 * flattened sentence, so a quoted read's reason reaches the card still split from the console's lead (steer 7).
 *
 * @param row the queue row the panel draws
 * @returns `{ refused }` when the form refused the card, else nothing
 */
export function refusedProps({ row }: { row: QueueRow }): { refused?: ReasonWords } {
  const form = row.record.form;
  if (form.kind !== "refused") {
    return {};
  }
  return { refused: form.why };
}
