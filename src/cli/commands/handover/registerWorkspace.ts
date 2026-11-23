/**
 * `handover register --workspace … --workspace-because …`: whose work a row is, stated by the writer as it lands.
 *
 * The console places a row off structured fields only (`site/lib/workspacePlacement.ts`) and never off `repo:`,
 * which is the checkout a seat runs in and is Slopweaver's for every fleet session. A row registered with no
 * statement, no pull request and no Slack destination is placed by the default rule, in the self Queue view only
 * (`site/lib/workspacePlacementContext.ts`). MEASURED over 33 open asks: each had to be placed by hand with
 * `handover set-workspace`, and every verb that registers rows kept minting more. So the statement travels with
 * the registration, written exactly as `set-workspace` writes it: `workspace:` and `workspaceBecause:`.
 */
import { declaredWorkspace, type StatedWorkspace, WORKSPACES } from "../../../handover/workspace.js";
import { optionalString } from "./askRowArgs.js";

/**
 * The workspace a registration states, or the refusal. Both flags or neither: a workspace with no reason is the
 * unexplained classification `workspaceBecause:` exists to end, and a reason with no workspace states nothing.
 *
 * @param values the parsed flag values
 * @returns the statement (undefined when neither flag was passed), or the refusal
 */
export function registerWorkspace({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly stated: StatedWorkspace | undefined } | { readonly refusal: string } {
  const workspace = optionalString({ name: "workspace", values });
  const because = optionalString({ name: "workspace-because", values })?.trim().replace(/\s+/gu, " ");
  if (workspace === undefined && because === undefined) {
    return { stated: undefined };
  }
  if (workspace === undefined) {
    return { refusal: `--workspace-because needs --workspace ${WORKSPACES.join("|")} — it is the reason for one` };
  }
  // An old spelling reads as its role and the ROLE is written: a console built before the rename still sends one.
  const role = declaredWorkspace({ declared: workspace });
  if (role === undefined) {
    return { refusal: `--workspace must be one of ${WORKSPACES.join("|")}, got ${JSON.stringify(workspace)}` };
  }
  if (because === undefined || because === "") {
    return {
      refusal: "--workspace needs --workspace-because <why>: the row carries the reason it is this workspace's",
    };
  }
  return { stated: { because, workspace: role } };
}
