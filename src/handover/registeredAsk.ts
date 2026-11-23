/**
 * A REGISTERED ask waiting on the owner's word with no run behind it — the row `handover register` writes with its
 * whole shape, which is already the decision the owner is asked to take.
 *
 * ## The defect, measured
 *
 * A search of the owner's Queue found nothing, while every chair pass had named four asks as on the Queue. All
 * four were `kind: ask`, `status: ready`, with a problem, options and a
 * lean in their front-matter — and no run, so no journalled question. The Queue draws the owner's `ownerWait` verdict,
 * and that verdict was derived only off a RUN parked on the owner, so each sat in `RUN NOW` instead, where `handover
 * reconcile` ranked it a STARVING row for a seat to pick up. Nothing but a hand `handover start` then `handover
 * ask` put one in front of the owner. After those four were asked by hand, 26 more stood the same
 * way:`slopweaver handover list --json | jq '[.rows[] | select(.kind == "ask" and .problem != null and .run
 * == "never-started" and .section == "RUN NOW")] | length'`.
 *
 * ## Why the row is drawn as it stands rather than refused at register time
 *
 * `./askShape.ts` says what the shape IS: a row that waits on the owner's word carries one, and `--finding` and
 * `--dispatch` are the declared exceptions because they wait on nobody's pick. So a whole shape on a
 * registered ask is the register already saying the owner's. Refusing it until a run asks would leave every row
 * registered before the refusal invisible, and make a second verb the price of the first.
 *
 * ## Why each condition, and what each one defers to
 *
 * - **No run ever opened** (`never-started`). A run that opened owns the question: its journal says what it
 *   asked, or how its cycle ended, and reading past an ending would resurrect an abandoned run as an ask.
 * - **`ready`**, the one status that would otherwise compose to `RUN NOW` — a paused, drafted, in-progress or
 *   terminal row keeps its own placement.
 * - **Unsettled**, and **no dated ruling at or after `askedIso`** — `./ownerWait.ts`'s `answeringRuling`, the
 *   same pick the run arm makes. Once `handover rule` records the owner's word the row stops waiting on them and
 *   becomes work for a seat. An authored front-matter `ruling:` cannot date itself and keeps it the owner's, as there.
 * - **An `askedIso` that parses**, because it is the instant the Queue ages the row from.
 *
 * Pure: an already-parsed doc, its derived state and its run disposition in, the ask out. No filesystem, no
 * clock.
 */

import { collapseWhitespace } from "#lib/oneLineSummary.js";
import { shapeCompleteness } from "./askShape.js";
import type { RunDisposition } from "./boardTypes.js";
import type { DerivedRowState } from "./derivedRowState.js";
import type { HandoverDoc } from "./doc.js";
import { answeringRuling, datedRulingOf } from "./ownerWait.js";

/** A registered ask waiting on the owner's word: what it asks, and when the owner was asked. */
export interface RegisteredAsk {
  /** The row's own summary — the `--ask` it was registered with. */
  readonly question: string;
  readonly askedIso: string;
}

/**
 * The registered ask a row carries while it waits on the owner's word with no run behind it.
 *
 * @param doc the row's parsed doc, whose front-matter carries the shape and the asked instant
 * @param derived the row's derived state, whose `status`, `settlement` and `ruling` are register-first
 * @param run the row's run disposition — anything but `never-started` means a run owns the question
 * @returns the ask, or `undefined` for every row that is not one
 */
export function registeredAskOf({
  doc,
  derived,
  run,
}: {
  doc: HandoverDoc;
  derived: DerivedRowState;
  run: RunDisposition;
}): RegisteredAsk | undefined {
  if (doc.kind !== "ask" || run.kind !== "never-started" || derived.status !== "ready") {
    return undefined;
  }
  if (derived.settlement !== undefined) {
    return undefined;
  }
  if (shapeCompleteness({ lean: doc.lean, options: doc.options, problem: doc.problem }) !== "whole") {
    return undefined;
  }
  const { summary, askedIso } = doc;
  if (summary === undefined || askedIso === undefined || Number.isNaN(Date.parse(askedIso))) {
    return undefined;
  }
  const ruled = answeringRuling({
    run: { askedIso },
    standing: datedRulingOf({ ruling: derived.ruling }),
  });
  if (ruled !== undefined) {
    return undefined;
  }
  // One line: a `--keep-lines` summary holds real breaks, and the question is printed inside a board reason.
  return { askedIso, question: collapseWhitespace({ text: summary }) };
}
