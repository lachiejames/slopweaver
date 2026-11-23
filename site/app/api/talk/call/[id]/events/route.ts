/**
 * A plan call's event stream: the tool calls its delegated Codex thread makes, its errors, and its end, as
 * newline-delimited JSON the page reads with `fetch` — a POST rather than an `EventSource` GET, so the full
 * console-press guard applies to it exactly as to every other call route.
 *
 * Each line is `{ seq, event }`, or `{ heartbeat: true }` every 15 seconds so a dead connection shows. The page
 * reconnects with `{ after: <last seq> }` and gets what it missed replayed from the call's ring. While no stream
 * is attached the call counts down its absent-stream grace (`talkPlanCallWire.ts`), so a closed tab ends the call.
 */
import { NextResponse } from "next/server";

import { num } from "../../../../../../lib/bag";
import type { SequencedEvent } from "../../../../../../lib/planCallContract";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";

/** Never prerendered, never cached: it is a live stream. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** `{ after }` is all the body carries. */
const BODY_MAX_BYTES = 256;

/** How often an idle stream says it is still there. */
const HEARTBEAT_MS = 15_000;

/**
 * Open the stream.
 *
 * @param request the press, whose JSON body is `{ after }` — the last sequence number the page saw, `0` for none
 * @param context the call id
 * @returns the NDJSON stream, or the refusal
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: BODY_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { status: read.status });
  }
  const after = num({ bag: read.body, key: "after" });
  if (after === undefined || after < 0) {
    return NextResponse.json({ ok: false, refused: "the body carries no `after` sequence number" }, { status: 400 });
  }
  const { call } = read;
  const encoder = new TextEncoder();
  let stop: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => {
      stop();
    },
    start: (controller) => {
      let open = true;
      const send = (value: unknown): void => {
        if (open) {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        }
      };
      const deliver = (entry: SequencedEvent): void => {
        send(entry);
        if (entry.event.kind === "closed") {
          stop();
        }
      };
      const heartbeat = setInterval(() => {
        send({ heartbeat: true });
      }, HEARTBEAT_MS);
      const { replay, unsubscribe } = call.subscribe({ after, listener: deliver });
      stop = () => {
        if (!open) {
          return;
        }
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", stop);
        controller.close();
      };
      request.signal.addEventListener("abort", stop);
      // A page gone before this ran never fires "abort" again; left subscribed, it would hold off the absent-stream end.
      if (request.signal.aborted) {
        stop();
        return;
      }
      for (const entry of replay) {
        deliver(entry);
      }
    },
  });
  return new Response(stream, {
    headers: { "cache-control": "no-store", "content-type": "application/x-ndjson; charset=utf-8" },
  });
}
