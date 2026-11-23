/**
 * The browser lane's Storage override: both variables or neither, a plain loopback origin, a generated key, and no
 * refusal that prints either value. Docker is a recording fake, so a test can show the override never reaches it.
 */
import { describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  E2E_OBJECTS_API_URL_ENV,
  E2E_OBJECTS_SERVICE_KEY_ENV,
  e2eStoreObjectsSelection,
  isLoopbackOrigin,
} from "../../../../store/objects/e2eSelection.js";
import { ObjectStoreErrors } from "../../../../store/objects/errors.js";
import { type DockerContextEndpoint, storeObjectsSelection } from "../../../../store/objects/selection.js";

const LANE_KEY = "FIXTURE_lane_key_0123456789abcdefABCDEF";
const LANE_URL = "http://127.0.0.1:54999";

/** A docker context read that records each ask and answers that docker is not running. */
function recordingEndpoint(): { endpoint: DockerContextEndpoint; asked: () => number } {
  let asked = 0;
  return {
    asked: () => asked,
    endpoint: () => {
      asked += 1;
      return err(ObjectStoreErrors.dockerEndpointUnreadable({ reason: "the docker daemon is not running" }));
    },
  };
}

describe("isLoopbackOrigin", () => {
  it("accepts a plain loopback origin with a port, IPv4 or IPv6", () => {
    expect(
      ["http://127.0.0.1:54999", "http://127.8.9.10:1", "http://[::1]:54999", "http://127.0.0.1:54999/"].map((apiUrl) =>
        isLoopbackOrigin({ apiUrl }),
      ),
    ).toEqual([true, true, true, true]);
  });

  it("refuses a hostname, another address, https, credentials, a path, a query, a fragment or no port", () => {
    const refused = [
      "http://localhost:54999",
      "http://10.0.0.7:54999",
      "http://0.0.0.0:54999",
      "http://[::]:54999",
      "http://128.0.0.1:54999",
      "https://127.0.0.1:54999",
      "http://user:pass@127.0.0.1:54999",
      "http://127.0.0.1:54999/storage/v1",
      "http://127.0.0.1:54999/?a=1",
      "http://127.0.0.1:54999/?",
      "http://127.0.0.1:54999/#",
      "http://127.0.0.1",
      "http://127.0.0.1:80",
      "not a url",
    ];
    expect(refused.filter((apiUrl) => isLoopbackOrigin({ apiUrl }))).toEqual([]);
  });
});

describe("e2eStoreObjectsSelection", () => {
  it("answers nothing when neither variable is set", () => {
    expect(unwrap(e2eStoreObjectsSelection({ env: {} }))).toBe(undefined);
  });

  it("answers the lane's origin and key when both are valid", () => {
    const env = { [E2E_OBJECTS_API_URL_ENV]: `${LANE_URL}/`, [E2E_OBJECTS_SERVICE_KEY_ENV]: LANE_KEY };
    expect(unwrap(e2eStoreObjectsSelection({ env }))).toEqual({ apiUrl: LANE_URL, serviceKey: LANE_KEY });
  });

  it("refuses either variable alone, naming the one that is set", () => {
    expect(unwrapErr(e2eStoreObjectsSelection({ env: { [E2E_OBJECTS_API_URL_ENV]: LANE_URL } }))).toEqual(
      ObjectStoreErrors.e2ePairIncomplete({ present: E2E_OBJECTS_API_URL_ENV }),
    );
    expect(unwrapErr(e2eStoreObjectsSelection({ env: { [E2E_OBJECTS_SERVICE_KEY_ENV]: LANE_KEY } }))).toEqual(
      ObjectStoreErrors.e2ePairIncomplete({ present: E2E_OBJECTS_SERVICE_KEY_ENV }),
    );
  });

  it("refuses a non-loopback address and a short or unusual key without printing either", () => {
    const remote = unwrapErr(
      e2eStoreObjectsSelection({
        env: { [E2E_OBJECTS_API_URL_ENV]: "http://192.0.2.7:54999", [E2E_OBJECTS_SERVICE_KEY_ENV]: LANE_KEY },
      }),
    );
    expect(remote.code).toBe("OBJECTS_E2E_API_URL_NOT_LOOPBACK");
    expect(remote.message).not.toContain("192.0.2.7");
    expect(remote.message).not.toContain(LANE_KEY);
    const keys = ["short", `${LANE_KEY} with spaces`, `${LANE_KEY}/slash`];
    const refusals = keys.map((key) =>
      unwrapErr(
        e2eStoreObjectsSelection({ env: { [E2E_OBJECTS_API_URL_ENV]: LANE_URL, [E2E_OBJECTS_SERVICE_KEY_ENV]: key } }),
      ),
    );
    expect(refusals.map((refusal) => refusal.code)).toEqual(Array(3).fill("OBJECTS_E2E_SERVICE_KEY_INVALID"));
    expect(refusals.filter((refusal, index) => refusal.message.includes(keys[index]!))).toEqual([]);
  });
});

describe("storeObjectsSelection with the lane's pair", () => {
  it("answers the lane's Storage without asking docker", () => {
    const { asked, endpoint } = recordingEndpoint();
    const env = { [E2E_OBJECTS_API_URL_ENV]: LANE_URL, [E2E_OBJECTS_SERVICE_KEY_ENV]: LANE_KEY };
    expect(unwrap(storeObjectsSelection({ endpoint, env, execArgv: [] }))).toEqual({
      apiUrl: LANE_URL,
      serviceKey: LANE_KEY,
    });
    expect(asked()).toBe(0);
  });

  it("refuses a half-set pair rather than falling back to docker", () => {
    const { asked, endpoint } = recordingEndpoint();
    const refused = unwrapErr(
      storeObjectsSelection({ endpoint, env: { [E2E_OBJECTS_SERVICE_KEY_ENV]: LANE_KEY }, execArgv: [] }),
    );
    expect(refused.code).toBe("OBJECTS_E2E_PAIR_INCOMPLETE");
    expect(asked()).toBe(0);
  });

  it("refuses the environment proxy before it reads the pair", () => {
    const { asked, endpoint } = recordingEndpoint();
    const env = {
      [E2E_OBJECTS_API_URL_ENV]: LANE_URL,
      [E2E_OBJECTS_SERVICE_KEY_ENV]: LANE_KEY,
      HTTPS_PROXY: "http://192.0.2.7:3128",
      NODE_USE_ENV_PROXY: "1",
    };
    expect(unwrapErr(storeObjectsSelection({ endpoint, env, execArgv: [] })).code).toBe("OBJECTS_ENV_PROXY_ON");
    expect(asked()).toBe(0);
  });

  it("asks docker as before when neither variable is set", () => {
    const { asked, endpoint } = recordingEndpoint();
    expect(unwrapErr(storeObjectsSelection({ endpoint, env: {}, execArgv: [] })).code).toBe(
      "OBJECTS_DOCKER_ENDPOINT_UNREADABLE",
    );
    expect(asked()).toBe(1);
  });
});
