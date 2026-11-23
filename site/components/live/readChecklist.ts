/*
 * A hand step's checklist, read off the register's published row (`hand post --checklist`, `src/hand/checklist.ts`):
 * every command its own copy block, every value the owner fetches named by where it sits. Its own module beside `./read.ts`,
 * the way `./readAction.ts` is.
 */
import { isBag, str, strings } from "../../lib/bag";

/** One line of a step's checklist, exactly as the register publishes it (`src/hand/checklist.ts`). */
export interface HandChecklistLine {
  readonly action: string;
  readonly command: string | undefined;
  readonly find: readonly string[] | undefined;
  readonly url: string | undefined;
}

/**
 * Read a step's checklist, whole or not at all — a card that silently lost a line, or a line's command, is the card
 * reading as a whole script that is merely short.
 *
 * @param value the raw `checklist` field
 * @returns `{ checklist }`, its `checklist` undefined when absent, or `undefined` when present and not whole
 */
export function readHandChecklist({
  value,
}: {
  value: unknown;
}): { readonly checklist: readonly HandChecklistLine[] | undefined } | undefined {
  if (value === undefined) {
    return { checklist: undefined };
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lines: HandChecklistLine[] = [];
  for (const one of value as readonly unknown[]) {
    if (!isBag(one)) {
      return undefined;
    }
    const action = str({ bag: one, key: "action" });
    const command = one["command"];
    const url = one["url"];
    const find = one["find"] === undefined ? undefined : strings({ bag: one, key: "find" });
    const badFind = one["find"] !== undefined && find === undefined;
    // A line's page places nothing, and the register admits a local `file:///` one, so any string reads.
    const badUrl = url !== undefined && typeof url !== "string";
    if (action === undefined || (command !== undefined && typeof command !== "string") || badFind || badUrl) {
      return undefined;
    }
    lines.push({ action, command, find, url });
  }
  return { checklist: lines };
}
