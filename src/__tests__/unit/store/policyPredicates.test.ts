/**
 * `declaredPolicyPredicates`: every policy the schema declares, rendered the way drizzle-kit writes it into a
 * migration. The pure half of what `store verify` compares against the live database; the database deparse in
 * `readPolicyFacts` belongs to the store's integration coverage and is deliberately not faked here.
 */
import { describe, expect, it } from "vitest";

import type { DeclaredPolicyPredicates } from "../../../store/lifecycleCore.js";
import { declaredPolicyPredicates } from "../../../store/policyPredicates.js";

const PUBLIC_PARENT = "exists (select 1 from content c where c.id = content_id and c.visibility = 'public')";

/**
 * The declared policies grouped by table, in first-seen order, each group keeping its policies' order.
 *
 * @returns one entry per table
 */
function groupedByTable({
  predicates,
}: {
  predicates: readonly DeclaredPolicyPredicates[];
}): { table: string; policies: DeclaredPolicyPredicates[] }[] {
  const groups: { table: string; policies: DeclaredPolicyPredicates[] }[] = [];
  for (const predicate of predicates) {
    const last = groups.at(-1);
    if (last !== undefined && last.table === predicate.table) {
      last.policies.push(predicate);
    } else {
      groups.push({ policies: [predicate], table: predicate.table });
    }
  }
  return groups;
}

describe("declaredPolicyPredicates", () => {
  it("renders every table's owner, agent and bot policies in full, defaulting an unset operation to 'all'", () => {
    const predicates = declaredPolicyPredicates();
    const ofTable = ({ table }: { table: string }): readonly DeclaredPolicyPredicates[] =>
      predicates.filter((predicate) => predicate.table === table);

    expect(predicates.length).toBeGreaterThan(0);
    expect(ofTable({ table: "content" })).toEqual([
      { cmd: "all", name: "content_owner_all", table: "content", using: "true", withCheck: "true" },
      { cmd: "select", name: "content_agent_read", table: "content", using: "true", withCheck: null },
      { cmd: "select", name: "content_bot_read", table: "content", using: "visibility = 'public'", withCheck: null },
    ]);
    expect(ofTable({ table: "content_slack" })).toEqual([
      { cmd: "all", name: "content_slack_owner_all", table: "content_slack", using: "true", withCheck: "true" },
      { cmd: "select", name: "content_slack_agent_read", table: "content_slack", using: "true", withCheck: null },
      { cmd: "select", name: "content_slack_bot_read", table: "content_slack", using: PUBLIC_PARENT, withCheck: null },
    ]);
    expect(ofTable({ table: "memories" })).toEqual([
      { cmd: "all", name: "memories_owner_all", table: "memories", using: "true", withCheck: "true" },
      { cmd: "select", name: "memories_agent_read", table: "memories", using: "true", withCheck: null },
      { cmd: "select", name: "memories_bot_read", table: "memories", using: "false", withCheck: null },
    ]);
  });

  it("declares exactly these tables, in this order, each with exactly three policies and this bot predicate", () => {
    const groups = groupedByTable({ predicates: declaredPolicyPredicates() });

    expect(groups.length).toBeGreaterThan(0);
    expect(
      groups.map(({ table, policies }) => ({
        bot: policies.find((policy) => policy.name === `${table}_bot_read`)!.using,
        count: policies.length,
        table,
      })),
    ).toEqual([
      { bot: "false", count: 3, table: "atlas_coverage" },
      { bot: "false", count: 3, table: "atlas_entity_channel" },
      { bot: "false", count: 3, table: "atlas_entity" },
      { bot: "false", count: 3, table: "atlas_gap" },
      { bot: "false", count: 3, table: "atlas_kind_status" },
      { bot: "false", count: 3, table: "authored_absent" },
      { bot: "false", count: 3, table: "authored_body" },
      { bot: "false", count: 3, table: "authored_file" },
      { bot: "false", count: 3, table: "board_row" },
      { bot: "true", count: 3, table: "cmux_event_state" },
      { bot: "false", count: 3, table: "codex_fallback_receipt" },
      { bot: "false", count: 3, table: "codex_fallback_request" },
      { bot: "true", count: 3, table: "codex_fleet_cap" },
      { bot: "true", count: 3, table: "codex_sign_in_observation" },
      { bot: "false", count: 3, table: "codex_supersession" },
      { bot: "true", count: 3, table: "container" },
      { bot: "visibility = 'public'", count: 3, table: "content" },
      { bot: "true", count: 3, table: "fleet_config" },
      { bot: "false", count: 3, table: "fleet_journal_event" },
      { bot: "false", count: 3, table: "fleet_journal" },
      { bot: "false", count: 3, table: "home_file_import" },
      { bot: "false", count: 3, table: "store_import_application" },
      { bot: "false", count: 3, table: "store_import_batch" },
      { bot: "false", count: 3, table: "store_import_item" },
      { bot: "false", count: 3, table: "store_import_part" },
      { bot: "false", count: 3, table: "store_import_question" },
      { bot: "false", count: 3, table: "store_import_resolution" },
      { bot: "false", count: 3, table: "knowledge_domain" },
      { bot: "false", count: 3, table: "landing_press" },
      { bot: "false", count: 3, table: "landing_read_cursor" },
      { bot: "false", count: 3, table: "autonomy_event" },
      { bot: "false", count: 3, table: "autonomy_register" },
      { bot: "false", count: 3, table: "door_event" },
      { bot: "false", count: 3, table: "door_register" },
      { bot: "false", count: 3, table: "grant_row" },
      { bot: "false", count: 3, table: "measurement_blob" },
      { bot: "false", count: 3, table: "measurement_location" },
      { bot: "false", count: 3, table: "memories" },
      { bot: "false", count: 3, table: "memory_recalls" },
      { bot: "true", count: 3, table: "organisation" },
      { bot: "false", count: 3, table: "org_health_acknowledgement" },
      { bot: "false", count: 3, table: "org_health_incident" },
      { bot: "false", count: 3, table: "org_health_sighting" },
      { bot: "false", count: 3, table: "owner_capture" },
      { bot: "false", count: 3, table: "owner_correction" },
      { bot: "false", count: 3, table: "owner_directive" },
      { bot: "true", count: 3, table: "owner_profile" },
      { bot: "false", count: 3, table: "owner_turn_location" },
      { bot: "false", count: 3, table: "owner_turn" },
      { bot: "true", count: 3, table: "owner_voice_register" },
      { bot: "true", count: 3, table: "person" },
      { bot: "true", count: 3, table: "person_link_candidate" },
      { bot: "true", count: 3, table: "plan_register" },
      { bot: "false", count: 3, table: "published_page_alias" },
      { bot: "false", count: 3, table: "published_page_blob" },
      { bot: "false", count: 3, table: "published_page_file" },
      { bot: "false", count: 3, table: "published_page" },
      { bot: "false", count: 3, table: "published_page_version" },
      { bot: "false", count: 3, table: "codex_pass" },
      { bot: "false", count: 3, table: "run_event" },
      { bot: "false", count: 3, table: "run" },
      { bot: "id = 'identity-roster'", count: 3, table: "singleton_register" },
      { bot: PUBLIC_PARENT, count: 3, table: "content_github" },
      { bot: PUBLIC_PARENT, count: 3, table: "content_linear" },
      { bot: PUBLIC_PARENT, count: 3, table: "content_notion" },
      { bot: PUBLIC_PARENT, count: 3, table: "content_slack" },
      { bot: "true", count: 3, table: "spend_merchant" },
      { bot: "false", count: 3, table: "standing_ask_coverage" },
      { bot: "false", count: 3, table: "standing_ask_event" },
      { bot: "false", count: 3, table: "standing_ask" },
      { bot: "false", count: 3, table: "steer_measurement" },
      { bot: "false", count: 3, table: "workstream_entry" },
      { bot: "false", count: 3, table: "workstream_link" },
      { bot: "false", count: 3, table: "workstream_milestone_after" },
      { bot: "false", count: 3, table: "workstream_milestone" },
      { bot: "false", count: 3, table: "workstream_register_meta" },
      { bot: "false", count: 3, table: "workstream" },
    ]);
  });

  it("gives every table the same owner and agent policies, the bot's predicate being the only axis that varies", () => {
    const groups = groupedByTable({ predicates: declaredPolicyPredicates() });

    const shapes = groups.map(({ table, policies }) =>
      policies.map(({ cmd, name, using, withCheck }) => ({
        cmd,
        name: name.replace(table, "<table>"),
        using: name === `${table}_bot_read` ? "<bot>" : using,
        withCheck,
      })),
    );

    expect(groups.length).toBeGreaterThan(0);
    expect(shapes).toEqual(
      groups.map(() => [
        { cmd: "all", name: "<table>_owner_all", using: "true", withCheck: "true" },
        { cmd: "select", name: "<table>_agent_read", using: "true", withCheck: null },
        { cmd: "select", name: "<table>_bot_read", using: "<bot>", withCheck: null },
      ]),
    );
  });
});
