/**
 * The outbound refusal for a dead Datadog console host — one policy, judged on the exact payload a provider write
 * is about to send.
 *
 * ## Why at the write transports, and not at the door or in each form
 *
 * The bot once linked a dead `app.<site>` host in writes across all integrations, and a review was not strong
 * enough enforcement. The door (`../admit/door.ts`) is the obvious
 * seam and the wrong one: its `artifact` describes a write rather than carrying its bytes (a Vanta document
 * write records `{ document, write }` and nothing it uploads). Schema refinements on every outbound form would
 * reach the dry runs too, but there are dozens of forms and a composer added next month would be unguarded until
 * somebody remembered. So the check sits where the bytes are final — the Slack `WebClient`, the GitHub write
 * `Octokit`, the Linear mutation sender, the Notion write client's `fetch` (`../corpus/notion/guardedFetch.ts`,
 * which reads a multipart upload's files into bytes before handing them here), the Vanta Manage transport and the
 * browser-driven Vanta policy seams — and a new composer is guarded by construction.
 *
 * What that costs, said plainly: a dry run sends nothing, so it does not cross a transport and does not refuse.
 * It may preview a dead link that the live write then refuses before anything leaves the machine. The PR-format
 * gate (`../prformat/checkCore.ts`) is the one composition-time check, because CI reads a description and never
 * a transport.
 *
 * ## What the walk reads
 *
 * Every string reachable through arrays, plain records, `URL`s and string `FormData` entries — keys too, since a
 * Slack `rich_text` link carries its URL as a value but a hand-built payload could carry anything anywhere.
 * Bytes (`Uint8Array`, `Buffer`, `ArrayBuffer`) are decoded five ways and each reading is judged: as Latin-1, one
 * character per byte, which reads UTF-8 and an uncompressed link in a PDF; and as UTF-16 in each byte order from
 * byte 0 and from byte 1, which reads UTF-16 at any alignment (a Slack upload's bytes once bypassed the walk,
 * and UTF-16 text hid the host from a Latin-1 reading and from a NUL-stripping one). Every reading
 * is a real decode, so nothing is guessed. UTF-32, and a host inside a compressed or base64-encoded stream, is the
 * stated limit, and so is one drawn into an image, bar `github attach`, which judges the text macOS Vision read off a
 * PNG's pixels (`../visualEvidence/imageTextRecognition.ts`). A `Blob`'s bytes cannot be read synchronously, so only its
 * type is walked; no write lane sends one unread, and the Vanta policy upload is judged on its source before it is built.
 * A cycle is walked once.
 *
 * ## What it guards against, and what it does not
 *
 * The defect is a composer that ACCIDENTALLY writes a dead link, so the walk judges the payload as it stands when
 * the transport is called. A payload built to change between that read and the SDK's own serialisation — an
 * accessor answering a clean value once and a dead host the next time — is deliberate code
 * in this process, and no guard in the same process closes that: a snapshot cannot be taken of the streams,
 * functions and SDK objects these payloads carry. The same holds for a `toJSON` written to answer the guard one
 * thing and the serialiser another: the walk calls it as JSON serialisation does, with the property's own
 * key, and code built to tell those calls apart is deliberate. It is a stated limit, not a gap anything here composes.
 *
 * A patched global — `JSON` itself, or a built-in's serialisation replaced at runtime — is the same deliberate
 * class; the walk follows the `toJSON` it can see, a bigint's included, and no further.
 *
 * An HTTP redirect is the other stated limit: a provider's server answering a write with a `Location` on a
 * dead host would have every SDK here follow it unjudged. That address is the provider's own answer, never a
 * composer's, and judging it would mean turning redirect-following off in every client. A field, token or upload
 * address a provider hands back in a response BODY for the next call is judged, because a composer carries it.
 */
import { type InvalidDatadogConsoleHostHit, invalidDatadogConsoleHosts } from "../datadog/invalidConsoleHost.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchOpen } from "../hatch/open.js";
import { hatchRefusal } from "../hatch/render.js";

/** One dead host found in a payload, and where in the payload it sat. */
export interface InvalidDatadogPayloadHit extends InvalidDatadogConsoleHostHit {
  /** A dotted path into the payload, e.g. `blocks.0.elements.2.url`; empty for a bare string payload. */
  readonly path: string;
}

/** The register row this policy reads. */
const HATCH_ID = "invalid-datadog-console-host";

/**
 * The detail a refusal carries in place of the hosts it found, when the payload sent declared credentials. A
 * found host is the payload's own text lowercased, so redacting the refusal afterwards against the credential
 * as written misses it; naming nothing is the only rendering a credential cannot ride out on.
 */
const WITHHELD_HITS_DETAIL = "the host and where it was found are withheld: this request sent declared credentials";

/**
 * A write a transport refused because its payload carries a dead Datadog console host.
 *
 * A throw rather than a `Result` at the Slack, GitHub and Linear seams, matching what each wraps: every one of
 * them already throws on a failed write inside `safeProviderCall`, which turns this into the verb's ordinary
 * write failure with the four-line message intact.
 */
export class InvalidDatadogHostRefusedError extends Error {}

/**
 * The readings of a run of bytes a host literal could appear in: Latin-1, and UTF-16 in each byte order from byte 0
 * and from byte 1. Big-endian is a real decode of a byte-swapped copy: reading little-endian one byte along stands in
 * for it only until the host's last character, which it pairs with whatever byte follows.
 *
 * @param bytes the bytes an upload or body is about to send
 * @returns the five readings
 */
function bytesAsTexts({ bytes }: { bytes: Buffer }): readonly string[] {
  const utf16 = ({ offset, bigEndian }: { offset: number; bigEndian: boolean }): string => {
    const length = bytes.length - offset;
    const run = Buffer.from(bytes.subarray(offset, offset + length - (length % 2)));
    if (bigEndian) {
      run.swap16();
    }
    return run.toString("utf16le");
  };
  return [
    bytes.toString("latin1"),
    utf16({ bigEndian: false, offset: 0 }),
    utf16({ bigEndian: false, offset: 1 }),
    utf16({ bigEndian: true, offset: 0 }),
    utf16({ bigEndian: true, offset: 1 }),
  ];
}

/**
 * The string a boxed `String` holds, or `undefined` for anything else. `String.prototype.valueOf` throws on any
 * receiver without a string's internal slot, so this is the brand check a spoofed `Symbol.toStringTag` cannot fool
 * (`Object.prototype.toString` can be, and was probed that way).
 *
 * @param value an object the walk reached
 * @returns the boxed text, or `undefined` when the value is not a boxed string
 */
function boxedStringText({ value }: { value: object }): string | undefined {
  try {
    return String.prototype.valueOf.call(value);
  } catch {
    return undefined;
  }
}

/** The `toJSON` methods the platform defines on shapes the walk reads directly — a URL's href, a Buffer's bytes. */
const PLATFORM_TO_JSON: ReadonlySet<unknown> = new Set<unknown>([URL.prototype.toJSON, Buffer.prototype.toJSON]);

/**
 * Join a payload path segment on.
 *
 * @param path the path so far
 * @param segment the key or index being entered
 * @returns the extended path
 */
function joinPath({ path, segment }: { path: string; segment: string }): string {
  return path === "" ? segment : `${path}.${segment}`;
}

/**
 * What JSON serialisation would send in place of a value: its `toJSON` answer, called the way serialisation calls
 * it, or nothing when it has none. A bigint is the one primitive serialisation asks, so its method is looked up on
 * its wrapper and called on the bigint itself. The platform's own `toJSON` on a URL or a Buffer
 * answers what the walk already reads, so it is skipped.
 *
 * @param value the value the walk reached
 * @param key the property name serialisation hands `toJSON`: the root's is "", an array item's its index
 * @returns the answer, as a one-item list, or an empty list when there is none to walk
 */
function toJsonAnswers({ value, key }: { value: object | bigint; key: string }): readonly unknown[] {
  const toJson: unknown = Reflect.get(Object(value), "toJSON");
  if (typeof toJson !== "function" || PLATFORM_TO_JSON.has(toJson)) {
    return [];
  }
  return [Reflect.apply(toJson, value, [key])];
}

/**
 * The bytes an object carries, when it is a run of bytes.
 *
 * @param value an object the walk reached
 * @returns its bytes, or `undefined` when it is not a byte view or an `ArrayBuffer`
 */
function objectBytes({ value }: { value: object }): Buffer | undefined {
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  return undefined;
}

/**
 * The texts an object sends as a whole rather than through its entries — a URL, a form, a Blob, a boxed string.
 *
 * @param value an object the walk reached
 * @param path where it sits in the payload
 * @returns each text with the path it is reported at, or `undefined` when the object is walked by its entries
 */
function objectTexts({ value, path }: { value: object; path: string }): readonly WalkText[] | undefined {
  if (value instanceof URL) {
    return [{ path, text: value.href }];
  }
  if (value instanceof FormData) {
    // A file entry is serialised with its name AND its type, so both are judged.
    return [...value.entries()].flatMap(([name, entry]) => [
      { path, text: name },
      {
        path: joinPath({ path, segment: name }),
        text: typeof entry === "string" ? entry : `${entry.name} ${entry.type}`,
      },
    ]);
  }
  if (value instanceof Blob) {
    return [{ path, text: value.type }];
  }
  // A boxed string serialises as the whole string, while its entries are single characters.
  const boxed = boxedStringText({ value });
  return boxed === undefined ? undefined : [{ path, text: boxed }];
}

/** One text the walk judges, and where in the payload it sits. */
interface WalkText {
  readonly path: string;
  readonly text: string;
}

/**
 * Every dead Datadog console host anywhere in a payload, in walk order.
 *
 * @param payload whatever a transport is about to send — a string, a request-options record, a GraphQL
 *   variables object, a `FormData`
 * @returns one hit per occurrence, each with the path it was found at; empty when the payload is clean
 */
export function invalidDatadogHostsInPayload({ payload }: { payload: unknown }): readonly InvalidDatadogPayloadHit[] {
  const hits: InvalidDatadogPayloadHit[] = [];
  const seen = new WeakSet<object>();
  const visitText = ({ text, path }: WalkText): void => {
    for (const hit of invalidDatadogConsoleHosts({ text })) {
      hits.push({ ...hit, path });
    }
  };
  // Two readings of one run can both spell the same host (a UTF-16BE run reads through the big-endian decode and,
  // up to its last character, the little-endian one a byte along), so a run reports each spelling once.
  const visitBytes = ({ bytes, path }: { bytes: Buffer; path: string }): void => {
    const spellings = new Set<string>();
    for (const hit of bytesAsTexts({ bytes }).flatMap((text) => invalidDatadogConsoleHosts({ text }))) {
      if (!spellings.has(hit.matched)) {
        spellings.add(hit.matched);
        hits.push({ ...hit, path });
      }
    }
  };
  const visit = ({ value, path, key }: { value: unknown; path: string; key: string }): void => {
    if (typeof value === "string") {
      visitText({ path, text: value });
      return;
    }
    if (typeof value === "bigint") {
      for (const answer of toJsonAnswers({ key, value })) {
        visit({ key, path, value: answer });
      }
      return;
    }
    if (value === null || typeof value !== "object" || seen.has(value)) {
      return;
    }
    seen.add(value);
    // JSON serialisation sends what `toJSON` answers rather than the value itself, so that answer is walked BEFORE
    // any shape below and as well as the value: a transport that does not serialise through JSON sends the value
    // instead (a boxed string, then bytes, each carrying its own `toJSON`).
    for (const answer of toJsonAnswers({ key, value })) {
      visit({ key, path, value: answer });
    }
    const bytes = objectBytes({ value });
    if (bytes !== undefined) {
      visitBytes({ bytes, path });
      return;
    }
    const texts = objectTexts({ path, value });
    if (texts !== undefined) {
      texts.forEach(visitText);
      return;
    }
    // An array's entries are its items keyed by index, which is the key serialisation hands an item's `toJSON`.
    for (const [entryKey, item] of Object.entries(value)) {
      visitText({ path, text: entryKey });
      visit({ key: entryKey, path: joinPath({ path, segment: entryKey }), value: item });
    }
  };
  visit({ key: "", path: "", value: payload });
  return hits;
}

/**
 * The four-line refusal for a payload's dead hosts, naming each one and the host it should have been.
 *
 * @param command what was refused, as the refusal's first line names it — `slack chat.postMessage`, say
 * @param hits what the walk found; must be non-empty
 * @param withholdHits name no host and no path, for a payload whose found text could be a credential
 * @returns the refusal text
 */
function invalidDatadogHostRefusalText({
  command,
  hits,
  withholdHits,
}: {
  command: string;
  hits: readonly InvalidDatadogPayloadHit[];
  withholdHits: boolean;
}): string {
  if (withholdHits) {
    return hatchRefusal({ detail: WITHHELD_HITS_DETAIL, hatch: { ...hatchFor({ id: HATCH_ID }), command } });
  }
  const pairs = [...new Set(hits.map((hit) => `${hit.invalidHost} is not a Datadog console; use ${hit.correctHost}`))];
  const where = [...new Set(hits.map((hit) => (hit.path === "" ? "the text" : hit.path)))];
  const detail = `${pairs.join("; ")} — found at ${where.join(", ")}`;
  return hatchRefusal({ detail, hatch: { ...hatchFor({ id: HATCH_ID }), command } });
}

/**
 * Whether this session holds the dead-host hatch open — a live journalled grant, or the ambient variable the
 * outbound lane still honours.
 *
 * @returns true when the write may carry a dead host this once
 */
export function invalidDatadogHostHatchOpen(): boolean {
  return hatchOpen({ env: process.env, id: HATCH_ID, nowIso: new Date().toISOString() });
}

/**
 * The refusal for a payload, or `undefined` when it may be sent.
 *
 * @param command what is being sent, for the refusal's first line
 * @param payload the exact payload about to cross the provider boundary
 * @param hatchIsOpen whether the hatch is open — {@link invalidDatadogHostHatchOpen} in production, a plain
 *   function in a test; asked only when there is something to refuse
 * @param withholdHits judge the payload exactly as ever, but name no host and no path in the refusal — for a
 *   payload carrying declared credentials, where the text found could BE one in any normalised form
 * @returns the four-line refusal, or `undefined` to send
 */
export function invalidDatadogHostRefusal({
  command,
  payload,
  hatchIsOpen,
  withholdHits,
}: {
  command: string;
  payload: unknown;
  hatchIsOpen: () => boolean;
  withholdHits?: boolean;
}): string | undefined {
  const hits = invalidDatadogHostsInPayload({ payload });
  if (hits.length === 0 || hatchIsOpen()) {
    return undefined;
  }
  return invalidDatadogHostRefusalText({ command, hits, withholdHits: withholdHits === true });
}

/**
 * The refusal as a `Result`'s error lines, judged against this session's own hatch — the shape a seam that
 * already returns `Result` (the Vanta transport, the policy upload) hands straight back.
 *
 * @param command what is being sent, for the refusal's first line
 * @param payload the exact payload about to cross the provider boundary
 * @param withholdHits name no host and no path, for a payload carrying declared credentials
 * @returns the four refusal lines, or `undefined` to send
 */
export function invalidDatadogHostRefusalLines({
  command,
  payload,
  withholdHits,
}: {
  command: string;
  payload: unknown;
  withholdHits?: boolean;
}): readonly string[] | undefined {
  return invalidDatadogHostRefusal({
    command,
    hatchIsOpen: invalidDatadogHostHatchOpen,
    payload,
    withholdHits: withholdHits === true,
  })?.split("\n");
}

/**
 * Throw {@link InvalidDatadogHostRefusedError} when a payload carries a dead Datadog console host — the shape a
 * throwing transport seam calls just before it sends.
 *
 * @param command what is being sent, for the refusal's first line
 * @param payload the exact payload about to cross the provider boundary
 * @param hatchIsOpen whether the hatch is open
 */
export function refuseInvalidDatadogHost({
  command,
  payload,
  hatchIsOpen,
}: {
  command: string;
  payload: unknown;
  hatchIsOpen: () => boolean;
}): void {
  const refusal = invalidDatadogHostRefusal({ command, hatchIsOpen, payload });
  if (refusal !== undefined) {
    throw new InvalidDatadogHostRefusedError(refusal);
  }
}
