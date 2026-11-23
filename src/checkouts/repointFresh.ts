/**
 * `github repoint-plan`'s fresh-destination stage: what selects the checkout new work starts from — the profile's
 * declared main checkouts, the desktop app's checkout, the Codex marketplace source and every launch agent string
 * naming a path inside an old checkout — moved to `--new-checkout`. Pure — `./repointPlan.ts` composes it.
 */
import { isUnder } from "./repointCheckouts.js";
import {
  mergeRepointParts,
  type ReadField,
  type RepointAction,
  type RepointPart,
  type RepositoryRepointFacts,
} from "./repointModel.js";

/** The surfaces whose one moving value is a JSON string field. */
type FieldSurface = "profile" | "desktop" | "codex-marketplace";

/** A read JSON string field and the pointer that reaches it. */
type PointedField = ReadField & { readonly pointer: string };

/** Every read field of one surface. */
interface FieldGroup {
  readonly surface: FieldSurface;
  readonly fields: readonly PointedField[];
}

/** One launch agent that was read. */
type ReadLaunchAgent = Extract<RepositoryRepointFacts["launchAgents"][number], { readonly kind: "read" }>;

/** `path` with its `root` prefix swapped for `to`. */
function moved({ path, root, to }: { path: string; root: string; to: string }): string {
  return `${to}${path.slice(root.length)}`;
}

/** One `fresh` json-field action for a read surface whose value sits under an old checkout. */
function freshField({
  field,
  surface,
  oldCheckouts,
  newCheckout,
}: {
  field: PointedField;
  surface: FieldSurface;
  oldCheckouts: readonly string[];
  newCheckout: string;
}): RepointAction | undefined {
  const root = oldCheckouts.find((old) => isUnder({ path: field.value, root: old }));
  if (root === undefined) {
    return undefined;
  }
  return {
    expectedSha256: field.sha256,
    from: field.value,
    kind: "json-field",
    path: field.path,
    pointer: field.pointer,
    role: "fresh",
    surface,
    to: moved({ path: field.value, root, to: newCheckout }),
  };
}

/** The read JSON surfaces as field groups, with each unreadable surface unresolved and each absent one disclosed. */
function fieldGroups({
  facts,
}: {
  facts: RepositoryRepointFacts;
}): Partial<RepointPart> & { readonly groups: readonly FieldGroup[] } {
  const groups: FieldGroup[] = [];
  const unresolved: RepointPart["unresolved"][number][] = [];
  const observations: RepointPart["observations"][number][] = [];
  const profile = facts.profile;
  if (profile.kind === "read") {
    groups.push({
      fields: profile.mainCheckouts.map((value, index) => ({
        path: profile.path,
        pointer: `/mainCheckouts/${String(index)}/path`,
        sha256: profile.sha256,
        value,
      })),
      surface: "profile",
    });
  } else if (profile.kind === "unreadable") {
    unresolved.push({ locator: profile.path, reason: profile.why, surface: "profile" });
  }
  for (const [surface, read] of [
    ["desktop", facts.desktop],
    ["codex-marketplace", facts.marketplace],
  ] as const) {
    if (read.kind === "read") {
      groups.push({ fields: [read], surface });
    } else if (read.kind === "unreadable") {
      unresolved.push({ locator: read.path, reason: read.why, surface });
    } else {
      observations.push({
        detail: "not present on this machine",
        disposition: "unchanged",
        locator: read.path,
        surface,
      });
    }
  }
  return { groups, observations, unresolved };
}

/** One surface's fields: moved when inside an old checkout and the fresh one is known, else disclosed or unresolved. */
function fieldGroupPart({
  group,
  oldCheckouts,
  newCheckout,
}: {
  group: FieldGroup;
  oldCheckouts: readonly string[];
  newCheckout: string | null;
}): RepointPart {
  const actions: RepointAction[] = [];
  const unresolved: RepointPart["unresolved"][number][] = [];
  const observations: RepointPart["observations"][number][] = [];
  for (const field of group.fields) {
    const locator = `${field.path}#${field.pointer}`;
    if (!oldCheckouts.some((old) => isUnder({ path: field.value, root: old }))) {
      observations.push({
        detail: `${field.value} is not inside the old checkout`,
        disposition: "unchanged",
        locator,
        surface: group.surface,
      });
      continue;
    }
    if (newCheckout === null) {
      unresolved.push({
        locator,
        reason: `${field.value} moves to the fresh checkout, which --new-checkout names`,
        surface: group.surface,
      });
      continue;
    }
    actions.push(freshField({ field, newCheckout, oldCheckouts, surface: group.surface })!);
  }
  return { actions, observations, unresolved };
}

/** One read launch agent's strings naming an old checkout, each moved, or unresolved without a fresh checkout. */
function readAgentPart({
  agent,
  oldCheckouts,
  newCheckout,
}: {
  agent: ReadLaunchAgent;
  oldCheckouts: readonly string[];
  newCheckout: string | null;
}): RepointPart {
  const actions: RepointAction[] = [];
  const unresolved: RepointPart["unresolved"][number][] = [];
  for (const entry of agent.strings) {
    // A `ProgramArguments` string may carry the path inside it (`--cwd=/old/checkout/x`), so the path is matched
    // where it is followed by a `/` or is the whole value, never as a bare prefix of a longer directory name.
    const root = oldCheckouts.find((old) => entry.value === old || entry.value.includes(`${old}/`));
    if (root === undefined) {
      continue;
    }
    if (newCheckout === null) {
      unresolved.push({
        locator: `${agent.path}#${entry.keyPath.join(".")}`,
        reason: `${entry.value} moves to the fresh checkout, which --new-checkout names`,
        surface: "launch-agent",
      });
      continue;
    }
    const to = entry.value === root ? newCheckout : entry.value.split(`${root}/`).join(`${newCheckout}/`);
    actions.push({
      expectedSha256: agent.sha256,
      from: entry.value,
      keyPath: entry.keyPath,
      kind: "plist-string",
      path: agent.path,
      role: "fresh",
      to,
    });
  }
  return { actions, observations: [], unresolved };
}

/**
 * The fresh-destination surfaces: profile, desktop, marketplace and launch agents.
 *
 * @param oldCheckouts each old checkout's declared path, the prefixes a moving value sits under
 * @param newCheckout the fit fresh checkout, or `null` when none is, which leaves every move unresolved
 * @returns the stage's actions, unresolved items and observations, surface-level items before field-level ones
 */
export function freshPart({
  facts,
  oldCheckouts,
  newCheckout,
}: {
  facts: RepositoryRepointFacts;
  oldCheckouts: readonly string[];
  newCheckout: string | null;
}): RepointPart {
  const surfaces = fieldGroups({ facts });
  const agentParts = facts.launchAgents.map((agent): Partial<RepointPart> =>
    agent.kind === "unreadable"
      ? { unresolved: [{ locator: agent.path, reason: agent.why, surface: "launch-agent" }] }
      : readAgentPart({ agent, newCheckout, oldCheckouts }),
  );
  return mergeRepointParts({
    parts: [
      surfaces,
      ...surfaces.groups.map((group) => fieldGroupPart({ group, newCheckout, oldCheckouts })),
      ...agentParts,
    ],
  });
}
