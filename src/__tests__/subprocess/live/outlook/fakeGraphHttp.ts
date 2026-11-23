/**
 * The three HTTP steps every `fakeGraphServer.ts` route shares: answer JSON, answer Graph's error envelope, and
 * read a request body whole.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { text } from "node:stream/consumers";

/**
 * Answer JSON with a status.
 *
 * @param body the value serialised as the response
 */
export function json({ res, status, body }: { res: ServerResponse; status: number; body: unknown }): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Answer a Graph error envelope.
 *
 * @param code Graph's error code, echoed into a synthetic message
 */
export function graphError({ res, status, code }: { res: ServerResponse; status: number; code: string }): void {
  json({ body: { error: { code, message: `synthetic ${code}` } }, res, status });
}

/**
 * Read a request body whole.
 *
 * @returns the body as UTF-8
 */
export async function bodyOf({ req }: { req: IncomingMessage }): Promise<string> {
  return text(req);
}
