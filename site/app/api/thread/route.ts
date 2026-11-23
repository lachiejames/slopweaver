import { NextResponse } from "next/server";
import { spawnVerb } from "../../../lib/spawnVerb";
import { avatarsArgv, THREAD_TIMEOUT_MS, threadArgv } from "../../../lib/threadVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: the thread as `store around` printed it, and its authors' pictures. */
export type ThreadResult =
  | {
      readonly ok: true;
      readonly observedAtIso: string;
      readonly thread: unknown;
      /** The roster narrowed to the thread's authors, or the reason it could not be read — never a guess. */
      readonly people: { readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly why: string };
    }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * The distinct `authorNativeId`s in a `store around --json` payload, read leniently: a payload this cannot
 * read yields none, and the page's own reader says so.
 *
 * @returns the ids, in first-seen order
 */
function authorIdsOf({ payload }: { payload: unknown }): readonly string[] {
  if (typeof payload !== "object" || payload === null || !("records" in payload)) {
    return [];
  }
  const records: unknown = payload.records;
  if (!Array.isArray(records)) {
    return [];
  }
  const out: string[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null || !("authorNativeId" in record)) {
      continue;
    }
    const id: unknown = record.authorNativeId;
    if (typeof id === "string" && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * Read one thread by permalink or `<channel>:<ts>` id: `?id=<…>`.
 *
 * @returns the thread and its people, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<ThreadResult>> {
  const observedAtIso = new Date().toISOString();
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return NextResponse.json({ notMeasured: "no id: ?id=<permalink | channel:ts>", observedAtIso, ok: false });
  }
  const built = threadArgv({ id });
  if (built.kind === "refused") {
    return NextResponse.json({ notMeasured: built.why, observedAtIso, ok: false });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: THREAD_TIMEOUT_MS, title: built.title });
  if (!ran.ok) {
    return NextResponse.json({ notMeasured: ran.notMeasured, observedAtIso, ok: false });
  }
  let thread: unknown;
  try {
    thread = JSON.parse(ran.out);
  } catch {
    return NextResponse.json({
      notMeasured: `${built.title} printed something that is not JSON`,
      observedAtIso,
      ok: false,
    });
  }
  const ids = authorIdsOf({ payload: thread });
  if (ids.length === 0) {
    return NextResponse.json({
      observedAtIso,
      ok: true,
      people: { ok: false, why: "no record names an author id" },
      thread,
    });
  }
  const roster = avatarsArgv({ ids });
  if (roster.kind === "refused") {
    return NextResponse.json({ observedAtIso, ok: true, people: { ok: false, why: roster.why }, thread });
  }
  const read = await spawnVerb({ argv: roster.argv, timeoutMs: THREAD_TIMEOUT_MS, title: roster.title });
  if (!read.ok) {
    return NextResponse.json({ observedAtIso, ok: true, people: { ok: false, why: read.notMeasured }, thread });
  }
  try {
    const payload: unknown = JSON.parse(read.out);
    return NextResponse.json({ observedAtIso, ok: true, people: { ok: true, payload }, thread });
  } catch {
    return NextResponse.json({
      observedAtIso,
      ok: true,
      people: { ok: false, why: `${roster.title} printed something that is not JSON` },
      thread,
    });
  }
}
