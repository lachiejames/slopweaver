/**
 * The user-attachment upload protocol, as pure functions — GitHub's own internal asset pipeline, the one
 * its comment box drives when you drag a file into it, expressed as data rather than as a DOM dance.
 *
 * ## Why this exists at all, and why it is not an Octokit call
 *
 * There is no REST or GraphQL endpoint for attaching media to a comment. `raw.githubusercontent.com` is
 * not a substitute: on a PRIVATE repository it does not render inline for another viewer, which was
 * measured the hard way (five pull requests on a private repository each got a broken-image
 * icon in the rendered description). The only
 * URL that renders inline in any markdown context on GitHub, public or private, is
 * `https://github.com/user-attachments/assets/<uuid>`, and the only way to mint one is this pipeline.
 *
 * ## The three calls
 *
 * 1. `POST {@link UPLOAD_POLICY_PATH}` — name/size/content_type + a CSRF `authenticity_token` + the numeric
 *    `repository_id`. Answers `201` with the presigned bucket policy AND the final asset `href`, which
 *    therefore exists before a single byte has been transferred.
 * 2. `POST <upload_url>` — every field of that policy's `form`, in order, then the bytes as `file` LAST.
 *    Answers `204` with an empty body. This is the only call that moves the file.
 * 3. `PUT <asset_upload_url>` — one `authenticity_token`. Answers `200` with the asset JSON.
 *
 * **Step 3's token is the one step 1 handed back**, not a fresh page scrape: the policy response carries
 * `asset_upload_authenticity_token` next to `asset_upload_url`. Measured — worth stating
 * because the reverse-engineered write-up this was built from assumed a second scrape, and a second
 * scrape is both slower and a real source of drift (the two tokens would come from different page loads).
 *
 * ## Where the scraped values come from, and where they do NOT
 *
 * Both live on the same `<file-attachment>` element, and only a page GitHub still server-renders a classic
 * markdown editor on carries one. Measured with a signed-in, SAML-authorised session: a pull
 * request's default, changes and commits pages, an issue and a commit page are all GitHub's React app now and
 * render NO upload region, while a pull request's `?overview=false` page and `releases/new` each render one
 * (`attachClient.ts`'s `uploadTokenPageUrls` says which is read when). Earlier, same shape: a repository home
 * page, an issue list and `issues/new` all carry the `octolytics-dimension-repository_id` meta tag while
 * rendering no upload region at all — so keying the repository id off that meta tag would appear to work on
 * pages where no token exists to pair it with. {@link scrapeUploadContext} therefore reads BOTH values out of
 * the upload region, never one from each source: a token and a repository id from different origins is exactly
 * the mismatch nobody would catch.
 *
 * Everything here is pure — no fetch, no fs. `attachClient.ts` is the effectful shell that calls it.
 */

import { type DefaultTreeAdapterMap, parse, html as parse5Html } from "parse5";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";

/** The upload-policy path, relative to `https://github.com`. */
export const UPLOAD_POLICY_PATH = "/upload/policies/assets";

/** The origin every call in this pipeline is made against and declares. */
export const GITHUB_ORIGIN = "https://github.com";

/**
 * The user agent every call in this pipeline sends.
 *
 * Not decoration, and not an attempt to look like something this is not: these endpoints exist only to
 * serve a browser, they are the web application talking to itself, and the sole client GitHub has ever
 * had to keep them working for is Chrome. A default Node user agent is the likeliest single reason a
 * request that works from a page would be turned away from a process, so the pipeline sends what the
 * captured session was captured from. Kept as one named constant so it is obvious what to change if
 * GitHub ever starts caring.
 */
export const GITHUB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/151.0.0.0 Safari/537.36";

/**
 * The headers github.com requires on calls 1 and 3. Measured: `accept` and `x-requested-with`
 * are the whole required set — the browser also sends `x-fetch-nonce` and `x-github-client-version`, and
 * the pipeline answers 201/200 without either, so those two are session chrome rather than protocol.
 * `origin` and `referer` are added per call by the client, because they name the page the upload belongs
 * to.
 */
export const GITHUB_XHR_HEADERS: Readonly<Record<string, string>> = {
  accept: "application/json",
  "user-agent": GITHUB_USER_AGENT,
  "x-requested-with": "XMLHttpRequest",
};

/**
 * Extension → content type and the MEASURED size ceiling GitHub's policy endpoint enforces for it.
 *
 * The ceilings are two distinct numbers, both measured against the live endpoint rather
 * than read from documentation (GitHub documents neither): **10 MiB for an image, 100 MiB for a video**,
 * both inclusive — 10,485,760 and 104,857,600 bytes are accepted, and one byte more is refused. The
 * gap is why this table pairs a limit with each type instead of holding one global constant.
 */
export const ATTACHABLE_MEDIA: Readonly<Record<string, { readonly contentType: string; readonly limitBytes: number }>> =
  {
    ".gif": { contentType: "image/gif", limitBytes: 10485760 },
    ".jpeg": { contentType: "image/jpeg", limitBytes: 10485760 },
    ".jpg": { contentType: "image/jpeg", limitBytes: 10485760 },
    ".mov": { contentType: "video/quicktime", limitBytes: 104857600 },
    ".mp4": { contentType: "video/mp4", limitBytes: 104857600 },
    ".png": { contentType: "image/png", limitBytes: 10485760 },
    ".svg": { contentType: "image/svg+xml", limitBytes: 10485760 },
    ".webm": { contentType: "video/webm", limitBytes: 104857600 },
    ".webp": { contentType: "image/webp", limitBytes: 10485760 },
  };

/** A file classified against {@link ATTACHABLE_MEDIA} and found small enough to send. */
export interface ClassifiedAttachment {
  readonly contentType: string;
  readonly limitBytes: number;
  readonly byteLength: number;
  /** The file's name EXACTLY as it is on disk — GitHub sanitises it server-side; see {@link policyFormFields}. */
  readonly fileName: string;
}

/** The two values scraped off a page's assets upload region. */
export interface UploadContext {
  readonly authenticityToken: string;
  readonly repositoryId: string;
}

/** GitHub's policy response — the presigned bucket, the finalize address, and the asset's permanent URL. */
export interface UploadPolicy {
  readonly uploadUrl: string;
  readonly form: Readonly<Record<string, string>>;
  readonly assetId: number;
  readonly assetHref: string;
  /** GitHub's OWN sanitised name for the asset — read back, never computed here. */
  readonly assetName: string;
  readonly assetUploadUrl: string;
  readonly assetUploadAuthenticityToken: string;
}

/** The lowercased final extension of a path, `""` when there is none after the last separator. */
function extensionOf({ fileName }: { fileName: string }): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot).toLowerCase();
}

/**
 * Classify a file by extension and check it against the measured ceiling for its content type — the whole
 * local half of "don't send a write you already know GitHub will refuse". Both refusals happen here, with
 * no network call, so `--dry-run` reports exactly what a real run would.
 *
 * @param fileName the file's base name (its extension selects the content type)
 * @param byteLength the file's exact size in bytes
 * @returns the content type, its ceiling and the name to send, or why the file is unsendable
 */
export function classifyAttachment({
  fileName,
  byteLength,
}: {
  fileName: string;
  byteLength: number;
}): Result<ClassifiedAttachment, GithubAttachError> {
  const extension = extensionOf({ fileName });
  const media = ATTACHABLE_MEDIA[extension];
  if (media === undefined) {
    return err(GithubAttachErrors.unsupportedMedia({ extension }));
  }
  if (byteLength > media.limitBytes) {
    return err(
      GithubAttachErrors.fileTooLarge({
        byteLength,
        contentType: media.contentType,
        limitBytes: media.limitBytes,
      }),
    );
  }
  return ok({ byteLength, contentType: media.contentType, fileName, limitBytes: media.limitBytes });
}

/** A node of a page as parse5 builds it. */
type PageNode = DefaultTreeAdapterMap["node"];
/** An element of a page as parse5 builds it. */
type PageElement = DefaultTreeAdapterMap["element"];

/** Whether a parsed node is an element rather than text, a comment or the document. */
function isPageElement(node: PageNode): node is PageElement {
  return "tagName" in node;
}

/**
 * Whether an element is the HTML element of that name. A `<file-attachment>` or `<input>` inside `<svg>` or `<math>`
 * is a foreign element sharing only the name, and is never the upload component.
 */
function isHtmlElement({ element, name }: { element: PageElement; name: string }): boolean {
  return element.tagName === name && element.namespaceURI === parse5Html.NS.HTML;
}

/** An element's attribute, or `undefined` when it has none; parse5 has lower-cased the name and decoded the value. */
function attributeOf({ element, name }: { element: PageElement; name: string }): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

/**
 * Every element under `node` in document order, itself excluded. A `<template>`'s inert content is never entered
 * (parse5 keeps it off `childNodes`), and nor is the inside of a nested element named `stopAt`. Iterative, because
 * `releases/new` is several megabytes of markup.
 */
function elementsUnder({ node, stopAt }: { node: PageNode; stopAt?: string }): readonly PageElement[] {
  const found: PageElement[] = [];
  const pending: PageNode[] = "childNodes" in node ? node.childNodes.toReversed() : [];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!isPageElement(next)) {
      continue;
    }
    found.push(next);
    if (next.tagName !== stopAt) {
      // One push per child, never a spread: a page with a million siblings would pass a million arguments.
      for (let index = next.childNodes.length - 1; index >= 0; index -= 1) {
        pending.push(next.childNodes[index]!);
      }
    }
  }
  return found;
}

/**
 * Whether an element is the upload-policy CSRF input — its class list carries `js-data-upload-policy-url-csrf`.
 * Split on ASCII whitespace only, as HTML splits a class list: JavaScript's `\s` also takes a decoded `&nbsp;`,
 * which would make one class read as two.
 */
function isPolicyCsrfInput({ element }: { element: PageElement }): boolean {
  const classes = attributeOf({ element, name: "class" });
  return (
    isHtmlElement({ element, name: "input" }) &&
    classes?.split(/[\t\n\f\r ]+/).includes("js-data-upload-policy-url-csrf") === true
  );
}

/**
 * The repository id and CSRF token of the first `<file-attachment>` whose upload policy is
 * {@link UPLOAD_POLICY_PATH}, either `undefined` where that element lacks it, or `undefined` overall when the
 * page renders no such element. The token is the first CSRF input INSIDE that element, never one inside another
 * `<file-attachment>` nested in it.
 *
 * A page can carry more than one upload region, and they are not interchangeable. `releases/new` renders the
 * release BODY's markdown editor against `/upload/policies/assets` and, further down, the release BINARIES
 * drop target against `/upload/policies/releases`, each with its own `data-csrf` input. That token is a
 * per-form CSRF token scoped to its own policy URL, so the binaries one sent to the assets endpoint is a
 * token for a different form. Reading "the first csrf input on the page" happens to pick the right one on
 * that page today only because of element order.
 *
 * The page is parsed by parse5, the spec's own tree construction, rather than scanned: a hand-written scanner
 * fell short of the spec one case per review — an attribute's quoted value, an upper-case tag, a comment, a
 * `</scriptX>`, a `<plaintext>` — and each let through a
 * token from no element of the assets region. What a browser would build is what is read.
 */
function assetsUploadRegion({
  html,
}: {
  html: string;
}): { repositoryId: string | undefined; authenticityToken: string | undefined } | undefined {
  const region = elementsUnder({ node: parse(html) }).find(
    (element) =>
      isHtmlElement({ element, name: "file-attachment" }) &&
      attributeOf({ element, name: "data-upload-policy-url" }) === UPLOAD_POLICY_PATH,
  );
  if (region === undefined) {
    return undefined;
  }
  const input = elementsUnder({ node: region, stopAt: "file-attachment" }).find((element) =>
    isPolicyCsrfInput({ element }),
  );
  return {
    authenticityToken: input === undefined ? undefined : attributeOf({ element: input, name: "value" }),
    repositoryId: attributeOf({ element: region, name: "data-upload-repository-id" }),
  };
}

/**
 * Scrape the CSRF token and the numeric repository id off the page's assets upload region.
 *
 * Both are read from the `<file-attachment>` whose `data-upload-policy-url` is {@link UPLOAD_POLICY_PATH} —
 * the repository id off its own `data-upload-repository-id`, the token off the
 * `class="js-data-upload-policy-url-csrf"` input inside it — and never from any other upload region on the
 * page ({@link assetsUploadRegion} says why). The page is parsed, so neither attribute ORDER nor quote
 * style is assumed — GitHub emits `class` before `value` on the token input today, and a renderer change that
 * swapped them must not break the read.
 *
 * A page missing either value is reported with BOTH names it looked for, because the two failures have the
 * same fix and naming only one sends the reader hunting for the wrong thing.
 *
 * @param html the page's HTML
 * @param url the page's URL, for the error message only
 * @returns the token and repository id, or which of the two the page did not render
 */
export function scrapeUploadContext({
  html,
  url,
}: {
  html: string;
  url: string;
}): Result<UploadContext, GithubAttachError> {
  const region = assetsUploadRegion({ html });
  if (region === undefined) {
    return err(
      GithubAttachErrors.scrapeFailed({
        missing: ["the upload-policy CSRF input", "the file-attachment repository id"],
        url,
      }),
    );
  }
  const authenticityToken = region.authenticityToken === "" ? undefined : region.authenticityToken;
  const repositoryId =
    region.repositoryId !== undefined && /^\d+$/.test(region.repositoryId) ? region.repositoryId : undefined;
  const missing = [
    ...(authenticityToken === undefined ? ["the upload-policy CSRF input"] : []),
    ...(repositoryId === undefined ? ["the file-attachment repository id"] : []),
  ];
  if (authenticityToken === undefined || repositoryId === undefined) {
    return err(GithubAttachErrors.scrapeFailed({ missing, url }));
  }
  return ok({ authenticityToken, repositoryId });
}

/**
 * Whether a fetched page came back as a signed-in view.
 *
 * GitHub renders `<meta name="user-login">` only for an authenticated visitor, which is what separates "this
 * page has no comment box" from "your cookies lapsed" — the two look identical otherwise, because a
 * signed-out visitor gets a perfectly valid 200.
 *
 * @param html the page's HTML
 * @returns true when GitHub rendered the page for a signed-in account
 */
export function isSignedInPage({ html }: { html: string }): boolean {
  return /<meta\s+name="user-login"\s+content="[^"]+"/.test(html);
}

/**
 * Whether a page is GitHub's single-sign-on interstitial rather than the object asked for.
 *
 * The distinction this draws is the one that costs an hour when it is missing. An org-SSO wall is a
 * perfectly valid `200`, served to an account that IS signed in, carrying none of the repository's content
 * — so every content-based check reads it as "this page has no comment box" when the truth is "this
 * session was never authorised for this organisation". Measured: a SAML-protected repository
 * answered 45,979 bytes with a signed-in `user-login` meta tag and no repository id at all, against
 * 416,225 bytes for a repository outside SSO.
 *
 * Keyed on the sign-on markers AND the absence of the repository-id meta tag together, because the words
 * "single sign-on" appear in ordinary GitHub chrome; a real wall is the pairing.
 *
 * @param html the page's HTML
 * @returns true when GitHub served an SSO interstitial instead of the page
 */
export function isOrgSsoWall({ html }: { html: string }): boolean {
  const hasRepositoryId = /octolytics-dimension-repository_id" content="\d+"/.test(html);
  const mentionsSso = /single sign-on|\/sso\/sign_in|saml\/initiate/i.test(html);
  return mentionsSso && !hasRepositoryId;
}

/** Read a string field off an already-parsed record, `undefined` when absent or the wrong type. */
function stringField({ record, key }: { record: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** How much of an unrecognised refusal body is worth showing before it stops being a message. */
const REFUSAL_DETAIL_MAX = 300;

/** Strip the HTML GitHub wraps its user-facing error half in, and flatten the whitespace around it. */
function collapseMarkup({ text }: { text: string }): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render GitHub's own refusal text out of a policy error body.
 *
 * The two refusals this endpoint actually emits use DIFFERENT shapes — an over-size image answers
 * `{errors:[{resource,code,field,message}]}` and an over-size video answers `{errors:[{field,message}]}` —
 * so this keys on `message`, the only field both carry, and strips the HTML span GitHub wraps its
 * user-facing half in. A body that is neither shape is passed through as raw text rather than swallowed:
 * an unrecognised refusal the caller can still read beats a tidy "unknown error".
 *
 * @param body the response body
 * @returns a single-line human-readable refusal
 */
export function policyRefusalDetail({ body }: { body: string }): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const errors: unknown = isRecord(parsed) ? parsed["errors"] : undefined;
    if (Array.isArray(errors)) {
      const messages: readonly string[] = errors
        .map((entry: unknown) => (isRecord(entry) ? stringField({ key: "message", record: entry }) : undefined))
        .filter((message: string | undefined) => message !== undefined)
        .map((message: string) => collapseMarkup({ text: message }));
      if (messages.length > 0) {
        return messages.join("; ");
      }
    }
  } catch {
    return collapseMarkup({ text: body }).slice(0, REFUSAL_DETAIL_MAX);
  }
  return collapseMarkup({ text: body }).slice(0, REFUSAL_DETAIL_MAX);
}

/**
 * Each required string field of the policy response, paired with the name the JSON gives it, in the order a
 * refusal lists them. The pairing is total: `fields` below is keyed by exactly these names, so every missing
 * field has a JSON name to be reported under.
 */
const POLICY_JSON_NAMES = [
  ["assetHref", "asset.href"],
  ["assetName", "asset.name"],
  ["assetUploadAuthenticityToken", "asset_upload_authenticity_token"],
  ["assetUploadUrl", "asset_upload_url"],
  ["uploadUrl", "upload_url"],
] as const;

/** Every required policy field the response did not carry, named the way the JSON names it. */
function missingPolicyFields({
  fields,
  assetId,
}: {
  fields: Readonly<Record<(typeof POLICY_JSON_NAMES)[number][0], string | undefined>>;
  assetId: number;
}): readonly string[] {
  return [
    ...POLICY_JSON_NAMES.filter(([key]) => fields[key] === undefined).map(([, name]) => name),
    ...(Number.isInteger(assetId) ? [] : ["asset.id"]),
  ];
}

/** The string-valued entries of a parsed record, in their original order — the presigned form's fields. */
function stringValuesOf({ record }: { record: Readonly<Record<string, unknown>> }): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Parse a `201` policy response into the exact five values the remaining two calls need.
 *
 * Every field is required, and a missing one is an error rather than a default, because each absence is
 * unrecoverable further down: no `upload_url` means nowhere to send bytes, and no
 * `asset_upload_authenticity_token` means an asset that can never be finalized — a silently-defaulted
 * empty string would surface as a puzzling 422 two calls later instead of here.
 *
 * @param body the policy response body
 * @returns the presigned form, the asset's permanent href, and the finalize address plus its token
 */
export function parseUploadPolicy({ body }: { body: string }): Result<UploadPolicy, GithubAttachError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause: unknown) {
    return err(GithubAttachErrors.policyRefused({ detail: `unparseable 201 body: ${String(cause)}`, status: 201 }));
  }
  const root: Readonly<Record<string, unknown>> = isRecord(parsed) ? parsed : {};
  const assetValue: unknown = root["asset"];
  const asset: Readonly<Record<string, unknown>> = isRecord(assetValue) ? assetValue : {};
  const formValue: unknown = root["form"];
  const formRecord: Readonly<Record<string, unknown>> = isRecord(formValue) ? formValue : {};
  const fields = {
    assetHref: stringField({ key: "href", record: asset }),
    assetName: stringField({ key: "name", record: asset }),
    assetUploadAuthenticityToken: stringField({ key: "asset_upload_authenticity_token", record: root }),
    assetUploadUrl: stringField({ key: "asset_upload_url", record: root }),
    uploadUrl: stringField({ key: "upload_url", record: root }),
  };
  const assetIdValue = asset["id"];
  const assetId = typeof assetIdValue === "number" ? assetIdValue : Number.NaN;
  const missing = missingPolicyFields({ assetId, fields });
  const { uploadUrl, assetUploadUrl, assetUploadAuthenticityToken, assetHref, assetName } = fields;
  if (
    missing.length > 0 ||
    uploadUrl === undefined ||
    assetUploadUrl === undefined ||
    assetUploadAuthenticityToken === undefined ||
    assetHref === undefined ||
    assetName === undefined
  ) {
    return err(
      GithubAttachErrors.policyRefused({
        detail: `GitHub answered 201 but the policy omitted ${missing.join(", ")}`,
        status: 201,
      }),
    );
  }
  return ok({
    assetHref,
    assetId,
    assetName,
    assetUploadAuthenticityToken,
    assetUploadUrl,
    form: stringValuesOf({ record: formRecord }),
    uploadUrl,
  });
}

/**
 * The step-1 form fields, in the order GitHub's own comment box sends them.
 *
 * `name` is the file's RAW name, spaces, parentheses and all — because that is what the browser sends, and
 * GitHub does the sanitising itself. Measured from a real capture: the browser sent
 * `fastify-express-side-by-side (1).mp4` and GitHub answered with
 * `name: "fastify-express-side-by-side.1.mp4"` plus the raw string echoed back as `original_name`.
 *
 * This module used to compute that sanitised name client-side, replacing every character outside
 * `[A-Za-z0-9._-]` with a dot. That rule is subtly wrong — it turns `side-by-side (1).mp4` into
 * `side-by-side..1..mp4`, because GitHub also collapses runs of substituted characters — and it was wrong
 * in the direction nobody would notice, since the `href` works either way. Sending the raw name deletes the
 * rule instead of fixing it: {@link parseUploadPolicy} reads GitHub's own answer back, so there is exactly
 * one authority on what an asset is called and it is not this file.
 *
 * @param classified the file's raw name, size and content type
 * @param context the scraped CSRF token and repository id
 * @returns ordered `[name, value]` pairs for the policy request's multipart body
 */
export function policyFormFields({
  classified,
  context,
}: {
  classified: ClassifiedAttachment;
  context: UploadContext;
}): readonly (readonly [string, string])[] {
  return [
    ["name", classified.fileName],
    ["size", String(classified.byteLength)],
    ["content_type", classified.contentType],
    ["authenticity_token", context.authenticityToken],
    ["repository_id", context.repositoryId],
  ];
}

/**
 * The step-2 form field names, in order, with `file` LAST.
 *
 * The ordering is not cosmetic: an S3 presigned POST evaluates its policy against the fields it has read
 * so far, and a `file` part arriving before the signature fields is rejected. Exposed as its own function
 * so a test can assert the ordering without performing an upload.
 *
 * @param form the presigned policy fields from the policy response
 * @returns the field names in send order, ending with `file`
 */
export function bucketFieldOrder({ form }: { form: Readonly<Record<string, string>> }): readonly string[] {
  return [...Object.keys(form), "file"];
}

/**
 * Render the markdown that embeds an uploaded asset.
 *
 * A video and an image need DIFFERENT markdown, and getting it wrong is silent: GitHub strips a raw
 * `<video>` tag out of a pull-request body, so a video embedded that way renders as nothing at all. What
 * GitHub's own comment box emits for a video is a bare URL on its own line, which its renderer turns into
 * an inline player; an image gets ordinary `![alt](href)`.
 *
 * @param contentType the asset's content type, which decides which form is used
 * @param href the permanent `user-attachments` URL
 * @param alt the alt text for the image form (ignored for a video)
 * @returns the markdown to paste into a pull-request body or comment
 */
export function embedMarkdown({ contentType, href, alt }: { contentType: string; href: string; alt: string }): string {
  return contentType.startsWith("video/") ? href : `![${alt}](${href})`;
}
