/**
 * The retired names — files that may still sit in the store and that nothing in `src/` reads. Each row says
 * why it is dead weight and that it is safe to delete; none is settable, so `secrets set` cannot mint one
 * again.
 */
import type { CredentialSpec } from "./spec.js";

/** The retired rows, in register order: the pre-`google-client-id` pair, the OpenAI key, the two store copies. */
export const RETIRED_CREDENTIALS = [
  {
    expiry: "none",
    lifecycle: "retired",
    mintScope: "not-a-credential",
    name: "gmail-client-id",
    platform: "Google",
    reader: null,
    readVerbs: "nothing",
    settable: false,
    shape: "line",
    usedFor:
      "NOTHING. The pre-`google-client-id` name for the Desktop-app OAuth client id. `skills/calendar/reference/connecting.md` once claimed that it was still read as a fallback; no module in `src/` has ever named it. Safe to delete",
    what: "a superseded Desktop-app OAuth client id",
    writtenBy: "placed by hand before `google-client-id` existed",
  },
  {
    expiry: "none",
    lifecycle: "retired",
    mintScope: "not-a-credential",
    name: "gmail-client-secret",
    platform: "Google",
    reader: null,
    readVerbs: "nothing",
    settable: false,
    shape: "line",
    usedFor: "NOTHING. The companion to `gmail-client-id`, retired on the same terms and for the same reason",
    what: "a superseded Desktop-app OAuth client secret",
    writtenBy: "placed by hand before `google-client-secret` existed",
  },
  {
    expiry: "unverified",
    lifecycle: "retired",
    mintScope: "unverified",
    name: "openai-api-key",
    platform: "OpenAI",
    reader: null,
    readVerbs: "nothing",
    settable: false,
    shape: "line",
    usedFor:
      "NOTHING. The platform.openai.com key the console voice once spent when the owner's ChatGPT plan refused a call. Every call rides the ChatGPT plan and nothing reaches platform.openai, so no module reads it. Safe to delete",
    what: "a platform API key (`sk-`)",
    writtenBy: "slopweaver secrets set openai-api-key, by a build that predates the ChatGPT-plan route",
  },
  {
    expiry: "none",
    lifecycle: "retired",
    mintScope: "not-a-credential",
    name: "store-api-url",
    platform: "Supabase (the local store's API gateway)",
    reader: null,
    readVerbs: "nothing",
    settable: false,
    shape: "line",
    usedFor:
      "NOTHING. The Storage API's address, now read off the gateway container's published port each time (read the stack, store nothing). Kept out of every backup and restore, and removed the first time the stack is read",
    what: "a superseded Storage API address",
    writtenBy: "slopweaver secrets set store-api-url, by a build that predates reading the stack",
  },
  {
    expiry: "none",
    lifecycle: "retired",
    mintScope: "read-write",
    name: "store-service-key",
    platform: "Supabase (the local store's API gateway)",
    reader: null,
    readVerbs: "nothing",
    settable: false,
    shape: "line",
    usedFor:
      "NOTHING. The local stack's service-role key, now read off the running Storage container each time and stored nowhere. Kept out of every backup and restore, and removed the first time the stack is read",
    what: "a superseded copy of the service-role key the store's Storage half is called with",
    writtenBy: "slopweaver secrets set store-service-key, by a build that predates reading the stack",
  },
] as const satisfies readonly CredentialSpec[];
