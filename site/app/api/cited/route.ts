import { NextResponse } from "next/server";

import {
  CITED_TIMEOUT_MS,
  type CitedArgv,
  type CitedResult,
  citedPullOf,
  citedReadArgvs,
  citedRecordOf,
  citedTicketOf,
} from "../../../lib/citedRecord";
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
}: CitedArgv): Promise<
  { readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly why: string }
> {
  const ran = await spawnVerb({ argv, timeoutMs: CITED_TIMEOUT_MS, title });
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
 * What a citation chip's hover card reads about a pull request or Linear ticket it names: `?url=<address>`. Every
 * step, and why a pull request in the landing reading never comes here, is `../../../lib/citedRecord.ts`.
 *
 * @returns the record's title and state, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<CitedResult>> {
  const observedAtIso = new Date().toISOString();
  const url = new URL(request.url).searchParams.get("url");
  if (url === null) {
    return NextResponse.json({ notMeasured: "no address: ?url=<address>", observedAtIso, ok: false });
  }
  const record = citedRecordOf({ url });
  if (record === undefined) {
    return NextResponse.json({
      notMeasured: `${url} is not a pull request or Linear issue the card reads`,
      observedAtIso,
      ok: false,
    });
  }
  const argvs = citedReadArgvs({ record });
  const answers = await Promise.all(argvs.map(async (one) => readJson(one)));
  const payloads: unknown[] = [];
  for (const answer of answers) {
    if (!answer.ok) {
      return NextResponse.json({ notMeasured: answer.why, observedAtIso, ok: false });
    }
    payloads.push(answer.payload);
  }
  let read;
  if (record.kind === "pull") {
    read = citedPullOf({ payload: payloads[0], record });
  } else {
    read = citedTicketOf({ read: payloads[0], record, states: payloads[1] });
  }
  if (read === undefined) {
    const commands = argvs.map((one) => one.title).join(" and ");
    return NextResponse.json({
      notMeasured: `${commands} answered in a shape this card does not read`,
      observedAtIso,
      ok: false,
    });
  }
  return NextResponse.json({ observedAtIso, ok: true, read });
}
