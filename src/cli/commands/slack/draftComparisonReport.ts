/**
 * What `slack draft list` and `show` print about a row's comparison (`../../../outbound/slack/draftComparison.ts`):
 * a list row's lead while their pick is owed, and the show block naming the comparison's state, Codex's words beside
 * the original while they have chosen neither, and the pick once they have. Pure, beside `./draftReport.ts`.
 */
import {
  candidateDropsReceipts,
  codexDropsReceiptsRefusal,
  type DraftWords,
  pickOwed,
  pickOwedRefusal,
} from "../../../outbound/slack/draftComparison.js";
import type { ParkedDraftPayload, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";

/**
 * The list row's lead for a row waiting on their pick, so a chair scanning the list sees why it cannot be sent yet.
 *
 * @param item the folded row
 * @returns `PICK OWED · ` while they have chosen neither draft, `CODEX DRAFT OWED · ` while Codex's is still owed, else
 *   nothing
 */
export function comparisonMark({ item }: { item: SlackDraftItem }): string {
  if (!pickOwed({ item })) {
    return "";
  }
  return item.comparison?.state === "pending" ? "CODEX DRAFT OWED · " : "PICK OWED · ";
}

/**
 * The show block for a row's comparison: nothing for a row that never owed one.
 *
 * @param item the folded row
 * @param bodyOf renders a payload as readable lines, the same renderer the original's body is shown through
 * @returns the lines, after a blank separator
 */
export function comparisonShowLines({
  item,
  bodyOf,
}: {
  item: SlackDraftItem;
  bodyOf: (args: { payload: ParkedDraftPayload }) => readonly string[];
}): readonly string[] {
  const { comparison, pick } = item;
  if (comparison === undefined) {
    return [];
  }
  if (pick !== undefined) {
    return pickedLines({ bodyOf, item, original: item.original, pick });
  }
  switch (comparison.state) {
    case "pending":
      return [
        "",
        `codex    a draft beside this one is owed, and neither is sent before it is shown: ` +
          `slopweaver slack draft compare ${item.id}`,
      ];
    case "skipped":
      return ["", `codex    no draft beside this one (${comparison.reason})`];
    case "unavailable":
      return ["", `codex    no draft yet — ${comparison.reason}. Retry: slopweaver slack draft compare ${item.id}`];
    case "refused":
      return ["", `codex    its draft was refused at ${comparison.stage}:`, ...comparison.reasons];
    case "ready":
      return [
        "",
        `— Codex's draft beside it (${comparison.requestedModel}), digest ${comparison.candidate.digest} —`,
        ...bodyOf({ payload: comparison.candidate.payload }),
        "",
        ...(candidateDropsReceipts({ item }) ? [codexDropsReceiptsRefusal({ id: item.id })] : []),
        pickOwedRefusal({ id: item.id, pending: false }),
      ];
    default: {
      const unreachable: never = comparison;
      return unreachable;
    }
  }
}

/** The pick, and the original's words when a Codex pick replaced them, so the swap is never invisible. */
function pickedLines({
  bodyOf,
  item,
  original,
  pick,
}: {
  bodyOf: (args: { payload: ParkedDraftPayload }) => readonly string[];
  item: SlackDraftItem;
  original: DraftWords | undefined;
  pick: NonNullable<SlackDraftItem["pick"]>;
}): readonly string[] {
  const heard = pick.voice === undefined ? "" : ` — heard "${pick.voice.heard}" (${pick.voice.anchor})`;
  const line = `picked   the ${pick.variant} draft at ${pick.atIso} over ${pick.model}${heard}`;
  if (original === undefined) {
    return ["", line];
  }
  return [
    "",
    line,
    `— the original it replaced on ${item.id}, digest ${original.digest} —`,
    ...bodyOf({ payload: original.payload }),
  ];
}
