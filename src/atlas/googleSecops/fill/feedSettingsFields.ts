/**
 * The settings fields a SecOps feed's `details` may carry — one per source type, exactly one present on any
 * feed — and the JSON name each arrives under.
 *
 * Every one of them is DECLARED on the feed boundary and READ by nothing: a settings message is where a
 * feed's source authenticates, and several of them (Amazon S3 V2, Azure Blob Store V2, SQS V2, CrowdStrike
 * alerts, Custom API) carry their secret as an ordinary readable field rather than an `INPUT_ONLY` one. The
 * fill keeps only WHICH key was present. Declaring them still matters: an undeclared key is a boundary
 * refusal, so a source type Google adds after the pin fails the feed read loudly instead of riding along.
 *
 * The list is verbatim, in proto order, from `FeedDetails`'s `oneof details` at the pinned commit. Reproduce
 * it (76 names):
 *
 * ```bash
 * curl -s https://raw.githubusercontent.com/googleapis/googleapis/<pinned-commit>/google/cloud/chronicle/v1/feed.proto | sed -n '/^  oneof details {/,/^  }/p' | grep -oE '\b[a-z0-9_]+_settings\b'
 * ```
 */

/** Every `FeedDetails.details` oneof field, as the proto spells it. */
export const FEED_SETTINGS_PROTO_FIELDS = [
  "anomali_settings",
  "azure_ad_context_settings",
  "cloud_passage_settings",
  "cortex_xdr_settings",
  "duo_auth_settings",
  "duo_user_context_settings",
  "microsoft_graph_alert_settings",
  "microsoft_security_center_alert_settings",
  "mimecast_mail_settings",
  "office365_settings",
  "proofpoint_mail_settings",
  "recorded_future_ioc_settings",
  "workday_settings",
  "pan_ioc_settings",
  "okta_settings",
  "okta_user_context_settings",
  "fox_it_stix_settings",
  "threat_connect_ioc_settings",
  "service_now_cmdb_settings",
  "imperva_waf_settings",
  "thinkst_canary_settings",
  "rh_isac_ioc_settings",
  "rapid7_insight_settings",
  "salesforce_settings",
  "netskope_alert_settings",
  "azure_mdm_intune_settings",
  "azure_ad_settings",
  "proofpoint_on_demand_settings",
  "workspace_users_settings",
  "workspace_activity_settings",
  "workspace_alerts_settings",
  "workspace_privileges_settings",
  "workspace_mobile_settings",
  "workspace_chrome_os_settings",
  "workspace_groups_settings",
  "azure_ad_audit_settings",
  "symantec_event_export_settings",
  "qualys_vm_settings",
  "pan_prisma_cloud_settings",
  "gcs_settings",
  "http_settings",
  "sftp_settings",
  "amazon_s3_settings",
  "azure_blob_store_settings",
  "amazon_sqs_settings",
  "google_cloud_identity_devices_settings",
  "google_cloud_identity_device_users_settings",
  "crowdstrike_detects_settings",
  "mandiant_ioc_settings",
  "sentinelone_alert_settings",
  "qualys_scan_settings",
  "pubsub_settings",
  "amazon_kinesis_firehose_settings",
  "webhook_settings",
  "dummy_log_type_settings",
  "https_push_google_cloud_pubsub_settings",
  "https_push_amazon_kinesis_firehose_settings",
  "https_push_webhook_settings",
  "aws_ec2_hosts_settings",
  "aws_ec2_instances_settings",
  "aws_ec2_vpcs_settings",
  "aws_iam_settings",
  "netskope_alert_v2_settings",
  "gcs_v2_settings",
  "amazon_s3_v2_settings",
  "amazon_sqs_v2_settings",
  "azure_event_hub_settings",
  "trellix_hx_hosts_settings",
  "azure_blob_store_v2_settings",
  "trellix_hx_alerts_settings",
  "google_cloud_storage_event_driven_settings",
  "crowdstrike_alerts_settings",
  "trellix_hx_bulk_acqs_settings",
  "mimecast_mail_v2_settings",
  "threat_connect_ioc_v3_settings",
  "custom_api_settings",
] as const;

/**
 * The name proto3's JSON mapping gives a field: each `_` dropped and the character after it upper-cased, as
 * `protoc` computes `json_name`. A digit after an underscore stays a digit — `amazon_s3_v2_settings` is
 * `amazonS3V2Settings`, `office365_settings` is `office365Settings`.
 *
 * @param field the field as the proto spells it, snake_case
 * @returns the JSON name it is serialised under
 */
export function protoJsonName({ field }: { field: string }): string {
  return field.replace(/_(.)/g, (_match, next: string) => next.toUpperCase());
}

/** Every settings field's JSON name, in proto order — the keys a feed's `details` may carry beside its metadata. */
export const FEED_SETTINGS_JSON_FIELDS: readonly string[] = FEED_SETTINGS_PROTO_FIELDS.map((field) =>
  protoJsonName({ field }),
);
