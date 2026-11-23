/**
 * The Microsoft identity platform authority the Outlook door signs in against, and the two metadata documents
 * MSAL would otherwise fetch before its first token call.
 *
 * `/consumers` is the authority for PERSONAL Microsoft accounts (outlook.com, hotmail.com, live.com) — the
 * owner's personal install is the door's first user, and a work tenant would be a different authority and a
 * different app registration. Pinning both documents is MSAL's documented way to skip instance and OpenID
 * discovery (MSAL Node configuration, `cloudDiscoveryMetadata` + `authorityMetadata`): it removes two network
 * round trips from every process, and removes the only calls whose answer would decide WHERE a token is sent.
 * If Microsoft ever moves an endpoint, the token call fails naming it, which is the edit to make here.
 *
 * Values are Microsoft's published `https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration`
 * and its instance-discovery answer for the global cloud.
 */

/** The personal-account authority. */
export const OUTLOOK_AUTHORITY = "https://login.microsoftonline.com/consumers";

/** The Microsoft Graph origin every door request goes to, and the only host a paging link may name. */
export const GRAPH_ORIGIN = "https://graph.microsoft.com";

/** The tenant id Microsoft issues personal-account tokens under. */
const CONSUMERS_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** Instance discovery for the global cloud, as `.../common/discovery/instance` answers it. */
export const OUTLOOK_CLOUD_DISCOVERY_METADATA = JSON.stringify({
  "api-version": "1.1",
  metadata: [
    {
      aliases: ["login.microsoftonline.com", "login.windows.net", "login.microsoft.com", "sts.windows.net"],
      preferred_cache: "login.windows.net",
      preferred_network: "login.microsoftonline.com",
    },
  ],
  tenant_discovery_endpoint: `${OUTLOOK_AUTHORITY}/v2.0/.well-known/openid-configuration`,
});

/** The `/consumers` OpenID configuration — the four fields MSAL reads, plus the logout endpoint it records. */
export const OUTLOOK_AUTHORITY_METADATA = JSON.stringify({
  authorization_endpoint: `${OUTLOOK_AUTHORITY}/oauth2/v2.0/authorize`,
  end_session_endpoint: `${OUTLOOK_AUTHORITY}/oauth2/v2.0/logout`,
  issuer: `https://login.microsoftonline.com/${CONSUMERS_TENANT_ID}/v2.0`,
  jwks_uri: `${OUTLOOK_AUTHORITY}/discovery/v2.0/keys`,
  token_endpoint: `${OUTLOOK_AUTHORITY}/oauth2/v2.0/token`,
});
