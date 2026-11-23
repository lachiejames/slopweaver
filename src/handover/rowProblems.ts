/*
 * A row's own integrity defects, checked at the one place a doc becomes a doc (`./doc.ts`'s `parseHandoverDoc`), so
 * every board reader sees the same defects.
 */

import { askRowProblems } from "./askRow.js";
import type { HandoverDoc } from "./doc.js";
import { pausedProblems } from "./paused.js";
import { ASK_SETTLEMENTS } from "./rowKind.js";

/**
 * A declared `settlement:` that is none of the settlements, on any row. `asAskSettlement` swallows it into
 * "unsettled", which reads a typo'd ask as still open — and an open card hides the inbox group it stands for
 * (`../live/gmail/triageCarded.ts`), so the swallowing is a defect every reader must see rather than a default.
 */
function settlementValueProblems({ declared }: { declared: string | undefined }): readonly string[] {
  if (declared === undefined || ASK_SETTLEMENTS.some((settlement) => settlement === declared)) {
    return [];
  }
  return [`settlement: "${declared}" is not a settlement — use ${ASK_SETTLEMENTS.join(", ")}, or remove it`];
}

/**
 * A parsed doc with its row's own integrity defects added. Checked at the one place a doc becomes a doc, so every
 * board reader sees the same defects.
 *
 * @param doc the doc its fields parsed to
 * @param named reads one declared front-matter value, before any coercion
 * @returns the doc, its problems extended when the row has any defect
 */
export function withRowProblems({
  doc,
  named,
}: {
  doc: HandoverDoc;
  named: (args: { key: string }) => string | undefined;
}): HandoverDoc {
  // A row whose `kind:` is `doc` produces no ask defect, which is why 200-odd live docs are untouched by this.
  const askProblems = askRowProblems({
    declaredKind: named({ key: "kind" }),
    declaredOrigin: named({ key: "origin" }),
    doc,
  });
  // A pause naming nobody, or a `pausedOn:` beside another status, is a row every reader would place confidently
  // and wrongly. `./paused.ts` names each defect.
  const pauseProblems = pausedProblems({ declaredStatus: named({ key: "status" }), doc });
  const found = [
    ...askProblems,
    ...pauseProblems,
    ...settlementValueProblems({ declared: named({ key: "settlement" }) }),
  ];
  return found.length === 0 ? doc : { ...doc, problems: [...doc.problems, ...found] };
}
