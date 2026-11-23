/**
 * The Vanta atlas sync as a verb runs it: credentials resolved through the shared route, then the real
 * transport, token provider and Manage API client, written once so every caller syncs exactly the way
 * `atlas vanta sync` does.
 */
import { logger } from "../../lib/logger.js";
import type { Result } from "../../lib/result.js";

import { createVantaManageClient } from "./client.js";
import { resolveVantaCommandCredentials } from "./credentialFiles.js";
import { createVantaTokenProvider } from "./oauth.js";
import { syncVantaAtlas, type VantaSyncReport } from "./sync.js";
import type { VantaSyncRunError } from "./syncErrors.js";
import { createVantaTransport } from "./transport.js";

/**
 * Sync the Vanta atlas under `home` against the live Manage API.
 *
 * The credentials take the shared route rather than a bare environment read: a scheduled slot has no shell to
 * export from, and the store under `home` is where `slopweaver secrets set vanta-client-id` put the pair.
 *
 * @param home the state home the atlas and the secrets store live under
 * @param env the environment the credential route consults before the store
 * @param at this run's ISO timestamp
 * @returns the sync report, or every reason the run could not proceed at all, typed by whether a rerun is correct
 */
export async function syncVantaAtlasLive({
  home,
  env,
  at,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  at: string;
}): Promise<Result<VantaSyncReport, VantaSyncRunError>> {
  return syncVantaAtlas({
    at,
    buildClient: ({ credentials }) => {
      const transport = createVantaTransport({ logger });
      const tokenProvider = createVantaTokenProvider({ credentials, home, logger, transport });
      return createVantaManageClient({ tokenProvider, transport });
    },
    credentials: resolveVantaCommandCredentials({ env, home, inputs: { clientIdFile: null, clientSecretFile: null } }),
    home,
    logger,
  });
}
