/**
 * The page's half of attaching a file in the Messenger: the file the owner picked, posted to `/api/talk/attach`, which keeps a
 * copy under the owner's home and answers with where. Nothing reaches the voice here; the owner's message, sent afterwards, names the
 * kept file (`site/lib/messengerAttachment.ts`).
 */
import { isBag } from "../../lib/bag";
import {
  type MessengerAttachReceipt,
  messengerAttachPrecheck,
  messengerAttachReceiptOf,
} from "../../lib/messengerAttachment";

/** How long one attach may take: the route's own verb bound, with room. */
const ATTACH_TIMEOUT_MS = 30_000;

/** How many bytes go through `String.fromCharCode` at once, under every engine's argument limit. */
const BASE64_CHUNK = 0x8000;

/** How one attach landed: kept with the verb's receipt, or why not. */
export type AttachSend =
  | { readonly kind: "kept"; readonly receipt: MessengerAttachReceipt }
  | { readonly kind: "refused"; readonly why: string };

/**
 * A file's bytes as standard, padded base64.
 *
 * @param bytes the file's bytes
 * @returns the base64 the route decodes
 */
export function base64Of({ bytes }: { bytes: Uint8Array }): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * Keep one file the owner picked.
 *
 * @param file the file from the owner's picker
 * @returns how it landed
 */
export async function attachFile({ file }: { file: File }): Promise<AttachSend> {
  const early = messengerAttachPrecheck({ bytes: file.size });
  if (early !== undefined) {
    return { kind: "refused", why: early };
  }
  let response: Response;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    response = await fetch("/api/talk/attach", {
      body: JSON.stringify({ base64: base64Of({ bytes }), name: file.name }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(ATTACH_TIMEOUT_MS),
    });
  } catch (cause) {
    return { kind: "refused", why: `the console server did not answer: ${String(cause)}` };
  }
  const body: unknown = await response.json().catch(() => undefined);
  return attachSendOf({ body, status: response.status });
}

/**
 * Read the attach route's answer.
 *
 * @param status the HTTP status
 * @param body the parsed body, or `undefined` when it was not JSON
 * @returns kept with its receipt only on the route's own 2xx, else the reason
 */
export function attachSendOf({ status, body }: { status: number; body: unknown }): AttachSend {
  const answered = status >= 200 && status < 300;
  if (answered && isBag(body) && body["outcome"] === "kept" && isBag(body["receipt"])) {
    const receipt = messengerAttachReceiptOf({ out: JSON.stringify(body["receipt"]) });
    if (receipt !== undefined) {
      return { kind: "kept", receipt };
    }
  }
  if (isBag(body) && typeof body["why"] === "string") {
    return { kind: "refused", why: body["why"] };
  }
  return { kind: "refused", why: `the attach route answered HTTP ${String(status)}` };
}
