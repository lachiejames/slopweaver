/**
 * The one effectful step every Vanta verb starts from: resolve credentials (from the two owner-only files,
 * the environment, or the secrets store under `home`) and bind a transport and token provider to them.
 *
 * Kept out of both shells because it is the only thing they genuinely share, and because a token provider
 * built two slightly different ways is exactly how a "one active token per Manage application" constraint
 * turns into a revocation ping-pong — `oauth.ts`'s header carries that constraint.
 */
import type { VantaCredentialError } from "../../../atlas/vanta/credentialErrors.js";
import { resolveVantaCommandCredentialsTyped } from "../../../atlas/vanta/credentialFiles.js";
import type { VantaCredentials } from "../../../atlas/vanta/credentials.js";
import { createVantaTokenProvider, type VantaTokenProvider } from "../../../atlas/vanta/oauth.js";
import { createVantaTransport, type VantaTransport } from "../../../atlas/vanta/transport.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";

/**
 * A transport and the token provider bound to it, ready for any Vanta client.
 *
 * @internal
 */
export interface VantaBinding {
  readonly transport: VantaTransport;
  readonly tokenProvider: VantaTokenProvider;
}

/**
 * Resolve credentials and bind a transport plus token provider to them.
 *
 * @param home the state home the mint lock lives under, and whose secrets store is the last credential route
 * @param clientIdFile the owner-only file holding the client id, or `null` for the environment or the store
 * @param clientSecretFile the owner-only file holding the client secret, or `null` for the environment or the store
 * @param env the environment, consulted only when neither file is named
 * @param createTransport builds the one transport; the real Vanta transport unless a test supplies its own
 * @param createTokenProvider builds the token provider bound to that transport; the real OAuth provider by default
 * @returns the binding, or every typed reason credentials could not be resolved — typed so a verb can grade
 *   "never configured" by code (`isVantaCredentialUnset`); print them with `vantaCredentialErrorsLines`
 */
export function bindVanta({
  home,
  clientIdFile,
  clientSecretFile,
  env,
  createTransport = createVantaTransport,
  createTokenProvider = createVantaTokenProvider,
}: {
  home: string;
  clientIdFile: string | null;
  clientSecretFile: string | null;
  env: Readonly<Record<string, string | undefined>>;
  createTransport?: (args: { logger: Logger }) => VantaTransport;
  createTokenProvider?: (args: {
    credentials: VantaCredentials;
    home: string;
    logger: Logger;
    transport: VantaTransport;
  }) => VantaTokenProvider;
}): Result<VantaBinding, readonly VantaCredentialError[]> {
  const credentials = resolveVantaCommandCredentialsTyped({ env, home, inputs: { clientIdFile, clientSecretFile } });
  if (credentials.isErr()) {
    return err(credentials.error);
  }
  const transport = createTransport({ logger });
  return ok({
    tokenProvider: createTokenProvider({ credentials: credentials.value, home, logger, transport }),
    transport,
  });
}
