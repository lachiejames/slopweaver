/**
 * The PURE half of `slopweaver fathom share <url>`: validate a share address, read what the page gave back,
 * and project it into the same bronze record the API lane writes.
 *
 * ## Why a share page is a second way IN, never a second kind
 *
 * A call somebody else recorded reaches the owner only as `https://fathom.video/share/<token>` — the owner's API key
 * lists the calls the OWNER recorded and nothing else, so the weekly session a consultant records is invisible to
 * `refresh --source fathom` however often it runs. The page, read in the owner's own signed-in Chrome
 * (`browser/fathomShareSnippet.ts`), carries the same facts the API does: the call's own id, when the
 * recording started, and every cue with its speaker and offset. So the record is the one
 * {@link ./project.projectFathomMeeting} writes, keyed on the same `sourceId` — the recording id — which
 * means a call reachable both ways is one row, never two.
 *
 * ## Raw words by speaker, and nothing the provider wrote
 *
 * The rule: keep the RAW verbatim transcript by speaker, never the summary — a Fathom or Gemini summary is lossy by nature. The snippet drops Fathom's action-item notes in
 * the page and returns only their COUNT, and this module never sees a summary field at all. The body is
 * {@link ./project.fathomTranscriptBody}'s `[HH:MM:SS] Speaker: words`, one line per cue.
 *
 * Pure: no I/O, no clock.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { personName } from "../personName.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";
import { FATHOM_BUCKET, fathomSpeakers, fathomTranscriptBody } from "./project.js";
import { type FathomShareError, FathomShareErrors } from "./shareErrors.js";
import type { FathomTranscriptItem } from "./types.js";

/** The one origin a share page lives on. */
export const FATHOM_SHARE_ORIGIN = "https://fathom.video";

/**
 * A share token as Fathom mints them. MEASURED on four real tokens: 32 characters of
 * `[A-Za-z0-9_-]`. The lower bound is looser than that so a future shorter token is not refused on length
 * alone; the character class is the part that keeps a path segment from being anything else.
 */
const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/u;

/** A validated share address: its token, and the canonical URL the page is read at and cited by. */
export interface FathomShareAddress {
  readonly token: string;
  readonly url: string;
}

/**
 * Validate one share address and reduce it to its canonical form.
 *
 * Accepts exactly `https://fathom.video/share/<token>`, with an optional trailing slash, query or fragment
 * (a link copied out of a recap mail carries a `?utm_…` tail). Anything else is refused — this verb reads
 * ONE page on ONE origin, and a URL it would have to guess about is a page it was not asked to read.
 *
 * @param url the address as given
 * @returns the token and the canonical URL, or why it is not a share address
 */
export function parseFathomShareUrl({ url }: { url: string }): Result<FathomShareAddress, FathomShareError> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return err(FathomShareErrors.urlInvalid({ url, why: "it is not a URL" }));
  }
  if (parsed.origin !== FATHOM_SHARE_ORIGIN) {
    return err(
      FathomShareErrors.urlInvalid({ url, why: `its origin is ${parsed.origin}, not ${FATHOM_SHARE_ORIGIN}` }),
    );
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const [head, token, ...rest] = segments;
  if (head !== "share" || token === undefined || rest.length > 0 || !SHARE_TOKEN.test(token)) {
    return err(FathomShareErrors.urlInvalid({ url, why: "its path is not /share/<token>" }));
  }
  return ok({ token, url: `${FATHOM_SHARE_ORIGIN}/share/${token}` });
}

/** A share link wherever it sits in a mail: body text, or an HTML `href` lifted off the message. */
const SHARE_LINK = /https:\/\/fathom\.video\/share\/([A-Za-z0-9_-]{16,64})/gu;

/**
 * Every distinct share token the given texts link to, in first-seen order.
 *
 * Only the exact origin counts: a lookalike host (`fathom.video.example`) never matches, because the
 * pattern requires `/share/` straight after `fathom.video`. A token is only ever read back at the canonical
 * `https://fathom.video/share/<token>` address, never at the link it was found in, so a share link wrapped
 * in a redirect is read at Fathom's own origin all the same.
 *
 * @param texts a message's body and its HTML link targets
 * @returns the tokens, deduplicated
 */
export function shareTokensIn({ texts }: { texts: readonly string[] }): readonly string[] {
  const tokens: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(SHARE_LINK)) {
      const token = match[1];
      if (token !== undefined && !tokens.includes(token)) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

/**
 * One line of speech as the page's own cue list carries it.
 *
 * @internal
 */
export interface FathomShareCue {
  readonly speaker: string;
  readonly email: string | null;
  /** Seconds from the start of the recording. */
  readonly startSeconds: number;
  readonly text: string;
}

/** Everything one share page gave back that a record is built from. */
export interface FathomShareCall {
  /** The recording's own id — the integer the API lane keys on. */
  readonly recordingId: number;
  readonly title: string | null;
  /** When the recording itself started — what the record is dated by. */
  readonly recordingStartIso: string;
  readonly scheduledStartIso: string | null;
  readonly hostEmail: string | null;
  readonly attendees: readonly { readonly name: string; readonly email: string | null }[];
  readonly cues: readonly FathomShareCue[];
  /** How many of Fathom's own action-item notes the page carried and the snippet dropped unread. */
  readonly droppedNotes: number;
}

/** A string field of a record, or null. */
function stringField({ value, key }: { value: Record<string, unknown>; key: string }): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

/** The cues a read carried, or the index of the first one that is not a cue. */
function readCues({ value }: { value: unknown }): Result<readonly FathomShareCue[], number> {
  if (!Array.isArray(value)) {
    return err(-1);
  }
  const cues: FathomShareCue[] = [];
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry["speaker"] !== "string" ||
      entry["speaker"].length === 0 ||
      typeof entry["startSeconds"] !== "number" ||
      typeof entry["text"] !== "string"
    ) {
      return err(index);
    }
    cues.push({
      email: stringField({ key: "email", value: entry }),
      speaker: entry["speaker"],
      startSeconds: entry["startSeconds"],
      text: entry["text"],
    });
  }
  return ok(cues);
}

/** The attendee list a read carried, dropping any entry with no name. */
function readAttendees({ value }: { value: unknown }): readonly { name: string; email: string | null }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry["name"] !== "string") {
      return [];
    }
    return [{ email: stringField({ key: "email", value: entry }), name: entry["name"] }];
  });
}

/**
 * The page read the snippet printed, once it has shown the share page was reached, carried the call
 * element, and had its transcript loaded. Each refusal names what the page showed.
 */
function readyPageRead({
  output,
  address,
}: {
  output: Record<string, unknown>;
  address: FathomShareAddress;
}): Result<Record<string, unknown>, FathomShareError> {
  const finalUrl = stringField({ key: "finalUrl", value: output });
  if (finalUrl !== null && !finalUrl.startsWith(address.url)) {
    return err(FathomShareErrors.notShown({ landedOn: finalUrl, url: address.url }));
  }
  const read = output["read"];
  if (!isRecord(read)) {
    return err(FathomShareErrors.shapeChanged({ url: address.url, what: "the page read returned nothing" }));
  }
  const readError = stringField({ key: "readError", value: read });
  if (readError !== null) {
    return err(FathomShareErrors.shapeChanged({ url: address.url, what: `the page read threw: ${readError}` }));
  }
  if (read["present"] !== true) {
    return err(
      FathomShareErrors.shapeChanged({ url: address.url, what: "the page carries no page-call-detail element" }),
    );
  }
  if (read["ready"] !== true) {
    return err(FathomShareErrors.transcriptAbsent({ url: address.url }));
  }
  return ok(read);
}

/**
 * Read what the snippet printed into a typed call, refusing every shape a record could not honestly be
 * built from.
 *
 * Each refusal names what the PAGE showed rather than what the parser expected: a share page that landed on
 * a sign-in wall and a page Fathom redesigned are different next actions, and a single "could not parse"
 * would send the operator to the wrong one.
 *
 * @param output the snippet's decoded JSON output
 * @param address the address that was read, for the messages
 * @returns the call, or why none could be read
 */
export function readFathomShareCapture({
  output,
  address,
}: {
  output: Record<string, unknown>;
  address: FathomShareAddress;
}): Result<FathomShareCall, FathomShareError> {
  const ready = readyPageRead({ address, output });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const read = ready.value;
  const call = read["call"];
  if (!isRecord(call) || typeof call["id"] !== "number") {
    return err(FathomShareErrors.shapeChanged({ url: address.url, what: "the call carries no numeric id" }));
  }
  const recordingStartIso = stringField({ key: "recordingStartedAt", value: call });
  if (recordingStartIso === null) {
    return err(FathomShareErrors.shapeChanged({ url: address.url, what: "the call carries no recording start" }));
  }
  const cues = readCues({ value: read["cues"] });
  if (cues.isErr()) {
    return err(
      FathomShareErrors.shapeChanged({
        url: address.url,
        what: cues.error < 0 ? "the cue list is not a list" : `cue ${String(cues.error)} is not a spoken line`,
      }),
    );
  }
  if (cues.value.length === 0) {
    return err(FathomShareErrors.transcriptAbsent({ url: address.url }));
  }
  const droppedNotes = read["droppedNotes"];
  return ok({
    attendees: readAttendees({ value: read["attendees"] }),
    cues: cues.value,
    droppedNotes: typeof droppedNotes === "number" ? droppedNotes : 0,
    hostEmail: stringField({ key: "hostEmail", value: call }),
    recordingId: call["id"],
    recordingStartIso,
    scheduledStartIso: stringField({ key: "scheduledStartAt", value: call }),
    title: stringField({ key: "title", value: call }),
  });
}

/**
 * An offset in seconds as `HH:MM:SS`, the spelling the API lane's transcript carries, so a share record and
 * an API record read identically.
 *
 * @param seconds seconds from the start of the recording; fractions are dropped, never rounded up
 * @returns the offset
 */
export function offsetStamp({ seconds }: { seconds: number }): string {
  const whole = Math.max(0, Math.floor(seconds));
  const pad = ({ value }: { value: number }): string => String(value).padStart(2, "0");
  const hours = pad({ value: Math.floor(whole / 3600) });
  const minutes = pad({ value: Math.floor((whole % 3600) / 60) });
  return `${hours}:${minutes}:${pad({ value: whole % 60 })}`;
}

/**
 * The cues as the transcript items the shared body renderer takes.
 *
 * @param cues the page's cues, in page order
 * @returns one item per cue
 */
function shareTranscriptItems({ cues }: { cues: readonly FathomShareCue[] }): readonly FathomTranscriptItem[] {
  return cues.map((cue) => ({
    speaker: {
      displayName: cue.speaker,
      ...(cue.email !== null ? { matchedInviteeEmail: cue.email } : {}),
    },
    text: cue.text,
    timestamp: offsetStamp({ seconds: cue.startSeconds }),
  }));
}

/**
 * The host's NAME, never their address. The page gives the host only as an address, so the name is the
 * attendee row carrying that same address, compared case-insensitively, else the address's local part.
 *
 * @param call the call the page gave back
 * @returns the name to store as the record's author, or undefined when the page named no host
 */
export function shareHostName({ call }: { call: FathomShareCall }): string | undefined {
  const { hostEmail } = call;
  if (hostEmail === null) {
    return undefined;
  }
  const wanted = hostEmail.toLowerCase();
  const row = call.attendees.find((one) => one.email?.toLowerCase() === wanted);
  return personName({ address: hostEmail, displayName: row === undefined ? undefined : row.name });
}

/**
 * Project one share-page call into a bronze record.
 *
 * Keyed on the RECORDING id, exactly as the API lane keys, and cited by the share URL — the one address the
 * owner can open. `attrs.via` says which way the words came in, and `attrs.shareToken` is what the
 * mail-driven discovery pass asks "have we read this link yet" of.
 *
 * @param call the call the page gave back
 * @param address the share address it was read at
 * @returns the record
 */
export function projectFathomShareCall({
  call,
  address,
}: {
  call: FathomShareCall;
  address: FathomShareAddress;
}): CorpusRecord {
  const items = shareTranscriptItems({ cues: call.cues });
  const body = fathomTranscriptBody({ items });
  const attendees = call.attendees.map((one) => one.name);
  const attrs: Record<string, CorpusAttributeValue> = {
    attendeeCount: call.attendees.length,
    recordingId: call.recordingId,
    shareToken: address.token,
    shareUrl: address.url,
    speakers: fathomSpeakers({ items }),
    transcriptChars: body.text.length,
    transcriptLines: items.length,
    via: "share-page",
    ...(attendees.length > 0 ? { attendees } : {}),
    ...(call.scheduledStartIso !== null ? { scheduledStartIso: call.scheduledStartIso } : {}),
    ...(call.droppedNotes > 0 ? { providerNotesDropped: call.droppedNotes } : {}),
    ...(body.droppedChars > 0 ? { transcriptCharsDropped: body.droppedChars } : {}),
  };
  const author = shareHostName({ call });
  const record: CorpusRecord = {
    attrs,
    container: FATHOM_BUCKET,
    kind: "transcript",
    refs: extractRefs({ text: body.text }),
    source: "fathom",
    sourceId: String(call.recordingId),
    text: body.text,
    tsIso: call.recordingStartIso,
    url: address.url,
    ...(author !== undefined ? { author } : {}),
    ...(call.title !== null ? { title: call.title } : {}),
  };
  // Private for the reason the API projection stamps it: a recorded external call must never reach a
  // non-owner's lane, and the default is public.
  return stampVisibility({ record, visibility: "private" });
}
