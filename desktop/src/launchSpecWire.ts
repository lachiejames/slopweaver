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

/**
 * The longest `title` or `ledgerKey` a launch may carry, in UTF-16 code units (a string's `.length`). Both are echoed
 * in every session snapshot and usage answer, and the title in every picture, for the session's whole life, so an
 * unbounded one could push each of those answers past `APP_HARNESS_MAX_LINE_BYTES` and poison it. Every title the CLI makes today is a handover
 * slug or one capped at 60 (`src/cmux/planNames.ts`), and 200 leaves room above that. Counted in code units rather
 * than bytes so this file stays free of a byte encoder: at the worst JSON escape (six bytes a unit) a bounded field
 * is still 1,200 bytes. `directory` is not bounded: an existing directory is already bound by the OS's path limit.
 */
export const APP_SESSION_TITLE_MAX_CHARS = 200;

/**
 * A launch field {@link APP_SESSION_TITLE_MAX_CHARS} bounds.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppLaunchBoundedField = "title" | "ledgerKey";

const BOUNDED_FIELDS: readonly AppLaunchBoundedField[] = ["title", "ledgerKey"];

/** What every launch carries, whichever vendor runs it. */
interface AppLaunchCommon {
  /** The short human title the card shows, at most {@link APP_SESSION_TITLE_MAX_CHARS} long. */
  readonly title: string;
  /** The directory the session runs in; it exists before the launch is asked for. */
  readonly directory: string;
  /** The ledger's label for the session, shown on the card, at most {@link APP_SESSION_TITLE_MAX_CHARS} long. */
  readonly ledgerKey: string;
  /** The model asked for, when one was pinned. */
  readonly model?: string;
  /**
   * The state home the spawn recorded the session's ledger row under, when it named one: the card's Stop closes
   * through the verb under the same home, so the close lands on that row.
   */
  readonly ledgerHome?: string;
  /**
   * The state home the session's own verbs must run under, when the spawn was EXPLICITLY given `--home`: the worker
   * exports it as `SLOPWEAVER_HOME`, so a seat confined to a scratch home never reads or writes the ambient one.
   * Absent on every other launch, so an app that predates this field still opens every launch it opened before; it
   * refuses only one that carries it, a refusal the CLI names (`./appLaunch.ts`). No protocol bump, on purpose: a
   * bump would refuse EVERY launch on an app one release behind, to protect the one launch that needs the field.
   */
  readonly stateHome?: string;
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

const COMMON_LAUNCH_KEYS: readonly string[] = [
  "vendor",
  "title",
  "directory",
  "ledgerKey",
  "model",
  "ledgerHome",
  "stateHome",
];

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
 * The first field, `title` then `ledgerKey`, that a value holds as a string longer than
 * {@link APP_SESSION_TITLE_MAX_CHARS}: what a refusal names when a launch spec is too long.
 *
 * @param value anything parsed off the wire, or a spec the CLI is about to send
 * @returns the overlong field, or undefined when neither is a string past the bound
 */
export function overlongLaunchField({ value }: { value: unknown }): AppLaunchBoundedField | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return BOUNDED_FIELDS.find((field) => {
    const held = value[field];
    return typeof held === "string" && held.length > APP_SESSION_TITLE_MAX_CHARS;
  });
}

/**
 * Whether a value is one launch spec, each vendor's arm carrying only its own keys.
 *
 * @param value anything parsed off the wire, or out of the app's recovery journal
 * @returns true when it is a Codex or a Claude launch with every field the shape the protocol declares, and its title
 * and ledger key within {@link APP_SESSION_TITLE_MAX_CHARS}
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppLaunchSpec(value: unknown): value is AppLaunchSpec {
  if (
    !isObject(value) ||
    !hasStrings({ keys: ["title", "directory", "ledgerKey"], value }) ||
    !hasOptionalStrings({ keys: ["model", "ledgerHome", "stateHome"], value }) ||
    overlongLaunchField({ value }) !== undefined
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
