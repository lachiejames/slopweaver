/**
 * What the Gmail transport's privacy guard judges in one request, and the verdict over it. Pure bar the MIME parse
 * (`./mimePrivacyPayload.ts`); the effectful half — the policy from a home, the re-read of a draft before it is sent,
 * and the refusal — is `./writePrivacy.ts` and `../../live/gmail/guardedFetch.ts`.
 *
 * ## Which requests are Gmail requests, and which of those are writes
 *
 * A request to `gmail.googleapis.com`, or to `www.googleapis.com` under a `/gmail/` path, is Gmail's; every other
 * request on the shared auth transport — the OAuth token refresh, a Google Docs read — passes through untouched.
 * Of Gmail's, every request NOT on {@link GMAIL_READ_ROUTES} is a write: an exact list of the reads the door makes,
 * each matched on its HTTP method AND its path, measured off the pinned SDK's own requests
 * (`src/__tests__/unit/live/gmail/guardedFetch.test.ts`), never inferred from names. A route added later is a write
 * until somebody lists it as a read, so a new write can never slip past unjudged; a new read needs the private-terms
 * file until it is listed.
 *
 * ## What is judged
 *
 * The request's path and every query value, and every STRING LEAF of its JSON body at any depth — a message or thread
 * id, a label id. A string under a `raw` key is a base64url MIME message, so it is decoded and parsed rather than
 * judged as text (`./mimePrivacyPayload.ts`); a `drafts.create` with none refuses. A `drafts.send` carrying only a
 * draft id is judged on the draft Gmail holds, re-read with `format=raw` immediately before the send. A body that is
 * not JSON refuses rather than passing unjudged. Transport headers — the bearer token above all — are never leaves.
 *
 * ## Where it goes: strict, always
 *
 * {@link GMAIL_STRICT_DESTINATION}. Mail can reach anyone, and no installation state proves a recipient is inside the
 * organisation: a same-domain address can be a group with outside members, forwarded or delegated. So every Gmail
 * write — a label change, a draft, a send, a one-click unsubscribe — forgives nothing.
 */
import { err, ok, type Result } from "../../lib/result.js";
import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import { payloadLeaves } from "../writePrivacyLeaves.js";
import { type GmailWriteLeaf, gmailRawMimeLeaves } from "./mimePrivacyPayload.js";
import { type GmailWritePayloadError, GmailWritePayloadErrors } from "./writePrivacyErrors.js";

/** The destination every Gmail write is judged under: strict, forgiving nothing. */
export const GMAIL_STRICT_DESTINATION: PrivacyDestination = {
  identifierAudience: "strict",
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

/** One request shape the Gmail door sends, named by the SDK method that sends it. */
interface GmailRoute {
  readonly method: string;
  readonly path: RegExp;
  readonly name: string;
}

/** The reads the Gmail door makes. Every other Gmail request is judged as a write. */
const GMAIL_READ_ROUTES: readonly GmailRoute[] = [
  { method: "GET", name: "users.messages.list", path: /^\/gmail\/v1\/users\/[^/]+\/messages$/u },
  { method: "GET", name: "users.messages.get", path: /^\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+$/u },
  {
    method: "GET",
    name: "users.messages.attachments.get",
    path: /^\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+$/u,
  },
  { method: "GET", name: "users.threads.get", path: /^\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+$/u },
  { method: "GET", name: "users.labels.list", path: /^\/gmail\/v1\/users\/[^/]+\/labels$/u },
  { method: "GET", name: "users.getProfile", path: /^\/gmail\/v1\/users\/[^/]+\/profile$/u },
  { method: "GET", name: "users.history.list", path: /^\/gmail\/v1\/users\/[^/]+\/history$/u },
  { method: "GET", name: "users.drafts.get", path: /^\/gmail\/v1\/users\/[^/]+\/drafts\/[^/]+$/u },
];

/** The writes the door sends today, named only so a refusal reads `gmail drafts.create` rather than an address. */
const GMAIL_WRITE_ROUTES: readonly GmailRoute[] = [
  { method: "POST", name: "messages.modify", path: /^\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/modify$/u },
  { method: "POST", name: "threads.modify", path: /^\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+\/modify$/u },
  { method: "POST", name: "drafts.create", path: /^\/gmail\/v1\/users\/[^/]+\/drafts$/u },
  { method: "POST", name: "drafts.send", path: /^\/gmail\/v1\/users\/[^/]+\/drafts\/send$/u },
];

/**
 * Whether a request is Gmail's own, the only kind this guard judges.
 *
 * @param url the full request URL the SDK fetches
 * @returns true for `gmail.googleapis.com`, and for `www.googleapis.com` under a Gmail path
 */
export function isGmailApiRequest({ url }: { url: URL }): boolean {
  if (url.hostname === "gmail.googleapis.com") {
    return true;
  }
  return url.hostname === "www.googleapis.com" && /^\/(?:upload\/|batch\/)?gmail\//u.test(url.pathname);
}

/** The route a request matches in `routes`, on its method and its path both. */
function routeIn({
  routes,
  url,
  method,
}: {
  routes: readonly GmailRoute[];
  url: URL;
  method: string;
}): GmailRoute | undefined {
  const verb = method.toUpperCase();
  return routes.find((route) => route.method === verb && route.path.test(url.pathname));
}

/**
 * Whether a Gmail request is one of the door's reads, which never load the private-terms file.
 *
 * @param url the full request URL the SDK fetches
 * @param method the HTTP method
 * @returns true only for a route on {@link GMAIL_READ_ROUTES}
 */
export function isGmailReadRequest({ url, method }: { url: URL; method: string }): boolean {
  return routeIn({ method, routes: GMAIL_READ_ROUTES, url }) !== undefined;
}

/**
 * Whether a request is `users.drafts.send`, which delivers a draft the guard must re-read first.
 *
 * @param url the full request URL the SDK fetches
 * @param method the HTTP method
 * @returns true for `POST …/drafts/send`
 */
export function isGmailDraftSend({ url, method }: { url: URL; method: string }): boolean {
  return routeIn({ method, routes: GMAIL_WRITE_ROUTES, url })?.name === "drafts.send";
}

/**
 * The name a refusal opens with, carrying no message, thread or draft id: the SDK method for a known write, else the
 * HTTP method and the path with every segment that is not a plain lowercase word or `v1` replaced by `{id}`.
 *
 * @param url the full request URL the SDK fetches
 * @param method the HTTP method
 * @returns `gmail drafts.create`, or `gmail POST /gmail/v1/users/me/messages/{id}/trash` for one nobody named yet
 */
export function gmailRequestCommand({ url, method }: { url: URL; method: string }): string {
  const known = routeIn({ method, routes: GMAIL_WRITE_ROUTES, url });
  if (known !== undefined) {
    return `gmail ${known.name}`;
  }
  const path = url.pathname
    .split("/")
    .map((segment) => (/^(?:v1|[a-z]*)$/u.test(segment) ? segment : "{id}"))
    .join("/");
  return `gmail ${method.toUpperCase()} ${path}`;
}

/** What a JSON body holds for the guard: its plain string leaves, and every base64url MIME message under `raw`. */
interface GmailJsonBody {
  readonly leaves: readonly GmailWriteLeaf[];
  readonly raws: readonly { readonly locus: string; readonly raw: string }[];
}

/**
 * Every string a JSON body would send, a `raw` MIME message set apart to be decoded rather than read as text.
 *
 * @param command the refusal's opening name, `gmail drafts.create`
 * @param body the serialised body exactly as the SDK sends it; undefined for a request with none
 * @returns the leaves and the raw messages, or the refusal for a body that is not JSON
 */
export function gmailJsonBody({
  command,
  body,
}: {
  command: string;
  body: string | undefined;
}): Result<GmailJsonBody, GmailWritePayloadError> {
  if (body === undefined) {
    return ok({ leaves: [], raws: [] });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err(GmailWritePayloadErrors.bodyNotJson({ command }));
  }
  const leaves: GmailWriteLeaf[] = [];
  const raws: { readonly locus: string; readonly raw: string }[] = [];
  for (const { path, text } of payloadLeaves({ path: "", skipKey: () => false, value: parsed })) {
    if (path === "raw" || path.endsWith(".raw")) {
      raws.push({ locus: `${command} ${path}`, raw: text });
    } else {
      leaves.push({ locus: `${command} ${path}`, text });
    }
  }
  return ok({ leaves, raws });
}

/** The request's path and every query value, each a leaf: an id or a search term is sent too. */
function urlLeaves({ command, url }: { command: string; url: URL }): GmailWriteLeaf[] {
  return [
    { locus: `${command} path`, text: url.pathname },
    ...[...url.searchParams.entries()].map(([key, value]) => ({ locus: `${command} query.${key}`, text: value })),
  ];
}

/** One write as both pre-wire guards judge it. */
export interface GmailWriteRequest {
  /** The refusal's opening name, carrying no id. */
  readonly command: string;
  /** What the dead-Datadog-host walk reads: the address, the body as sent, and every decoded MIME string. */
  readonly payload: unknown;
  /** What the privacy check judges, or the refusal for a request that cannot be judged. */
  readonly leaves: Result<readonly GmailWriteLeaf[], GmailWritePayloadError>;
}

/** Every leaf of a write, or the first refusal: the URL, the JSON body, each raw message, the re-read draft. */
async function writeLeaves({
  command,
  url,
  body,
  draft,
}: {
  command: string;
  url: URL;
  body: string | undefined;
  draft: Result<string, { readonly message: string }> | undefined;
}): Promise<Result<readonly GmailWriteLeaf[], GmailWritePayloadError>> {
  const json = gmailJsonBody({ body, command });
  if (json.isErr()) {
    return err(json.error);
  }
  if (command === "gmail drafts.create" && json.value.raws.length === 0) {
    return err(GmailWritePayloadErrors.draftWithoutRaw({ command }));
  }
  const leaves: GmailWriteLeaf[] = [...urlLeaves({ command, url }), ...json.value.leaves];
  const raws = [...json.value.raws];
  if (draft !== undefined) {
    if (draft.isErr()) {
      return err(GmailWritePayloadErrors.writeUnreadable({ command, reason: draft.error.message }));
    }
    raws.push({ locus: `${command} draft.raw`, raw: draft.value });
  }
  for (const { locus, raw } of raws) {
    const decoded = await gmailRawMimeLeaves({ locus, raw });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    leaves.push(...decoded.value);
  }
  return ok(leaves);
}

/**
 * One Gmail write as both guards judge it.
 *
 * @param method the HTTP method the SDK sends
 * @param url the full request URL
 * @param body the serialised body exactly as it will be sent, or undefined for none
 * @param draft for a `drafts.send` naming only an id: the draft's raw as re-read just now, or why it could not be;
 *   undefined for every other write
 * @returns the judged request
 */
export async function gmailWriteRequest({
  method,
  url,
  body,
  draft,
}: {
  method: string;
  url: URL;
  body: string | undefined;
  draft: Result<string, { readonly message: string }> | undefined;
}): Promise<GmailWriteRequest> {
  const command = gmailRequestCommand({ method, url });
  const leaves = await writeLeaves({ body, command, draft, url });
  const decoded = leaves.isOk() ? leaves.value.map((leaf) => leaf.text) : [];
  return { command, leaves, payload: { body, decoded, url: url.href } };
}

/**
 * A write the transport could not hand over to be judged — a body it cannot read as text — refused under its own
 * command, with the URL alone for the dead-host walk.
 *
 * @param url the full request URL
 * @param method the HTTP method
 * @param reason the transport's own sentence for why the body cannot be read
 * @returns the judged request, its leaves the refusal
 */
export function gmailUnreadableWriteRequest({
  method,
  url,
  reason,
}: {
  method: string;
  url: URL;
  reason: string;
}): GmailWriteRequest {
  const command = gmailRequestCommand({ method, url });
  return { command, leaves: err(GmailWritePayloadErrors.writeUnreadable({ command, reason })), payload: url.href };
}

/**
 * A one-click unsubscribe POST as both guards judge it: the sender's whole URL, path and query tokens included, the
 * form body and the content type. It goes to a third party, not Gmail, so no Gmail transport sees it.
 *
 * @param url the sender's one-click target
 * @param body the RFC 8058 form body
 * @param contentType the content type the POST declares
 * @returns the judged request, under the command `gmail unsubscribe one-click`
 */
export function gmailOneClickRequest({
  url,
  body,
  contentType,
}: {
  url: URL;
  body: string;
  contentType: string;
}): GmailWriteRequest {
  const command = "gmail unsubscribe one-click";
  const leaves: readonly GmailWriteLeaf[] = [
    { locus: `${command} url`, text: url.href },
    { locus: `${command} body`, text: body },
    { locus: `${command} content-type`, text: contentType },
  ];
  return { command, leaves: ok(leaves), payload: { body, contentType, url: url.href } };
}

/**
 * Judge every leaf of one write against the outbound privacy check, strictly.
 *
 * @param leaves the request's leaves, a draft's decoded message included
 * @param policy the denylist, identifier rules and private terms the check reads
 * @returns every finding, leaf by leaf in walk order; empty when the write may be sent
 */
export function gmailWriteFindings({
  leaves,
  policy,
}: {
  leaves: readonly GmailWriteLeaf[];
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return leaves.flatMap(
    (leaf) =>
      checkPrivacy({
        content: leaf,
        destination: GMAIL_STRICT_DESTINATION,
        personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
        policy,
      }).findings,
  );
}
