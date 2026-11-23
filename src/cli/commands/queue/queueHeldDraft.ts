/*
 * What the door held, read back out of the log and understood.
 *
 * Pure parsing, one direction: a stored draft in, a typed answer form or `undefined` out. Nothing here
 * posts, and nothing here appends a queue event, so a draft that cannot be parsed can never be recorded as
 * sent. The one effect is `--form -` reading stdin, which is load-bearing because prose dies on an inline
 * shell quote.
 */
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { isRecord } from "../../../lib/parsers.js";
import { readStdin } from "../../../lib/readStdin.js";
import { HELD_DOCUMENTS_KEY, HELD_UPLOADS_KEY, type HeldUpload } from "../../../live/turn/heldUploads.js";
import { type AnswerFormAnswer, answerFormSchema } from "../../../outbound/assistant/answerForm.js";

/** `--form -` reads from stdin, which is load-bearing: prose dies on an inline shell quote. */
const STDIN_SENTINEL = "-";

/**
 * The replacement form a `--form` asked for, parsed.
 *
 * `undefined` means no `--form` was passed, which is the ordinary release of the stored draft. It is spelled
 * as a distinct value rather than an empty object so "release what was drafted" and "release this instead"
 * can never be confused — that difference is the whole audit claim the release note carries.
 *
 * @returns the parsed replacement, or `undefined` when no `--form` was passed
 */
export async function replacementDraft({
  form,
}: {
  form: string | undefined;
}): Promise<{ readonly draft: Readonly<Record<string, unknown>> } | { readonly failure: string } | undefined> {
  if (form === undefined || form.length === 0) {
    return undefined;
  }
  const json = form === STDIN_SENTINEL ? await readStdin() : form;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { failure: `--form is not valid JSON: ${String(error)}` };
  }
  if (!isRecord(parsed)) {
    return { failure: "--form must be a JSON object — the same update form a turn composes" };
  }
  return { draft: parsed };
}

/** The locked entries under one reserved key, keeping only the ones that survived the JSON round trip. */
function heldUploadsOf({ field }: { field: unknown }): readonly HeldUpload[] {
  if (!Array.isArray(field)) {
    return [];
  }
  return field.filter(
    (candidate): candidate is HeldUpload =>
      isRecord(candidate) && typeof candidate["filename"] === "string" && typeof candidate["bytesBase64"] === "string",
  );
}

/**
 * Split a held answer-form draft from its locked attachment bytes — BOTH lanes.
 *
 * The draft on disk is `{...answer, [HELD_UPLOADS_KEY]: HeldUpload[], [HELD_DOCUMENTS_KEY]: HeldUpload[]}`
 * (`../../../live/turn/run.ts`'s `file`), so both reserved keys must come OUT before the rest is validated
 * against `strictForm`'s answer schema — otherwise a genuinely valid answer would be refused for carrying
 * an "unknown" key that this module itself put there.
 */
function splitHeldUploads({ raw }: { raw: Readonly<Record<string, unknown>> }): {
  readonly rest: Readonly<Record<string, unknown>>;
  readonly heldUploads: readonly HeldUpload[];
  readonly heldDocuments: readonly HeldUpload[];
} {
  const { [HELD_UPLOADS_KEY]: uploadsField, [HELD_DOCUMENTS_KEY]: documentsField, ...rest } = raw;
  return {
    heldDocuments: heldUploadsOf({ field: documentsField }),
    heldUploads: heldUploadsOf({ field: uploadsField }),
    rest,
  };
}

/**
 * Decode the upload bytes a hold locked away.
 *
 * @returns the attachments the composite sender takes, byte for byte what was stored
 */
export function decodeHeldUploads({ heldUploads }: { heldUploads: readonly HeldUpload[] }): readonly SlackUpload[] {
  return heldUploads.map((upload) => ({
    bytes: Buffer.from(upload.bytesBase64, "base64"),
    filename: upload.filename,
  }));
}

/**
 * Read a held draft as the new answer form — the primary contract going forward.
 *
 * @returns the parsed answer, or `undefined` when the draft is an `UpdateArtifact` card instead
 */
export function parseHeldAnswer({ raw }: { raw: Readonly<Record<string, unknown>> }):
  | {
      readonly answer: AnswerFormAnswer;
      readonly heldUploads: readonly HeldUpload[];
      readonly heldDocuments: readonly HeldUpload[];
    }
  | undefined {
  const { rest, heldUploads, heldDocuments } = splitHeldUploads({ raw });
  const parsed = answerFormSchema.safeParse(rest);
  if (!parsed.success) {
    return undefined;
  }
  return { answer: parsed.data, heldDocuments, heldUploads };
}
