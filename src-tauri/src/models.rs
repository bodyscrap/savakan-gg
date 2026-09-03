use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

fn default_bind_ip() -> String {
    "0.0.0.0".to_owned()
}

fn default_broadcast_subnet_mask() -> String {
    "255.255.255.0".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSnapshot {
    pub tournament_id: String,
    pub slug: String,
    pub name: String,
    pub events: Vec<EventSnapshot>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentWorkspace {
    pub snapshot: TournamentSnapshot,
    pub local_meta: TournamentLocalMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemListConfig {
    pub id: String,
    pub name: String,
    pub category_name: String,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderProfile {
    pub sender_name: String,
    pub sender_user_id: String,
    #[serde(default = "default_bind_ip")]
    pub bind_ip: String,
    #[serde(default = "default_broadcast_subnet_mask")]
    pub broadcast_subnet_mask: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericMessage {
    pub message_id: String,
    pub thread_id: String,
    #[serde(default)]
    pub parent_message_id: Option<String>,
    #[serde(default = "default_message_type")]
    pub message_type: String,
    #[serde(default)]
    pub message_meta: Option<serde_json::Value>,
    pub method: String,
    pub subject: String,
    pub sender_name: String,
    pub sender_user_id: String,
    pub sender_ip: String,
    pub body: String,
    pub created_at: String,
}

fn default_message_type() -> String {
    "normal".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventManagementMeta {
    pub side_decision_method: String,
    pub item_list_snapshots: Vec<ItemListConfig>,
    #[serde(default)]
    pub category_min_counts: Vec<u32>,
    #[serde(default)]
    pub category_max_counts: Vec<u32>,
    #[serde(default)]
    pub category_allow_duplicates: Vec<bool>,
    #[serde(default)]
    pub total_min_count: u32,
    #[serde(default)]
    pub total_max_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentLocalMeta {
    pub tournament_id: String,
    pub slug: String,
    pub events: Vec<EventLocalMeta>,
    #[serde(default)]
    pub set_play_sides: Vec<SetPlaySideMeta>,
    #[serde(default)]
    pub pending_set_results: Vec<LocalSetResultMeta>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLocalMeta {
    pub event_id: String,
    pub event_name: String,
    #[serde(default)]
    pub event_alias: Option<String>,
    #[serde(default)]
    pub event_management: Option<EventManagementMeta>,
    pub entrants: Vec<EventEntrantMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEventManagementMetaInput {
    pub slug: String,
    pub event_id: String,
    pub event_name: String,
    pub setting: EventManagementMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEntrantMeta {
    pub entrant_id: String,
    pub entrant_name: String,
    pub play_side: Option<PlaySide>,
    pub character_names: Vec<String>,
    pub auth_code: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlaySide {
    #[serde(rename = "1P")]
    OneP,
    #[serde(rename = "2P")]
    TwoP,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlayerMetaInput {
    pub slug: String,
    pub event_id: String,
    pub event_name: String,
    pub entrant_id: String,
    pub entrant_name: String,
    pub play_side: Option<PlaySide>,
    pub character_names: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetPlaySideInput {
    pub slug: String,
    pub event_id: String,
    pub set_id: String,
    pub entrant_id: String,
    pub play_side: Option<PlaySide>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPlaySideMeta {
    pub set_id: String,
    pub entrant_id: String,
    pub play_side: PlaySide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetResultInput {
    pub slug: String,
    pub event_id: String,
    pub set_id: String,
    pub winner_id: String,
    pub confirmed: bool,
    pub slot_scores: Vec<LocalSetScoreInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetScoreUpdateInput {
    pub slug: String,
    pub event_id: String,
    pub set_id: String,
    pub slot_scores: Vec<LocalSetScoreInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetScoreInput {
    pub entrant_id: String,
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetResultMeta {
    pub event_id: String,
    pub event_name: String,
    pub set_id: String,
    pub winner_id: String,
    pub score_csv: String,
    #[serde(default = "default_confirmed")]
    pub confirmed: bool,
    #[serde(default)]
    pub slot_scores: Vec<LocalSetScoreMeta>,
    pub recorded_at: DateTime<Utc>,
}

fn default_confirmed() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetScoreMeta {
    pub entrant_id: String,
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BracketBatchReportResult {
    pub workspace: TournamentWorkspace,
    pub processed_count: usize,
    pub reported_count: usize,
    pub skipped_count: usize,
    pub completed: bool,
    pub conflict: Option<BracketBatchConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BracketBatchReportInput {
    pub slug: String,
    pub event_id: String,
    pub per_page: Option<u32>,
    pub force_overwrite_current_conflict: Option<bool>,
    pub force_overwrite_remaining_conflicts: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BracketBatchConflict {
    pub set_id: String,
    pub full_round_text: String,
    pub local_winner_id: String,
    pub remote_winner_id: Option<String>,
    pub remote_state: i64,
    pub entrant_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSnapshot {
    pub event_id: String,
    pub name: String,
    pub sets: Vec<SetSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSnapshot {
    pub set_id: String,
    pub full_round_text: String,
    pub round: Option<i64>,
    pub phase_name: Option<String>,
    pub phase_group_name: Option<String>,
    pub state: i64,
    pub winner_id: Option<String>,
    pub slots: Vec<SetSlotSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSlotSnapshot {
    pub entrant_id: Option<String>,
    pub entrant_name: String,
    pub seed_id: Option<String>,
    pub seed_num: Option<i64>,
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSetResultInput {
    pub slug: String,
    pub set_id: String,
    pub winner_id: String,
    pub score_csv: String,
    pub force_overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetSetResultCascadeInput {
    pub slug: String,
    pub event_id: String,
    pub set_id: String,
    pub reset_remote: Option<bool>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetSetResultCascadeResult {
    pub workspace: TournamentWorkspace,
    pub affected_set_ids: Vec<String>,
    pub remote_reset_applied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventSnapshotInput {
    pub slug: String,
    pub event_id: String,
    pub event_slug: Option<String>,
    pub event_alias: Option<String>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventSnapshotBySlugInput {
    pub tournament_slug: String,
    pub event_slug: String,
    pub event_alias: Option<String>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentEventPreviewItem {
    pub event_id: String,
    pub event_name: String,
    pub event_slug: Option<String>,
    pub set_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentPreview {
    pub tournament_id: String,
    pub slug: String,
    pub name: String,
    pub updated_at: DateTime<Utc>,
    pub events: Vec<TournamentEventPreviewItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSnapshotEventListItem {
    pub tournament_id: String,
    pub slug: String,
    pub tournament_name: String,
    pub updated_at: DateTime<Utc>,
    pub event_id: String,
    pub event_name: String,
    #[serde(default)]
    pub event_alias: Option<String>,
    pub set_count: usize,
}

