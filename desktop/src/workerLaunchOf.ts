/**
 * Which worker a prepared launch starts, and the one configuration document it is handed: a pure function of the
 * launch spec, the app's own paths and this run of the app. The vendor decides the arm; nothing else does.
 */
import { judgedAppRefusal } from "./judgedApp";
import type { AppLaunchSpec } from "./sessionControlProtocol";
import type { WorkerLaunchConfig } from "./sessionWorker/workerWire";

/** Where the packaged pieces each vendor's worker needs live. */
export interface SessionPaths {
  readonly codex: { readonly workerEntry: string; readonly adapterEntry: string; readonly codexPath: string };
  readonly claude: { readonly workerEntry: string; readonly claudePath: string };
}

/** The worker a launch starts, or why it may not start. */
export type WorkerLaunch =
  | { readonly kind: "launch"; readonly workerEntry: string; readonly config: WorkerLaunchConfig }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The worker for one launch.
 *
 * @param spec the launch the verb asked for
 * @param paths where each vendor's packaged worker and binary live
 * @param sessionId the control plane's id for the session
 * @param instanceId this run of the app, which a Codex launch must name as the run its browser door was judged against
 * @param claudeTranscriptId the UUID the app minted for a Claude transcript; Codex mints its own and reports it
 * @param resumeVendorSessionId the vendor transcript the recovery journal recorded, continued instead of a new one
 * @returns the worker entry and its configuration, or the refusal
 */
export function workerLaunchOf({
  spec,
  paths,
  sessionId,
  instanceId,
  claudeTranscriptId,
  resumeVendorSessionId,
}: {
  spec: AppLaunchSpec;
  paths: SessionPaths;
  sessionId: string;
  instanceId: string;
  claudeTranscriptId: string;
  resumeVendorSessionId?: string;
}): WorkerLaunch {
  const model = spec.model === undefined ? {} : { model: spec.model };
  const resumed = resumeVendorSessionId === undefined ? {} : { resumeVendorSessionId };
  if (spec.vendor === "claude") {
    return {
      config: {
        claudeMdExcludes: spec.claudeMdExcludes,
        claudePath: paths.claude.claudePath,
        credential: spec.credential,
        directory: spec.directory,
        sessionId,
        vendor: "claude",
        // A resumed transcript keeps its id, so the SDK must stream the recorded one, never a freshly minted one.
        vendorSessionId: resumeVendorSessionId ?? claudeTranscriptId,
        ...resumed,
        ...model,
        ...(spec.effort === undefined ? {} : { effort: spec.effort }),
        ...(spec.pluginDir === undefined ? {} : { pluginDir: spec.pluginDir }),
      },
      kind: "launch",
      workerEntry: paths.claude.workerEntry,
    };
  }
  const misjudged = judgedAppRefusal({ judged: spec.judgedInstanceId, serving: instanceId });
  if (misjudged !== undefined) {
    return { kind: "refused", why: misjudged };
  }
  return {
    config: {
      adapterEntry: paths.codex.adapterEntry,
      codexHome: spec.codexHome,
      codexPath: paths.codex.codexPath,
      directory: spec.directory,
      sessionId,
      vendor: "codex",
      ...resumed,
      ...model,
    },
    kind: "launch",
    workerEntry: paths.codex.workerEntry,
  };
}
