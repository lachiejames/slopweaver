/**
 * Keep a file the owner attached in the Messenger under their home, so the thinking model can read it with `file_read`.
 *
 * The owner decides what to share with the voice, files included. The page posts the file they picked as `{ name, base64 }`
 * (`site/lib/messengerAttachment.ts`); this stages it in a `0600` file in a per-request `mkdtemp` directory, the way the
 * relay route stages a frame, runs `slopweaver talk attach`, and removes the directory once the verb has returned. The
 * verb judges the file and keeps its own copy (`src/talk/attachmentStore.ts`).
 *
 * Nothing here reaches a provider: this is a page on this machine writing to this machine's disk. The owner's message, sent
 * afterwards the way every typed message is sent, is what names the file to the voice.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  MESSENGER_ATTACH_BODY_MAX_BYTES,
  type MessengerAttachReceipt,
  messengerAttachReceiptOf,
  messengerAttachRefusalOf,
  parseMessengerAttachRequest,
} from "../../../../lib/messengerAttachment";
import { spawnVerb } from "../../../../lib/spawnVerb";
import { readConsoleBody } from "../../../../lib/talkCallRequest";

/** Never prerendered: it writes under the home. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** Twenty seconds: one file of at most 8 MiB read, judged and written once. */
const ATTACH_TIMEOUT_MS = 20_000;

/** The verb line a failure is named by. */
const ATTACH_TITLE = "slopweaver talk attach";

/** The verb's exit on a refusal it printed, `src/cli/exitCodes.ts`'s `EXIT_ERROR`. */
const REFUSED_EXIT = 1;

/**
 * What the attach came to: kept, with the verb's receipt; refused, with the reason to show the owner; or not confirmed,
 * when the verb never answered and the page cannot say whether a copy was kept.
 */
export type TalkAttachResult =
  | { readonly outcome: "kept"; readonly receipt: MessengerAttachReceipt }
  | { readonly outcome: "refused"; readonly why: string }
  | { readonly outcome: "unknown"; readonly why: string };

/**
 * Keep one attached file.
 *
 * @param request the press, whose JSON body is `{ name, base64 }`
 * @returns the receipt, or why nothing was kept
 */
export async function POST(request: Request): Promise<NextResponse<TalkAttachResult>> {
  const headers = { "cache-control": "no-store" };
  const read = await readConsoleBody({ maxBytes: MESSENGER_ATTACH_BODY_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ outcome: "refused", why: read.refused }, { headers, status: read.status });
  }
  const parsed = parseMessengerAttachRequest({ body: read.body });
  if (parsed.kind === "refused") {
    return NextResponse.json({ outcome: "refused", why: parsed.why }, { headers, status: parsed.status });
  }
  const dir = await mkdtemp(join(tmpdir(), "slopweaver-attach-"));
  try {
    const staged = join(dir, "upload");
    await writeFile(staged, parsed.bytes, { mode: 0o600 });
    const ran = await spawnVerb({
      argv: ["talk", "attach", "--file", staged, "--name", parsed.name, "--json"],
      timeoutMs: ATTACH_TIMEOUT_MS,
      title: ATTACH_TITLE,
    });
    if (ran.ok) {
      const receipt = messengerAttachReceiptOf({ out: ran.out });
      if (receipt === undefined) {
        const why = `${ATTACH_TITLE} answered without a receipt, so where the file was kept is not known`;
        return NextResponse.json({ outcome: "unknown", why }, { headers, status: 502 });
      }
      return NextResponse.json({ outcome: "kept", receipt }, { headers });
    }
    if (ran.exitCode === undefined) {
      return NextResponse.json({ outcome: "unknown", why: ran.notMeasured }, { headers, status: 504 });
    }
    const refusal = ran.exitCode === REFUSED_EXIT ? messengerAttachRefusalOf({ out: ran.out }) : undefined;
    if (refusal === undefined) {
      return NextResponse.json({ outcome: "refused", why: ran.notMeasured }, { headers, status: 502 });
    }
    return NextResponse.json({ outcome: "refused", why: refusal }, { headers, status: 422 });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
