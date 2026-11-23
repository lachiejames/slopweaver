/**
 * Whether the pinned protos and the service config describe ONE surface: every method and service declared
 * once, every config binding standing for a method no pinned proto declares, every published service served,
 * and every authentication rule matching something. `inventory.ts` builds rows only after this passes, so a
 * disagreement is a typed refusal naming it rather than a row minted from one side alone.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type AuthRule, authRuleMatches } from "./authRules.js";
import { type GoogleSecopsInventoryError, GoogleSecopsInventoryErrors } from "./errors.js";
import type { ProtoRpc } from "./protoParse.js";

/**
 * The mixin services `http.rules` may bind: declared in a trusted dependency, never in the pinned directory.
 * A future pin adding another mixin is refused until it is named here, rather than read as a stand-in proto.
 */
const CONFIG_BOUND_SERVICES: ReadonlySet<string> = new Set(["google.longrunning.Operations"]);

/**
 * A disagreement between the config and the protos.
 *
 * @param detail what disagrees
 * @returns the SERVICE_CONFIG_INCONSISTENT refusal
 */
function inconsistent({ detail }: { detail: string }): Result<never, GoogleSecopsInventoryError> {
  return err(GoogleSecopsInventoryErrors.serviceConfigInconsistent({ detail }));
}

/**
 * Check that every method, and every service, is declared in exactly one pinned file.
 *
 * @param declared every method the protos declare, published or not
 * @returns the ids declared, or the first method or service declared twice
 */
function checkDeclaredOnce({
  declared,
}: {
  declared: readonly ProtoRpc[];
}): Result<ReadonlySet<string>, GoogleSecopsInventoryError> {
  // protoc refuses a method declared twice, so no real pin carries one; refused by name anyway, because two
  // rows for one id would otherwise surface only as a census count or a sort failure naming neither file.
  const firstDeclared = new Map<string, string>();
  // The same for a service: protoc refuses one declared in two files, and reading both would merge a
  // second file's methods into the first's service, or swap one rpc per file without moving any count.
  const serviceDocument = new Map<string, string>();
  for (const rpc of declared) {
    const earlier = firstDeclared.get(rpc.id);
    if (earlier !== undefined) {
      return err(
        GoogleSecopsInventoryErrors.protoUnparseable({
          detail: `declares ${rpc.id}, already declared in ${earlier}`,
          document: rpc.document,
        }),
      );
    }
    firstDeclared.set(rpc.id, rpc.document);
    const serviceIn = serviceDocument.get(rpc.service);
    if (serviceIn !== undefined && serviceIn !== rpc.document) {
      return err(
        GoogleSecopsInventoryErrors.protoUnparseable({
          detail: `declares service ${rpc.service}, already declared in ${serviceIn}`,
          document: rpc.document,
        }),
      );
    }
    serviceDocument.set(rpc.service, rpc.document);
  }
  return ok(new Set(firstDeclared.keys()));
}

/**
 * Check that the config and the protos describe one surface.
 *
 * @param apis the published services
 * @param declared every method the protos declare, published or not
 * @param httpRules every method the config binds itself
 * @param authRules every authentication rule
 * @returns ok, or the first disagreement
 */
export function checkGoogleSecopsConsistency({
  apis,
  declared,
  httpRules,
  authRules,
}: {
  apis: readonly string[];
  declared: readonly ProtoRpc[];
  httpRules: readonly ProtoRpc[];
  authRules: readonly AuthRule[];
}): Result<void, GoogleSecopsInventoryError> {
  const declaredOnce = checkDeclaredOnce({ declared });
  if (declaredOnce.isErr()) {
    return err(declaredOnce.error);
  }
  const declaredIds = declaredOnce.value;
  const collision = httpRules.find((rule) => declaredIds.has(rule.id));
  if (collision !== undefined) {
    return inconsistent({ detail: `http.rules rebinds ${collision.id}, which a proto already binds` });
  }
  // A config binding is read only for a method declared OUTSIDE the pinned protos (the Operations mixin).
  // Under a service a pinned proto declares, a rule naming a method that proto lacks would mint a row for
  // a method that does not exist — Google's own config validation refuses a selector matching no method.
  // A config binding is only ever read for a published service; one for a service `apis:` does not list (a
  // typo'd `google.longrunning.Operation`) would otherwise be counted as unpublished and drop its row silently.
  const unlisted = httpRules.find((rule) => !apis.includes(rule.service));
  if (unlisted !== undefined) {
    return inconsistent({ detail: `http.rules binds ${unlisted.id}, whose service apis does not list` });
  }
  const declaringDocument = new Map(declared.map((rpc) => [rpc.service, rpc.document]));
  const phantom = httpRules.find((rule) => declaringDocument.has(rule.service));
  if (phantom !== undefined) {
    const document = declaringDocument.get(phantom.service)!;
    return inconsistent({
      detail: `http.rules binds ${phantom.id}, but ${document} declares ${phantom.service} without that method`,
    });
  }
  // A config binding for any other service would stand in for its proto: with that proto missing from the
  // pin, one rule would satisfy the orphan check below and mint one row where Google publishes every method.
  const unbound = httpRules.find((rule) => !CONFIG_BOUND_SERVICES.has(rule.service));
  if (unbound !== undefined) {
    return inconsistent({
      detail: `http.rules binds ${unbound.id}, but only ${[...CONFIG_BOUND_SERVICES].join(", ")} is bound by config — a pinned proto must declare ${unbound.service}`,
    });
  }
  const everyMethod = [...declared, ...httpRules];
  const served = new Set(everyMethod.map((rpc) => rpc.service));
  const orphan = apis.find((api) => !served.has(api));
  if (orphan !== undefined) {
    return inconsistent({ detail: `apis lists ${orphan}, which no pinned proto or http rule declares` });
  }
  const deadRule = authRules.find((rule) =>
    everyMethod.every((rpc) => !authRuleMatches({ method: rpc.id, selector: rule.selector })),
  );
  if (deadRule !== undefined) {
    return inconsistent({ detail: `authentication rule ${deadRule.selector} matches no method` });
  }
  return ok(undefined);
}
