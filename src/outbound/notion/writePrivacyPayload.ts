/**
 * What the Notion write transport's privacy guard judges in one request, and the verdict over it. Pure, bar
 * reading an upload's `Blob` into bytes: the effectful half — loading the policy from a home and refusing before
 * anything is sent — is `./writePrivacy.ts`, called by the write client's `fetch`
 * (`../../corpus/notion/guardedFetch.ts`) and by the upload preflight (`../../corpus/notion/mediaApi.ts`).
 *
 * ## Which requests are writes
 *
 * Every request NOT on {@link NOTION_READ_ROUTES}, an exact list of the five reads the write lane's client makes,
 * each matched on its HTTP method AND its `/v1/…` path, so a GET and a PATCH on one page path are never confused. A
 * route added later is a write until somebody lists it as a read, so a new write can never slip past unjudged; the
 * cost is that a new read needs the private-terms file until it is listed. The routes were measured off the pinned
 * SDK's own `fetch` calls (`src/__tests__/unit/outbound/notion/writePrivacy.test.ts`), never inferred from names.
 *
 * ## What is judged
 *
 * Every STRING LEAF of a JSON body, at any depth — markdown, a title, an icon, a caption, a block's text, a URL,
 * properties and anything nested — except a STRING directly under a key {@link isNotionStructuralKey} names: a
 * token, `auth`, an `id` or a `…_id` string says where a write goes, not what it says. An object under such a key
 * is still walked. A body that is not JSON refuses rather than passing unjudged.
 *
 * A multipart upload's every string field (bar a `…_id`), each file's name and MIME type, and its BYTES when the
 * filename has a text-like extension (`TEXT_UPLOAD_EXTENSIONS`, shared with the Slack and Linear guards), decoded
 * as strict UTF-8; a text-like file that is not valid UTF-8 refuses. Every other file — an image, a PDF, an
 * archive — passes with its bytes unread: no OCR, EXIF or document parsing, so text drawn into pixels is unjudged.
 *
 * ## Where it goes
 *
 * The installation's own Notion workspace ({@link NOTION_WORKSPACE_DESTINATION}), which forgives
 * forbidden-identifier findings only: installation state, credentials, the denylist and private terms refuse
 * exactly as anywhere else. The residue: a page shared to the web or with a guest receives what that audience forgives.
 */
import { err, ok, type Result } from "../../lib/result.js";
import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import { TEXT_UPLOAD_EXTENSIONS } from "../slack/writePrivacyPayload.js";
import { payloadLeaves } from "../writePrivacyLeaves.js";

/** One string the guard judges, and the locus a refusal names it by. */
export interface NotionWriteLeaf {
  readonly locus: string;
  readonly text: string;
}

/** The destination every Notion write is judged under: the installation's own workspace. */
export const NOTION_WORKSPACE_DESTINATION: PrivacyDestination = {
  identifierAudience: "installation-workspace",
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

/** One request shape the write lane's client sends, named by the SDK method that sends it. */
interface NotionRoute {
  readonly method: string;
  readonly path: RegExp;
  readonly name: string;
}

/** The five reads the write lane's client makes. Every other request is judged as a write. */
export const NOTION_READ_ROUTES: readonly NotionRoute[] = [
  { method: "GET", name: "pages.retrieve", path: /^\/v1\/pages\/[^/]+$/u },
  { method: "GET", name: "pages.retrieveMarkdown", path: /^\/v1\/pages\/[^/]+\/markdown$/u },
  { method: "GET", name: "blocks.children.list", path: /^\/v1\/blocks\/[^/]+\/children$/u },
  { method: "GET", name: "fileUploads.retrieve", path: /^\/v1\/file_uploads\/[^/]+$/u },
  { method: "GET", name: "users.me", path: /^\/v1\/users\/me$/u },
];

/** The writes the lane sends today, named only so a refusal reads `notion pages.create` rather than an address. */
const NOTION_WRITE_ROUTES: readonly NotionRoute[] = [
  { method: "POST", name: "pages.create", path: /^\/v1\/pages$/u },
  { method: "PATCH", name: "pages.update", path: /^\/v1\/pages\/[^/]+$/u },
  { method: "PATCH", name: "pages.updateMarkdown", path: /^\/v1\/pages\/[^/]+\/markdown$/u },
  { method: "POST", name: "pages.move", path: /^\/v1\/pages\/[^/]+\/move$/u },
  { method: "PATCH", name: "blocks.children.append", path: /^\/v1\/blocks\/[^/]+\/children$/u },
  { method: "DELETE", name: "blocks.delete", path: /^\/v1\/blocks\/[^/]+$/u },
  { method: "POST", name: "fileUploads.create", path: /^\/v1\/file_uploads$/u },
  { method: "POST", name: "fileUploads.send", path: /^\/v1\/file_uploads\/[^/]+\/send$/u },
];

/** The request's path, or undefined for a URL that does not parse, which is then judged as a write. */
function pathOf({ url }: { url: string }): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/** The route a request matches in `routes`, on its method and its path both. */
function routeIn({
  routes,
  url,
  method,
}: {
  routes: readonly NotionRoute[];
  url: string;
  method: string | undefined;
}): NotionRoute | undefined {
  const path = pathOf({ url });
  if (path === undefined || method === undefined) {
    return undefined;
  }
  const verb = method.toUpperCase();
  return routes.find((route) => route.method === verb && route.path.test(path));
}

/**
 * Whether a request is one of the write lane's five reads, which never need the private-terms file.
 *
 * @param url the full request URL the SDK fetches
 * @param method the HTTP method; a request naming none is judged as a write
 * @returns true only for a route on {@link NOTION_READ_ROUTES}
 */
export function isNotionReadRequest({ url, method }: { url: string; method: string | undefined }): boolean {
  return routeIn({ method, routes: NOTION_READ_ROUTES, url }) !== undefined;
}

/**
 * The name a refusal opens with, carrying no page, block or upload id: the SDK method for a known write, else the
 * HTTP method and the path with every segment that is not `v1` or a plain lowercase word replaced by `{id}`.
 *
 * @param url the full request URL the SDK fetches
 * @param method the HTTP method
 * @returns `notion pages.create`, or `notion POST /v1/comments/{id}` for a write nobody named yet
 */
export function notionRequestCommand({ url, method }: { url: string; method: string | undefined }): string {
  const known = routeIn({ method, routes: NOTION_WRITE_ROUTES, url });
  if (known !== undefined) {
    return `notion ${known.name}`;
  }
  const verb = method === undefined ? "UNSPECIFIED" : method.toUpperCase();
  return `notion ${verb} ${redactedPath({ url })}`;
}

/** A request's path with every segment that is not `v1` or a plain lowercase word replaced by `{id}`. */
function redactedPath({ url }: { url: string }): string {
  const path = pathOf({ url });
  if (path === undefined) {
    return "an unparseable address";
  }
  return path
    .split("/")
    .map((segment) => (/^(?:v1|[a-z_]*)$/u.test(segment) ? segment : "{id}"))
    .join("/");
}

/**
 * Whether a key says where a write goes rather than what it says. Only a STRING directly under it is skipped: an
 * object or array under such a key (`unique_id: { prefix }` on a database property) is content and is walked.
 *
 * @param key one object key or form field name
 * @returns true for `token`, `auth`, `id` and any `…_id`
 */
export function isNotionStructuralKey({ key }: { key: string }): boolean {
  return key === "token" || key === "auth" || key === "id" || key.endsWith("_id");
}

/**
 * A parsed JSON body with every string sitting directly under a structural key removed, and nothing else.
 *
 * @param value one parsed JSON value; acyclic, since `JSON.parse` cannot build a cycle
 * @returns the same shape, less those id and credential strings
 */
function withoutStructuralStrings({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withoutStructuralStrings({ value: item }));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !(typeof item === "string" && isNotionStructuralKey({ key })))
      .map(([key, item]) => [key, withoutStructuralStrings({ value: item })]),
  );
}

/** Why a write's payload could not be walked into leaves, so the guard cannot judge it and refuses it. */
type NotionWritePayloadError =
  | { readonly code: "BODY_NOT_JSON"; readonly message: string }
  | { readonly code: "TEXT_NOT_UTF8"; readonly message: string };

/** The one place each {@link NotionWritePayloadError} is built. */
const NotionWritePayloadErrors = {
  bodyNotJson: ({ command }: { command: string }): NotionWritePayloadError => ({
    code: "BODY_NOT_JSON",
    message: `${command}: a request body that is not JSON, so it cannot be judged`,
  }),
  textNotUtf8: ({ command, field }: { command: string; field: string }): NotionWritePayloadError => ({
    code: "TEXT_NOT_UTF8",
    message: `${command} ${field}: a text-like file that is not valid UTF-8, so it cannot be judged`,
  }),
} as const;

/**
 * Every string a JSON body would send that the guard judges, each under its locus.
 *
 * @param command the refusal's opening name, `notion pages.create`
 * @param body the serialised body exactly as the SDK sends it; undefined for a request with none
 * @returns the leaves in walk order, or the refusal for a body that is not JSON
 */
export function notionJsonWriteLeaves({
  command,
  body,
}: {
  command: string;
  body: string | undefined;
}): Result<readonly NotionWriteLeaf[], NotionWritePayloadError> {
  if (body === undefined) {
    return ok([]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err(NotionWritePayloadErrors.bodyNotJson({ command }));
  }
  const leaves = payloadLeaves({ path: "", skipKey: () => false, value: withoutStructuralStrings({ value: parsed }) });
  return ok(leaves.map(({ path, text }) => ({ locus: `${command} ${path}`, text })));
}

/** One file in a multipart body, its bytes already read. */
interface NotionUploadFile {
  readonly field: string;
  readonly filename: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** A multipart body with every file read into bytes, so both guards judge the same bytes the request sends. */
export interface NotionMaterialisedForm {
  readonly fields: readonly { readonly field: string; readonly value: string }[];
  readonly files: readonly NotionUploadFile[];
}

/**
 * Read every file of a multipart body into bytes, once. The form itself is left untouched and is what is sent: a
 * `Blob` can be read again.
 *
 * @param form the `FormData` the SDK built
 * @returns its string fields and its files, in entry order
 */
async function materialiseNotionForm({ form }: { form: FormData }): Promise<NotionMaterialisedForm> {
  const fields: { readonly field: string; readonly value: string }[] = [];
  const files: NotionUploadFile[] = [];
  for (const [field, value] of form.entries()) {
    if (typeof value === "string") {
      fields.push({ field, value });
    } else {
      files.push({ bytes: new Uint8Array(await value.arrayBuffer()), field, filename: value.name, type: value.type });
    }
  }
  return { fields, files };
}

/** Whether a filename's extension is on `TEXT_UPLOAD_EXTENSIONS`; a name with no extension is not. */
function isTextLike({ filename }: { filename: string }): boolean {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 && TEXT_UPLOAD_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}

/** The bytes as UTF-8, or undefined when they are not valid UTF-8. */
function decodeStrictUtf8({ bytes }: { bytes: Uint8Array }): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Every string a multipart body would send that the guard judges: each string field bar a structural one, each
 * file's name and type, and a text-like file's decoded bytes.
 *
 * @param command the refusal's opening name, `notion fileUploads.send`
 * @param form the body with its files already read
 * @returns the leaves, or the refusal for a text-like file that is not valid UTF-8
 */
export function notionFormLeaves({
  command,
  form,
}: {
  command: string;
  form: NotionMaterialisedForm;
}): Result<readonly NotionWriteLeaf[], NotionWritePayloadError> {
  const leaves: NotionWriteLeaf[] = form.fields
    .filter(({ field }) => !isNotionStructuralKey({ key: field }))
    .map(({ field, value }) => ({ locus: `${command} ${field}`, text: value }));
  for (const file of form.files) {
    leaves.push(
      { locus: `${command} ${file.field}.filename`, text: file.filename },
      { locus: `${command} ${file.field}.type`, text: file.type },
    );
    if (!isTextLike({ filename: file.filename })) {
      continue;
    }
    const text = decodeStrictUtf8({ bytes: file.bytes });
    if (text === undefined) {
      return err(NotionWritePayloadErrors.textNotUtf8({ command, field: file.field }));
    }
    leaves.push({ locus: `${command} ${file.field}`, text });
  }
  return ok(leaves);
}

/**
 * Judge every leaf of one write against the outbound privacy check, in the installation's own Notion workspace.
 *
 * @param leaves the request's leaves, an upload's text included
 * @param policy the denylist, identifier rules and private terms the check reads
 * @returns every finding, leaf by leaf in walk order; empty when the write may be sent
 */
export function notionWriteFindings({
  leaves,
  policy,
}: {
  leaves: readonly NotionWriteLeaf[];
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return leaves.flatMap(
    (leaf) =>
      checkPrivacy({
        content: leaf,
        destination: NOTION_WORKSPACE_DESTINATION,
        personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
        policy,
      }).findings,
  );
}

/** One write as both pre-wire guards judge it. */
export interface NotionWriteRequest {
  /** The refusal's opening name, carrying no id. */
  readonly command: string;
  /** What the dead-Datadog-host walk reads: the serialised body, or the form plus every file's bytes. */
  readonly payload: unknown;
  /** What the privacy check judges, or the refusal for a body that cannot be judged. */
  readonly leaves: Result<readonly NotionWriteLeaf[], NotionWritePayloadError>;
  /** The whole request, its URL's page or block id included, which a held write's key covers. */
  readonly request: unknown;
}

/**
 * One fetch as both guards judge it, or undefined for one of the five reads.
 *
 * @param url the full request URL the SDK fetches
 * @param method the HTTP method the SDK sends
 * @param body the serialised JSON or the multipart form, exactly as it will be sent
 * @returns the judged request, or undefined for a read
 */
export async function notionWriteRequest({
  url,
  method,
  body,
}: {
  url: string;
  method: string | undefined;
  body: string | FormData | undefined;
}): Promise<NotionWriteRequest | undefined> {
  if (isNotionReadRequest({ method, url })) {
    return undefined;
  }
  const command = notionRequestCommand({ method, url });
  if (body instanceof FormData) {
    const form = await materialiseNotionForm({ form: body });
    return {
      command,
      leaves: notionFormLeaves({ command, form }),
      payload: { files: form.files, form: body },
      request: { fields: form.fields, files: form.files, method, url },
    };
  }
  return { command, leaves: notionJsonWriteLeaves({ body, command }), payload: body, request: { body, method, url } };
}

/**
 * A whole upload as both guards judge it BEFORE its slot is reserved: its name, its type and a text-like file's
 * bytes, the same leaves its `fileUploads.send` later carries.
 *
 * @param filename the name the file is uploaded under
 * @param contentType the MIME type it is declared as
 * @param bytes the file's contents
 * @returns the judged request, under the command `notion attach upload`
 */
export function notionUploadRequest({
  filename,
  contentType,
  bytes,
}: {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): NotionWriteRequest {
  const command = "notion attach upload";
  const form: NotionMaterialisedForm = { fields: [], files: [{ bytes, field: "file", filename, type: contentType }] };
  return {
    command,
    leaves: notionFormLeaves({ command, form }),
    payload: { bytes, contentType, filename },
    request: { bytes, contentType, filename },
  };
}
