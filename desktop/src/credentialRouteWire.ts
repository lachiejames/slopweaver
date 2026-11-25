/**
 * Which login an app-hosted Claude session presents, as the session wire carries it inside a Claude launch: by path
 * only, never a token. Its own file so the session wire stays one readable page; the launch carrying it is
 * `sessionControlProtocol.ts` (the CLI's `appProtocol.ts`).
 *
 * Written ONCE and copied byte for byte, exactly as the session wire is: `desktop/src/credentialRouteWire.ts` is the
 * canonical copy and `src/sessionHarness/credentialRouteWire.ts` the mirror the CLI imports.
 * `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` fails the moment the two differ. So this file imports
 * only its mirrored sibling, under the one specifier both trees resolve.
 */
import { hasOnlyKeys, hasStrings, isObject } from "./wireBasics.js";

/**
 * Which login a Claude session presents, by path only — a token never crosses this wire. `store` boots on the routed
 * credential store's own saved login; `setup-token` opens a token file the app hands the session as file descriptor 3,
 * beside an unbound store, exactly as a cmux seat's boot line does (`src/claude/seatPinning.ts`).
 */
export type ClaudeCredentialRoute =
  | { readonly kind: "store"; readonly secureStorageDir: string }
  | { readonly kind: "setup-token"; readonly secureStorageDir: string; readonly tokenFilePath: string };

/**
 * Whether a value is one credential route, each arm carrying only its own paths.
 *
 * @param value anything parsed off the wire, or out of the app's recovery journal
 * @returns true for a store route, or a setup-token route naming its token file
 */
export function isClaudeCredentialRoute(value: unknown): value is ClaudeCredentialRoute {
  if (!isObject(value)) {
    return false;
  }
  if (value["kind"] === "store") {
    return (
      hasStrings({ keys: ["secureStorageDir"], value }) && hasOnlyKeys({ keys: ["kind", "secureStorageDir"], value })
    );
  }
  return (
    value["kind"] === "setup-token" &&
    hasStrings({ keys: ["secureStorageDir", "tokenFilePath"], value }) &&
    hasOnlyKeys({ keys: ["kind", "secureStorageDir", "tokenFilePath"], value })
  );
}
