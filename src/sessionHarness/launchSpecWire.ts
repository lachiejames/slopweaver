/**
 * What a launch asks the control plane to open, and whether a value off the wire or out of the app's recovery journal
 * is one. One of the protocol's mirrored siblings: the same bytes in the desktop and in the CLI, held equal by the
 * mirror test, so it names nothing either tree alone holds.
 */
import { type ClaudeCredentialRoute, isClaudeCredentialRoute } from "./credentialRouteWire.js";
import { hasOnlyKeys, hasOptionalStrings, hasStrings, isObject } from "./wireBasics.js";

/**
 * How hard a Claude session thinks, in the Agent SDK's own levels; an unknown level is refused, never passed on.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Every {@link AppClaudeEffort}, which the CLI checks a seat's effort against before it asks for a launch. */
export const APP_CLAUDE_EFFORTS: readonly AppClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** What every launch carries, whichever vendor runs it. */
interface AppLaunchCommon {
  /** The short human title the card shows. */
  readonly title: string;
  /** The directory the session runs in; it exists before the launch is asked for. */
  readonly directory: string;
  /** The ledger's label for the session, shown on the card. */
  readonly ledgerKey: string;
  /** The model asked for, when one was pinned. */
  readonly model?: string;
  /**
   * The state home the spawn recorded the session's ledger row under, when it named one: the card's Stop closes
   * through the verb under the same home, so the close lands on that row.
   */
  readonly ledgerHome?: string;
}

/**
 * A Codex launch.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface CodexAppLaunchSpec extends AppLaunchCommon {
  readonly vendor: "codex";
  /** The `$CODEX_HOME` the session's plan routes it to. */
  readonly codexHome: string;
  /**
   * The `instanceId` of the app whose `pong` named the binary the spawn's browser door judged. Each request is its own
   * connection, so another run of the app (a reinstall, a relaunch) can hold the socket by the launch; it refuses a
   * launch naming any instance but its own, so a judgment is never spent on an app it was not made against.
   */
  readonly judgedInstanceId: string;
}

/**
 * A Claude launch: the login it presents, and what it loads.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface ClaudeAppLaunchSpec extends AppLaunchCommon {
  readonly vendor: "claude";
  readonly credential: ClaudeCredentialRoute;
  /** The rule files the seat's template leaves out, by absolute path (`src/cmux/launchTemplate.ts`). */
  readonly claudeMdExcludes: readonly string[];
  readonly effort?: AppClaudeEffort;
  /** The Slopweaver plugin directory the seat loads, when the spawn resolved one. */
  readonly pluginDir?: string;
}

/** What the control plane needs to open one session — never a credential, never the ledger. */
export type AppLaunchSpec = CodexAppLaunchSpec | ClaudeAppLaunchSpec;

const COMMON_LAUNCH_KEYS: readonly string[] = ["vendor", "title", "directory", "ledgerKey", "model", "ledgerHome"];

function isClaudeLaunchSpec(value: Readonly<Record<string, unknown>>): boolean {
  const excludes = value["claudeMdExcludes"];
  const effort = value["effort"];
  return (
    hasOnlyKeys({ keys: [...COMMON_LAUNCH_KEYS, "credential", "claudeMdExcludes", "effort", "pluginDir"], value }) &&
    isClaudeCredentialRoute(value["credential"]) &&
    Array.isArray(excludes) &&
    excludes.every((path) => typeof path === "string") &&
    (effort === undefined || APP_CLAUDE_EFFORTS.some((level) => level === effort)) &&
    hasOptionalStrings({ keys: ["pluginDir"], value })
  );
}

/**
 * Whether a value is one launch spec, each vendor's arm carrying only its own keys.
 *
 * @param value anything parsed off the wire, or out of the app's recovery journal
 * @returns true when it is a Codex or a Claude launch with every field the shape the protocol declares
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppLaunchSpec(value: unknown): value is AppLaunchSpec {
  if (
    !isObject(value) ||
    !hasStrings({ keys: ["title", "directory", "ledgerKey"], value }) ||
    !hasOptionalStrings({ keys: ["model", "ledgerHome"], value })
  ) {
    return false;
  }
  if (value["vendor"] === "claude") {
    return isClaudeLaunchSpec(value);
  }
  return (
    value["vendor"] === "codex" &&
    hasStrings({ keys: ["codexHome", "judgedInstanceId"], value }) &&
    hasOnlyKeys({ keys: [...COMMON_LAUNCH_KEYS, "codexHome", "judgedInstanceId"], value })
  );
}
