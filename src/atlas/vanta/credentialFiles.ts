/**
 * Read Vanta credentials from owner-only files instead of the environment, for a caller that would rather
 * not put a secret in `process.env` at all (e.g. a systemd unit or a shared shell profile).
 *
 * Three routes, in precedence order, and every Vanta verb resolves through all of them:
 *
 * 1. an explicit `--client-id-file`/`--client-secret-file` pair, when the caller named one;
 * 2. `VANTA_CLIENT_ID`/`VANTA_CLIENT_SECRET` in the environment, when either is set;
 * 3. the secrets store — `$SLOPWEAVER_HOME/secrets/vanta-client-id` and `vanta-client-secret`, the files
 *    `slopweaver secrets set` writes.
 *
 * The third route is what a SCHEDULED run stands on. A recipe slot that runs `slopweaver atlas vanta sync` has no
 * shell profile to export from, so a verb that read only the environment exited "credentials not
 * configured" on every slot until a human exported the pair by hand — the atlas goes
 * stale for exactly that reason. The store files are read with the same owner-only check
 * the explicit files get, so a loosened mode on a secret is refused rather than quietly used.
 */
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";

import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";
import { type VantaCredentialError, VantaCredentialErrors, vantaCredentialErrorsLines } from "./credentialErrors.js";
import {
  resolveVantaCredentialsTyped,
  VANTA_CLIENT_ID_ENV,
  VANTA_CLIENT_ID_SECRET,
  VANTA_CLIENT_SECRET_ENV,
  VANTA_CLIENT_SECRET_SECRET,
  type VantaCredentials,
} from "./credentials.js";

export interface VantaCredentialInputs {
  readonly clientIdFile: string | null;
  readonly clientSecretFile: string | null;
}

/**
 * Resolve credentials from an explicit pair of files, else the environment, else the secrets store under
 * `home` — see the file header for why the third route exists.
 *
 * @param inputs the explicit file paths, or both `null` to fall through to the environment and the store
 * @param env the environment, consulted only when `inputs` names no files
 * @param home the state home whose `secrets/` directory is the last resort
 * @returns the verified credentials, or every reason they could not be resolved
 */
export function resolveVantaCommandCredentials({
  inputs,
  env,
  home,
}: {
  inputs: VantaCredentialInputs;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<VantaCredentials> {
  return resolveVantaCommandCredentialsTyped({ env, home, inputs }).mapErr((errors) =>
    vantaCredentialErrorsLines({ errors }),
  );
}

/**
 * {@link resolveVantaCommandCredentials}, before its typed failures become the lines a caller prints — for a
 * caller that decides on WHICH failure it was, as a verb's "not configured" exit does.
 *
 * @param inputs the explicit file paths, or both `null` to fall through to the environment and the store
 * @param env the environment, consulted only when `inputs` names no files
 * @param home the state home whose `secrets/` directory is the last resort
 * @returns the verified credentials, or every typed reason they could not be resolved
 */
export function resolveVantaCommandCredentialsTyped({
  inputs,
  env,
  home,
}: {
  inputs: VantaCredentialInputs;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<VantaCredentials, readonly VantaCredentialError[]> {
  if (inputs.clientIdFile === null && inputs.clientSecretFile === null) {
    return resolveFromEnvOrStore({ env, home });
  }
  if (inputs.clientIdFile === null || inputs.clientSecretFile === null) {
    return err([VantaCredentialErrors.credentialFilesUnpaired()]);
  }
  return resolveFromFiles({
    clientIdFile: { label: "--client-id-file", path: inputs.clientIdFile },
    clientSecretFile: { label: "--client-secret-file", path: inputs.clientSecretFile },
  });
}

/** One credential file and the name a refusal calls it by. */
interface CredentialFile {
  readonly label: string;
  readonly path: string;
}

/**
 * The environment when either variable is set, otherwise the store when both files exist. A half-set
 * environment is reported as an environment problem rather than silently overridden by the store, and a
 * half-populated store names the file that is missing rather than the variables that are not exported.
 */
function resolveFromEnvOrStore({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<VantaCredentials, readonly VantaCredentialError[]> {
  const envHasEither = isPresent({ raw: env[VANTA_CLIENT_ID_ENV] }) || isPresent({ raw: env[VANTA_CLIENT_SECRET_ENV] });
  if (envHasEither) {
    return resolveVantaCredentialsTyped({ env });
  }
  const clientIdFile = {
    label: `secrets/${VANTA_CLIENT_ID_SECRET}`,
    path: secretFilePath({ home, name: VANTA_CLIENT_ID_SECRET }),
  };
  const clientSecretFile = {
    label: `secrets/${VANTA_CLIENT_SECRET_SECRET}`,
    path: secretFilePath({ home, name: VANTA_CLIENT_SECRET_SECRET }),
  };
  const idStored = existsSync(clientIdFile.path);
  const secretStored = existsSync(clientSecretFile.path);
  if (!idStored && !secretStored) {
    return resolveVantaCredentialsTyped({ env });
  }
  if (!idStored || !secretStored) {
    const missing = idStored ? VANTA_CLIENT_SECRET_SECRET : VANTA_CLIENT_ID_SECRET;
    const present = idStored ? VANTA_CLIENT_ID_SECRET : VANTA_CLIENT_SECRET_SECRET;
    return err([VantaCredentialErrors.storeHalfPopulated({ missing, present })]);
  }
  return resolveFromFiles({ clientIdFile, clientSecretFile });
}

function isPresent({ raw }: { raw: string | undefined }): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/** Read both files, report every refusal, then grade the pair exactly as an environment pair is graded. */
function resolveFromFiles({
  clientIdFile,
  clientSecretFile,
}: {
  clientIdFile: CredentialFile;
  clientSecretFile: CredentialFile;
}): Result<VantaCredentials, readonly VantaCredentialError[]> {
  const clientId = readCredentialFile(clientIdFile);
  const clientSecret = readCredentialFile(clientSecretFile);
  if (clientId.isErr() || clientSecret.isErr()) {
    return err([...(clientId.isErr() ? [clientId.error] : []), ...(clientSecret.isErr() ? [clientSecret.error] : [])]);
  }
  return resolveVantaCredentialsTyped({
    env: { VANTA_CLIENT_ID: clientId.value, VANTA_CLIENT_SECRET: clientSecret.value },
  });
}

function readCredentialFile({ label, path }: CredentialFile): Result<string, VantaCredentialError> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      return err(VantaCredentialErrors.fileNotRegular({ label, path }));
    }
    if ((stats.mode & 0o077) !== 0) {
      return err(VantaCredentialErrors.fileNotOwnerOnly({ label, path }));
    }
    return ok(readFileSync(descriptor, "utf8").trim());
  } catch (error: unknown) {
    return err(VantaCredentialErrors.fileUnreadable({ cause: error, label, path }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}
