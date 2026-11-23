/**
 * The escape-hatch rows for the DATADOG MONITOR write surface — `slopweaver datadog monitor update|delete`.
 *
 * A file rather than a section of `./registry.ts` for the reason `./codexPassHatches.ts` gives: the register
 * sheds a whole surface to a sibling, and `ESCAPE_HATCHES` spreads it back in, so there is still one register.
 *
 * Ambient, not journalled: what it waives is a change to a Datadog monitor's configuration, whose audience is
 * a deploy loop rather than a person, so `../devLint/journalledIds.ts`'s criterion is not met. The flag carries
 * its own written reason, and that reason rides the door ledger as a `datadog-iac-managed` acknowledgement.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the Datadog monitor write surface. */
export const DATADOG_MONITOR_HATCHES = [
  {
    caught:
      "the monitor carries a configured infrastructure-as-code ownership tag (profile.json datadog.iacManagedTags), so an infrastructure-as-code deployment owns it, and an out-of-band edit or delete races that deployment, which puts the monitor back or fails on the drift",
    command: "slopweaver datadog monitor update|delete",
    exceptions: [
      "the infrastructure-as-code deployment that created the monitor no longer exists or no longer declares it, so nothing will redeploy it",
      "an incident needs the change now and the same change is going into the IaC source in the same breath",
    ],
    id: "datadog-monitor-iac-managed",
    key: { incantation: 'slopweaver datadog monitor <update|delete> ... --iac-override "<why>"', kind: "command" },
    lane: "ambient",
    reader: "src/cli/commands/datadog/monitorCore.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
