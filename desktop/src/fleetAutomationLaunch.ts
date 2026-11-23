/**
 * The exact line the shell types into a recovery tab, from fixed parts, what each button starts, and the reason the
 * page shows when the shell's own launch never reached cmux. Pure.
 */
import { err, ok, type Result } from "neverthrow";

import type { FleetError } from "./errors";
import { EPISODE_ID } from "./fleetAutomationEpisode";
import type { FleetHandAction, FleetHealth, FleetReason, FleetResumeHatch } from "./fleetHealth";

/** What a typed line starts. */
export type FleetLaunch =
  | { readonly kind: "resume"; readonly episodeId: string }
  | { readonly kind: "claude-signin"; readonly alias: string; readonly episodeId: string }
  | { readonly kind: "policy-override"; readonly hatch: FleetResumeHatch; readonly episodeId: string };

/**
 * A value as one single-quoted shell word.
 *
 * @param value the raw text
 * @returns it quoted, every `'` closed, escaped and reopened
 */
export function shellWord({ value }: { value: string }): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The line typed into the recovery tab. The resume always names the episode, so every attempt it records belongs to
 * the episode the shell opened, and it runs against the SAME home the page reads: a cmux tab starts from its own
 * login environment, so a shell started with a `SLOPWEAVER_HOME` would otherwise read one fleet and resume another.
 * `CLAUDE_CONFIG_DIR` travels for the same reason: it moves Claude Code's session registry, which both read.
 *
 * @param checkout the checkout whose `bin/slopweaver` runs
 * @param home the shell's own `SLOPWEAVER_HOME`, exported into the tab when it was started with one
 * @param claudeConfig the shell's own `CLAUDE_CONFIG_DIR`, exported into the tab when it was started with one
 * @param launch what to start
 * @returns the line, or why it would not be safe to type
 */
export function fleetLaunchLine({
  checkout,
  home,
  claudeConfig,
  launch,
}: {
  checkout: string;
  home: string | undefined;
  claudeConfig: string | undefined;
  launch: FleetLaunch;
}): Result<string, string> {
  if (!EPISODE_ID.test(launch.episodeId)) {
    return err(`episode id ${launch.episodeId} is not a minted id`);
  }
  const exported = [
    { name: "SLOPWEAVER_HOME", value: home },
    { name: "CLAUDE_CONFIG_DIR", value: claudeConfig },
  ].filter((variable): variable is { name: string; value: string } => variable.value !== undefined);
  if ([checkout, ...exported.map((variable) => variable.value)].some((path) => /[\r\n]/u.test(path))) {
    return err("the checkout or home path holds a line break");
  }
  const resume = `bin/slopweaver fleet resume --episode ${launch.episodeId}`;
  let cd = `cd ${shellWord({ value: checkout })}`;
  for (const variable of exported) {
    cd = `${cd} && export ${variable.name}=${shellWord({ value: variable.value })}`;
  }
  switch (launch.kind) {
    case "resume":
      return ok(`${cd} && ${resume}`);
    case "claude-signin":
      return ok(`${cd} && bin/slopweaver claude signin --plan ${shellWord({ value: launch.alias })} && ${resume}`);
    case "policy-override":
      return ok(`${cd} && ${launch.hatch}=1 ${resume}`);
    default: {
      const unreachable: never = launch;
      return unreachable;
    }
  }
}

/**
 * What one button press starts in a terminal, or `undefined` for a button the shell carries out itself.
 *
 * @param action the button
 * @param episodeId the open episode
 * @returns the launch, when the button is one
 */
export function launchForAction({
  action,
  episodeId,
}: {
  action: FleetHandAction;
  episodeId: string;
}): FleetLaunch | undefined {
  switch (action.kind) {
    case "claude-signin":
      return { alias: action.alias, episodeId, kind: "claude-signin" };
    case "policy-override":
      return { episodeId, hatch: action.hatch, kind: "policy-override" };
    case "resume":
      return { episodeId, kind: "resume" };
    case "automation-consent":
    case "open-cmux":
      return undefined;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * The reason the page shows when the shell's own launch failed: it replaces the fleet's, because nothing the fleet
 * says can move until the shell can reach cmux.
 *
 * @param failure why the launch failed
 * @returns the reason, with the one button that clears it
 */
export function bridgeFailureReason({ failure }: { failure: FleetError }): FleetReason {
  if (failure.code === "AUTOMATION_DENIED") {
    return {
      code: failure.code,
      detail:
        "Recovery runs in a cmux tab you can see, and macOS has not let Slopweaver open one. Allow Slopweaver to control cmux under Automation, and recovery starts.",
      handStep: {
        action: { kind: "automation-consent" },
        id: "automation-consent",
        label: "Open Automation settings",
        note: "Slopweaver needs permission to open a cmux tab for recovery.",
      },
      headline: "Slopweaver is not allowed to open a cmux tab.",
      raw: failure.message,
    };
  }
  return {
    code: failure.code,
    detail: "Recovery runs in a cmux tab you can see, and cmux did not open one. Opening cmux continues the recovery.",
    handStep: {
      action: { kind: "open-cmux" },
      id: "open-cmux",
      label: "Open cmux",
      note: "Recovery is waiting for cmux to open.",
    },
    headline: "cmux is not open, so recovery cannot start.",
    raw: failure.message,
  };
}

/**
 * The health the page shows: the fleet's own, with the shell's launch failure as the reason while one stands and the
 * fleet reads down. A reading that is recovering is someone's attempt running, so the failure's button would act on
 * a fleet that no longer asks for it; the failure stays held and shows again if the fleet
 * reads down.
 *
 * @param health what `fleet health` read
 * @param failure the shell's last launch failure, if the owner has not acted on it
 * @returns the health to render
 */
export function withBridgeFailure({
  health,
  failure,
}: {
  health: FleetHealth;
  failure: FleetError | undefined;
}): FleetHealth {
  if (failure === undefined || health.state !== "down") {
    return health;
  }
  return { ...health, reason: bridgeFailureReason({ failure }) };
}

/**
 * The command "Start recovery again" runs, shown under the note so the owner can see what the button does or paste it
 * by hand. The button types the same verb with the episode named (`fleetLaunchLine`).
 */
export const RESUME_COMMAND = "slopweaver fleet resume";
