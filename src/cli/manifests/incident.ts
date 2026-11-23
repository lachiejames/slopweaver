/**
 * Lazy manifest for the `incident` noun — a live incident investigated unasked, ending in one floating note.
 *
 * `detect` is `none`: it reads the corpus and writes nothing (registration is the scheduled recovery sweep's, off live
 * discovery). `note` is `local-state`: it writes the hand-step register and draws the note on the owner's own machine, and
 * posts nothing to Slack — both cross-posts stay parked drafts until the owner says yes. `postmortems` is `none` (it reads
 * the org-health snapshot and the hand register); `postmortem` is `local-state` as `note` is, its one reply parked.
 */
import {
  INCIDENT_DETECT_USAGE,
  INCIDENT_NOTE_USAGE,
  INCIDENT_POSTMORTEM_USAGE,
  INCIDENT_POSTMORTEMS_USAGE,
} from "../commands/incident/incidentUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  doorRouted: false,
  dryParseSafe: true,
  parseRejectIsIoFree: true,
} as const;

/** The `incident` noun's verbs as lazy manifest entries. */
export const incidentManifest: Readonly<Record<string, VerbManifestEntry>> = {
  detect: lazy({
    load: () => import("../commands/incident/detect.js").then((m) => m.incidentDetectCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      effect: "none",
      example: "slopweaver incident detect --since 2026-09-01T00:00:00Z",
      summary:
        "Judge every incident channel the corpus holds as the live sweep would — incident or self-named drill, when " +
        "it opened, whether it is live now — registering nothing. Exits 3 when there is none",
      usage: INCIDENT_DETECT_USAGE,
    },
  }),
  note: lazy({
    load: () => import("../commands/incident/note.js").then((m) => m.incidentNoteCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      effect: "local-state",
      example: "slopweaver incident note --form ~/.slopweaver/runs/incident-x/note.json --dry-run",
      summary:
        "Post an incident investigation's ONE floating note from a form — verbatim quotes above the fold, root " +
        "cause, impact and Datadog evidence behind it, one share-with-the-team question — amending the open revision",
      usage: INCIDENT_NOTE_USAGE,
    },
  }),
  postmortem: lazy({
    load: () => import("../commands/incident/postmortem.js").then((m) => m.incidentPostmortemCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      effect: "local-state",
      example: "slopweaver incident postmortem --form ~/.slopweaver/runs/postmortem-x/card.json --dry-run",
      summary:
        "Post the ONE Queue card asking whether to send the reply that gets the owner into a resolved incident's " +
        "postmortem — the briefing page, verbatim channel lines, one parked ask tagging whoever runs it",
      usage: INCIDENT_POSTMORTEM_USAGE,
    },
  }),
  postmortems: lazy({
    load: () => import("../commands/incident/postmortems.js").then((m) => m.incidentPostmortemsCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      effect: "none",
      example: "slopweaver incident postmortems --json",
      summary:
        "List the resolved incidents worth a postmortem card off the org-health snapshot, each with the register " +
        "command for its row, registering nothing. Exits 3 when there is none",
      usage: INCIDENT_POSTMORTEMS_USAGE,
    },
  }),
};
