/**
 * The three things the method inventory reads out of `chronicle_v1.yaml`, googleapis' service config for
 * the Chronicle API.
 *
 * - **`apis:`** — which services the API publishes. A proto in the same directory declaring a service NOT
 *   listed here is not part of the published v1 surface, so its rpcs are pinned and counted but never
 *   become rows (the generator's header says why that is the choice).
 * - **`http.rules`** — REST bindings for methods declared outside these protos. On this config that is
 *   the `google.longrunning.Operations` mixin's four methods, bound under the instance.
 * - **`authentication.rules`** — the scopes each method accepts, read by `authRules.ts`.
 *
 * Only those keys are decoded; the rest of the document (publishing, documentation, library settings) is
 * nothing a row carries. Whether the text decodes at all is `serviceConfigText.ts`'s question.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type AuthRule, splitCanonicalScopes } from "./authRules.js";
import { type GoogleSecopsInventoryError, GoogleSecopsInventoryErrors } from "./errors.js";
import type { ProtoRpc } from "./protoParse.js";
import { decodePinnedServiceConfigText } from "./serviceConfigText.js";
import type { GoogleSecopsHttpMethod } from "./surfaceRow.js";

/**
 * The pinned file name the config is read from, carried onto every row it binds. Its one other reader is
 * `tools/generateGoogleSecopsSurfaces.ts`, outside the tree knip resolves.
 *
 * @internal
 */
export const CHRONICLE_SERVICE_CONFIG_DOCUMENT = "chronicle_v1.yaml";

// The rule objects are STRICT: a key this reader does not name (`additionalBindings`, a typo) is refused
// rather than stripped, because a stripped binding is a verb Google's reader sees and this one does not.
const httpRuleSchema = z
  .object({
    additional_bindings: z.unknown().optional(),
    body: z.string().optional(),
    custom: z.unknown().optional(),
    delete: z.string().optional(),
    get: z.string().optional(),
    patch: z.string().optional(),
    post: z.string().optional(),
    put: z.string().optional(),
    selector: z.string().min(1),
  })
  .strict();

const serviceConfigSchema = z.object({
  // Strict: an entry's `mixins:` or `methods:` would publish or rebind methods this reader never places.
  apis: z.array(z.object({ name: z.string().min(1) }).strict()).min(1),
  // Strict, as every object holding a list a row is read from: a sibling key beside `rules` is refused.
  authentication: z
    .object({
      rules: z.array(
        z
          .object({ oauth: z.object({ canonical_scopes: z.string().min(1) }).strict(), selector: z.string().min(1) })
          .strict(),
      ),
    })
    .strict(),
  http: z.object({ rules: z.array(httpRuleSchema) }).strict(),
  name: z.string().min(1),
});

/** What the inventory reads out of the service config. */
export interface ChronicleServiceConfig {
  /** The service's own DNS name, `chronicle.googleapis.com`. */
  readonly name: string;
  /** Every published service, fully qualified, in file order. */
  readonly apis: readonly string[];
  /** Every `http.rules` binding, one placeable verb each. */
  readonly httpRules: readonly ProtoRpc[];
  /** Every `authentication.rules` entry, in file order — order decides, see `authRules.ts`. */
  readonly authRules: readonly AuthRule[];
}

/** The `http.rules` keys that name a REST verb, in the order a rule is read. */
const VERBS: readonly (readonly ["delete" | "get" | "patch" | "post" | "put", GoogleSecopsHttpMethod])[] = [
  ["delete", "DELETE"],
  ["get", "GET"],
  ["patch", "PATCH"],
  ["post", "POST"],
  ["put", "PUT"],
];

/** A selector naming exactly one method: three or more dotted identifiers, no list, no wildcard, no space. */
const SINGLE_METHOD = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*){2,}$/u;

/**
 * One pattern of an `authentication.rules` selector, as `authRules.ts` reads it: `*` alone, or dotted
 * identifiers with an optional trailing `.*`. A `*` anywhere else (`v1.*.GetRule`) is a pattern that
 * matcher would test literally and never match, so the rule it sits in would quietly grant nothing.
 */
const AUTH_PATTERN = /^(?:\*|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\.\*)?)$/u;

/**
 * Turn one `http.rules` entry into the rpc it binds, refusing anything but exactly one verb.
 *
 * @param rule the decoded rule
 * @returns the bound method, or why it is not one placeable verb
 */
function httpRuleRpc({ rule }: { rule: z.infer<typeof httpRuleSchema> }): Result<ProtoRpc, GoogleSecopsInventoryError> {
  const method = rule.selector;
  const ambiguous = ({ detail }: { detail: string }): Result<never, GoogleSecopsInventoryError> =>
    err(
      GoogleSecopsInventoryErrors.httpBindingAmbiguous({ detail, document: CHRONICLE_SERVICE_CONFIG_DOCUMENT, method }),
    );
  if (rule.custom !== undefined || rule.additional_bindings !== undefined) {
    return ambiguous({ detail: "declares custom or additional_bindings" });
  }
  const bound = VERBS.flatMap(([key, httpMethod]) => {
    const path = rule[key];
    return path === undefined ? [] : [{ httpMethod, pathTemplate: path }];
  });
  const only = bound[0];
  if (only === undefined || bound.length !== 1) {
    return ambiguous({ detail: `the rule names ${String(bound.length)} verbs` });
  }
  // Google's selector grammar also allows a comma list and a trailing `*`, and either would bind a verb to
  // methods this reader never names, slipping past the rebind refusal in `inventory.ts`. Only ONE method is read.
  if (!SINGLE_METHOD.test(method)) {
    return err(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: `http rule selector ${method} is not one fully qualified <package>.<Service>.<Rpc>`,
      }),
    );
  }
  const lastDot = method.lastIndexOf(".");
  return ok({
    document: CHRONICLE_SERVICE_CONFIG_DOCUMENT,
    id: method,
    rpc: method.slice(lastDot + 1),
    service: method.slice(0, lastDot),
    ...only,
  });
}

/**
 * Read every http rule as the one method it binds, refusing a method bound twice.
 *
 * @param rules the decoded `http.rules`
 * @returns the bound methods in config order, or the first rule that is not one placeable binding
 */
function readHttpRules({
  rules,
}: {
  rules: readonly z.infer<typeof httpRuleSchema>[];
}): Result<ProtoRpc[], GoogleSecopsInventoryError> {
  const httpRules: ProtoRpc[] = [];
  for (const rule of rules) {
    const rpc = httpRuleRpc({ rule });
    if (rpc.isErr()) {
      return err(rpc.error);
    }
    // Google applies the LAST rule for a selector, so a second one silently changes the verb of the first.
    if (httpRules.some((bound) => bound.id === rpc.value.id)) {
      return err(
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: `http.rules binds ${rpc.value.id} twice` }),
      );
    }
    httpRules.push(rpc.value);
  }
  return ok(httpRules);
}

/**
 * Why one authentication rule cannot be read as written, if it cannot.
 *
 * @param selector the rule's selector, possibly a comma list
 * @param canonicalScopes the rule's comma-separated scopes
 * @returns the refusal, or null when the rule reads as written
 */
function authRuleRefusal({
  selector,
  canonicalScopes,
}: {
  selector: string;
  canonicalScopes: string;
}): GoogleSecopsInventoryError | null {
  const pattern = selector.split(",").find((part) => !AUTH_PATTERN.test(part.trim()));
  if (pattern !== undefined) {
    return GoogleSecopsInventoryErrors.serviceConfigUnparseable({
      detail: `authentication rule selector ${selector} holds the pattern '${pattern.trim()}', which is not *, a name, or a name ending .*`,
    });
  }
  // Scopes are comma-separated; two written one per line without the comma would read as ONE scope.
  const joined = splitCanonicalScopes({ canonicalScopes }).find((scope) => /\s/u.test(scope));
  if (joined !== undefined) {
    return GoogleSecopsInventoryErrors.serviceConfigUnparseable({
      detail: `authentication rule ${selector} grants ${JSON.stringify(joined)}, which holds whitespace — a missing comma between two scopes`,
    });
  }
  return null;
}

/**
 * Read the service config's published services, extra HTTP bindings and authentication rules.
 *
 * @param text the whole `chronicle_v1.yaml`
 * @returns the three decoded lists, or the first reason the document is not the shape this reads
 */
export function parseChronicleServiceConfig({
  text,
}: {
  text: string;
}): Result<ChronicleServiceConfig, GoogleSecopsInventoryError> {
  const decoded = decodePinnedServiceConfigText({ text });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const parsed = serviceConfigSchema.safeParse(decoded.value);
  if (!parsed.success) {
    return err(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      }),
    );
  }
  const httpRules = readHttpRules({ rules: parsed.data.http.rules });
  if (httpRules.isErr()) {
    return err(httpRules.error);
  }
  for (const rule of parsed.data.authentication.rules) {
    const refusal = authRuleRefusal({ canonicalScopes: rule.oauth.canonical_scopes, selector: rule.selector });
    if (refusal !== null) {
      return err(refusal);
    }
  }
  return ok({
    apis: parsed.data.apis.map((api) => api.name),
    authRules: parsed.data.authentication.rules.map((rule) => ({
      scopes: splitCanonicalScopes({ canonicalScopes: rule.oauth.canonical_scopes }),
      selector: rule.selector,
    })),
    httpRules: httpRules.value,
    name: parsed.data.name,
  });
}
