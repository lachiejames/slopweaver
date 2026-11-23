/**
 * The Outlook authority in `live/outlook/authority.ts`: the personal-account `/consumers` authority, Graph's
 * origin, and the two pinned MSAL discovery documents, whose endpoints must all sit under that authority.
 */
import { describe, expect, it } from "vitest";

import {
  GRAPH_ORIGIN,
  OUTLOOK_AUTHORITY,
  OUTLOOK_AUTHORITY_METADATA,
  OUTLOOK_CLOUD_DISCOVERY_METADATA,
} from "../../../../live/outlook/authority.js";

describe("the Outlook authority constants", () => {
  it("signs in against the personal-account authority and sends Graph calls to Graph's origin", () => {
    expect(OUTLOOK_AUTHORITY).toBe("https://login.microsoftonline.com/consumers");
    expect(GRAPH_ORIGIN).toBe("https://graph.microsoft.com");
  });

  it("pins the OpenID configuration with every endpoint under /consumers", () => {
    expect(JSON.parse(OUTLOOK_AUTHORITY_METADATA)).toEqual({
      authorization_endpoint: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
      end_session_endpoint: "https://login.microsoftonline.com/consumers/oauth2/v2.0/logout",
      issuer: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      jwks_uri: "https://login.microsoftonline.com/consumers/discovery/v2.0/keys",
      token_endpoint: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    });
  });

  it("pins the global-cloud instance discovery pointing back at the /consumers configuration", () => {
    expect(JSON.parse(OUTLOOK_CLOUD_DISCOVERY_METADATA)).toEqual({
      "api-version": "1.1",
      metadata: [
        {
          aliases: ["login.microsoftonline.com", "login.windows.net", "login.microsoft.com", "sts.windows.net"],
          preferred_cache: "login.windows.net",
          preferred_network: "login.microsoftonline.com",
        },
      ],
      tenant_discovery_endpoint: "https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration",
    });
  });
});
