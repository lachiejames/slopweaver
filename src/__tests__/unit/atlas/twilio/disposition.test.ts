import { describe, expect, it } from "vitest";

import { twilioDispositionFor } from "../../../../atlas/twilio/disposition.js";

describe("which Twilio records are stored one row each", () => {
  // The whole point of the criterion, and the reason it is a function of one operation rather than a list
  // of product areas: same resource, adjacent nouns, opposite dispositions.
  it("cuts through the video room area rather than along it", () => {
    expect(twilioDispositionFor({ path: "/v1/Rooms/{RoomSid}/Recordings" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/v1/Rooms/{RoomSid}/RecordingRules" })).toBe("entity");
  });

  it("cuts through a participant's subscription the same way", () => {
    expect(twilioDispositionFor({ path: "/v1/Rooms/{RoomSid}/Participants/{ParticipantSid}/SubscribedTracks" })).toBe(
      "shape-index",
    );
    expect(twilioDispositionFor({ path: "/v1/Rooms/{RoomSid}/Participants/{ParticipantSid}/SubscribeRules" })).toBe(
      "entity",
    );
  });

  it("treats the message and call logs as the voluminous family the ask named", () => {
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Messages.json" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Messages/{Sid}.json" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Calls.json" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Recordings.json" })).toBe("shape-index");
  });

  it("treats Twilio's own error and metering streams as observations", () => {
    expect(twilioDispositionFor({ path: "/v1/Alerts" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/v1/Events" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Usage/Records/Daily.json" })).toBe(
      "shape-index",
    );
    expect(twilioDispositionFor({ path: "/v1/Voice/Summaries" })).toBe("shape-index");
  });

  it("cuts through Studio: a flow is authored, an execution of it is an occurrence", () => {
    expect(twilioDispositionFor({ path: "/v2/Flows/{FlowSid}/Executions" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/v2/Flows" })).toBe("entity");
  });

  it("cuts through metering: a usage record is observed, a usage trigger is configured", () => {
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Usage/Records.json" })).toBe("shape-index");
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/Usage/Triggers.json" })).toBe("entity");
  });

  it("keeps the configuration this atlas exists to hold as entities", () => {
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts/{AccountSid}/IncomingPhoneNumbers.json" })).toBe(
      "entity",
    );
    expect(twilioDispositionFor({ path: "/v1/Services" })).toBe("entity");
    expect(twilioDispositionFor({ path: "/2010-04-01/Accounts.json" })).toBe("entity");
    expect(twilioDispositionFor({ path: "/v1/Workspaces/{WorkspaceSid}/Workflows" })).toBe("entity");
  });
});
