/*
 * `crowdstrikeEntityView` on one stored entity: the entity as its detail, and one observation taken from its own
 * source and state, under the scope crowdstrike.
 */
import { describe, expect, it } from "vitest";

import type { CrowdstrikeEntity } from "../../../../../atlas/crowdstrike/entities.js";
import { crowdstrikeEntityView } from "../../../../../atlas/crowdstrike/readAdapter.js";
import { ENTITIES, SEEN } from "./entities.js";

describe("crowdstrikeEntityView", () => {
  it("reports a console request on the console surface it was observed on, with its screenshot and the scope crowdstrike", () => {
    const entity = ENTITIES["console-request"];
    expect(crowdstrikeEntityView({ entity, kind: "console-request" })).toEqual({
      detail: entity,
      id: "request-id-1",
      kind: "console-request",
      observations: [
        {
          artifacts: [
            {
              byteLength: 2048,
              kind: "page-png",
              mediaType: "image/png",
              relativePath: "artifacts/console-request.png",
              sha256: "a".repeat(64),
            },
          ],
          deepLink: "https://falcon.example-cloud.test/console-request",
          deepLinkStatus: "browser-discovered",
          endpoint: "/example/console-request",
          observedAt: SEEN,
          state: "observed",
          surface: "falcon-console",
        },
      ],
      providerId: "GET /api2/devices/queries/devices/v1",
      scope: "crowdstrike",
    });
  });

  it("carries a stale entity's state into its one observation", () => {
    const entity: CrowdstrikeEntity = { ...ENTITIES["host-group"], state: "stale" };
    expect(crowdstrikeEntityView({ entity, kind: "host-group" }).observations).toEqual([
      {
        artifacts: [],
        deepLink: "https://falcon.example-cloud.test/host-group",
        deepLinkStatus: "provider-provided",
        endpoint: "/example/host-group",
        observedAt: SEEN,
        state: "stale",
        surface: "falcon-api",
      },
    ]);
  });
});
