/**
 * The pure readers `tools/generateFigmaSurfaces.ts` runs over one OpenAPI operation: its query parameter
 * names, its OAuth scopes and the credential forms it accepts. Split out so the generator stays under the
 * file-size cap; nothing here reaches the network or the filesystem.
 */
import { FIGMA_AUTH_METHODS, type FigmaAuthMethod } from "../src/atlas/figma/surfaceNaming.js";
import { isRecord } from "../src/lib/parsers.js";

/**
 * The query parameter names one operation declares, its path item's shared ones included.
 *
 * @returns every declared query parameter name, in declaration order
 */
export function queryParamsOf({
  operation,
  pathParameters,
}: {
  operation: Record<string, unknown>;
  pathParameters: readonly unknown[];
}): readonly string[] {
  const own = Array.isArray(operation["parameters"]) ? operation["parameters"] : [];
  return [...pathParameters, ...own].flatMap((parameter): readonly string[] => {
    if (!isRecord(parameter) || parameter["in"] !== "query" || typeof parameter["name"] !== "string") {
      return [];
    }
    return [parameter["name"]];
  });
}

/**
 * Every OAuth scope one operation's `security` names, sorted and deduplicated.
 *
 * @returns the sorted scope names
 */
export function scopesOf({ operation }: { operation: Record<string, unknown> }): readonly string[] {
  const security = operation["security"];
  if (!Array.isArray(security)) {
    return [];
  }
  const found = new Set<string>();
  security.forEach((requirement: unknown) => {
    if (!isRecord(requirement)) {
      return;
    }
    Object.values(requirement).forEach((scopes: unknown) => {
      if (!Array.isArray(scopes)) {
        return;
      }
      scopes.forEach((scope: unknown) => {
        if (typeof scope === "string") {
          found.add(scope);
        }
      });
    });
  });
  return [...found].toSorted();
}

/**
 * The credential forms one operation accepts, read from the security-scheme NAMES it requires.
 *
 * @returns the accepted forms, in the order the registry lists them
 */
export function authMethodsOf({ operation }: { operation: Record<string, unknown> }): readonly FigmaAuthMethod[] {
  const security = operation["security"];
  if (!Array.isArray(security)) {
    return [];
  }
  const named = new Set<string>();
  security.forEach((requirement: unknown) => {
    if (isRecord(requirement)) {
      Object.keys(requirement).forEach((scheme) => named.add(scheme));
    }
  });
  return FIGMA_AUTH_METHODS.filter((method) => named.has(method));
}
