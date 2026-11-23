import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { type LiveFixture, liveFixtureFor } from "../../../../lib/liveFixtures";
import { rideOrRun } from "../../../../lib/liveFlights";
import { LIVE_FLIGHTS } from "../../../../lib/liveFlightsServer";
import { type LiveResult, runLiveVerb } from "../../../../lib/liveVerbRun";
import { type LiveVerb, liveVerbFor } from "../../../../lib/liveVerbs";
import { startPackKeeper } from "../../../../lib/packKeeper";
import { savedReadingsDirectory, saveReading } from "../../../../lib/savedReadings";

export type { LiveResult };

/**
 * Never prerendered. Without this, `next build` evaluates the route once and the page ships a number
 * frozen at build time — a console showing a stale figure with no way to tell, which is the exact failure
 * every tile on this site is written to avoid.
 */
export const dynamic = "force-dynamic";

/** No ISR window either: the whole point is that each request re-reads the machine. */
export const revalidate = 0;

/**
 * Every verb read this server has under way (`site/lib/liveFlightsServer.ts`), forgotten by the act route after a
 * write. The run itself, its parse and its stamp, are `site/lib/liveVerbRun.ts`'s, shared with the chair's report route.
 */
const flights = LIVE_FLIGHTS;

/**
 * Run one real flight, and save its reading when it answered, for the first load after the next restart
 * (`site/lib/savedReadings.ts`, which keeps only each slug's newest reading on disk, across processes).
 *
 * Inside the callback `rideOrRun` calls only for a new flight, so a reader riding it never saves the same answer
 * twice. Not awaited: the answer goes back unchanged and the save encodes it on a later turn.
 *
 * @param slug the allowlist row's slug
 * @param verb the allowlist row
 * @returns the flight's reading, exactly as the verb answered
 */
async function runAndSave({ slug, verb }: { slug: string; verb: LiveVerb }): Promise<LiveResult> {
  const result = await runLiveVerb({ verb });
  if (result.ok) {
    void saveReading({ directory: savedReadingsDirectory(), result, slug });
  }
  return result;
}

/**
 * Serve one frozen reading in a verb's place.
 *
 * The path is joined from the ROW — `site/fixtures/<slug>/<file>` — and never from the request, and
 * `observedAtIso` is the fixture's frozen instant so the tile ages it honestly: a fixture read today reports
 * how old that instant is, not `just now`.
 *
 * @param fixture the resolved row
 * @returns the frozen payload labelled as such, or a stated reason the file could not be read
 */
async function serveFixture({ fixture }: { fixture: LiveFixture }): Promise<LiveResult> {
  const path = join(process.cwd(), "fixtures", fixture.slug, fixture.file);
  try {
    const payload: unknown = JSON.parse(await readFile(path, "utf8"));
    return { fixture: fixture.name, observedAtIso: fixture.frozenAtIso, ok: true, payload, stampedByRoute: false };
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return {
      notMeasured: `fixture ${fixture.name} could not be read from ${path}: ${why}`,
      observedAtIso: new Date().toISOString(),
      ok: false,
    };
  }
}

/**
 * Read one live verb.
 *
 * Always 200 with a `LiveResult` body, including when the verb failed. A 500 here would make a failure
 * indistinguishable from the page being broken, and the tile's job is to say which.
 *
 * @returns the verb's payload, or the stated reason it could not be read
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ verb: string }> },
): Promise<NextResponse<LiveResult | { readonly error: string }>> {
  const { verb: slug } = await context.params;
  const verb = liveVerbFor({ slug });
  if (verb === undefined) {
    // 404 rather than a LiveResult: an unknown slug is a bug in the page, not a machine that would not answer.
    return NextResponse.json({ error: `no live verb named ${slug}` }, { status: 404 });
  }
  const query = new URL(request.url).searchParams;
  const name = query.get("fixture");
  if (name !== null) {
    const fixture = liveFixtureFor({ name, slug });
    if (fixture === undefined) {
      // Same reasoning as the slug: a name the map does not hold is a page bug, not a machine that would not answer.
      return NextResponse.json({ error: `no fixture named ${name} for ${slug}` }, { status: 404 });
    }
    return NextResponse.json(await serveFixture({ fixture }), { headers: { "cache-control": "no-store" } });
  }
  // A real read means a console page is open, so the voice's pack starts being kept fresh (`lib/packKeeper.ts`).
  startPackKeeper();
  const fresh = query.get("fresh") === "1";
  const { answer } = rideOrRun({ flights, fresh, key: slug, run: () => runAndSave({ slug, verb }) });
  return NextResponse.json(await answer, {
    headers: { "cache-control": "no-store" },
  });
}
