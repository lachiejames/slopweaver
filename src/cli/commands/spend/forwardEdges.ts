/**
 * The production edges `spend forward` is wired to: the Gmail draft call and the read of a pulled file, plus the
 * attachments a matched receipt's pulled files make through that read. Everything `./forwardRun.ts` decides goes
 * through these as injected seams, so its tests hold no mailbox and no disk.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "../../../lib/result.js";
import { type GmailApi, makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { ForwardAttachment } from "../../../live/gmail/forward.js";
import { SpendForwardErrors } from "../../../spend/tasks/forwardErrors.js";
import type { TaskAct } from "../../../spend/tasks/read.js";

/**
 * Read every file a matched receipt's PDFs were pulled to, through an injected read.
 *
 * @param readBytes the read of one pulled file — `readPulledFile` in production
 * @returns the attachments, none for an act with no matched receipt, or the first file that would not read
 */
export function attachmentsFor({
  act,
  readBytes,
}: {
  act: TaskAct;
  readBytes: (args: { path: string }) => Result<Uint8Array, { message: string }>;
}): Result<readonly ForwardAttachment[], { message: string }> {
  if (act.invoice.kind !== "matched") {
    return ok([]);
  }
  const attachments: ForwardAttachment[] = [];
  for (const file of act.invoice.files) {
    const bytes = readBytes({ path: file.localPath });
    if (bytes.isErr()) {
      return err(SpendForwardErrors.attachmentUnreadable({ cause: bytes.error.message, path: file.localPath }));
    }
    attachments.push({ bytes: bytes.value, filename: file.filename, mimeType: "application/pdf" });
  }
  return ok(attachments);
}

/**
 * The production draft call: the `compose` capability of this home's grant, and nothing that sends.
 *
 * @returns the bound draft call, or why the grant cannot serve it
 */
export function productionDrafts({
  home,
}: {
  home: string;
}): Result<Pick<GmailApi, "createDraft">, { message: string }> {
  return resolveGmailClient({ capabilities: ["compose"], home }).map(({ account, client }) => {
    const api = makeGmailApi({ account, client });
    return { createDraft: api.createDraft };
  });
}

/**
 * Read one pulled file back, as bytes.
 *
 * @param path where `spend tasks` pulled the receipt's PDF to
 * @returns the bytes, or why the file would not read
 */
export function readPulledFile({ path }: { path: string }): Result<Uint8Array, { message: string }> {
  try {
    return ok(new Uint8Array(readFileSync(path)));
  } catch (error: unknown) {
    return err({ message: error instanceof Error ? error.message : String(error) });
  }
}
