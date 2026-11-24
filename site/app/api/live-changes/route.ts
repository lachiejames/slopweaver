/**
 * The Queue's change stream: server-sent events naming each register that moved, which signals are up, and a
 * heartbeat every 15 seconds so a dead connection shows. The page holds ONE of these per browser, not per tab
 * (`components/live/LiveChanges.tsx`), because every console tab shares the origin's six connections and a stream
 * holds one for as long as it is open.
 *
 * Read-only and carrying no register content, only register names: the page re-reads each one through the live route
 * exactly as its poll did. Not under `/api/live/` so no verb slug can ever collide with it.
 */

import { listenForLiveChanges } from "../../../lib/liveChangesServer";
import { liveChangeFrame } from "../../../lib/liveChangeWire";

/** Never prerendered, never cached: it is a live stream. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** Node, never Edge: the broker holds file watches and a Postgres connection, neither of which Edge can open. */
export const runtime = "nodejs";

/**
 * Open the stream.
 *
 * @param request the page's `EventSource` request; its abort ends the stream
 * @returns the event stream
 */
export function GET(request: Request): Response {
  const encoder = new TextEncoder();
  let stop: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => {
      stop();
    },
    start: (controller) => {
      let open = true;
      const unlisten = listenForLiveChanges({
        listener: (event) => {
          if (open) {
            controller.enqueue(encoder.encode(liveChangeFrame({ event })));
          }
        },
      });
      stop = () => {
        if (!open) {
          return;
        }
        open = false;
        unlisten();
        request.signal.removeEventListener("abort", stop);
        controller.close();
      };
      request.signal.addEventListener("abort", stop);
      // A page gone before this ran never fires "abort" again; left listening, it would keep the watches alive.
      if (request.signal.aborted) {
        stop();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}
