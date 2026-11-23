import { NextResponse } from "next/server";

import { PULL_TIMEOUT_MS, pullAddressOf, pullAvatarsArgv, pullReadArgv } from "../../../lib/pullAddress";
import { pullLogins, readPullDocument } from "../../../lib/pullView";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: the pull request as `github read` printed it, and its people's pictures. */
export type PullResult =
  | {
      readonly ok: true;
      readonly observedAtIso: string;
      readonly document: unknown;
      /** The roster narrowed to the pull request's people, or the reason it could not be read — never a guess. */
      readonly people: { readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly why: string };
    }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Read one pull request live from GitHub, through the door: `?url=<any GitHub address naming a pull request>`. The
 * same two-step shape as `../thread/route.ts` — the object, then the member roster narrowed to its people — and
 * the same rule: nothing here polls; the page reads again when the owner opens it or presses re-read.
 *
 * @returns the document and its people, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<PullResult>> {
  const observedAtIso = new Date().toISOString();
  const url = new URL(request.url).searchParams.get("url");
  if (url === null) {
    return NextResponse.json({ notMeasured: "no address: ?url=<pull request address>", observedAtIso, ok: false });
  }
  const address = pullAddressOf({ url });
  if (address === undefined) {
    return NextResponse.json({ notMeasured: `${url} does not name a GitHub pull request`, observedAtIso, ok: false });
  }
  const read = pullReadArgv({ address });
  const ran = await spawnVerb({ argv: read.argv, timeoutMs: PULL_TIMEOUT_MS, title: read.title });
  if (!ran.ok) {
    return NextResponse.json({ notMeasured: ran.notMeasured, observedAtIso, ok: false });
  }
  let document: unknown;
  try {
    document = JSON.parse(ran.out);
  } catch {
    return NextResponse.json({
      notMeasured: `${read.title} printed something that is not JSON`,
      observedAtIso,
      ok: false,
    });
  }
  const view = readPullDocument({ payload: document });
  if (view === undefined) {
    return NextResponse.json({
      notMeasured: `${read.title} answered in a shape this page does not read`,
      observedAtIso,
      ok: false,
    });
  }
  const logins = pullLogins({ view });
  if (logins.length === 0) {
    return NextResponse.json({
      document,
      observedAtIso,
      ok: true,
      people: { ok: false, why: "no one on it has a login" },
    });
  }
  const roster = pullAvatarsArgv({ logins });
  if (roster.kind === "refused") {
    return NextResponse.json({ document, observedAtIso, ok: true, people: { ok: false, why: roster.why } });
  }
  const people = await spawnVerb({ argv: roster.argv.argv, timeoutMs: PULL_TIMEOUT_MS, title: roster.argv.title });
  if (!people.ok) {
    return NextResponse.json({ document, observedAtIso, ok: true, people: { ok: false, why: people.notMeasured } });
  }
  try {
    const payload: unknown = JSON.parse(people.out);
    return NextResponse.json({ document, observedAtIso, ok: true, people: { ok: true, payload } });
  } catch {
    return NextResponse.json({
      document,
      observedAtIso,
      ok: true,
      people: { ok: false, why: `${roster.argv.title} printed something that is not JSON` },
    });
  }
}
