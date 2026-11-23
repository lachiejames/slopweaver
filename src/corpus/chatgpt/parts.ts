/**
 * What one part of a ChatGPT message carries — shared by the one-chat live read (`chatgpt conversation`) and the
 * export parser, because both read the same message shape: the web backend and the export archive serialise a
 * message identically.
 *
 * MEASURED against a recorded chat and a live read (`cli/commands/chatgpt/conversation.ts`): a typed
 * turn is `text` whose parts are strings, and a voice turn is `multimodal_text` whose parts are
 * `audio_transcription` objects carrying `text`, beside an `audio_asset_pointer` to the recording itself.
 *
 * Pure.
 */

/** One message part, classified. */
export type ChatgptPart =
  /** Words: a typed string part, or a spoken turn's transcription. */
  | { readonly kind: "words"; readonly text: string; readonly spoken: boolean }
  /** The recording behind a spoken turn — its words are the transcription beside it, so nothing is missing. */
  | { readonly kind: "recording"; readonly contentType: string }
  /** Anything else — an image, a file — named by its content type, its words not carried. */
  | { readonly kind: "other"; readonly contentType: string };

/**
 * Classify one part of a message's `content.parts`.
 *
 * A KIND this reader does not know is reported by the caller; a known kind is read by the fields named here and no
 * others. Real attachment parts carry many fields this does not read (sizes, dimensions, generation metadata), so an
 * extra field on a known kind — a `text` set on an `image_asset_pointer`, say — is passed over, not reported. Refusing
 * every field not named would fail a first real export on fields no reader needs; widen it when one is seen to carry
 * words.
 *
 * @param part one element of `content.parts`, as the backend or export sent it
 * @returns what the part carries, or `undefined` for a value that is neither a string nor a typed object
 */
export function classifyChatgptPart({ part }: { part: unknown }): ChatgptPart | undefined {
  if (typeof part === "string") {
    return { kind: "words", spoken: false, text: part };
  }
  // A content type that is not a string is untyped, never coerced: `String(["image_asset_pointer"])` would read an
  // array as a known kind and pass over the words beside it.
  if (typeof part !== "object" || part === null || !("content_type" in part) || typeof part.content_type !== "string") {
    return undefined;
  }
  const contentType = part.content_type;
  if (contentType === "audio_transcription" && "text" in part && typeof part.text === "string") {
    return { kind: "words", spoken: true, text: part.text };
  }
  if (contentType === "audio_asset_pointer" || contentType === "real_time_user_audio_video_asset_pointer") {
    return { contentType, kind: "recording" };
  }
  return { contentType, kind: "other" };
}
