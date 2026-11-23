import { NextResponse } from "next/server";

import { type LiveResult, runLiveVerb } from "../../../lib/liveVerbRun";
import { liveVerbFor } from "../../../lib/liveVerbs";
import { readPlacementOrganisation } from "../../../lib/placementOrganisationLive";
import {
  type QueueStoppingReport,
  queueStoppingReport,
  STOPPING_REGISTER_SLUGS,
  type StoppingRegister,
} from "../../../lib/queueStoppingReport";

/** Never prerendered: a report frozen at build time would name the cards stopping the owner's work on the day it was built. */
export const dynamic = "force-dynamic";

/** No ISR window either: each request re-reads the registers. */
export const revalidate = 0;

/**
 * Read one register through the live allowlist and the shared runner — the exact child the Queue page's tile runs.
 *
 * @param register the register
 * @returns what the runner answered, or a stated reason when the allowlist no longer holds its slug
 */
async function readRegister({ register }: { register: StoppingRegister }): Promise<LiveResult> {
  const slug = STOPPING_REGISTER_SLUGS[register];
  const verb = liveVerbFor({ slug });
  if (verb === undefined) {
    return { notMeasured: `no live verb named ${slug}`, observedAtIso: new Date().toISOString(), ok: false };
  }
  return runLiveVerb({ verb });
}

/**
 * The cards stopping the owner's work, in the order the owner's Queue leads with them, for the chair (`slopweaver queue stopping`).
 *
 * Always 200 with a `QueueStoppingReport`, an unread register or organisation included: that is a fact the report
 * states (`complete: false`), never a server failure. The organisation is read once per request, beside the registers.
 *
 * @returns the report
 */
export async function GET(): Promise<NextResponse<QueueStoppingReport>> {
  const [organisation, hands, board, workstreams] = await Promise.all([
    readPlacementOrganisation(),
    readRegister({ register: "hands" }),
    readRegister({ register: "board" }),
    readRegister({ register: "workstreams" }),
  ]);
  const report = queueStoppingReport({
    observedAtIso: new Date().toISOString(),
    organisation,
    results: { board, hands, workstreams },
  });
  return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
}
