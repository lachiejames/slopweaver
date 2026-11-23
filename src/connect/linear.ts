/**
 * Linear preflight: reachability (`viewer`) plus a 1-item read across the core lanes (users/issues/projects)
 * to catch a dead token, plus a best-effort curated-lane probe (initiatives/documents) that only WARNS when
 * empty — those lanes are additive, never required. Pure classifier + thin injected-probe shell.
 *
 * **This file used to say a Linear key "grants full read (no per-scope gating)". That is no longer true.**
 * Linear now issues fine-grained personal API keys scoped to Read, Write, Admin, Create issues, Create
 * comments, and selected teams. Two consequences, both load-bearing for the write lane:
 *
 *  - A read probe passing says nothing about whether the key may WRITE. There is no documented query or
 *    response header that introspects the presented key's permissions — schema introspection lists the
 *    mutations that exist globally, not what this credential may execute. So write capability is reported as
 *    UNVERIFIED rather than guessed, and the only way to establish it is to attempt a write, which
 *    "discovering you can post by posting" rules out.
 *  - "Create issues" and general "Write" are different grants, so they must not collapse into one boolean.
 */
import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { type ConnectCapability, type ConnectCheckReport, finaliseReport, probeScopeDetail } from "./types.js";

/** The raw outcome of the Linear probes. */
export interface LinearProbe {
  readonly authReachable: boolean;
  readonly usersSampled: number;
  readonly issuesSampled: number;
  readonly projectsSampled: number;
  readonly curatedSampled: number;
}

/** The injectable Linear probe bag — `viewer` (auth), a core-lane sample, a curated-lane sample. */
export interface LinearConnectProbes {
  viewer(): Promise<Result<{ reachable: boolean }, IngestError>>;
  activity(): Promise<Result<{ users: number; issues: number; projects: number }, IngestError>>;
  curated(): Promise<Result<{ initiatives: number; documents: number }, IngestError>>;
}

/** The 1-item core read-probe verdict (any user/issue/project visible ⇒ ok; nothing ⇒ no-data-visible). */
function readCapability({ probe }: { probe: LinearProbe }): ConnectCapability {
  const total = probe.usersSampled + probe.issuesSampled + probe.projectsSampled;
  if (total > 0) {
    return {
      detail: probeScopeDetail({
        sampled: [
          `${String(probe.usersSampled)} user(s)`,
          `${String(probe.issuesSampled)} issue(s)`,
          `${String(probe.projectsSampled)} project(s)`,
        ],
      }),
      id: "read-probe",
      status: "ok",
    };
  }
  return {
    detail: "auth ok but no users/issues/projects visible — the workspace looks empty to this key",
    id: "read-probe",
    status: "missing",
  };
}

/** The best-effort curated lane (initiatives/documents): present ⇒ ok, absent ⇒ a non-fatal warning. */
function curatedCapability({ probe }: { probe: LinearProbe }): ConnectCapability {
  if (probe.curatedSampled > 0) {
    return { detail: "initiatives/documents visible", id: "curated", status: "ok" };
  }
  return {
    detail: "no initiatives/documents visible (best-effort lane — activity still ingests)",
    id: "curated",
    status: "warning",
  };
}

/**
 * Classify a Linear probe into a report. Pure.
 *
 * @param probe the raw probe outcome
 * @returns the finalised report
 */
export function classifyLinear({ probe }: { probe: LinearProbe }): ConnectCheckReport {
  if (!probe.authReachable) {
    return finaliseReport({
      capabilities: [
        { detail: "viewer query failed — the API key is invalid or revoked", id: "auth", status: "missing" },
      ],
      errors: ["linear: viewer did not reach the workspace"],
      source: "linear",
      tokenPresent: true,
    });
  }
  return finaliseReport({
    capabilities: [
      { detail: "viewer reached the workspace", id: "auth", status: "ok" },
      readCapability({ probe }),
      curatedCapability({ probe }),
    ],
    source: "linear",
    tokenPresent: true,
  });
}

/**
 * Run the Linear probes and classify. Effectful shell over the injected bag.
 *
 * @param probes the injected probe bag
 * @returns the preflight report
 */
export async function checkLinearConnection({ probes }: { probes: LinearConnectProbes }): Promise<ConnectCheckReport> {
  const [viewer, activity, curated] = await Promise.all([probes.viewer(), probes.activity(), probes.curated()]);
  const act = activity.isOk() ? activity.value : { issues: 0, projects: 0, users: 0 };
  const cur = curated.isOk() ? curated.value : { documents: 0, initiatives: 0 };
  return classifyLinear({
    probe: {
      authReachable: viewer.isOk() ? viewer.value.reachable : false,
      curatedSampled: cur.initiatives + cur.documents,
      issuesSampled: act.issues,
      projectsSampled: act.projects,
      usersSampled: act.users,
    },
  });
}
