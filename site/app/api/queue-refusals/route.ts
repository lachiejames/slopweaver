import { NextResponse } from "next/server";

import { type LiveResult, runLiveVerb } from "../../../lib/liveVerbRun";
import { liveVerbFor } from "../../../lib/liveVerbs";
import { readPlacementOrganisation } from "../../../lib/placementOrganisationLive";
import {
  type QueueRefusalReport,
  queueRefusalReport,
  queueRefusalsOf,
  REFUSAL_REGISTER_SLUGS,
  type RefusalRegister,
} from "../../../lib/queueRefusalReport";

/**
 * Never prerendered: a report frozen at build time would name the cards withheld on the day the console was built.
 */
export const dynamic = "force-dynamic";

/** No ISR window either: each request re-reads the registers. */
export const revalidate = 0;

/**
 * Read one register through the live allowlist and the shared runner — the exact child the Queue page's tile runs.
 *
 * @param register the register, by `rowsOf`'s name for it
 * @returns what the runner answered, or a stated reason when the allowlist no longer holds its slug
 */
async function readRegister({ register }: { register: RefusalRegister }): Promise<LiveResult> {
  const slug = REFUSAL_REGISTER_SLUGS[register];
  const verb = liveVerbFor({ slug });
  if (verb === undefined) {
    return { notMeasured: `no live verb named ${slug}`, observedAtIso: new Date().toISOString(), ok: false };
  }
  return runLiveVerb({ verb });
}

/**
 * The cards a gate withheld from the owner's Queue, for the chair (`slopweaver queue refusals`).
 *
 * Always 200 with a `QueueRefusalReport`, an unread register or organisation included: that is a fact the report
 * states (`complete: false`), never a server failure. The organisation is read once per request, beside the registers.
 *
 * @returns the report
 */
export async function GET(): Promise<NextResponse<QueueRefusalReport>> {
  const [organisation, hands, board, drafts, posts, reviews, imports, landing, reviewers] = await Promise.all([
    readPlacementOrganisation(),
    readRegister({ register: "hands" }),
    readRegister({ register: "board" }),
    readRegister({ register: "drafts" }),
    readRegister({ register: "posts" }),
    readRegister({ register: "reviews" }),
    readRegister({ register: "imports" }),
    readRegister({ register: "landing" }),
    readRegister({ register: "reviewers" }),
  ]);
  const { unread, withheld } = queueRefusalsOf({
    organisation,
    results: { board, drafts, hands, imports, landing, posts, reviewers, reviews },
  });
  const report = queueRefusalReport({ observedAtIso: new Date().toISOString(), unread, withheld });
  return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
}
