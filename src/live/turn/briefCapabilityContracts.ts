/**
 * The brief's capability CONTRACTS: the available, historical and unavailable sections a judging session reads to
 * learn what this context can reach, and what `turn brief --contracts` prints on its own.
 *
 * A leaf beside `./brief.ts`, which imports it for the full brief's capability section. It imports nothing from
 * `./brief.ts`, so the edge runs one way. It is pure: it formats strings and reads nothing.
 */
import { shellCommandLine } from "#lib/shellCommandLine.js";

import type { SourceCapability } from "../../route/profile.js";

/** Render one capability's honesty fields, available or not. */
function capabilityLines({ capability, status }: { capability: SourceCapability; status: string }): readonly string[] {
  const command =
    capability.command.length === 0 ? [] : [`      run: ${shellCommandLine({ command: capability.command })}`];
  return [
    `    - ${capability.id} [${status}] — ${capability.truthMode}/${capability.effect}/${capability.sourceClass}`,
    `      what: ${capability.what}`,
    `      freshness: ${capability.freshness.kind} — ${capability.freshness.detail}`,
    `      coverage: ${capability.coverage.kind} — ${capability.coverage.detail}`,
    ...command,
  ];
}

/** One rendered section: its heading, then a row per capability, or `- none` when the set is empty. */
function capabilitySection({
  capabilities,
  heading,
  status,
}: {
  capabilities: readonly SourceCapability[];
  heading: string;
  status: string;
}): readonly string[] {
  const rows = capabilities.flatMap((capability) => capabilityLines({ capability, status }));
  return [heading, ...(rows.length === 0 ? ["    - none"] : rows)];
}

/**
 * Render a capability inventory — the read-only door: `turn brief --contracts` prints exactly this, so a
 * session that only wants to know what a capability does never has to write a brief to find out.
 *
 * All three sections always render, `- none` included. An empty HISTORICAL section is a fact worth printing:
 * "this context reaches no history" is an answer a session can act on, where the section's ABSENCE reads as
 * the contract below it lying — and that is the defect this split closes, not a cosmetic one. See
 * `../../route/routingCapabilities.ts` for the measurement.
 *
 * @param available reachable and current-truth
 * @param historical reachable and history — what was said, decided or recorded
 * @param unavailable known but not reachable from here, whichever truth mode it declares
 * @returns the same lines a full brief's own capability section carries
 */
export function renderCapabilityContracts({
  available,
  historical,
  unavailable,
}: {
  available: readonly SourceCapability[];
  historical: readonly SourceCapability[];
  unavailable: readonly SourceCapability[];
}): readonly string[] {
  return [
    ...capabilitySection({
      capabilities: available,
      heading: "AVAILABLE CAPABILITIES — current truth, and the only legs that can establish present state:",
      status: "available",
    }),
    ...capabilitySection({
      capabilities: historical,
      heading:
        "HISTORICAL (reachable, and what was said/decided/recorded — selectable, but never proof of present state):",
      status: "HISTORICAL",
    }),
    ...capabilitySection({
      capabilities: unavailable,
      heading: "UNAVAILABLE (known, unreachable from here — never a selectable live need):",
      status: "UNAVAILABLE",
    }),
  ];
}
