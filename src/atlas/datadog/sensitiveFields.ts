/**
 * The response fields this atlas refuses to store, named one at a time — and SCOPED to the kind that makes
 * each one secret.
 *
 * ## Why a scoped table rather than a bare name list, which is what every sibling atlas uses
 *
 * MEASURED against the installed SDK's own models (reproduce with
 * `yarn tsx tools/datadogOperationScan.ts --secrets`, which resolves each operation's declared response
 * type through its models four levels deep): the field name `key` appears on **49** distinct models
 * and carries credential material on **nine** of them — `ApiKey`, `FullAPIKeyAttributes`,
 * `FullApplicationKeyAttributes`, `FullPersonalAccessTokenAttributes`, `FullServiceAccessTokenAttributes`,
 * `SyntheticsTestRequestCertificate` and the three synthetics private-location secret models. The other
 * forty are a case's own human identifier, a feature flag's key, a flag variant's key, a cost-allocation
 * tag key, a dashboard widget's group-by key, a fleet agent tag, a Model Lab metric name and a DNS
 * aggregation group-by. `hash` is the same story: an application key's VALUE on one model, a Cloud Workload Security rule action and a RUM
 * application's public identifier on three others. And `token` is the sharpest case of all — a
 * public-dashboard share token that grants ANONYMOUS access on one kind, and a pagination cursor in
 * `meta.token` on another.
 *
 * So a bare-name denial is wrong in both directions here, and much more sharply than it was for JumpCloud:
 * denying `key` would delete the identity of every case, feature flag and project this account holds, and
 * admitting it would store the API key. The rule is therefore **secret MATERIAL out, POSTURE in, decided
 * per (kind, field)** — a denial names the field AND the kinds in which that field carries material, with
 * `kinds: null` reserved for names that are never posture anywhere.
 *
 * ## Why this exists at all, when there is already a closed endpoint registry
 *
 * Because an endpoint allowlist does not protect this atlas. `GET /api/v1/integration/aws` is exactly the
 * posture read an "which cloud accounts are integrated" question needs, and it carries `accessKeyId` and
 * `secretAccessKey` on every account. `GET /api/v1/api_key` is how the atlas answers "which keys exist,
 * who made them, when were they last used" — and it carries every key's value. Excluding those endpoints
 * would answer "Datadog has no such endpoint", which is false. Endpoint exclusion and field exclusion are
 * different boundaries and this atlas needs both, the same conclusion `jumpcloud/sensitiveFields.ts`
 * reached from its own evidence.
 *
 * ## A field can be denied for its SHAPE rather than for its name
 *
 * Most rows here name something that IS a credential. Six do not, and they are the ones a name-based scan
 * will never find: `customHeaders`, `headers`, `body`, `payload` and a synthetics global variable's `value`
 * are free-form strings and maps that a PERSON fills in, and `{"Authorization":"Basic …"}` is the ordinary
 * thing to put in one. Two adversarial review passes found two of them reaching a kind file — a webhook's
 * `customHeaders` carrying a base64 basic-auth credential, and a synthetic test's `body` carrying an OAuth
 * `client_secret` — past the registry, past this table, and past the gate, which parses no embedded JSON
 * and has no base64 rule.
 *
 * What is NOT denied under this rule, and the cost of that: a monitor's `message`, a Datadog `text` and an
 * incident's `content` are equally free-form and are KEPT, because they are the posture an investigation
 * actually asks for and denying them would empty the atlas of monitors. A credential somebody pasted into a
 * monitor message therefore reaches a kind file, and nothing here catches it. That is the residue, stated
 * rather than discovered.
 *
 * So the rule that generalises, and the one to apply to a new field before waiting for a review to catch
 * it: **a field whose declared type is a free-form string or map a person authors is denied wherever a
 * credential could be typed into it**, whatever its name suggests. Each such denial states its cost — the
 * atlas can no longer say which headers a synthetic test sets — because that cost is real and hiding it
 * would be the same dishonesty this file exists to prevent.
 *
 * ## The `synthetics` kind is EXCLUDED WHOLE, and these rows are what stands when it comes back
 *
 * `exclusions.ts`'s `DATADOG_EXCLUDED_KINDS` refuses every synthetics operation with reason
 * `unsupported-sensitive-shape`, because the evidence below shows a denylist cannot make this kind safe to
 * store and the allowlist projection that could is not built. **So nothing below is load-bearing for
 * synthetics today.** The rows scoped to this kind are kept anyway, as a second layer under that
 * projection, and the rest of this section is the evidence that a denylist alone is not the shape to come
 * back with. Read it as a recorded decision, not as a live defence.
 *
 * The bar is a full atlas, so this exclusion is a gap to close, never a licence to shrink a kind.
 *
 * FOUR separate review rounds found four separate credential-bearing fields in this one kind —
 * `SyntheticsBasicAuthSigv4.secretKey`, then `SyntheticsTestRequest.body`, then `.form`, then
 * `SyntheticsBrowserTestConfig.setCookie`. Each fix enumerated one more model and the next round found a
 * field on a model the last enumeration had not covered. That is not four mistakes; it is one, repeated,
 * and it is a fact about the SUBJECT: a synthetic test IS a request a person configured including its
 * authentication, its cookies, its variables and the responses it captured, so free-form members of it are
 * where credentials live rather than where they occasionally appear.
 *
 * MEASURED: **202** distinct fields across the 379 `Synthetics*` models are declared as a bare
 * string, an `any`, or a `{ [key: string]: … }` map, and 168 of them are not denied by any row below.
 * Reproduce both, and the undenied list itself, with the command below — it prints the free-form count,
 * the number of rows in this table that deny one of them for this kind (64), the undenied count, and then
 * every undenied name:
 *
 * ```
 * node -e 'const{readdirSync,readFileSync}=require("fs"),f=new Set();for(const v of["v1","v2"]){const d=`node_modules/@datadog/datadog-api-client/dist/packages/datadog-api-client-${v}/models`;for(const n of readdirSync(d).filter(n=>n.startsWith("Synthetics")&&n.endsWith(".d.ts")))for(const m of readFileSync(`${d}/${n}`,"utf8").matchAll(/^ {4}"?(\w+)"?\??:\s*([^;]+);/gm))if(/^(string|any|\{\s*\[key: string\])/.test(m[2].trim()))f.add(m[1])}const s=["sensitiveFields","freeFormFieldDenials"].map(n=>readFileSync(`src/atlas/datadog/${n}.ts`,"utf8")).join("\n"),d=new Set();for(const m of s.matchAll(/field: "(\w+)",\n\s+kinds: (null|\[[^\]]*\])/g))if(m[2]==="null"||m[2].includes("synthetics"))d.add(m[1]);const u=[...f].filter(n=>!d.has(n));console.log(f.size,d.size,u.length,u.sort().join(" "))'
 * ```
 *
 * An earlier pass reported 215 from `tools/datadogOperationScan.ts`'s own resolver and carried no
 * reproduction, so nobody could tell the two criteria apart; the command above is the one this file's
 * number now means. The ORDER of magnitude is what the argument rests on either way — the shape of the
 * rule does not turn on a dozen fields, and a bare number nobody can re-run is what
 * `.claude/rules/typescript-patterns.md` bans.
 *
 * The rows in `freeFormFieldDenials.ts` deny the credential-capable subset — `body`, `bodyCompressed`,
 * `cacheHeaders`, `compressedMessage`, `compressedSteps`, `cookies`, `emailMessages`,
 * `extractedValuesFromScript`, `form`, `header`, `headers`, `initialApplicationArguments`, `message`,
 * `metadata`, `params`, `query`, `receivedMessage`, `requestHeaders`, `responseBody`, `responseHeaders`,
 * `sentMessage`, `setCookie`, `toolArgs`, `username`, `value`, `variables`, `variablesFromScript` — and what
 * stays is the posture that makes a test legible: `url`, `method`, `service`, `host`, `timeout`, the
 * certificate DOMAINS it accepts, its locations, its assertions and every boolean option.
 *
 * **A denylist over 202 free-form fields is a list somebody grows past**, and the shape that would close
 * it is an ALLOWLIST for this one kind — the 1Password projection applied where the evidence warrants it.
 * That is the work the exclusion waits on; this paragraph is the specification for what has to be built
 * BEFORE a live pass may store a test, and the two findings below are why.
 *
 * A FIFTH round is already sitting in the undenied 168, found statically rather than by another review, and
 * it is the argument in one model. `SyntheticsTestResultVariable` declares `value` — denied under this kind,
 * for exactly this reason — beside `val` ("Evaluated value of the variable", in Datadog's own docstring) and
 * `example` ("Example value for the variable"), neither denied, on the same model that carries the `secure`
 * boolean saying the variable holds a secret. The precise thing these rows exist to catch is reachable
 * through a three-letter alias on the model the row was written for.
 *
 * And the reason a sixth round would follow it: **276 of the 379 `Synthetics*` models declare an
 * undeclared-property catch-all** (`"additionalProperties"?: { [key: string]: any }`), which is the SDK's
 * holder for whatever the response carried that the schema does not name. So a field Datadog adds next
 * month arrives under a name no enumeration could have carried — through that holder on the SDK-object
 * path, and under its own top-level name on the raw-JSON path. A name-based denial has no floor here, which
 * is why the allowlist is the SHAPE that closes the kind rather than a fifth patch to this table.
 *
 * **Why it is a registry row rather than more prose here.** Before the exclusion this was a stated
 * PRECONDITION in three prose sites — this header, `descriptor.ts`'s `unfilledBecause`
 * and `sync.ts`'s gap detail — enforced by no gate and no test, so a session adding the live pass would
 * have tripped no wire. It is now a `disposition: "excluded"` on all 69 synthetics rows of
 * `generated/surfaces.ts`, 34 of them carrying `unsupported-sensitive-shape` and the other 35 keeping the `mutating`
 * reason they already had. A caller cannot reach an excluded operation, so the boundary is the registry's
 * rather than a reader's memory of a paragraph.
 *
 * `atlas datadog sync` itself EXISTS — `sync.ts` — and is a pure local publish of the compiled registry:
 * it presents no credential, reaches no organisation, and `catalogue.ts` is its only caller of
 * `projectDatadogValue`, over rows committed to this repository. So no provider response has ever reached
 * a kind file through this atlas, for synthetics or anything else.
 *
 * The named residue, had the kind been admitted, is `url`, which can carry userinfo: it would have been
 * kept, because a test's target is the single most useful thing an atlas holds about it.
 *
 * ## The scan itself was incomplete once, and that is the more important failure
 *
 * An adversarial review pass found `SyntheticsBasicAuthSigv4.secretKey` — an AWS SigV4 secret on an
 * admitted synthetics test — reaching a kind file past all three layers. The row was missing because the
 * scan that BUILT this table could not see it: `SyntheticsTestRequest.basicAuth` is typed
 * `SyntheticsBasicAuth`, a file that declares `A | B | C` and no fields of its own, and the resolver
 * followed only files with fields. Seven auth variants were invisible. The value has no recognisable
 * shape, so `sensitivity.ts` could not catch it either — this table was the only thing that could, and it
 * was built by an instrument with a hole in it.
 *
 * So the fix was the instrument, not the row: `tools/datadogOperationScan.ts` now follows a union alias,
 * and the table was re-derived from the complete pass — which added `accessKey`, `accessToken`,
 * `globalApiKey`, `secretKey`, `sessionToken`, `shareToken`, `tokens` and `validTokens` rather than one.
 * An incomplete instrument is worse than a missing row, because it makes the table look finished.
 *
 * ## What the complete scan found and this table deliberately KEEPS
 *
 * `publicPortion`, on a personal access token and a service access token, is the vendor's own name for the
 * half that is not secret — denying it would remove the only handle a token-rotation question has.
 * `last4`, on both key kinds, and `credentialSuffix` on a secure embed ("Last 4 characters of the
 * credential", in Datadog's own docstring) are four characters Datadog itself renders in its console; they
 * identify a key without reducing anyone's search space, and they are the ONLY thing left once the value is
 * gone. That is a deliberate divergence from JumpCloud's denial of `apiKeyPrefix`, which is an identifying
 * prefix of unbounded length rather than a vendor-published display suffix.
 *
 * The observability pipeline's `passwordKey`, `clientSecretKey`, `tokenKey` and `usernameKey` are kept for a
 * different reason, and it is the sharpest KEEP here: they are not values at all. Datadog's own docstring
 * says "Name of the environment variable or secret that contains the ClickHouse password" — so the field
 * holds a REFERENCE, and storing it answers "which secret does this pipeline read", which is exactly the
 * posture question an audit asks. `storeHecToken` is kept because it is a BOOLEAN.
 *
 * ## Where the evidence stops
 *
 * The scan is bounded: a fixed secret-shaped name set, resolved four levels deep. It is how this table was
 * BUILT, never a proof that it is complete — a field Datadog adds next month, or one nested deeper than
 * four levels, is not in it. `sensitivity.ts` is the layer that assumes exactly that and looks at the bytes.
 *
 * ## Where the rows live
 *
 * The table is composed here, and its contiguous run of shape denials sits in `freeFormFieldDenials.ts`,
 * spread back in at the position it has always held. "Below" in this header means the composed table.
 */
import { DATADOG_FREE_FORM_FIELD_DENIALS } from "./freeFormFieldDenials.js";

/**
 * Why one field is refused, kept apart from the fact that it was.
 *
 * Withholding an AWS secret access key is a disclosure decision; dropping a pagination cursor is
 * housekeeping. Conflating them would make the secret list look longer than it is and hide what it
 * actually protects, so the boundary reports which of the two applied rather than a bare boolean.
 * @internal
 */
export type DatadogDenialReason = "secret-material" | "ephemeral-token";

/**
 * One refused field: its name, why, and the kinds the refusal applies in.
 * @internal
 */
export interface DatadogFieldDenial {
  /** The provider's own property name, compared exactly rather than case-folded. */
  readonly field: string;
  readonly reason: DatadogDenialReason;
  /** The kinds in which this field carries the material. `null` means every kind. */
  readonly kinds: readonly string[] | null;
  /** The individual decision, checkable against the scan output. Stated in coverage. */
  readonly detail: string;
}

/**
 * The refused set.
 *
 * Ordered by reason then field so a reviewer reads the disclosure decisions first. Every `kinds: null` row
 * was checked against the scan for a posture reading somewhere in the SDK and had none.
 */
export const DATADOG_FIELD_DENIALS: readonly DatadogFieldDenial[] = [
  {
    detail: "the AWS access key id half of an integration credential; a split credential is still the credential",
    field: "accessKeyId",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "an integration's outbound API key — Confluent Cloud, Okta, Fastly, Opsgenie, Statuspage and eleven others all spell it this way",
    field: "apiKey",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the AWS SigV4 access key a synthetics test signs with — SyntheticsBasicAuthSigv4. Found by an adversarial review pass behind a blind spot in the scan itself, which could not follow a union type alias",
    field: "accessKey",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "an OAuth or vendor access token presented to a third party — Asana, and a Splunk forward destination",
    field: "accessToken",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "an organisation-wide API key on a Cloudflare-style integration",
    field: "globalApiKey",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the AWS SigV4 SECRET key a synthetics test signs with. The value has no recognisable shape, so the pre-publish gate cannot catch it and this row is the only thing that does — which is why the scan behind this table had to be fixed rather than the row simply added",
    field: "secretKey",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a temporary AWS session token, which is credential material for as long as it lives",
    field: "sessionToken",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a dashboard share-invite token, which grants access to whoever holds it",
    field: "shareToken",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "the token list an HTTP auth config presents to a third party — HTTPTokenAuth",
    field: "tokens",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "an observability pipeline source's ACCEPTED tokens, in Datadog's own words 'a list of tokens that are accepted for authenticating incoming HTTP requests' — inbound credentials, and material despite the innocuous name",
    field: "validTokens",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "an integration's outbound API password",
    field: "apiPassword",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "an integration's outbound API secret",
    field: "apiSecret",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "an integration's outbound API token",
    field: "apiToken",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a bearer or basic-auth token presented to a third party",
    field: "authToken",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "an OAuth client secret — Azure tenants, Okta accounts, webhook OAuth2 clients and synthetics OAuth test configurations",
    field: "clientSecret",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "a RUM client token; it authorises browser-side ingestion into this org and is a credential despite shipping to browsers",
    field: "clientToken",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the container object holding an integration's credential material, dropped whole rather than field by field — forty-eight integration models spell it this way and each nests different material",
    field: "credentials",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a single credential object, the singular form of the same container",
    field: "credential",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a path to a credential file, which is a locator for material rather than posture",
    field: "credentialsFile",
    kinds: null,
    reason: "secret-material",
  },
  ...DATADOG_FREE_FORM_FIELD_DENIALS,
  {
    detail:
      "the application key VALUE on the v1 key model. Denied only here: the same name is a Cloud Workload Security rule action and a RUM application's public identifier elsewhere",
    field: "hash",
    kinds: ["application_key"],
    reason: "secret-material",
  },
  {
    detail: "a path to a key file",
    field: "keyFile",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the API key, application key, access token or synthetics client-certificate PRIVATE key value. Denied in these kinds only — `key` is a case identifier, a feature-flag key, a tag key and a metric name in forty other models",
    field: "key",
    kinds: [
      "api_key",
      "api_keys",
      "application_key",
      "application_keys",
      "current_user",
      "personal_access_tokens",
      "service_accounts",
      "synthetics",
    ],
    reason: "secret-material",
  },
  {
    detail: "an authentication password or passphrase",
    field: "password",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a passphrase protecting key material",
    field: "passphrase",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a GCP or generic service-account private key",
    field: "privateKey",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "the AWS secret access key half of an integration credential",
    field: "secretAccessKey",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a named secret value, and the private-location secrets container synthetics returns whole",
    field: "secret",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "the private-location secrets container — authentication and config-decryption key material together",
    field: "secrets",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a shared secret presented to a third party",
    field: "sharedSecret",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the public-dashboard share token and the secure-embed token. Both grant ANONYMOUS read of the dashboard, so each is a credential. Denied only in this kind — `token` is a pagination cursor in `meta` under `security`",
    field: "token",
    kinds: ["dashboard"],
    reason: "secret-material",
  },
  {
    detail:
      "the token a deleted public dashboard used to carry. Denied for the same reason as `token` under this kind: a share token is a credential, and whether Datadog still honours it is not this atlas's judgement to make",
    field: "deletedPublicDashboardToken",
    kinds: ["dashboard"],
    reason: "secret-material",
  },
  {
    detail: "the secret a workflow presents on its inbound webhook trigger",
    field: "webhookSecret",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail: "a request-scoped continuation handle, stale the moment it is written",
    field: "continuationToken",
    kinds: null,
    reason: "ephemeral-token",
  },
  {
    detail: "a request-scoped continuation handle",
    field: "nextContinuationToken",
    kinds: null,
    reason: "ephemeral-token",
  },
  {
    detail: "a request-scoped paging handle",
    field: "nextPageToken",
    kinds: null,
    reason: "ephemeral-token",
  },
  {
    detail: "a request-scoped paging handle",
    field: "nextRecordId",
    kinds: null,
    reason: "ephemeral-token",
  },
  {
    detail: "a request-scoped paging handle",
    field: "nextToken",
    kinds: null,
    reason: "ephemeral-token",
  },
  {
    detail: "a request-scoped paging handle",
    field: "pageToken",
    kinds: null,
    reason: "ephemeral-token",
  },
  {
    detail:
      "the `meta.token` pagination cursor the security families page with — the same name that is a share credential under `dashboard`, which is why both rows are scoped",
    field: "token",
    kinds: ["security", "security-entities", "siem-historical-detections"],
    reason: "ephemeral-token",
  },
];
