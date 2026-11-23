/**
 * One page of the owner's ChatGPT account listing, read through its endpoint's strict boundary
 * (`#lib/boundary.js`): the three wire shapes, MEASURED key sets, and the pure parsers that turn each page into
 * listed conversations or projects. Pure throughout; the paced walk that asks for the pages is `./listing.ts`,
 * and the measurement of the three lanes is in its header.
 *
 * A listed item's `create_time` and `update_time` are ISO strings here, while the whole conversation carries epoch
 * numbers; both are read into ISO instants before anything compares them.
 */

import { z } from "zod";
import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";

import { CHATGPT_CONVERSATION_ID } from "../../../corpus/chatgpt/exportSchema.js";
import { type ChatgptError, ChatgptErrors } from "./errors.js";
import type { ChatgptListingLane, ListedChatgptConversation } from "./listing.js";
import { boundaryRefusal } from "./web.js";

/** A ChatGPT Project's id: `g-p-` and 32 hex digits, measured at 36 characters. */
const PROJECT_ID = /^g-p-[0-9a-f]{32}$/;

/** A key the answer carries that nothing here reads: declared, so one more is refused by name. */
const unread = z.unknown().optional();

/** One listed conversation, on all three lanes. Key set MEASURED; a project's item adds `owner`. */
const listItemWire = z.strictObject({
  async_status: unread,
  blocked_urls: unread,
  context_scopes: unread,
  context_scopes_v2: unread,
  conversation_origin: unread,
  conversation_template_id: unread,
  create_time: z.string(),
  current_node: unread,
  gizmo_id: z.string().nullable(),
  id: z.string(),
  is_archived: z.boolean(),
  is_do_not_remember: unread,
  is_starred: unread,
  is_temporary_chat: unread,
  latest_assistant_turn_created_at: unread,
  mapping: unread,
  memory_scope: unread,
  owner: unread,
  pinned_time: unread,
  safe_urls: unread,
  snippet: unread,
  sugar_item_id: unread,
  sugar_item_visible: unread,
  summary_metadata: unread,
  title: z.string().nullable(),
  trial_conversation_type: unread,
  update_time: z.string(),
  workspace_id: unread,
});

const conversationsPageWire = z.strictObject({
  items: z.array(listItemWire),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
});

/** The project's own record inside a sidebar item; only its id and name are read. Key set MEASURED. */
const projectGizmoWire = z.strictObject({
  appeal_info: unread,
  archived_at: unread,
  author: unread,
  context_stuffing_budget: unread,
  conversation_copy_in_progress: unread,
  created_at: unread,
  current_user_permission: unread,
  default_model: unread,
  display: z.strictObject({
    categories: unread,
    description: unread,
    emoji: unread,
    name: z.string(),
    profile_pic_id: unread,
    profile_picture_url: unread,
    prompt_starters: unread,
    theme: unread,
  }),
  gizmo_snorlax_type: unread,
  gizmo_type: unread,
  goal: unread,
  id: z.string(),
  instructions: unread,
  is_archived: unread,
  is_unassigned: unread,
  last_interacted_at: unread,
  live_version: unread,
  memory_enabled: unread,
  memory_scope: unread,
  model: unread,
  num_interactions: unread,
  organization_id: unread,
  share_recipient: unread,
  sharing: unread,
  sharing_targets: unread,
  short_url: unread,
  tags: unread,
  training_disabled: unread,
  updated_at: unread,
  use_injest_path: unread,
  vanity_metrics: unread,
  version: unread,
  version_author: unread,
  version_created_at: unread,
  version_updated_at: unread,
  voice: unread,
  workspace_approval_date: unread,
  workspace_approved: unread,
  workspace_id: unread,
});

const projectsPageWire = z.strictObject({
  cursor: z.string().nullable(),
  items: z.array(
    z.strictObject({
      conversations: unread,
      gizmo: z.strictObject({
        files: unread,
        gizmo: projectGizmoWire,
        has_tpp_conversation: unread,
        is_space_backing: unread,
        product_features: unread,
        project_connector_scope_limits: unread,
        project_file_limits: unread,
        tools: unread,
      }),
    }),
  ),
});

const projectConversationsPageWire = z.strictObject({
  cursor: z.union([z.string(), z.number()]).nullable(),
  items: z.array(listItemWire),
});

/** The three endpoints this module reads, one boundary each. */
const LISTING_BOUNDARIES = {
  conversations: defineBoundary({ endpoint: "GET /backend-api/conversations", schema: conversationsPageWire }),
  projectConversations: defineBoundary({
    endpoint: "GET /backend-api/gizmos/:projectId/conversations",
    schema: projectConversationsPageWire,
  }),
  projects: defineBoundary({ endpoint: "GET /backend-api/gizmos/snorlax/sidebar", schema: projectsPageWire }),
} as const;

/**
 * A listed instant as ISO, or `undefined` when it does not parse. Pure.
 *
 * @param text the listing's own instant, an ISO string
 * @returns the instant at millisecond precision
 */
export function listedInstantIso({ text }: { text: string }): string | undefined {
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** One wire item as a listed conversation, refused when its id or an instant is not one this noun can use. */
function listedFrom({
  item,
  lane,
  projectId,
  path,
}: {
  item: z.infer<typeof listItemWire>;
  lane: ChatgptListingLane;
  projectId: string | null;
  path: string;
}): Result<ListedChatgptConversation, ChatgptError> {
  if (!CHATGPT_CONVERSATION_ID.test(item.id)) {
    return err(ChatgptErrors.pageMalformed({ path, problems: ["a listed id is not a conversation id"] }));
  }
  const createdIso = listedInstantIso({ text: item.create_time });
  const updatedIso = listedInstantIso({ text: item.update_time });
  if (createdIso === undefined || updatedIso === undefined) {
    return err(
      ChatgptErrors.pageMalformed({ path, problems: [`conversation ${item.id} lists an unreadable instant`] }),
    );
  }
  return ok({ createdIso, id: item.id, lane, projectId, title: item.title, updatedIso });
}

/** Every wire item of one page as listed conversations, or the first refusal. */
function listedPage({
  items,
  lane,
  projectId,
  path,
}: {
  items: readonly z.infer<typeof listItemWire>[];
  lane: ChatgptListingLane;
  projectId: string | null;
  path: string;
}): Result<readonly ListedChatgptConversation[], ChatgptError> {
  const listed: ListedChatgptConversation[] = [];
  for (const item of items) {
    const one = listedFrom({ item, lane, path, projectId });
    if (one.isErr()) {
      return err(one.error);
    }
    listed.push(one.value);
  }
  return ok(listed);
}

/**
 * Read one page of the active or archived listing. Pure.
 *
 * @param path the path it answered, named in a refusal
 * @param text the body as sent
 * @param archived which lane asked
 * @returns the page's conversations and the listing's own `total`
 */
export function parseConversationsPage({
  path,
  text,
  archived,
}: {
  path: string;
  text: string;
  archived: boolean;
}): Result<{ items: readonly ListedChatgptConversation[]; total: number }, ChatgptError> {
  const parsed = LISTING_BOUNDARIES.conversations.parseJson({ text });
  if (parsed.isErr()) {
    return err(boundaryRefusal({ error: parsed.error, path }));
  }
  const lane: ChatgptListingLane = archived ? "archived" : "active";
  const items = listedPage({ items: parsed.value.items, lane, path, projectId: null });
  if (items.isErr()) {
    return err(items.error);
  }
  return ok({ items: items.value, total: parsed.value.total });
}

/** One project as the sidebar names it. */
export interface ListedChatgptProject {
  readonly id: string;
  readonly name: string;
}

/**
 * Read one page of the projects sidebar. Pure.
 *
 * @param path the path it answered, named in a refusal
 * @param text the body as sent
 * @returns the page's projects and the next page's cursor, `null` on the last
 */
export function parseProjectsPage({
  path,
  text,
}: {
  path: string;
  text: string;
}): Result<{ projects: readonly ListedChatgptProject[]; cursor: string | null }, ChatgptError> {
  const parsed = LISTING_BOUNDARIES.projects.parseJson({ text });
  if (parsed.isErr()) {
    return err(boundaryRefusal({ error: parsed.error, path }));
  }
  const projects: ListedChatgptProject[] = [];
  for (const item of parsed.value.items) {
    const { id, display } = item.gizmo.gizmo;
    if (!PROJECT_ID.test(id)) {
      return err(
        ChatgptErrors.pageMalformed({ path, problems: ["a listed project id is not g-p- and 32 hex digits"] }),
      );
    }
    projects.push({ id, name: display.name });
  }
  return ok({ cursor: parsed.value.cursor, projects });
}

/**
 * Read one page of one project's conversations. Pure.
 *
 * @param path the path it answered, named in a refusal
 * @param text the body as sent
 * @param projectId the project asked about, stamped on each conversation
 * @returns the page's conversations and the next page's cursor, `null` on the last
 */
export function parseProjectConversationsPage({
  path,
  text,
  projectId,
}: {
  path: string;
  text: string;
  projectId: string;
}): Result<{ items: readonly ListedChatgptConversation[]; cursor: string | null }, ChatgptError> {
  const parsed = LISTING_BOUNDARIES.projectConversations.parseJson({ text });
  if (parsed.isErr()) {
    return err(boundaryRefusal({ error: parsed.error, path }));
  }
  const items = listedPage({ items: parsed.value.items, lane: "project", path, projectId });
  if (items.isErr()) {
    return err(items.error);
  }
  const { cursor } = parsed.value;
  return ok({ cursor: cursor === null ? null : String(cursor), items: items.value });
}
