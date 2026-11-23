/**
 * The Vanta atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. The rest do: `sync` walks the
 * Manage API, `changes` reads what each sync changed (`changesStore.ts`), `reset` archives a generation, `walk` fills the browser surface, `shot` photographs one named
 * control at its own address, and `vulnerabilities`, `test-entities`, `controls-evidence` and
 * `control-evidence` read LIVE and publish nothing, because a posture's whole value is that it is current.
 *
 * They sit under `atlas vanta` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once — a second top-level spelling would put Vanta in
 * it twice, which is the failure `kit/contract.ts` makes one-platform-per-atlas a type to prevent.
 *
 * Deactivation and reactivation are deliberately NOT here. It changes state at Vanta, and an atlas only ever reads; it lives
 * under the `write` noun, where its approval and door routing are the point rather than an aside.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The vanta row of the registry. */
export const VANTA_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // Vanta answers three verbs of its own beyond the two every platform has, so its row cannot take the
    // generic summary and usage without under-advertising what it does.
    doorRouted: false,
    example: "slopweaver atlas vanta read --kind policy --json",
    summary:
      "The Vanta atlas: `read` its stored entities or `coverage` for what it knows it does NOT know, " +
      "`render` for one HTML page of what it has already stored, capped and screenshot-able — the route " +
      "the browser door names for a picture, since vanta.com is doored, though it shows only pages a " +
      "`walk` has already photographed — plus `sync` to walk the Manage API, `changes` for what each sync " +
      "changed that no session has judged yet, " +
      "`walk` to fill the browser surface, `shot` to photograph ONE named control at its own address, " +
      "`reset` to archive a generation, and `vulnerabilities`, `test-entities`, " +
      "`controls-evidence` and `control-evidence` to read the live posture and file the evidence behind it",
  },
  platform: "vanta",
  readDescriptor: async () => (await import("./descriptor.js")).VANTA_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readVantaSnapshot(args),
  verbs: [
    {
      describe: "walk the Manage API and publish a generation",
      load: async () => (await import("../../cli/commands/vanta/syncRun.js")).vantaSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe:
        "print what the syncs no session has judged yet changed, or --mark-read one judged; writes only that local cursor",
      load: async () => (await import("../../cli/commands/vanta/changesRun.js")).vantaChangesCommand,
      usage: ["changes [--kind <kind>] [--mark-read <at>] [--json] [--home <dir>]"],
      verb: "changes",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/vanta/resetRun.js")).vantaResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
    {
      describe: "read findings LIVE; nothing is published, because a finding's value is that it is current",
      load: async () => (await import("../../cli/commands/vanta/vulnerabilitiesRun.js")).vantaVulnerabilitiesCommand,
      usage: [
        "vulnerabilities [--severity CRITICAL|HIGH|MEDIUM|LOW] [--active|--deactivated] [--fixable]",
        "     [--html <path>] [--client-id-file <path>] [--client-secret-file <path>] [--json] [--home <dir>]",
      ],
      verb: "vulnerabilities",
    },
    {
      describe: "read which resources a test fails on or has deactivated LIVE, with each deactivation's reason",
      load: async () => (await import("../../cli/commands/vanta/testEntitiesRun.js")).vantaTestEntitiesCommand,
      usage: [
        "test-entities --status FAILING|DEACTIVATED [--test <id>] [--limit <n>]",
        "     [--client-id-file <path>] [--client-secret-file <path>] [--json] [--home <dir>]",
      ],
      verb: "test-entities",
    },
    {
      describe: "read every control LIVE and file the evidence behind which of them need attention",
      load: async () => (await import("../../cli/commands/vanta/controlsEvidenceRun.js")).vantaControlsEvidenceCommand,
      usage: [
        "controls-evidence [--tenant <slug>] [--artifact <path>] [--json]",
        "     [--home <dir>] [--client-id-file <path> --client-secret-file <path>]",
      ],
      verb: "controls-evidence",
    },
    {
      describe: "explain ONE control LIVE — its failing tests, remediation and failing entities",
      load: async () => (await import("../../cli/commands/vanta/controlEvidenceRun.js")).vantaControlEvidenceCommand,
      usage: [
        "control-evidence --control <id> [--entity-sample <1..10>] [--tenant <slug>] [--artifact <path>]",
        "     [--client-id-file <path>] [--client-secret-file <path>] [--json] [--home <dir>]",
      ],
      verb: "control-evidence",
    },
    {
      describe: "fill the BROWSER surface by walking every declared page in your own Chrome, photographing each",
      load: async () => (await import("../../cli/commands/vanta/walkRun.js")).vantaWalkCommand,
      usage: ["walk [--tenant <slug>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe:
        "photograph ONE named control at its own address, because a picture of the controls list proves nothing about a control",
      load: async () => (await import("../../cli/commands/vanta/shotRun.js")).vantaShotCommand,
      usage: ["shot --control <id> [--control <id>...] [--tenant <slug>] [--json] [--home <dir>]"],
      verb: "shot",
    },
    {
      describe: "describe ONE policy's version menu in your own Chrome — reads only, clicks no item",
      load: async () => (await import("../../cli/commands/vanta/policyVersionRun.js")).runVantaPolicyVersions,
      usage: ["policy-versions --policy <id> [--tenant <slug>] [--json] [--home <dir>]"],
      verb: "policy-versions",
    },
  ],
};
