import { NextResponse } from "next/server";
import {
  ACT_PULL_CANDIDATES,
  ACT_PULL_TIMEOUT_MS,
  type ActPullRead,
  type ActPullResult,
  actPullCandidates,
  actPullRead,
  actPullReadArgv,
  actPullSearchArgv,
  exactActPulls,
} from "../../../lib/actPullVerb";

import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Run one verb and parse what it printed, or say why that was not possible.
 *
 * @returns the parsed payload, or the reason it was not measured
 */
async function readJson({
  argv,
  title,
}: {
  argv: readonly string[];
  title: string;
}): Promise<{ readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly why: string }> {
  // From the checkout whose binary runs, so the search's repository is that tree's own `origin`.
  const ran = await spawnVerb({ argv, atCheckoutRoot: true, timeoutMs: ACT_PULL_TIMEOUT_MS, title });
  if (!ran.ok) {
    return { ok: false, why: ran.notMeasured };
  }
  try {
    const payload: unknown = JSON.parse(ran.out);
    return { ok: true, payload };
  } catch {
    return { ok: false, why: `${title} printed something that is not JSON` };
  }
}

/**
 * The pull requests opened from one branch, merged or not: `?branch=<name>`. Every step and why it is two
 * verbs is `../../../lib/actPullVerb.ts`.
 *
 * @returns the exact pull requests, or the one reason they were not measured
 */
export async function GET(request: Request): Promise<NextResponse<ActPullResult>> {
  const observedAtIso = new Date().toISOString();
  const branch = new URL(request.url).searchParams.get("branch");
  if (branch === null) {
    return NextResponse.json({ notMeasured: "no branch: ?branch=<name>", observedAtIso, ok: false });
  }
  const search = actPullSearchArgv({ branch });
  if (search.kind === "refused") {
    return NextResponse.json({ notMeasured: search.why, observedAtIso, ok: false });
  }
  const searched = await readJson({ argv: search.argv, title: search.title });
  if (!searched.ok) {
    return NextResponse.json({ notMeasured: searched.why, observedAtIso, ok: false });
  }
  const matched = actPullCandidates({ payload: searched.payload });
  if (matched === undefined) {
    return NextResponse.json({
      notMeasured: `${search.title} answered in a shape this card does not read`,
      observedAtIso,
      ok: false,
    });
  }
  const { beyond, candidates, repo } = matched;
  const reads = await Promise.all(
    candidates.slice(0, ACT_PULL_CANDIDATES).map(async (candidate) => {
      const read = actPullReadArgv({ repo, url: candidate.url });
      if (read.kind === "refused") {
        return { ok: false, why: read.why } as const;
      }
      const answered = await readJson({ argv: read.argv, title: read.title });
      if (!answered.ok) {
        return answered;
      }
      const pull = actPullRead({ payload: answered.payload, repo });
      if (pull === undefined) {
        return { ok: false, why: `${read.title} answered in a shape this card does not read` } as const;
      }
      return { ok: true, read: pull } as const;
    }),
  );
  const pulls: ActPullRead[] = [];
  for (const read of reads) {
    if (!read.ok) {
      // A candidate that could not be read is not ruled out, so no answer is honest here.
      return NextResponse.json({ notMeasured: read.why, observedAtIso, ok: false });
    }
    pulls.push(read.read);
  }
  const exact = exactActPulls({ beyond, branch, candidates, reads: pulls });
  return NextResponse.json({ observedAtIso, ok: true, pulls: exact.pulls, repo, unchecked: exact.unchecked });
}
