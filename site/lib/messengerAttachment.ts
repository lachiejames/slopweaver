/**
 * A file the owner attaches in the Messenger, as the page and the attach route handle it: the route's body, the verb's
 * receipt, and the one line the owner's message carries so the thinking model reads the file with `file_read`.
 *
 * A call's controls let the owner decide what to share with the voice, files included.
 *
 * The file never travels to a provider on its own. The route stages it and `slopweaver talk attach` keeps a copy under
 * the home (`src/talk/attachmentStore.ts`); the owner's message then goes the way every typed message goes, carrying one line
 * that names the file and where it was kept. The bytes reach the model only if the thinking model reads them with
 * `file_read`, the tool it already has. The verb owns the rules (`src/talk/attachment.ts`); the caps here are the
 * same numbers, held equal by `src/__tests__/unit/talk/attachment.test.ts`, so a file too large for the verb is
 * refused on the page before it is read.
 */
import { type Bag, isBag } from "./bag";
import { fileSizeLabel } from "./draftMediaText";
import { TYPED_TEXT_MAX_CHARS } from "./planCallContract";

/** The largest picture kept: `src/talk/attachment.ts`'s `ATTACHMENT_PICTURE_MAX_BYTES`. */
export const MESSENGER_ATTACH_PICTURE_MAX_BYTES = 8 * 1024 * 1024;

/** The largest text file kept: `src/talk/attachment.ts`'s `ATTACHMENT_TEXT_MAX_BYTES`. */
export const MESSENGER_ATTACH_TEXT_MAX_BYTES = 1024 * 1024;

/** The longest name the route passes on, in characters; the verb holds it to 240 UTF-8 bytes. */
const NAME_MAX_CHARS = 1024;

/** The largest body the attach route reads: the largest picture as base64, and room for its name. */
export const MESSENGER_ATTACH_BODY_MAX_BYTES = Math.ceil(MESSENGER_ATTACH_PICTURE_MAX_BYTES / 3) * 4 + 8 * 1024;

/** Standard base64 with its padding, the only spelling `Buffer.toString("base64")` writes back. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

/** A body the attach route stages, or why it will not. */
export type MessengerAttachRequest =
  | { readonly kind: "ok"; readonly name: string; readonly bytes: Buffer }
  | { readonly kind: "refused"; readonly status: 400 | 413; readonly why: string };

/**
 * Read the attach route's body: `{ name, base64 }`, the base64 canonical so the bytes staged are exactly the ones
 * sent, and no larger than the picture cap.
 *
 * @param body the JSON object the route read
 * @returns the name and bytes to stage, or the refusal with its status
 */
export function parseMessengerAttachRequest({ body }: { body: Bag }): MessengerAttachRequest {
  const { name, base64 } = body;
  if (typeof name !== "string" || name.length === 0 || name.length > NAME_MAX_CHARS) {
    return {
      kind: "refused",
      status: 400,
      why: `name must be the file's name, up to ${String(NAME_MAX_CHARS)} characters`,
    };
  }
  if (typeof base64 !== "string" || !BASE64.test(base64) || base64.length % 4 !== 0) {
    return { kind: "refused", status: 400, why: "base64 must be the file's bytes in standard, padded base64" };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) {
    return { kind: "refused", status: 400, why: "base64 is not canonical, so the bytes it decodes to are not certain" };
  }
  if (bytes.length > MESSENGER_ATTACH_PICTURE_MAX_BYTES) {
    return { kind: "refused", status: 413, why: oversizeWhy({ bytes: bytes.length }) };
  }
  return { bytes, kind: "ok", name };
}

/**
 * Why a file is too large to attach at all: over the picture cap, the larger of the two.
 *
 * @param bytes the file's size
 * @returns the sentence the page shows
 */
function oversizeWhy({ bytes }: { bytes: number }): string {
  const picture = fileSizeLabel({ bytes: MESSENGER_ATTACH_PICTURE_MAX_BYTES });
  const text = fileSizeLabel({ bytes: MESSENGER_ATTACH_TEXT_MAX_BYTES });
  return `the file is ${fileSizeLabel({ bytes })}; the most attached is ${picture} for a picture, ${text} for a text file`;
}

/**
 * Whether the page may send a file to be kept, judged on what it knows before reading it: its size.
 *
 * @param bytes the file's size, as the browser reports it
 * @returns why it may not, or `undefined` when the verb is the one to judge it
 */
export function messengerAttachPrecheck({ bytes }: { bytes: number }): string | undefined {
  if (bytes === 0) {
    return "the file is empty";
  }
  if (bytes > MESSENGER_ATTACH_PICTURE_MAX_BYTES) {
    return oversizeWhy({ bytes });
  }
  return undefined;
}

/** What `talk attach --json` printed for a kept file. */
export interface MessengerAttachReceipt {
  readonly path: string;
  readonly name: string;
  readonly kind: "picture" | "text";
  readonly bytes: number;
}

/**
 * Read the verb's receipt off its stdout.
 *
 * @param out what `talk attach --json` printed on exit 0
 * @returns the receipt, or `undefined` when stdout is not one
 */
export function messengerAttachReceiptOf({ out }: { out: string }): MessengerAttachReceipt | undefined {
  const parsed = parsedBag({ out });
  if (parsed === undefined) {
    return undefined;
  }
  const { path, name, kind, bytes } = parsed;
  const kindKnown = kind === "picture" || kind === "text";
  if (typeof path !== "string" || typeof name !== "string" || !kindKnown || typeof bytes !== "number") {
    return undefined;
  }
  return { bytes, kind, name, path };
}

/**
 * Read the verb's refusal off its stdout: `{"refused":{"code","message"}}`, printed with `--json` on exit 1.
 *
 * @param out what the verb printed
 * @returns the refusal's sentence, or `undefined` when stdout is not one
 */
export function messengerAttachRefusalOf({ out }: { out: string }): string | undefined {
  const refused = parsedBag({ out })?.["refused"];
  if (!isBag(refused) || typeof refused["message"] !== "string") {
    return undefined;
  }
  return refused["message"];
}

/** One JSON object off a verb's stdout, or `undefined`. */
function parsedBag({ out }: { out: string }): Bag | undefined {
  try {
    const parsed: unknown = JSON.parse(out.trim());
    return isBag(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The line the owner's message carries for a kept file: its name, what it is, how large, the path it was kept at, and the
 * tool that reads it. The name and the path are JSON-quoted, so neither can end the line or read as an instruction.
 *
 * @param receipt what the verb kept
 * @returns the line
 */
export function messengerAttachmentLine({ receipt }: { receipt: MessengerAttachReceipt }): string {
  const what = receipt.kind === "picture" ? "a picture" : "a text file";
  const size = fileSizeLabel({ bytes: receipt.bytes });
  return `[Attached: ${JSON.stringify(receipt.name)}, ${what} of ${size}, saved at ${JSON.stringify(receipt.path)}. Read it with file_read.]`;
}

/** One file a paste or a drop carried, as much of it as the decision reads. */
export interface MessengerTransferFile {
  readonly name: string;
  readonly type: string;
}

/** One file of a transfer to attach: where it sits in the transfer, and the name it is kept under. */
export interface MessengerTransferPick {
  readonly fileIndex: number;
  readonly name: string;
}

/** What a paste or drop comes to: every one of its files to attach, each under its name, or the default. */
export type MessengerTransferDecision =
  { readonly kind: "attach"; readonly picks: readonly MessengerTransferPick[] } | { readonly kind: "default" };

/** The name a browser gives a clipboard picture, which says nothing about which screenshot it is. */
const GENERIC_PASTED_NAME = /^image(\.(png|jpe?g|webp))?$/iu;

/** The suffix a pasted picture is named with, by the type the clipboard reports; the verb judges the bytes. */
const PASTED_SUFFIX: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

/**
 * What a paste or a drop into the box does: screenshots paste into the voice. Every pasted or dropped file goes the
 * paperclip's way, and more than one file can be shared at a time. A paste that also carries text stays a text paste, so a
 * spreadsheet copy offering a picture of itself pastes its cells. A drop is files whatever text rides with it, since
 * a browser's image drag carries its URL. A clipboard picture under the browser's generic name is named for the
 * instant it was pasted, with its place in the paste after the first, so two screenshots read apart in the
 * transcript; any other name, and every dropped file's, is kept as it is.
 *
 * @param files the files the transfer carried, in its order
 * @param hasPlainText whether it also carried `text/plain`
 * @param nowIso the instant of the paste, as an ISO string
 * @param source a clipboard paste or a drag and drop
 * @returns every file to attach with its name, or the default paste or drop
 */
export function messengerTransferDecision({
  files,
  hasPlainText,
  nowIso,
  source,
}: {
  files: readonly MessengerTransferFile[];
  hasPlainText: boolean;
  nowIso: string;
  source: "drop" | "paste";
}): MessengerTransferDecision {
  if (files.length === 0) {
    return { kind: "default" };
  }
  if (source === "paste" && hasPlainText) {
    return { kind: "default" };
  }
  const picks = files.map((file, fileIndex): MessengerTransferPick => {
    const name = file.name.trim();
    if (source === "drop" || (name !== "" && !GENERIC_PASTED_NAME.test(name))) {
      return { fileIndex, name: file.name };
    }
    let pasted = `pasted-${nowIso.replaceAll(/[:.]/gu, "-")}`;
    if (fileIndex > 0) {
      pasted += `-${String(fileIndex + 1)}`;
    }
    const suffix = PASTED_SUFFIX.get(file.type.toLowerCase());
    if (suffix !== undefined) {
      pasted += suffix;
    }
    return { fileIndex, name: pasted };
  });
  return { kind: "attach", picks };
}

/**
 * The most files that wait under the owner's box at once. Ten lines of `[Attached: …]` are about 2,500 characters, well
 * inside one typed message's 16,000, so the cap keeps the row of thumbnails readable rather than guarding the message.
 */
export const MESSENGER_ATTACH_MAX_FILES = 10;

/**
 * One file waiting under the owner's box: being kept, from the moment it is picked; kept and ready to name in the next
 * message; or out with a send that has not answered yet. `previewUrl` is the page's own object URL for a picture's
 * thumbnail, `undefined` for a text file. Kept by the widget, so closing the tray keeps the files the way it keeps the
 * draft — and a file out with a send is marked there too, so a composer mounted again mid-send cannot send it twice.
 */
export type PendingMessengerAttachment = {
  readonly token: string;
  readonly name: string;
  readonly bytes: number;
  readonly previewUrl: string | undefined;
} & (
  | { readonly kind: "keeping" }
  | { readonly kind: "kept"; readonly receipt: MessengerAttachReceipt }
  | { readonly kind: "sending"; readonly receipt: MessengerAttachReceipt }
);

/**
 * What waits under the owner's box once one keep has answered: that file kept with its receipt, or taken off when it
 * was refused, every other file as it was. A file the owner removed while it was being kept is never brought back by
 * its answer.
 *
 * @param now what waits under the owner's box as the keep answers
 * @param token the keep's own id, minted when the owner picked the file
 * @param receipt what the verb kept, `undefined` when it kept nothing
 * @returns what waits now
 */
export function attachmentsAfterKeep({
  now,
  token,
  receipt,
}: {
  now: readonly PendingMessengerAttachment[];
  token: string;
  receipt: MessengerAttachReceipt | undefined;
}): readonly PendingMessengerAttachment[] {
  const at = now.findIndex((file) => file.token === token && file.kind === "keeping");
  if (at === -1) {
    return now;
  }
  if (receipt === undefined) {
    return now.filter((_, index) => index !== at);
  }
  return now.map((file, index): PendingMessengerAttachment =>
    index === at ? { ...file, kind: "kept", receipt } : file,
  );
}

/** How many of the files the owner offered fit beside the ones already waiting, and why the rest do not. */
export interface MessengerAttachRoom {
  readonly take: number;
  readonly why: string | undefined;
}

/**
 * How many newly offered files fit under the cap beside the ones already waiting. The first ones fit, in the owner's order.
 *
 * @param waiting how many files already wait
 * @param offered how many the owner just picked, pasted or dropped
 * @returns how many to keep, and the sentence naming what was left out, `undefined` when nothing was
 */
export function messengerAttachRoom({ waiting, offered }: { waiting: number; offered: number }): MessengerAttachRoom {
  const take = Math.max(0, Math.min(offered, MESSENGER_ATTACH_MAX_FILES - waiting));
  if (take === offered) {
    return { take, why: undefined };
  }
  const left = offered - take;
  const files = left === 1 ? "1 file was" : `${String(left)} files were`;
  return { take, why: `${files} left out; at most ${String(MESSENGER_ATTACH_MAX_FILES)} wait at once` };
}

/**
 * What waits once a send goes out: each kept file it carries marked as out with it, so no other press sends it again
 * while it is out. Every other file is as it was.
 *
 * @param now what waits as the send goes out
 * @param sent the files the send carries
 * @returns what waits now
 */
export function attachmentsSending({
  now,
  sent,
}: {
  now: readonly PendingMessengerAttachment[];
  sent: readonly PendingMessengerAttachment[];
}): readonly PendingMessengerAttachment[] {
  const sentTokens = new Set(sent.map((file) => file.token));
  return now.map((file): PendingMessengerAttachment => {
    if (file.kind !== "kept" || !sentTokens.has(file.token)) {
      return file;
    }
    return { ...file, kind: "sending" };
  });
}

/**
 * What waits once a send answers. When it went, every file out with it is gone; when it did not, each is kept and
 * ready again. A file the owner added while it was out still waits, and one removed while it was out stays removed.
 *
 * @param now what waits as the send answers
 * @param sent the files the send carried
 * @param went whether the send went, or may have gone and so must not be sent again
 * @returns what waits now
 */
export function attachmentsAfterSend({
  now,
  sent,
  went,
}: {
  now: readonly PendingMessengerAttachment[];
  sent: readonly PendingMessengerAttachment[];
  went: boolean;
}): readonly PendingMessengerAttachment[] {
  const sentTokens = new Set(sent.map((file) => file.token));
  if (went) {
    return now.filter((file) => !sentTokens.has(file.token));
  }
  return now.map((file): PendingMessengerAttachment => {
    if (file.kind !== "sending" || !sentTokens.has(file.token)) {
      return file;
    }
    return { ...file, kind: "kept" };
  });
}

/** The owner's message with its attachment lines, or why it cannot be sent whole. */
export type MessengerMessage =
  { readonly kind: "ok"; readonly text: string } | { readonly kind: "refused"; readonly why: string };

/**
 * The owner's message as sent: what they typed, then one line per kept file in their order, or the lines alone when
 * nothing was typed. Refused rather than cut when the whole is over what one typed message carries.
 *
 * @param draft what the owner typed
 * @param receipts the kept files, empty with none
 * @returns the message, or why it is refused
 */
export function messengerMessageOf({
  draft,
  receipts,
}: {
  draft: string;
  receipts: readonly MessengerAttachReceipt[];
}): MessengerMessage {
  let text = draft;
  if (receipts.length > 0) {
    const lines = receipts.map((receipt) => messengerAttachmentLine({ receipt })).join("\n");
    text = draft.trim() === "" ? lines : `${draft}\n\n${lines}`;
  }
  if (text.length > TYPED_TEXT_MAX_CHARS) {
    const why = `the message and its attachment lines are ${String(text.length)} characters; one message carries ${String(TYPED_TEXT_MAX_CHARS)}`;
    return { kind: "refused", why };
  }
  return { kind: "ok", text };
}
