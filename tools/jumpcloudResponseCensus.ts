/**
 * Take the structural census `tools/generateJumpcloudResponseBoundaries.ts` declares every JumpCloud response
 * boundary from: run one production sync and one week of the auth-event read against the live tenant, and record
 * every answer's key paths, kinds and counts per surface (`src/atlas/jumpcloud/responseCensus.ts`) — never a value.
 *
 * Both reads admit each page through `admitJumpcloudCensusPage` (`src/atlas/jumpcloud/censusAdmit.ts`), the declared
 * carrier with no field checked, so a page that has drifted from today's boundaries is still walked past and its
 * later pages and fan-outs still measured. Walked through the production admitter, the census stops exactly where
 * the drift is.
 *
 * Run against a THROWAWAY home holding only a copy of the JumpCloud credential, never the operator's own, so the
 * sync's atlas lands nowhere anyone reads, and a fresh one, so no resumed generation skips a call:
 *
 * ```bash
 * yarn tsx tools/jumpcloudResponseCensus.ts <throwaway-home> <census.json>
 * ```
 *
 * A census is one walk's measurement of one tenant and is not committed. Name it, with every other census you hold,
 * on the generator's command line; the generator sums them and declares the boundaries from that sum.
 */
import { writeFileSync } from "node:fs";

import { productionAuthEventsDeps, readJumpcloudAuthEvents } from "../src/atlas/jumpcloud/authEventsRead.js";
import { admitJumpcloudCensusPage } from "../src/atlas/jumpcloud/censusAdmit.js";
import type { JumpcloudFetch } from "../src/atlas/jumpcloud/client.js";
import { jumpcloudPagedSurfaceNames } from "../src/atlas/jumpcloud/pagedSurfaces.js";
import {
  type JumpcloudResponseCensus,
  jumpcloudCensusSurfaceFor,
  observeJumpcloudAnswer,
} from "../src/atlas/jumpcloud/responseCensus.js";
import { syncJumpcloudAtlas } from "../src/atlas/jumpcloud/sync.js";
import { productionJumpcloudSyncDeps } from "../src/atlas/jumpcloud/syncDeps.js";
import { safeJsonStringify } from "../src/lib/safeJson.js";

const [home, out] = process.argv.slice(2);
if (home === undefined || out === undefined) {
  throw new Error("usage: yarn tsx tools/jumpcloudResponseCensus.ts <throwaway-home> <census.json>");
}

const census: JumpcloudResponseCensus = {};
const surfaces = jumpcloudPagedSurfaceNames();

/** The production fetch, with every answer it returns folded into the census on the way back. */
function observed({ fetch }: { fetch: JumpcloudFetch }): JumpcloudFetch {
  return async (request) => {
    const answer = await fetch(request);
    observeJumpcloudAnswer({
      census,
      status: answer.status,
      surface: jumpcloudCensusSurfaceFor({ method: request.method, surfaces, url: request.url }),
      text: answer.text,
    });
    return answer;
  };
}

const progress: (line: string) => void = (line) => {
  if (/kind|published|refus/i.test(line)) {
    process.stderr.write(`${line}\n`);
  }
};

const syncDeps = productionJumpcloudSyncDeps({ env: {}, home, progress });
if (syncDeps.isErr()) {
  throw new Error(syncDeps.error.join("; "));
}
const { client } = syncDeps.value;
const synced = await syncJumpcloudAtlas({
  deps: {
    ...syncDeps.value,
    admit: admitJumpcloudCensusPage,
    client: { ...client, fetch: observed({ fetch: client.fetch }) },
  },
  home,
});
// An unpublished generation is an `ok` report, so the line says which refusals stood rather than "answered".
if (synced.isErr()) {
  process.stderr.write(`sync: failed — ${synced.error.join("; ")}\n`);
} else if (synced.value.published) {
  process.stderr.write("sync: published\n");
} else {
  process.stderr.write(`sync: NOT published — ${synced.value.refusals.join("; ")}\n`);
}

const authDeps = productionAuthEventsDeps({ env: {}, home, maxPages: 20, progress });
if (authDeps.isErr()) {
  throw new Error(authDeps.error.join("; "));
}
const end = new Date();
const auth = await readJumpcloudAuthEvents({
  deps: {
    ...authDeps.value,
    admit: admitJumpcloudCensusPage,
    client: { ...authDeps.value.client, fetch: observed({ fetch: authDeps.value.client.fetch }) },
  },
  endIso: end.toISOString(),
  startIso: new Date(end.getTime() - 7 * 24 * 3600 * 1000).toISOString(),
});
if (auth.isErr()) {
  process.stderr.write(`auth events: failed — ${auth.error.message}\n`);
} else {
  const endings = auth.value.services.map(
    (walk) => `${walk.service} ${walk.ending.kind} after ${String(walk.pagesRead)} page(s)`,
  );
  process.stderr.write(`auth events: ${endings.join("; ")}\n`);
}

writeFileSync(out, `${safeJsonStringify({ label: "the JumpCloud response census", value: census })}\n`);
process.stderr.write(`census: ${String(Object.keys(census).length)} surface(s) observed, written to ${out}\n`);
