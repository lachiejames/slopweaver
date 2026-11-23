/**
 * Every `slopweaver gcp` READ — each family's `describe`, and `secret access` — sent once through the door's
 * transport and printed. A read changes nothing in Google, so it carries no approval and writes no door row.
 */
import { accessSecret, describeRunService, describeSecret } from "../../../gcp/describe.js";
import { cutMessage } from "../../../gcp/redact.js";
import { writeSecretFile } from "../../../gcp/secretFile.js";
import { callGcp, type GcpDoorSend } from "../../../gcp/transport.js";
import { API_SERVICE, REPOSITORY, SERVICE_ACCOUNT } from "../../../gcp/wire.js";
import type { GcpReadOptions } from "./gcpCore.js";
import {
  accessReport,
  payloadValues,
  redactedRunDescription,
  runDescribeLines,
  secretDescribeLines,
} from "./gcpLines.js";
import { printed, reportError } from "./gcpPrint.js";

/**
 * The project a read acts on, which its quota is billed to.
 *
 * @returns the read's project id
 */
export function readProject({ options }: { options: GcpReadOptions }): string {
  return "ref" in options ? options.ref.project : options.project;
}

/**
 * Run one read.
 *
 * @param send the sender
 * @param options the read
 * @param json whether to print JSON
 * @returns the exit code
 */
export async function runRead({
  send,
  options,
  json,
}: {
  send: GcpDoorSend;
  options: GcpReadOptions;
  json: boolean;
}): Promise<number> {
  switch (options.read) {
    case "run describe": {
      const read = await describeRunService({ ref: options.ref, send });
      return read.isErr()
        ? reportError({ error: read.error })
        : printed({
            json,
            lines: runDescribeLines({ description: read.value }),
            value: redactedRunDescription({ description: read.value }),
          });
    }
    case "secret describe": {
      const read = await describeSecret({ ref: options.ref, send });
      return read.isErr()
        ? reportError({ error: read.error })
        : printed({ json, lines: secretDescribeLines({ description: read.value }), value: read.value });
    }
    case "secret access":
      return runAccess({ json, options, send });
    case "service-account describe":
    case "services describe":
    case "artifacts describe":
      return runProjectRead({ json, options, send });
    default: {
      const unreachable: never = options;
      return unreachable;
    }
  }
}

/** A read of one project-level resource: a service account, an API, or an Artifact Registry repository. */
// max-lines-exempt: a per-read dispatch whose whole body is one call-then-print branch per project-level read
async function runProjectRead({
  send,
  options,
  json,
}: {
  send: GcpDoorSend;
  options: Extract<GcpReadOptions, { read: "service-account describe" | "services describe" | "artifacts describe" }>;
  json: boolean;
}): Promise<number> {
  switch (options.read) {
    case "service-account describe": {
      const read = await callGcp({
        boundary: SERVICE_ACCOUNT,
        request: { email: options.email, kind: "service-account-get", project: options.project },
        send,
      });
      return read.isErr()
        ? reportError({ error: read.error })
        : printed({
            json,
            lines: [
              `${read.value.email}${read.value.disabled === true ? " (DISABLED)" : ""}: ${String(read.value.displayName)}`,
            ],
            value: read.value,
          });
    }
    case "services describe": {
      const read = await callGcp({
        boundary: API_SERVICE,
        request: { kind: "api-service-get", project: options.project, service: options.service },
        send,
      });
      return read.isErr()
        ? reportError({ error: read.error })
        : printed({
            json,
            lines: [`${options.service} on ${options.project}: ${String(read.value.state)}`],
            value: read.value,
          });
    }
    case "artifacts describe": {
      const read = await callGcp({
        boundary: REPOSITORY,
        request: {
          kind: "repository-get",
          project: options.project,
          region: options.region,
          repository: options.repository,
        },
        send,
      });
      return read.isErr()
        ? reportError({ error: read.error })
        : printed({
            json,
            lines: [`${read.value.name}: ${String(read.value.format)} ${String(read.value.registryUri)}`],
            value: read.value,
          });
    }
    default: {
      const unreachable: never = options;
      return unreachable;
    }
  }
}

/** `secret access`: check the payload, print its fingerprint, and write it to a new file when asked. */
async function runAccess({
  send,
  options,
  json,
}: {
  send: GcpDoorSend;
  options: Extract<GcpReadOptions, { read: "secret access" }>;
  json: boolean;
}): Promise<number> {
  const accessed = await accessSecret({ ref: options.ref, send, version: options.version });
  if (accessed.isErr()) {
    return reportError({ error: accessed.error });
  }
  const { name, payload } = accessed.value;
  // Everything printed from here on is cut against the payload's text, a file error's message included.
  const values = payloadValues({ bytes: payload.bytes });
  if (options.toFile !== undefined) {
    const written = writeSecretFile({ bytes: payload.bytes, path: options.toFile });
    if (written.isErr()) {
      return reportError({ error: cutMessage({ error: written.error, values }) });
    }
  }
  return printed({ json, ...accessReport({ fingerprint: payload.fingerprint, name, toFile: options.toFile, values }) });
}
