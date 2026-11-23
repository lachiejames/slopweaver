/**
 * The escape-hatch row for the GCP door's write surface — `slopweaver gcp <family> <write>`.
 *
 * A file rather than a section of `./registry.ts` for the reason `./codexPassHatches.ts` gives: the register
 * sheds a whole surface to a sibling, and `ESCAPE_HATCHES` spreads it back in, so there is still one register.
 *
 * Ambient, not journalled: what it waives is a change to a cloud resource's configuration, whose audience is a
 * project rather than a person, so `../devLint/journalledIds.ts`'s criterion is not met — the same reading
 * `./datadogMonitorHatches.ts` makes. The flag carries its own written reason, and that reason rides the door
 * ledger as a `gcp-edit-existing` acknowledgement on every step of the write. It waives ONLY the additive
 * rail: the digest approval still holds the write until it matches.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the GCP door's write surface. */
export const GCP_HATCHES = [
  {
    caught:
      "the write changes how something that already exists in GCP behaves — a deploy onto an existing Cloud Run service, a secret version that moves `latest`, a disabled version, a public grant on an existing resource — and the owner's standing ruling is that the door is additive by default because editing what exists is where the risk lies",
    command: "slopweaver gcp run deploy|secret add-version|secret disable-version|secret add-iam-policy-binding",
    exceptions: [
      "a rollout the owner asked for that ships a new image to a service that already runs, as the SOPS-639 deploys did",
      "rotating a credential, where the new version is meant to become `latest` and the old one is disabled after",
      "a public invoker grant on a service whose whole purpose is to be reached without a Google sign-in",
    ],
    id: "gcp-edit-existing",
    key: { incantation: 'slopweaver gcp <family> <write> ... --edit-existing "<why>"', kind: "command" },
    lane: "ambient",
    reader: "src/cli/commands/gcp/gcpCore.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
