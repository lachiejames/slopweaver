/**
 * The contiguous run of `sensitiveFields.ts`'s denial table that refuses a field for its SHAPE: a free-form
 * string or map a person authors, or content a synthetic test captured, where a credential is the ordinary
 * thing to find. Why that rule exists, and what it costs, is that file's header; this module only holds the
 * rows.
 *
 * Two rows here are not shape denials: `username` and `externalId` are kind-scoped credential rows. They sit
 * in this run because they are interleaved with it, and `datadogFieldDenial` reads the composed table in
 * order with `.find`, so the run moves whole and in order rather than being re-sorted into concepts.
 *
 * The `description` row's own detail says "this file's header"; that means `sensitiveFields.ts`'s header,
 * where the synthetics rounds are recorded. The text is runtime data, so it stays as written.
 */
import type { DatadogFieldDenial } from "./sensitiveFields.js";

/**
 * The shape-denied rows, spread into `DATADOG_FIELD_DENIALS` at the position they have always held.
 */
export const DATADOG_FREE_FORM_FIELD_DENIALS: readonly DatadogFieldDenial[] = [
  {
    detail:
      'the arbitrary header blob a webhook attaches to every call it makes. Datadog\'s own type is a free-form string, and `{"Authorization":"Basic …"}` is the canonical thing to put in it — so this is denied for the SHAPE of the field rather than for its name',
    field: "customHeaders",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the request body a synthetic test sends. A free-form string a person authors, and an OAuth token-exchange body is the ordinary thing to put in one — a review pass found `client_secret` reaching a kind file through it. Denied in this kind only: `body` is declared as a plain string on exactly four models and all four are synthetics. The stated cost is that the atlas can no longer say what payload a test posts",
    field: "body",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "a synthetic test's multipart form map. Part of the same request config as `body` and `headers`, and an OAuth `client_secret` form field is the ordinary thing in one",
    field: "form",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "a synthetic test's free-form request metadata map — gRPC and MCP calls carry auth in it",
    field: "metadata",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the arguments a synthetic MCP test passes to a tool, a free-form map a person authors",
    field: "toolArgs",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "the Set-Cookie header a browser test installs before it runs, on SyntheticsBrowserTestConfig. A session cookie IS a bearer credential — found by the review round that proved a per-MODEL enumeration was the wrong shape for this kind",
    field: "setCookie",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "a cookie jar a synthetic test carries or captured",
    field: "cookies",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "request, response and cache header maps a synthetic test sent or observed",
    field: "requestHeaders",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "response headers a synthetic test captured from the service it tested",
    field: "responseHeaders",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "cache headers a synthetic test sends",
    field: "cacheHeaders",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "a single authored header on a synthetic test",
    field: "header",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "a response body a synthetic test captured from the service it tested, which is that service's data",
    field: "responseBody",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the compressed forms of a synthetic test's authored body, message and steps — the same content, encoded",
    field: "bodyCompressed",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the compressed form of a synthetic test's authored message",
    field: "compressedMessage",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the compressed form of a browser test's authored steps",
    field: "compressedSteps",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "synthetics variables and the values a test extracted at runtime. A token exchanged mid-test lands here by design — that is what the feature is FOR",
    field: "variables",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "values a browser test's script extracted at runtime, which is where a captured token lands",
    field: "variablesFromScript",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "values extracted from a test's script, same reasoning",
    field: "extractedValuesFromScript",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "a free-form parameter map on a synthetic step",
    field: "params",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "the sample log lines pasted into a Grok parser so its rules can be authored against something real. A Grok sample is a pasted real log line, a real log line is where a credential appears, so the gate's AWS-access-key-id shape refuses the whole publish on one. It is the same class as `customHeaders` and a synthetic test's `body` — a free-form string a PERSON authored, where the ordinary content is a real production log line and a real log line is exactly where a credential appears. Denied in `logs` only, which is exact rather than cautious: `samples` is declared on ONE model in the whole pinned client, `LogsGrokParser`. The stated cost is that the atlas can no longer show which log lines a pipeline's parser was written against, only that it has some",
    field: "samples",
    kinds: ["logs"],
    reason: "secret-material",
  },
  {
    detail:
      "a secret-detection rule's own description. THE SECRET-DETECTION CATALOGUE CLASS: two Datadog products exist to recognise credentials, and each publishes a rule library that describes what one looks like — Sensitive Data Scanner's ~450 `standard-patterns` and Static Analysis's secret rules. A rule that detects a Slack token describes itself with a Slack token, so these are real matches rather than false ones and the answer is to stop STORING the field, never to teach the gate an exception it would then carry for every kind. FOUND BY THE GATE, once per detection kind: a refusal on `sensitive-data-scanner` and another on `static-analysis` are the same class. The enumeration of KINDS is what grows here, not the reasoning — the same shape as the synthetics rounds recorded in this file's header. The organisation's own scanning groups reach this field too and are denied with it deliberately: a person-authored description of what a group scans for is the same free-form string with the same ordinary content. The stated cost is real — the atlas can say which detection rules exist and no longer what each one looks for",
    field: "description",
    kinds: ["sensitive-data-scanner", "static-analysis"],
    reason: "secret-material",
  },
  {
    detail:
      "the regular expression a secret-detection rule matches WITH, which is the same class as its `description` one field over and is if anything more direct: a rule for a PEM key is a pattern containing `-----BEGIN … PRIVATE KEY-----`, so the gate recognises the detector as the thing detected. Denied in the two detection kinds only — `pattern` elsewhere in Datadog is a log-parser grok expression or a monitor's match string, neither of which is written to describe a credential",
    field: "pattern",
    kinds: ["sensitive-data-scanner", "static-analysis"],
    reason: "secret-material",
  },
  {
    detail: "a message a synthetic test sent or received, and the mailbox contents an email test captured",
    field: "sentMessage",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "a message a synthetic test received from the service it tested",
    field: "receivedMessage",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the emails an email test captured, which are another service's content",
    field: "emailMessages",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the arguments a mobile test launches an application with",
    field: "initialApplicationArguments",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail: "the username half of a synthetic test's configured credential",
    field: "username",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "a synthetic test's request query, declared `any` by the SDK. Denied in this kind only — a `query` on a monitor, an SLO or a log pipeline is the posture the atlas exists to hold",
    field: "query",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "a synthetic test's request message — the gRPC or WebSocket payload it sends, not prose a person reads. Denied in this kind only: a monitor's `message` is the notification text and is KEPT, which is the residue this file states",
    field: "message",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
  {
    detail:
      "request headers a synthetic test, an HTTP auth config or a proxy sends. Same reasoning as customHeaders: a map a person fills in, and an Authorization value is the ordinary content. The cost is stated rather than hidden — the atlas can no longer say which headers a test sets",
    field: "headers",
    kinds: null,
    reason: "secret-material",
  },
  {
    detail:
      "the AWS assume-role external id, which is a shared secret between the two accounts and the whole confused-deputy defence. Denied only in the integration kinds — `externalId` is a plain provider identifier on a finding and on an incident responder",
    field: "externalId",
    kinds: ["integration", "integrations"],
    reason: "secret-material",
  },
  {
    detail:
      "a free-form body a person authored: a webhook's payload template, a JWT payload, a workflow instance's inputs. Denied in these kinds only — `payload` is a rule query on a security detection, an event body and a case bulk-update elsewhere, none of which is a place a credential is typed",
    field: "payload",
    kinds: ["integration", "integrations", "synthetics", "workflows"],
    reason: "secret-material",
  },
  {
    detail:
      "a synthetics global variable's VALUE. The sibling `secure` flag says which ones are secret, and a field-name rule cannot read a sibling — so the whole field goes and the flag, the name and the description stay. The stated cost is that a non-secure variable's value is withheld too",
    field: "value",
    kinds: ["synthetics"],
    reason: "secret-material",
  },
];
