use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::models::{
    ApplyExternalScoreReportInput, BracketGraphEdge, BracketGraphSnapshot, EventEntrantMeta,
    EventLocalMeta, EventManagementMeta, EventSnapshot, GenericMessage, ItemListConfig,
    LocalGrandFinalResetResultMeta, LocalPlayerMetaInput, LocalSetPlaySideInput,
    LocalSetResultInput, LocalSetResultMeta, LocalSetScoreMeta, LocalSetScoreUpdateInput,
    LocalSnapshotEventListItem, MobileResultRequestInput, MobileResultRequestItem,
    PhaseGroupExternalEditor, PhaseGroupGraphSeedSnapshot, PhaseGroupSeedSnapshot,
    RestoreEventGraphInput, RestoreEventGraphResult, SaveEventManagementMetaInput, SenderProfile,
    SetPhaseGroupExternalEditorInput, SetPhaseGroupExternalScoreBroadcastInput,
    SetPhaseGroupScoreEditLockInput, SetPlaySideMeta, SetSnapshot, SnapshotRestoreScope,
    TournamentEventPreviewItem, TournamentLocalMeta, TournamentSnapshot, TournamentWorkspace,
};

const STORAGE_DIR_NAME: &str = "savakan-gg";
const TOKEN_FILE: &str = "startgg-token.txt";
const SLUG_FILE: &str = "last-slug.txt";
const ITEM_LISTS_FILE: &str = "item-lists.json";
const EVENT_MGMT_FILE: &str = "event-mgmt-settings.json";
const SENDER_PROFILE_FILE: &str = "sender-profile.json";
const GENERIC_MESSAGES_FILE: &str = "generic-messages.json";
const MOBILE_RESULT_REQUESTS_FILE: &str = "mobile-result-requests.json";
const LAST_SNAPSHOT_SELECTION_FILE: &str = "last-snapshot-selection.json";
const TEMP_TOKEN_FILE: &str = "token.txt";
const SETTINGS_DIR_NAME: &str = "settings";
const SNAPSHOTS_DIR_NAME: &str = "snapshots";
const EVENT_SETTING_CATEGORY_SLOT_COUNT: usize = 3;

fn storage_perf_log(message: impl FnOnce() -> String) {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    if *ENABLED.get_or_init(|| std::env::var_os("SAVAKAN_STORAGE_PERF").is_some()) {
        eprintln!("[storage-perf] {}", message());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastSnapshotSelection {
    pub slug: String,
    pub event_id: String,
    #[serde(default)]
    pub phase_name: Option<String>,
    #[serde(default)]
    pub phase_group_name: Option<String>,
}

fn sanitize_slug(slug: &str) -> String {
    slug.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn event_name_slug(name: &str) -> String {
    let mut slug = String::new();
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').to_owned()
}

fn normalize_slug_for_storage(slug: &str) -> String {
    let trimmed = slug.trim().trim_matches('/');

    if let Some(rest) = trimmed.strip_prefix("https://www.start.gg/tournament/") {
        return rest.trim_matches('/').to_owned();
    }
    if let Some(rest) = trimmed.strip_prefix("http://www.start.gg/tournament/") {
        return rest.trim_matches('/').to_owned();
    }
    if let Some(rest) = trimmed.strip_prefix("www.start.gg/tournament/") {
        return rest.trim_matches('/').to_owned();
    }
    if let Some(rest) = trimmed.strip_prefix("start.gg/tournament/") {
        return rest.trim_matches('/').to_owned();
    }
    if let Some(rest) = trimmed.strip_prefix("tournament/") {
        return rest.trim_matches('/').to_owned();
    }

    trimmed.to_owned()
}

fn event_snapshot_path_with_keys(
    app: &AppHandle,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
) -> Result<PathBuf, String> {
    let file_name = format!(
        "{}-{}-{}-{}-snapshot.json",
        sanitize_slug(tournament_id),
        sanitize_slug(slug_key),
        sanitize_slug(event_id),
        event_name_slug(event_name)
    );
    Ok(snapshots_dir(app)?.join(file_name))
}

fn pristine_event_snapshot_path_with_keys(
    app: &AppHandle,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
) -> Result<PathBuf, String> {
    let file_name = format!(
        "{}-{}-{}-{}-pristine.json",
        sanitize_slug(tournament_id),
        sanitize_slug(slug_key),
        sanitize_slug(event_id),
        event_name_slug(event_name)
    );
    Ok(snapshots_dir(app)?.join(file_name))
}

fn event_graph_path_with_keys(
    app: &AppHandle,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
) -> Result<PathBuf, String> {
    let file_name = format!(
        "{}-{}-{}-{}-graph.json",
        sanitize_slug(tournament_id),
        sanitize_slug(slug_key),
        sanitize_slug(event_id),
        event_name_slug(event_name),
    );
    Ok(snapshots_dir(app)?.join(file_name))
}

fn meta_path_with_slug_key(
    app: &AppHandle,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
) -> Result<PathBuf, String> {
    let file_name = format!(
        "{}-{}-{}-{}-meta.json",
        sanitize_slug(tournament_id),
        sanitize_slug(slug_key),
        sanitize_slug(event_id),
        event_name_slug(event_name),
    );
    Ok(snapshots_dir(app)?.join(file_name))
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dirの取得に失敗しました: {e}"))?
        .join(STORAGE_DIR_NAME);

    fs::create_dir_all(&path)
        .map_err(|e| format!("保存先ディレクトリの作成に失敗しました: {e}"))?;
    Ok(path)
}

fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = storage_dir(app)?.join(SETTINGS_DIR_NAME);
    fs::create_dir_all(&path)
        .map_err(|e| format!("設定保存先ディレクトリの作成に失敗しました: {e}"))?;
    Ok(path)
}

fn snapshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = storage_dir(app)?.join(SNAPSHOTS_DIR_NAME);
    fs::create_dir_all(&path)
        .map_err(|e| format!("スナップショット保存先ディレクトリの作成に失敗しました: {e}"))?;
    Ok(path)
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(TOKEN_FILE))
}

fn meta_path(
    app: &AppHandle,
    tournament_id: &str,
    slug: &str,
    event_id: &str,
    event_name: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_slug_for_storage(slug);
    meta_path_with_slug_key(app, tournament_id, &normalized, event_id, event_name)
}

fn slug_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(SLUG_FILE))
}

fn item_lists_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(ITEM_LISTS_FILE))
}

fn event_mgmt_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(EVENT_MGMT_FILE))
}

fn sender_profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(SENDER_PROFILE_FILE))
}

fn generic_messages_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(GENERIC_MESSAGES_FILE))
}

fn last_snapshot_selection_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(LAST_SNAPSHOT_SELECTION_FILE))
}

fn mobile_result_requests_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(MOBILE_RESULT_REQUESTS_FILE))
}

fn build_empty_meta(slug: &str, event_id: &str) -> TournamentLocalMeta {
    TournamentLocalMeta {
        tournament_id: String::new(),
        slug: slug.to_owned(),
        tournament_name: String::new(),
        events: vec![EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        }],
        set_play_sides: Vec::new(),
        pending_set_results: Vec::new(),
        pending_grand_final_reset_results: Vec::new(),
        set_confirmation_history: Vec::new(),
        updated_at: Utc::now(),
    }
}

fn append_set_confirmation_record(
    local_meta: &mut TournamentLocalMeta,
    event_id: &str,
    set_id: &str,
    winner_id: &str,
    slot_entrant_ids: Vec<String>,
    confirmed_at: chrono::DateTime<Utc>,
) {
    let sequence = local_meta
        .set_confirmation_history
        .iter()
        .filter(|record| record.event_id == event_id)
        .map(|record| record.sequence)
        .max()
        .unwrap_or_default()
        .saturating_add(1);
    local_meta
        .set_confirmation_history
        .push(crate::models::SetConfirmationRecord {
            event_id: event_id.to_owned(),
            set_id: set_id.to_owned(),
            sequence,
            confirmed_at,
            winner_id: winner_id.to_owned(),
            slot_entrant_ids,
        });
}

#[cfg(test)]
#[path = "storage/tests/set_confirmation_history_tests.rs"]
mod set_confirmation_history_tests;

fn derive_auth_code(slug: &str, event_id: &str, entrant_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(slug.as_bytes());
    hasher.update(b":");
    hasher.update(event_id.as_bytes());
    hasher.update(b":");
    hasher.update(entrant_id.as_bytes());

    let digest = hasher.finalize();
    let code = digest
        .iter()
        .take(6)
        .map(|byte| format!("{:02X}", byte))
        .collect::<String>();

    format!("AUTH-{code}")
}

fn normalize_character_names(character_names: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();

    for character_name in character_names {
        let trimmed = character_name.trim();
        if trimmed.is_empty() {
            continue;
        }

        if seen.insert(trimmed.to_owned()) {
            normalized.push(trimmed.to_owned());
        }
    }

    normalized
}

fn normalize_item_list_snapshot(item_list: &ItemListConfig) -> ItemListConfig {
    ItemListConfig {
        id: item_list.id.trim().to_owned(),
        name: item_list.name.trim().to_owned(),
        category_name: item_list.category_name.trim().to_owned(),
        items: normalize_character_names(&item_list.items),
    }
}

fn normalize_count_array(source: &[u32], fallback: u32) -> Vec<u32> {
    let mut normalized = source
        .iter()
        .copied()
        .take(EVENT_SETTING_CATEGORY_SLOT_COUNT)
        .collect::<Vec<u32>>();

    while normalized.len() < EVENT_SETTING_CATEGORY_SLOT_COUNT {
        normalized.push(fallback);
    }

    normalized
}

fn normalize_allow_duplicates_array(source: &[bool]) -> Vec<bool> {
    let mut normalized = source
        .iter()
        .copied()
        .take(EVENT_SETTING_CATEGORY_SLOT_COUNT)
        .collect::<Vec<bool>>();

    while normalized.len() < EVENT_SETTING_CATEGORY_SLOT_COUNT {
        normalized.push(false);
    }

    normalized
}

fn normalize_event_management_meta(setting: EventManagementMeta) -> EventManagementMeta {
    let side_decision_method = match setting.side_decision_method.as_str() {
        "upper_2p" | "random" => setting.side_decision_method,
        _ => "upper_1p".to_owned(),
    };

    let mut item_list_snapshots = setting
        .item_list_snapshots
        .iter()
        .take(EVENT_SETTING_CATEGORY_SLOT_COUNT)
        .map(normalize_item_list_snapshot)
        .collect::<Vec<ItemListConfig>>();

    while item_list_snapshots.len() < EVENT_SETTING_CATEGORY_SLOT_COUNT {
        item_list_snapshots.push(ItemListConfig {
            id: String::new(),
            name: String::new(),
            category_name: String::new(),
            items: Vec::new(),
        });
    }

    let mut category_min_counts = normalize_count_array(&setting.category_min_counts, 0);
    let mut category_max_counts = normalize_count_array(&setting.category_max_counts, 1);
    let mut category_allow_duplicates =
        normalize_allow_duplicates_array(&setting.category_allow_duplicates);

    for index in 0..EVENT_SETTING_CATEGORY_SLOT_COUNT {
        if item_list_snapshots[index].id.is_empty() {
            category_min_counts[index] = 0;
            category_max_counts[index] = 0;
            category_allow_duplicates[index] = false;
        } else if category_max_counts[index] < category_min_counts[index] {
            category_max_counts[index] = category_min_counts[index];
        }
    }

    let total_min_count = setting.total_min_count;
    let total_max_count = setting.total_max_count.max(total_min_count);

    EventManagementMeta {
        side_decision_method,
        item_list_snapshots,
        use_alias_name: setting.use_alias_name,
        category_min_counts,
        category_max_counts,
        category_allow_duplicates,
        total_min_count,
        total_max_count,
    }
}

fn derive_score_csv_from_slot_scores(
    slot_scores: &[crate::models::LocalSetScoreInput],
    winner_id: &str,
) -> Result<String, String> {
    if slot_scores.len() < 2 {
        return Err("プレイヤー別スコアが不足しています。".to_owned());
    }

    let winner_score = slot_scores
        .iter()
        .find(|slot| slot.entrant_id == winner_id)
        .ok_or_else(|| "winnerIdに対応するスコアが見つかりません。".to_owned())?
        .score;

    if winner_score < 0 {
        return Err("winnerのスコアにDQ(-1)は指定できません。".to_owned());
    }

    let loser_score = slot_scores
        .iter()
        .find(|slot| slot.entrant_id != winner_id)
        .ok_or_else(|| "敗者側スコアが見つかりません。".to_owned())?
        .score;

    if loser_score < 0 {
        return Ok(format!("{winner_score}-DQ"));
    }

    if winner_score == 0 && loser_score == 0 {
        return Err("scoreCsvは 0-0 以外を指定してください。".to_owned());
    }

    Ok(format!("{winner_score}-{loser_score}"))
}

#[cfg(test)]
fn normalize_score_csv(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(' ', "")
}

#[cfg(test)]
fn integer_score(value: Option<f64>) -> Option<i64> {
    let score = value?;
    let rounded = score.round();
    if (score - rounded).abs() > 0.000_001 {
        return None;
    }
    Some(rounded as i64)
}

#[cfg(test)]
fn derive_score_csv_from_snapshot_set(
    set: &crate::models::SetSnapshot,
    winner_id: &str,
) -> Option<String> {
    let winner_slot = set
        .slots
        .iter()
        .find(|slot| slot.entrant_id.as_deref() == Some(winner_id))?;
    let loser_slot = set.slots.iter().find(|slot| {
        slot.entrant_id.as_deref().is_some() && slot.entrant_id.as_deref() != Some(winner_id)
    })?;

    let winner_score = integer_score(winner_slot.score)?;
    let loser_score = integer_score(loser_slot.score)?;

    if loser_score < 0 {
        return Some(format!("{winner_score}-DQ"));
    }

    Some(format!("{winner_score}-{loser_score}"))
}

#[cfg(test)]
fn is_pending_result_matched_with_set(
    pending: &LocalSetResultMeta,
    set: &crate::models::SetSnapshot,
) -> bool {
    // スコアのみのdraftは、winner_idが空でも結果取り消しとは区別する。
    if pending.winner_id.trim().is_empty() {
        if pending.slot_scores.is_empty() {
            return set.winner_id.is_none();
        }
        return set.winner_id.is_none()
            && pending.slot_scores.iter().all(|pending_score| {
                set.slots
                    .iter()
                    .find(|slot| slot.entrant_id.as_deref() == Some(&pending_score.entrant_id))
                    .and_then(|slot| integer_score(slot.score))
                    == Some(pending_score.score)
            });
    }

    if set.winner_id.as_deref() != Some(pending.winner_id.as_str()) {
        return false;
    }

    let remote_score_csv = derive_score_csv_from_snapshot_set(set, &pending.winner_id);
    let Some(remote_score_csv) = remote_score_csv else {
        return false;
    };

    normalize_score_csv(&remote_score_csv) == normalize_score_csv(&pending.score_csv)
}

fn result_entrant_ids_match_set_roster(
    set: &SetSnapshot,
    winner_id: &str,
    score_entrant_ids: &[String],
) -> bool {
    let entrant_ids = set
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.as_deref())
        .collect::<HashSet<_>>();

    (winner_id.trim().is_empty() || entrant_ids.contains(winner_id))
        && score_entrant_ids
            .iter()
            .all(|entrant_id| entrant_ids.contains(entrant_id.as_str()))
}

fn phase_group_id_for_set<'a>(event: &'a EventSnapshot, set_id: &str) -> Option<&'a str> {
    let source_set_id = source_grand_final_set_id_from_virtual_reset_set_id(set_id)
        .unwrap_or_else(|| set_id.to_owned());
    let set = event.sets.iter().find(|set| set.set_id == source_set_id)?;

    let phase_group = set
        .phase_group_id
        .as_deref()
        .and_then(|phase_group_id| {
            event
                .phase_groups
                .iter()
                .find(|group| group.phase_group_id == phase_group_id)
        })
        .or_else(|| {
            event.phase_groups.iter().find(|group| {
                group.phase_order == set.phase_order
                    && group.display_identifier == set.phase_group_display_identifier
            })
        })
        .or_else(|| {
            event.phase_groups.iter().find(|group| {
                group.phase_name == set.phase_name
                    && group.display_identifier == set.phase_group_display_identifier
            })
        })?;

    Some(phase_group.phase_group_id.as_str())
}

fn score_edit_enabled_for_phase_group(
    event_meta: Option<&EventLocalMeta>,
    phase_group_id: &str,
) -> bool {
    event_meta.is_some_and(|meta| {
        meta.score_edit_enabled_phase_group_ids
            .iter()
            .any(|enabled_id| enabled_id == phase_group_id)
    })
}

fn external_score_report_is_applicable(
    event_meta: &EventLocalMeta,
    phase_group_id: &str,
    sender_user_id: &str,
    set_is_confirmed: bool,
) -> bool {
    !set_is_confirmed
        && !score_edit_enabled_for_phase_group(Some(event_meta), phase_group_id)
        && event_meta.external_editors.iter().any(|editor| {
            editor.phase_group_id == phase_group_id && editor.sender_user_id == sender_user_id
        })
}

#[cfg(test)]
mod score_edit_lock_tests {
    use super::*;

    #[test]
    fn legacy_event_meta_defaults_to_locked_and_only_explicitly_unlocked_pools_allow_scores() {
        let legacy_meta: EventLocalMeta = serde_json::from_value(serde_json::json!({
            "eventId": "event",
            "eventName": "Event",
            "entrants": []
        }))
        .expect("legacy event metadata should deserialize");
        assert!(legacy_meta.score_edit_enabled_phase_group_ids.is_empty());
        assert!(!score_edit_enabled_for_phase_group(
            Some(&legacy_meta),
            "pool-a"
        ));

        let mut updated_meta = legacy_meta;
        updated_meta
            .score_edit_enabled_phase_group_ids
            .push("pool-a".to_owned());
        assert!(score_edit_enabled_for_phase_group(
            Some(&updated_meta),
            "pool-a"
        ));
        assert!(!score_edit_enabled_for_phase_group(
            Some(&updated_meta),
            "pool-b"
        ));
        assert!(updated_meta
            .external_score_broadcast_phase_group_ids
            .is_empty());
    }

    #[test]
    fn external_score_report_requires_locked_pool_and_registered_sender() {
        let event_meta: EventLocalMeta = serde_json::from_value(serde_json::json!({
            "eventId": "event",
            "eventName": "Event",
            "entrants": [],
            "externalEditors": [{
                "phaseGroupId": "pool-a",
                "senderName": "External",
                "senderUserId": "12345678"
            }]
        }))
        .expect("event metadata should deserialize");

        assert!(external_score_report_is_applicable(
            &event_meta,
            "pool-a",
            "12345678",
            false
        ));
        assert!(!external_score_report_is_applicable(
            &event_meta,
            "pool-a",
            "87654321",
            false
        ));
        assert!(!external_score_report_is_applicable(
            &event_meta,
            "pool-a",
            "12345678",
            true
        ));
        let mut unlocked_meta = event_meta;
        unlocked_meta
            .score_edit_enabled_phase_group_ids
            .push("pool-a".to_owned());
        assert!(!external_score_report_is_applicable(
            &unlocked_meta,
            "pool-a",
            "12345678",
            false
        ));
    }

    #[test]
    fn set_lock_is_scoped_to_its_phase_group() {
        let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
            "tournamentId": "tournament",
            "slug": "tournament/slug",
            "name": "Tournament",
            "events": [{
                "eventId": "event",
                "name": "Event",
                "phaseGroups": [
                    { "phaseGroupId": "pool-a" },
                    { "phaseGroupId": "pool-b" }
                ],
                "sets": [
                    { "setId": "set-a", "phaseGroupId": "pool-a", "fullRoundText": "Round 1", "state": 1, "slots": [] },
                    { "setId": "set-b", "phaseGroupId": "pool-b", "fullRoundText": "Round 1", "state": 1, "slots": [] }
                ]
            }],
            "updatedAt": "2026-10-04T00:00:00Z"
        }))
        .expect("snapshot should deserialize");
        let mut local_meta = build_empty_meta("tournament/slug", "event");
        let workspace = TournamentWorkspace {
            snapshot,
            local_meta: local_meta.clone(),
        };
        assert!(is_set_score_edit_locked(&workspace, "event", "set-a"));

        local_meta.events[0]
            .score_edit_enabled_phase_group_ids
            .push("pool-a".to_owned());
        let workspace = TournamentWorkspace {
            snapshot: workspace.snapshot,
            local_meta,
        };
        assert!(!is_set_score_edit_locked(&workspace, "event", "set-a"));
        assert!(is_set_score_edit_locked(&workspace, "event", "set-b"));
    }
}

pub fn is_set_score_edit_locked(
    workspace: &TournamentWorkspace,
    event_id: &str,
    set_id: &str,
) -> bool {
    let Some(event) = workspace
        .snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
    else {
        return true;
    };
    let Some(phase_group_id) = phase_group_id_for_set(event, set_id) else {
        return true;
    };
    let event_meta = workspace
        .local_meta
        .events
        .iter()
        .find(|meta| meta.event_id == event_id);

    !score_edit_enabled_for_phase_group(event_meta, phase_group_id)
}

fn ensure_set_score_edit_enabled(
    local_meta: &TournamentLocalMeta,
    snapshot: &TournamentSnapshot,
    event_id: &str,
    set_id: &str,
) -> Result<(), String> {
    let event = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;
    let phase_group_id = phase_group_id_for_set(event, set_id)
        .ok_or_else(|| "プールを特定できないためスコアを変更できません。".to_owned())?;
    let event_meta = local_meta
        .events
        .iter()
        .find(|meta| meta.event_id == event_id);
    if !score_edit_enabled_for_phase_group(event_meta, phase_group_id) {
        return Err("このプールは編集ロック中のため、スコアを変更できません。".to_owned());
    }
    Ok(())
}

#[cfg(test)]
#[path = "storage/tests/result_entrant_roster_tests.rs"]
mod result_entrant_roster_tests;

fn opposite_side(side: crate::models::PlaySide) -> crate::models::PlaySide {
    match side {
        crate::models::PlaySide::OneP => crate::models::PlaySide::TwoP,
        crate::models::PlaySide::TwoP => crate::models::PlaySide::OneP,
    }
}

fn merge_snapshot_into_meta(
    snapshot: &TournamentSnapshot,
    event_id: &str,
    mut meta: TournamentLocalMeta,
) -> TournamentLocalMeta {
    meta.tournament_id = snapshot.tournament_id.clone();
    meta.slug = snapshot.slug.clone();
    meta.tournament_name = snapshot.name.clone();

    let event = snapshot
        .events
        .iter()
        .find(|item| item.event_id == event_id)
        .cloned()
        .unwrap_or_else(|| EventSnapshot {
            event_id: event_id.to_owned(),
            name: String::new(),
            phases: Vec::new(),
            phase_groups: Vec::new(),
            sets: Vec::new(),
        });
    let mut set_by_id = HashMap::with_capacity(event.sets.len());
    for set in &event.sets {
        set_by_id.entry(set.set_id.as_str()).or_insert(set);
    }
    meta.pending_set_results.retain(|pending| {
        if pending.event_id != event_id {
            return true;
        }
        let Some(set) = set_by_id.get(pending.set_id.as_str()) else {
            return false;
        };
        let score_entrant_ids = pending
            .slot_scores
            .iter()
            .map(|score| score.entrant_id.clone())
            .collect::<Vec<_>>();
        result_entrant_ids_match_set_roster(set, &pending.winner_id, &score_entrant_ids)
    });

    let event_index = if let Some(index) = meta
        .events
        .iter()
        .position(|item| item.event_id == event.event_id)
    {
        index
    } else {
        meta.events.push(EventLocalMeta {
            event_id: event.event_id.clone(),
            event_name: event.name.clone(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
        meta.events.len().saturating_sub(1)
    };

    let event_meta = meta
        .events
        .get_mut(event_index)
        .expect("event_index must refer to an existing event meta");
    event_meta.event_name = event.name.clone();

    let mut seen_entrant_ids = HashSet::new();
    let mut valid_set_slot_keys = HashSet::new();
    let mut entrant_index_by_id = HashMap::with_capacity(event_meta.entrants.len());
    for (index, entrant) in event_meta.entrants.iter().enumerate() {
        entrant_index_by_id
            .entry(entrant.entrant_id.clone())
            .or_insert(index);
    }

    for set in &event.sets {
        let set_id = set.set_id.clone();
        let keep_side_for_set = is_set_matchup_ready(set);
        for slot in &set.slots {
            let Some(entrant_id) = &slot.entrant_id else {
                continue;
            };

            if keep_side_for_set {
                valid_set_slot_keys.insert(format!("{}:{}", set_id, entrant_id));
            }

            if !seen_entrant_ids.insert(entrant_id.clone()) {
                continue;
            }

            if let Some(existing_index) = entrant_index_by_id.get(entrant_id).copied() {
                event_meta.entrants[existing_index].entrant_name = slot.entrant_name.clone();
                continue;
            }

            let entrant_index = event_meta.entrants.len();
            event_meta.entrants.push(EventEntrantMeta {
                entrant_id: entrant_id.clone(),
                entrant_name: slot.entrant_name.clone(),
                alias_name: String::new(),
                play_side: None,
                character_names: Vec::new(),
                auth_code: derive_auth_code(&snapshot.slug, &event.event_id, entrant_id),
                notes: None,
            });
            entrant_index_by_id.insert(entrant_id.clone(), entrant_index);
        }
    }

    let mut side_by_set_and_entrant = HashMap::new();
    for item in &meta.set_play_sides {
        if !valid_set_slot_keys.contains(&format!("{}:{}", item.set_id, item.entrant_id)) {
            continue;
        }
        side_by_set_and_entrant.insert(
            (item.set_id.clone(), item.entrant_id.clone()),
            item.play_side.clone(),
        );
    }

    let mut normalized_set_play_sides = Vec::new();
    for set in &event.sets {
        if !is_set_matchup_ready(set) {
            continue;
        }

        if set.slots.len() < 2 {
            continue;
        }

        let Some(upper_id) = set.slots.get(0).and_then(|slot| slot.entrant_id.clone()) else {
            continue;
        };
        let Some(lower_id) = set.slots.get(1).and_then(|slot| slot.entrant_id.clone()) else {
            continue;
        };

        let upper_side = side_by_set_and_entrant
            .get(&(set.set_id.clone(), upper_id.clone()))
            .cloned();
        let lower_side = side_by_set_and_entrant
            .get(&(set.set_id.clone(), lower_id.clone()))
            .cloned();

        let resolved_upper = match (upper_side, lower_side) {
            (Some(upper), Some(lower)) if upper == opposite_side(lower.clone()) => Some(upper),
            (Some(upper), Some(_)) => Some(upper),
            (Some(upper), None) => Some(upper),
            (None, Some(lower)) => Some(opposite_side(lower)),
            (None, None) => None,
        };

        if let Some(upper) = resolved_upper {
            let lower = opposite_side(upper.clone());
            normalized_set_play_sides.push(SetPlaySideMeta {
                set_id: set.set_id.clone(),
                entrant_id: upper_id,
                play_side: upper,
            });
            normalized_set_play_sides.push(SetPlaySideMeta {
                set_id: set.set_id.clone(),
                entrant_id: lower_id,
                play_side: lower,
            });
        }
    }
    meta.set_play_sides = normalized_set_play_sides;

    meta.updated_at = Utc::now();
    meta
}

pub fn save_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = token_path(app)?;
    fs::write(path, token.trim()).map_err(|e| format!("トークン保存に失敗しました: {e}"))
}

pub fn save_slug(app: &AppHandle, slug: &str) -> Result<(), String> {
    let path = slug_path(app)?;
    fs::write(path, slug.trim()).map_err(|e| format!("slug保存に失敗しました: {e}"))
}

pub fn load_slug(app: &AppHandle) -> Result<Option<String>, String> {
    let path = slug_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("slug読込に失敗しました: {e}"))?;
    let trimmed = raw.trim().to_owned();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

pub fn load_saved_token(app: &AppHandle) -> Result<Option<String>, String> {
    let path = token_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw =
        fs::read_to_string(path).map_err(|e| format!("保存済みトークン読込に失敗しました: {e}"))?;
    let trimmed = raw.trim().to_owned();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

pub fn save_last_snapshot_selection(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    phase_name: Option<&str>,
    phase_group_name: Option<&str>,
) -> Result<(), String> {
    let path = last_snapshot_selection_path(app)?;
    let payload = LastSnapshotSelection {
        slug: slug.trim().to_owned(),
        event_id: event_id.trim().to_owned(),
        phase_name: phase_name
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        phase_group_name: phase_group_name
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
    };

    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("最後の選択スナップショットJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("最後の選択スナップショット保存に失敗しました: {e}"))
}

pub fn load_last_snapshot_selection(
    app: &AppHandle,
) -> Result<Option<LastSnapshotSelection>, String> {
    let path = last_snapshot_selection_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("最後の選択スナップショット読込に失敗しました: {e}"))?;
    let payload = serde_json::from_str::<LastSnapshotSelection>(&raw)
        .map_err(|e| format!("最後の選択スナップショットのパースに失敗しました: {e}"))?;

    if payload.slug.trim().is_empty() || payload.event_id.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(payload))
}

pub fn save_item_lists(app: &AppHandle, item_lists: &[ItemListConfig]) -> Result<(), String> {
    let path = item_lists_path(app)?;
    let json = serde_json::to_string_pretty(item_lists)
        .map_err(|e| format!("アイテムリストのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("アイテムリスト保存に失敗しました: {e}"))
}

pub fn load_item_lists(app: &AppHandle) -> Result<Option<Vec<ItemListConfig>>, String> {
    let path = item_lists_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("保存済みアイテムリスト読込に失敗しました: {e}"))?;
    let item_lists = serde_json::from_str::<Vec<ItemListConfig>>(&raw)
        .map_err(|e| format!("保存済みアイテムリストのパースに失敗しました: {e}"))?;
    Ok(Some(item_lists))
}

pub fn save_event_mgmt_settings(
    app: &AppHandle,
    settings: &serde_json::Value,
) -> Result<(), String> {
    let path = event_mgmt_path(app)?;
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("大会設定のJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("大会設定保存に失敗しました: {e}"))
}

pub fn load_event_mgmt_settings(app: &AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = event_mgmt_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw =
        fs::read_to_string(path).map_err(|e| format!("保存済み大会設定読込に失敗しました: {e}"))?;
    let settings = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("保存済み大会設定のパースに失敗しました: {e}"))?;
    Ok(Some(settings))
}

pub fn save_sender_profile(app: &AppHandle, profile: &SenderProfile) -> Result<(), String> {
    let path = sender_profile_path(app)?;
    let sender_name = profile.sender_name.trim();
    if sender_name.is_empty() {
        return Err("送信者名を入力してください。".to_owned());
    }

    let sender_user_id = profile.sender_user_id.trim();
    if sender_user_id.len() != 8 || !sender_user_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("ユーザーIDは8桁の数字で入力してください。".to_owned());
    }

    let bind_ip = profile.bind_ip.trim();
    if bind_ip.parse::<std::net::Ipv4Addr>().is_err() {
        return Err("自分のIPはIPv4形式で入力してください。例: 192.168.1.10".to_owned());
    }

    let broadcast_subnet_mask = profile.broadcast_subnet_mask.trim();
    if broadcast_subnet_mask.parse::<std::net::Ipv4Addr>().is_err() {
        return Err(
            "ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0"
                .to_owned(),
        );
    }

    let normalized = SenderProfile {
        sender_name: sender_name.to_owned(),
        sender_user_id: sender_user_id.to_owned(),
        bind_ip: bind_ip.to_owned(),
        broadcast_subnet_mask: broadcast_subnet_mask.to_owned(),
    };

    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("送信者設定のJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("送信者設定保存に失敗しました: {e}"))
}

pub fn load_sender_profile(app: &AppHandle) -> Result<Option<SenderProfile>, String> {
    let path = sender_profile_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("送信者設定読込に失敗しました: {e}"))?;
    let profile = serde_json::from_str::<SenderProfile>(&raw)
        .map_err(|e| format!("送信者設定のパースに失敗しました: {e}"))?;
    Ok(Some(profile))
}

pub fn save_generic_messages(app: &AppHandle, messages: &[GenericMessage]) -> Result<(), String> {
    let path = generic_messages_path(app)?;
    let json = serde_json::to_string_pretty(messages)
        .map_err(|e| format!("メッセージのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("メッセージ保存に失敗しました: {e}"))
}

#[derive(Debug, Clone)]
struct CallMessageIdentity {
    event_id: String,
    set_id: String,
    player_id: String,
}

fn message_meta_string(meta: &serde_json::Value, key: &str) -> String {
    meta.get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_owned())
        .unwrap_or_default()
}

fn call_message_identity(message: &GenericMessage) -> Option<CallMessageIdentity> {
    let meta = message.message_meta.as_ref()?;

    let set_id = message_meta_string(meta, "setId");
    let player_id = message_meta_string(meta, "playerId").to_ascii_uppercase();
    let event_id = {
        let scoped = message_meta_string(meta, "scopeEventId");
        if !scoped.is_empty() {
            scoped
        } else {
            message_meta_string(meta, "eventId")
        }
    };

    if event_id.is_empty() || set_id.is_empty() || player_id.is_empty() {
        return None;
    }

    Some(CallMessageIdentity {
        event_id,
        set_id,
        player_id,
    })
}

fn call_identity_matches(left: &CallMessageIdentity, right: &CallMessageIdentity) -> bool {
    left.event_id == right.event_id
        && left.set_id == right.set_id
        && left.player_id == right.player_id
}

fn build_forced_resolve_message(root: &GenericMessage) -> GenericMessage {
    let message_id = format!(
        "{}-forced-resolve-{}",
        root.message_id,
        Utc::now().timestamp_millis()
    );

    GenericMessage {
        message_id,
        thread_id: root.thread_id.clone(),
        parent_message_id: Some(root.message_id.clone()),
        message_type: "resolve".to_owned(),
        message_meta: root.message_meta.clone(),
        method: root.method.clone(),
        subject: format!("Resolved: {}", root.subject),
        sender_name: root.sender_name.clone(),
        sender_user_id: root.sender_user_id.clone(),
        sender_ip: root.sender_ip.clone(),
        body: "同一呼び出しを再受信したため、自動的に解決しました。".to_owned(),
        created_at: Utc::now().to_rfc3339(),
    }
}

fn is_same_message_identity(left: &GenericMessage, right: &GenericMessage) -> bool {
    // Message identity is message_id only; sender IP changes must not affect equality.
    left.message_id == right.message_id
}

fn collect_duplicate_unresolved_call_roots(
    messages: &[GenericMessage],
    identity: &CallMessageIdentity,
) -> Vec<GenericMessage> {
    messages
        .iter()
        .filter(|item| {
            item.parent_message_id.is_none()
                && item.method == "call_player"
                && call_message_identity(item)
                    .map(|item_identity| call_identity_matches(&item_identity, identity))
                    .unwrap_or(false)
        })
        .filter(|root| {
            !messages
                .iter()
                .any(|item| item.thread_id == root.thread_id && item.message_type == "resolve")
        })
        .cloned()
        .collect()
}

pub fn append_generic_message(app: &AppHandle, message: &GenericMessage) -> Result<(), String> {
    let mut messages = load_generic_messages(app)?.unwrap_or_default();

    if message.message_type == "resolve" && message.method == "call_player" {
        let root = messages.iter().find(|item| {
            item.thread_id == message.thread_id
                && item.parent_message_id.is_none()
                && item.method == "call_player"
        });

        let Some(root) = root else {
            // 未知の呼び出しスレッドに対する解決メッセージは取り込まない。
            return Ok(());
        };

        let Some(root_identity) = call_message_identity(root) else {
            return Ok(());
        };
        let Some(resolve_identity) = call_message_identity(message) else {
            return Ok(());
        };
        if !call_identity_matches(&root_identity, &resolve_identity) {
            return Ok(());
        }
    }

    if message.message_type == "normal"
        && message.parent_message_id.is_none()
        && message.method == "call_player"
    {
        if let Some(call_identity) = call_message_identity(message) {
            let matching_roots = collect_duplicate_unresolved_call_roots(&messages, &call_identity);

            for root in matching_roots {
                messages.push(build_forced_resolve_message(&root));
            }
        }
    }

    if let Some(index) = messages
        .iter()
        .position(|item| is_same_message_identity(item, message))
    {
        messages[index] = message.clone();
    } else {
        messages.push(message.clone());
    }

    messages.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    save_generic_messages(app, &messages)
}

#[cfg(test)]
#[path = "storage/tests/call_message_identity_tests.rs"]
mod call_message_identity_tests;

pub fn load_generic_messages(app: &AppHandle) -> Result<Option<Vec<GenericMessage>>, String> {
    let path = generic_messages_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("保存済みメッセージ読込に失敗しました: {e}"))?;

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("保存済みメッセージのパースに失敗しました: {e}"))?;

    let mut messages = Vec::new();
    let Some(items) = value.as_array() else {
        return Ok(Some(messages));
    };

    for item in items {
        let message_id = item
            .get("messageId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();
        if message_id.is_empty() {
            continue;
        }

        let method = item
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("generic")
            .trim()
            .to_owned();
        let message_type_raw = item
            .get("messageType")
            .and_then(|v| v.as_str())
            .unwrap_or("normal")
            .trim()
            .to_ascii_lowercase();
        let message_type = if message_type_raw == "resolve" {
            "resolve".to_owned()
        } else {
            "normal".to_owned()
        };
        let subject = item
            .get("subject")
            .and_then(|v| v.as_str())
            .unwrap_or("汎用メッセージ")
            .trim()
            .to_owned();
        let sender_name = item
            .get("senderName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();
        let sender_user_id = item
            .get("senderUserId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();
        let sender_ip = item
            .get("senderIp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();
        let body = item
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();
        let created_at = item
            .get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();

        if sender_name.is_empty()
            || sender_user_id.is_empty()
            || body.is_empty()
            || created_at.is_empty()
        {
            continue;
        }

        let parent_message_id = item
            .get("parentMessageId")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty());
        let message_meta = item.get("messageMeta").cloned();
        let thread_id = item
            .get("threadId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();

        let resolved_thread_id = if thread_id.is_empty() {
            message_id.clone()
        } else {
            thread_id
        };

        messages.push(GenericMessage {
            message_id,
            thread_id: resolved_thread_id,
            parent_message_id,
            message_type,
            message_meta,
            method,
            subject,
            sender_name,
            sender_user_id,
            sender_ip,
            body,
            created_at,
        });
    }

    messages.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(Some(messages))
}

pub fn load_mobile_result_requests(
    app: &AppHandle,
) -> Result<Vec<MobileResultRequestItem>, String> {
    let path = mobile_result_requests_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("結果入力依頼キューの読込に失敗しました: {e}"))?;

    let mut items = serde_json::from_str::<Vec<MobileResultRequestItem>>(&raw)
        .map_err(|e| format!("結果入力依頼キューのパースに失敗しました: {e}"))?;

    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(items)
}

pub fn save_mobile_result_requests(
    app: &AppHandle,
    items: &[MobileResultRequestItem],
) -> Result<(), String> {
    let path = mobile_result_requests_path(app)?;
    let json = serde_json::to_string_pretty(items)
        .map_err(|e| format!("結果入力依頼キューのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("結果入力依頼キューの保存に失敗しました: {e}"))
}

pub fn append_mobile_result_request(
    app: &AppHandle,
    input: MobileResultRequestInput,
) -> Result<MobileResultRequestItem, String> {
    let slug = input.slug.trim().to_owned();
    let event_id = input.event_id.trim().to_owned();
    let set_id = input.set_id.trim().to_owned();

    if slug.is_empty() || event_id.is_empty() || set_id.is_empty() {
        return Err("slug, eventId, setId は必須です。".to_owned());
    }

    let winner_id = input
        .winner_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    let requested_by = input
        .requested_by
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    let note = input
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    let slot_scores = input
        .slot_scores
        .iter()
        .map(|item| LocalSetScoreMeta {
            entrant_id: item.entrant_id.trim().to_owned(),
            score: item.score,
        })
        .filter(|item| !item.entrant_id.is_empty())
        .collect::<Vec<LocalSetScoreMeta>>();

    let mut items = load_mobile_result_requests(app)?;
    let timestamp = Utc::now();
    let request_id = format!(
        "req-{}-{}",
        timestamp.timestamp_millis(),
        items.len().saturating_add(1)
    );

    let next_item = MobileResultRequestItem {
        request_id,
        slug,
        event_id,
        set_id,
        winner_id,
        slot_scores,
        requested_by,
        note,
        status: "pending".to_owned(),
        created_at: timestamp,
    };

    items.push(next_item.clone());
    save_mobile_result_requests(app, &items)?;
    Ok(next_item)
}

pub fn load_token(app: &AppHandle) -> Result<String, String> {
    let mut candidate_paths = Vec::new();
    candidate_paths.push(token_path(app)?);

    // 暫定対応: 実行ディレクトリ配下の token.txt からも読めるようにする。
    if let Ok(current_dir) = std::env::current_dir() {
        candidate_paths.push(current_dir.join(TEMP_TOKEN_FILE));
        if let Some(parent) = current_dir.parent() {
            candidate_paths.push(parent.join(TEMP_TOKEN_FILE));
        }
    }

    for path in candidate_paths {
        if !path.exists() {
            continue;
        }

        match fs::read_to_string(&path) {
            Ok(token) => {
                let trimmed = token.trim().to_owned();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
            Err(_) => continue,
        }
    }

    Err(
        "トークンの読込に失敗しました。保存済みトークン、またはtoken.txtを確認してください。"
            .to_owned(),
    )
}

pub fn save_snapshot(app: &AppHandle, snapshot: &TournamentSnapshot) -> Result<(), String> {
    invalidate_progression_cache(&snapshot.slug);
    let normalized_slug = normalize_slug_for_storage(&snapshot.slug);
    for event in &snapshot.events {
        save_event_graph_file(
            app,
            &build_bracket_graph(snapshot, event),
            &snapshot.tournament_id,
            &normalized_slug,
            &event.event_id,
            &event.name,
        )?;
    }

    remove_stale_event_graph_files(
        app,
        &snapshot.tournament_id,
        &normalized_slug,
        &snapshot.events,
    )?;
    Ok(())
}

fn save_event_graph_snapshot(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    event_id: &str,
) -> Result<(), String> {
    let started_at = Instant::now();
    let event = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("ブラケットgraph保存対象のイベントがありません: {event_id}"))?;
    let normalized_slug = normalize_slug_for_storage(&snapshot.slug);
    let build_started_at = Instant::now();
    let graph = build_bracket_graph(snapshot, event);
    let build_elapsed_us = build_started_at.elapsed().as_micros();
    let set_count = graph.event.sets.len();
    save_event_graph_file(
        app,
        &graph,
        &snapshot.tournament_id,
        &normalized_slug,
        &event.event_id,
        &event.name,
    )?;
    storage_perf_log(|| {
        format!(
            "save_event_graph_snapshot event={} sets={} build_us={} total_us={}",
            event_id,
            set_count,
            build_elapsed_us,
            started_at.elapsed().as_micros()
        )
    });
    Ok(())
}

type ProgressionCandidatesBySeed<'a> =
    HashMap<&'a str, Vec<(&'a crate::models::SetSnapshot, &'static str)>>;
type ProgressionCandidatesByGroupAndSeed<'a> =
    HashMap<String, HashMap<String, Vec<(&'a crate::models::SetSnapshot, &'static str)>>>;
type ProgressionCandidatesByGroupSeedAndRound<'a> =
    HashMap<String, HashMap<String, HashMap<i64, (&'a crate::models::SetSnapshot, &'static str)>>>;
type WinnersToLosersRoundMap = HashMap<String, HashMap<i64, HashSet<i64>>>;

fn build_bracket_graph(
    snapshot: &TournamentSnapshot,
    event: &EventSnapshot,
) -> BracketGraphSnapshot {
    let started_at = Instant::now();
    let phase_group_key = graph_phase_group_key;

    let phase_group_has_set_ids = event
        .phase_groups
        .iter()
        .any(|phase_group| !phase_group.set_ids.is_empty());
    let phase_group_set_ids = event
        .phase_groups
        .iter()
        .flat_map(|phase_group| phase_group.set_ids.iter().map(String::as_str))
        .collect::<HashSet<_>>();
    let intermediate_set_ids = event
        .sets
        .iter()
        .filter(|set| {
            if phase_group_has_set_ids {
                !phase_group_set_ids.contains(set.set_id.as_str())
            } else {
                set.is_intermediate
            }
        })
        .map(|set| set.set_id.as_str())
        .collect::<HashSet<_>>();
    let mut event_set_by_id = HashMap::new();
    let mut group_key_by_set_id = HashMap::new();
    let mut phase_group_sets_by_key_and_round =
        HashMap::<String, HashMap<i64, Vec<&crate::models::SetSnapshot>>>::new();
    let mut progression_candidates_by_seed = ProgressionCandidatesBySeed::new();
    let mut progression_candidates_by_group_and_seed = ProgressionCandidatesByGroupAndSeed::new();
    let mut progression_candidates_by_group_seed_and_round =
        ProgressionCandidatesByGroupSeedAndRound::new();
    for set in &event.sets {
        let group_key = phase_group_key(set);
        event_set_by_id.entry(set.set_id.as_str()).or_insert(set);
        group_key_by_set_id
            .entry(set.set_id.as_str())
            .or_insert_with(|| group_key.clone());
        if let Some(round) = bracket_round(set) {
            phase_group_sets_by_key_and_round
                .entry(group_key.clone())
                .or_default()
                .entry(round)
                .or_default()
                .push(set);
        }

        let group_candidates = progression_candidates_by_group_and_seed
            .entry(group_key.clone())
            .or_default();
        for (seed_id, relation) in [
            (set.winner_progression_seed_id.as_deref(), "winner"),
            (set.loser_progression_seed_id.as_deref(), "loser"),
        ] {
            let Some(seed_id) = seed_id else {
                continue;
            };
            progression_candidates_by_seed
                .entry(seed_id)
                .or_default()
                .push((set, relation));
            group_candidates
                .entry(seed_id.to_owned())
                .or_default()
                .push((set, relation));
            if relation == "winner" {
                if let Some(round) = bracket_round(set) {
                    progression_candidates_by_group_seed_and_round
                        .entry(group_key.clone())
                        .or_default()
                        .entry(seed_id.to_owned())
                        .or_default()
                        .entry(round)
                        .or_insert((set, relation));
                }
            }
        }
    }
    let winners_to_losers_rounds_by_group = build_winners_to_losers_round_map(
        event,
        &event_set_by_id,
        &intermediate_set_ids,
        &progression_candidates_by_seed,
        &phase_group_sets_by_key_and_round,
    );

    let mut graph_event = event.clone();
    for set in &mut graph_event.sets {
        set.is_intermediate = intermediate_set_ids.contains(set.set_id.as_str());
    }
    graph_event.sets.retain(|set| !set.is_intermediate);
    let mut seen_phase_group_ids = HashSet::new();
    graph_event
        .phase_groups
        .retain(|phase_group| seen_phase_group_ids.insert(phase_group.phase_group_id.clone()));

    let mut set_name_by_id = HashMap::new();
    let mut phase_group_sets = HashMap::<String, Vec<crate::models::SetSnapshot>>::new();
    for set in &graph_event.sets {
        let group_key = phase_group_key(set);
        phase_group_sets
            .entry(group_key)
            .or_default()
            .push(set.clone());
    }

    for sets in phase_group_sets.into_values() {
        let group_event = EventSnapshot {
            event_id: graph_event.event_id.clone(),
            name: graph_event.name.clone(),
            phases: Vec::new(),
            phase_groups: Vec::new(),
            sets,
        };
        for (set_id, set_name) in build_set_display_code_by_id(&group_event) {
            set_name_by_id.insert(set_id, set_name);
        }
    }

    for set in &mut graph_event.sets {
        set.phase_group_set_name = set
            .identifier
            .clone()
            .or_else(|| set_name_by_id.get(&set.set_id).cloned());

        let target_for_source_resolution = set.clone();
        rewrite_progression_source(
            &mut set.entrant1_source,
            &target_for_source_resolution,
            event,
            &set_name_by_id,
            &progression_candidates_by_group_and_seed,
            &progression_candidates_by_group_seed_and_round,
            &progression_candidates_by_seed,
            &winners_to_losers_rounds_by_group,
        );
        rewrite_progression_source(
            &mut set.entrant2_source,
            &target_for_source_resolution,
            event,
            &set_name_by_id,
            &progression_candidates_by_group_and_seed,
            &progression_candidates_by_group_seed_and_round,
            &progression_candidates_by_seed,
            &winners_to_losers_rounds_by_group,
        );
        rewrite_intermediate_source(
            &mut set.entrant1_source,
            &target_for_source_resolution,
            &set_name_by_id,
            &event_set_by_id,
            &intermediate_set_ids,
            &progression_candidates_by_seed,
            &winners_to_losers_rounds_by_group,
        );
        rewrite_intermediate_source(
            &mut set.entrant2_source,
            &target_for_source_resolution,
            &set_name_by_id,
            &event_set_by_id,
            &intermediate_set_ids,
            &progression_candidates_by_seed,
            &winners_to_losers_rounds_by_group,
        );
    }

    let mut graph_event_set_by_id = HashMap::new();
    for set in &graph_event.sets {
        graph_event_set_by_id
            .entry(set.set_id.as_str())
            .or_insert(set);
    }
    let mut raw_edges = Vec::new();
    for target in &event.sets {
        let target_phase_group_key = phase_group_key(target);
        let edge_target = graph_event_set_by_id
            .get(target.set_id.as_str())
            .copied()
            .unwrap_or(target);

        for (target_slot_index, source) in [
            edge_target.entrant1_source.as_ref(),
            edge_target.entrant2_source.as_ref(),
        ]
        .into_iter()
        .enumerate()
        {
            let Some(source) = source else {
                continue;
            };
            let Some(source_set_id) = resolved_source_set_id(source) else {
                continue;
            };
            let progression_source_id = source.type_id.as_deref().unwrap_or(source_set_id);

            let progression_candidate = progression_candidate_for_target(
                event,
                target,
                progression_source_id,
                &progression_candidates_by_group_and_seed,
                &progression_candidates_by_group_seed_and_round,
                &progression_candidates_by_seed,
                &winners_to_losers_rounds_by_group,
            );

            if let Some((candidate, relation)) = progression_candidate {
                if !is_allowed_round_transition(
                    candidate,
                    target,
                    relation,
                    &winners_to_losers_rounds_by_group,
                ) {
                    continue;
                }
                let progression_id = match relation {
                    "winner" => candidate.winner_progression_id.clone(),
                    "loser" => candidate.loser_progression_id.clone(),
                    _ => None,
                };
                raw_edges.push(BracketGraphEdge {
                    from_set_id: candidate.set_id.clone(),
                    to_set_id: target.set_id.clone(),
                    target_slot_index,
                    relation: relation.to_owned(),
                    progression_id,
                });
                continue;
            }

            if let Some(resolved_edges) = resolve_hidden_source_edges(
                source_set_id,
                &event_set_by_id,
                &intermediate_set_ids,
                &progression_candidates_by_seed,
            ) {
                for (from_set_id, relation) in resolved_edges {
                    if event_set_by_id
                        .get(from_set_id.as_str())
                        .is_some_and(|candidate| {
                            !is_allowed_round_transition(
                                candidate,
                                target,
                                &relation,
                                &winners_to_losers_rounds_by_group,
                            )
                        })
                    {
                        continue;
                    }
                    raw_edges.push(BracketGraphEdge {
                        from_set_id,
                        to_set_id: target.set_id.clone(),
                        target_slot_index,
                        relation,
                        progression_id: None,
                    });
                }
                continue;
            }

            if let Some(candidate) = event_set_by_id.get(source_set_id).filter(|candidate| {
                group_key_by_set_id
                    .get(candidate.set_id.as_str())
                    .is_some_and(|group_key| group_key == &target_phase_group_key)
            }) {
                if let Some(relation) = source.condition.as_deref() {
                    let relation = relation.to_ascii_lowercase();
                    if !is_allowed_round_transition(
                        candidate,
                        target,
                        &relation,
                        &winners_to_losers_rounds_by_group,
                    ) {
                        continue;
                    }
                    raw_edges.push(BracketGraphEdge {
                        from_set_id: candidate.set_id.clone(),
                        to_set_id: target.set_id.clone(),
                        target_slot_index,
                        relation,
                        progression_id: None,
                    });
                }
            }
        }
    }

    let mut raw_edge_target_slots = raw_edges
        .iter()
        .map(|edge: &BracketGraphEdge| (edge.to_set_id.clone(), edge.target_slot_index))
        .collect::<HashSet<_>>();
    for group_rounds in phase_group_sets_by_key_and_round.values() {
        let Some(first_losers_round) = group_rounds
            .iter()
            .filter(|(round, sets)| **round < 0 && sets.iter().any(|set| is_losers_set(set)))
            .map(|(round, _)| *round)
            .max()
        else {
            continue;
        };
        let Some(first_winners_round) = group_rounds
            .iter()
            .filter(|(round, sets)| {
                **round > 0
                    && sets
                        .iter()
                        .any(|set| !is_losers_set(set) && !is_grand_final_set(set))
            })
            .map(|(round, _)| *round)
            .min()
        else {
            continue;
        };

        let mut winners_first_ids = group_rounds
            .get(&first_winners_round)
            .into_iter()
            .flatten()
            .filter(|set| !is_losers_set(set) && !is_grand_final_set(set))
            .map(|set| set.set_id.clone())
            .collect::<Vec<_>>();
        let mut losers_first_ids = group_rounds
            .get(&first_losers_round)
            .into_iter()
            .flatten()
            .filter(|set| is_losers_set(set))
            .map(|set| set.set_id.clone())
            .collect::<Vec<_>>();
        winners_first_ids.sort();
        losers_first_ids.sort();

        for (target_index, target_set_id) in losers_first_ids.iter().enumerate() {
            let source_ids =
                pick_pair_source_ids(&winners_first_ids, losers_first_ids.len(), target_index);
            for (target_slot_index, source_set_id) in source_ids.into_iter().enumerate() {
                if raw_edge_target_slots.contains(&(target_set_id.clone(), target_slot_index)) {
                    continue;
                }
                raw_edges.push(BracketGraphEdge {
                    from_set_id: source_set_id,
                    to_set_id: target_set_id.clone(),
                    target_slot_index,
                    relation: "loser".to_owned(),
                    progression_id: None,
                });
                raw_edge_target_slots.insert((target_set_id.clone(), target_slot_index));
            }
        }
    }

    let mut incoming_raw_edge_indexes = HashMap::<&str, Vec<usize>>::new();
    for (edge_index, edge) in raw_edges.iter().enumerate() {
        incoming_raw_edge_indexes
            .entry(edge.to_set_id.as_str())
            .or_default()
            .push(edge_index);
    }
    let hidden_pipe_source_slot_indexes_by_set_id = event
        .sets
        .iter()
        .filter(|set| intermediate_set_ids.contains(set.set_id.as_str()))
        .map(|set| (set.set_id.as_str(), hidden_pipe_source_slot_indexes(set)))
        .collect::<HashMap<_, _>>();

    let mut edges = Vec::new();
    let mut seen_edges = HashSet::new();
    for raw_edge in &raw_edges {
        if intermediate_set_ids.contains(raw_edge.to_set_id.as_str()) {
            continue;
        }

        let mut pending_sources = vec![(raw_edge.from_set_id.clone(), raw_edge.relation.clone())];
        let mut visited = HashSet::new();

        while let Some((source_set_id, relation)) = pending_sources.pop() {
            if !visited.insert((source_set_id.clone(), relation.clone())) {
                continue;
            }

            if intermediate_set_ids.contains(source_set_id.as_str()) {
                let slot_indexes = hidden_pipe_source_slot_indexes_by_set_id
                    .get(source_set_id.as_str())
                    .and_then(Option::as_ref);
                for incoming_index in incoming_raw_edge_indexes
                    .get(source_set_id.as_str())
                    .into_iter()
                    .flatten()
                {
                    let incoming = &raw_edges[*incoming_index];
                    if slot_indexes.is_some_and(|slot_indexes| {
                        !slot_indexes.contains(&incoming.target_slot_index)
                    }) {
                        continue;
                    }
                    pending_sources.push((incoming.from_set_id.clone(), incoming.relation.clone()));
                }
                continue;
            }

            let edge_key = (
                source_set_id.clone(),
                raw_edge.to_set_id.clone(),
                raw_edge.target_slot_index,
                relation.clone(),
            );
            if seen_edges.insert(edge_key) {
                edges.push(BracketGraphEdge {
                    from_set_id: source_set_id,
                    to_set_id: raw_edge.to_set_id.clone(),
                    target_slot_index: raw_edge.target_slot_index,
                    relation,
                    progression_id: raw_edge.progression_id.clone(),
                });
            }
        }
    }

    let phase_group_seeds = graph_event
        .phase_groups
        .iter()
        .flat_map(|group| {
            group.seeds.iter().map(|seed| PhaseGroupGraphSeedSnapshot {
                phase_group_id: group.phase_group_id.clone(),
                seed_id: seed.seed_id.clone(),
                seed_num: seed.seed_num,
                origin_phase_order: seed.origin_phase_order,
                origin_phase_group_display_identifier: seed
                    .origin_phase_group_display_identifier
                    .clone(),
                origin_placement: seed.origin_placement,
                origin_order: seed.origin_order,
                entrant_id: seed.entrant_id.clone(),
                entrant_name: seed.entrant_name.clone(),
                placeholder_name: seed.placeholder_name.clone(),
            })
        })
        .collect();

    storage_perf_log(|| {
        format!(
            "build_bracket_graph event={} sets={} raw_edges={} edges={} elapsed_us={}",
            event.event_id,
            event.sets.len(),
            raw_edges.len(),
            edges.len(),
            started_at.elapsed().as_micros()
        )
    });

    BracketGraphSnapshot {
        schema_version: 1,
        tournament_id: snapshot.tournament_id.clone(),
        slug: snapshot.slug.clone(),
        tournament_name: snapshot.name.clone(),
        event: graph_event,
        phase_group_seeds,
        edges,
        updated_at: snapshot.updated_at,
    }
}

fn build_winners_to_losers_round_map(
    event: &EventSnapshot,
    sets_by_id: &HashMap<&str, &crate::models::SetSnapshot>,
    intermediate_set_ids: &HashSet<&str>,
    progression_candidates_by_seed: &ProgressionCandidatesBySeed<'_>,
    phase_group_sets_by_key_and_round: &HashMap<
        String,
        HashMap<i64, Vec<&crate::models::SetSnapshot>>,
    >,
) -> WinnersToLosersRoundMap {
    let mut winners_to_losers_rounds = WinnersToLosersRoundMap::new();
    for target in &event.sets {
        if !is_losers_set(target) || is_round_transition_exception(target) {
            continue;
        }
        if target.round.and_then(i64::checked_abs).is_none() {
            continue;
        }

        for source in [
            target.entrant1_source.as_ref(),
            target.entrant2_source.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(source_set_id) = resolved_source_set_id(source) {
                if let Some(resolved_edges) = resolve_hidden_source_edges(
                    source_set_id,
                    sets_by_id,
                    intermediate_set_ids,
                    progression_candidates_by_seed,
                ) {
                    for (from_set_id, relation) in resolved_edges {
                        if let Some(source_set) = sets_by_id.get(from_set_id.as_str()) {
                            record_winners_to_losers_round_mapping(
                                &mut winners_to_losers_rounds,
                                source_set,
                                target,
                                &relation,
                            );
                        }
                    }
                } else if let Some(relation) = source_kind_from_api_source(source) {
                    if let Some(source_set) = sets_by_id.get(source_set_id) {
                        record_winners_to_losers_round_mapping(
                            &mut winners_to_losers_rounds,
                            source_set,
                            target,
                            relation,
                        );
                    }
                }
            }

            if source.source_type.as_deref() == Some("seed") {
                if let Some(seed_id) = source.type_id.as_deref() {
                    let candidates = progression_candidates_by_seed
                        .get(seed_id)
                        .into_iter()
                        .flatten()
                        .filter(|(source_set, relation)| {
                            *relation == "loser"
                                && !is_losers_set(source_set)
                                && graph_phase_group_key(source_set)
                                    == graph_phase_group_key(target)
                                && !is_round_transition_exception(source_set)
                        })
                        .collect::<Vec<_>>();
                    let source_rounds = candidates
                        .iter()
                        .filter_map(|(source_set, _)| source_set.round.and_then(i64::checked_abs))
                        .collect::<HashSet<_>>();
                    if source_rounds.len() == 1 {
                        if let Some((source_set, relation)) = candidates.first() {
                            record_winners_to_losers_round_mapping(
                                &mut winners_to_losers_rounds,
                                source_set,
                                target,
                                relation,
                            );
                        }
                    }
                }
            }
        }
    }

    for (group_key, rounds) in phase_group_sets_by_key_and_round {
        let first_losers_round = rounds
            .iter()
            .filter(|(round, sets)| {
                **round < 0
                    && sets
                        .iter()
                        .any(|set| is_losers_set(set) && !is_round_transition_exception(set))
            })
            .map(|(round, _)| *round)
            .max();
        let first_winners_round = rounds
            .iter()
            .filter(|(round, sets)| {
                **round > 0
                    && sets.iter().any(|set| {
                        !is_losers_set(set)
                            && !is_grand_final_set(set)
                            && !is_round_transition_exception(set)
                    })
            })
            .map(|(round, _)| *round)
            .min();
        if let (Some(winners_round), Some(losers_round)) = (first_winners_round, first_losers_round)
        {
            winners_to_losers_rounds
                .entry(group_key.clone())
                .or_default()
                .entry(winners_round)
                .or_insert_with(|| HashSet::from([losers_round]));
        }
    }

    winners_to_losers_rounds
}

fn record_winners_to_losers_round_mapping(
    mappings: &mut WinnersToLosersRoundMap,
    source: &crate::models::SetSnapshot,
    target: &crate::models::SetSnapshot,
    relation: &str,
) {
    if relation != "loser"
        || is_losers_set(source)
        || !is_losers_set(target)
        || is_round_transition_exception(source)
        || is_round_transition_exception(target)
        || graph_phase_group_key(source) != graph_phase_group_key(target)
    {
        return;
    }
    let (Some(source_round), Some(target_round)) = (bracket_round(source), bracket_round(target))
    else {
        return;
    };
    if source_round <= 0 || target_round >= 0 {
        return;
    }

    mappings
        .entry(graph_phase_group_key(source))
        .or_default()
        .entry(source_round)
        .or_default()
        .insert(target_round);
}

fn save_pristine_snapshot(app: &AppHandle, snapshot: &TournamentSnapshot) -> Result<(), String> {
    let normalized_slug = normalize_slug_for_storage(&snapshot.slug);
    for event in &snapshot.events {
        let event_snapshot = TournamentSnapshot {
            tournament_id: snapshot.tournament_id.clone(),
            slug: snapshot.slug.clone(),
            name: snapshot.name.clone(),
            events: vec![event.clone()],
            updated_at: snapshot.updated_at,
        };
        save_event_snapshot_file(
            app,
            &event_snapshot,
            &snapshot.tournament_id,
            &normalized_slug,
            &event.event_id,
            &event.name,
            true,
        )?;
    }

    remove_stale_event_snapshot_files(
        app,
        &snapshot.tournament_id,
        &normalized_slug,
        &snapshot.events,
        true,
    )?;
    Ok(())
}

fn save_event_snapshot_file(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
    pristine: bool,
) -> Result<(), String> {
    if !pristine {
        invalidate_progression_cache(&snapshot.slug);
    }
    let path = if pristine {
        pristine_event_snapshot_path_with_keys(app, tournament_id, slug_key, event_id, event_name)?
    } else {
        event_snapshot_path_with_keys(app, tournament_id, slug_key, event_id, event_name)?
    };
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("スナップショットのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("スナップショット保存に失敗しました: {e}"))?;
    if !pristine {
        invalidate_progression_cache(&snapshot.slug);
    }
    Ok(())
}

fn save_event_graph_file(
    app: &AppHandle,
    graph: &BracketGraphSnapshot,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
) -> Result<(), String> {
    let started_at = Instant::now();
    let path = event_graph_path_with_keys(app, tournament_id, slug_key, event_id, event_name)?;
    let serialize_started_at = Instant::now();
    let json = serde_json::to_string_pretty(graph)
        .map_err(|e| format!("ブラケットグラフのJSON変換に失敗しました: {e}"))?;
    let serialize_elapsed_us = serialize_started_at.elapsed().as_micros();
    let bytes = json.len();
    let write_started_at = Instant::now();
    fs::write(path, json).map_err(|e| format!("ブラケットグラフ保存に失敗しました: {e}"))?;
    storage_perf_log(|| {
        format!(
            "write_event_graph event={} bytes={} serialize_us={} write_us={} total_us={}",
            event_id,
            bytes,
            serialize_elapsed_us,
            write_started_at.elapsed().as_micros(),
            started_at.elapsed().as_micros()
        )
    });
    Ok(())
}

fn remove_stale_event_graph_files(
    app: &AppHandle,
    tournament_id: &str,
    slug_key: &str,
    events: &[EventSnapshot],
) -> Result<(), String> {
    let dir = snapshots_dir(app)?;
    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.ends_with("-graph.json") {
            continue;
        }
        let raw = match fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let graph = match serde_json::from_str::<BracketGraphSnapshot>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if normalize_slug_for_storage(&graph.slug) != slug_key
            || graph.tournament_id != tournament_id
        {
            continue;
        }
        let Some(current_event) = events
            .iter()
            .find(|event| event.event_id == graph.event.event_id)
        else {
            continue;
        };
        let expected = event_graph_path_with_keys(
            app,
            tournament_id,
            slug_key,
            &current_event.event_id,
            &current_event.name,
        )?;
        if path != expected {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn remove_stale_event_snapshot_files(
    app: &AppHandle,
    tournament_id: &str,
    slug_key: &str,
    events: &[EventSnapshot],
    pristine: bool,
) -> Result<(), String> {
    let dir = snapshots_dir(app)?;
    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.ends_with(".json") {
            continue;
        }
        let suffix = if pristine {
            "-pristine.json"
        } else {
            "-snapshot.json"
        };
        if !file_name.ends_with(suffix) {
            continue;
        }
        let file_snapshot = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<TournamentSnapshot>(&raw).ok());
        let Some(file_snapshot) = file_snapshot else {
            continue;
        };
        if normalize_slug_for_storage(&file_snapshot.slug) != slug_key
            || file_snapshot.tournament_id != tournament_id
        {
            continue;
        }

        let Some(file_event) = file_snapshot.events.first() else {
            continue;
        };
        let Some(current_event) = events
            .iter()
            .find(|event| event.event_id == file_event.event_id)
        else {
            // 保存対象に含まれないeventは、別event保存時に削除しない。
            continue;
        };
        let expected_name = if pristine {
            format!(
                "{}-{}-{}-{}-pristine.json",
                sanitize_slug(tournament_id),
                sanitize_slug(slug_key),
                sanitize_slug(&current_event.event_id),
                event_name_slug(&current_event.name)
            )
        } else {
            format!(
                "{}-{}-{}-{}-snapshot.json",
                sanitize_slug(tournament_id),
                sanitize_slug(slug_key),
                sanitize_slug(&current_event.event_id),
                event_name_slug(&current_event.name)
            )
        };
        if file_name != expected_name {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn load_event_snapshot_files(
    app: &AppHandle,
    slug: &str,
    pristine: bool,
) -> Result<Vec<TournamentSnapshot>, String> {
    let started_at = Instant::now();
    let dir = snapshots_dir(app)?;
    let slug_key = normalize_slug_for_storage(slug);
    let suffix = if pristine {
        "-pristine.json"
    } else {
        "-snapshot.json"
    };
    let mut snapshots = Vec::new();
    let mut scanned_files = 0;
    let mut read_bytes = 0;
    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        scanned_files += 1;
        if !file_name.ends_with(suffix) {
            continue;
        }
        let raw = match fs::read_to_string(path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        read_bytes += raw.len();
        if let Ok(mut snapshot) = serde_json::from_str::<TournamentSnapshot>(&raw) {
            if normalize_slug_for_storage(&snapshot.slug) != slug_key {
                continue;
            }
            if !pristine {
                for event in &mut snapshot.events {
                    apply_source_based_tbd_labels(event);
                }
            }
            snapshots.push(snapshot);
        }
    }
    storage_perf_log(|| {
        format!(
            "load_event_snapshot_files slug={} scanned_files={} parsed_snapshots={} read_bytes={} elapsed_us={}",
            slug_key,
            scanned_files,
            snapshots.len(),
            read_bytes,
            started_at.elapsed().as_micros()
        )
    });
    Ok(snapshots)
}

fn load_event_graph_files(
    app: &AppHandle,
    slug: &str,
) -> Result<Vec<BracketGraphSnapshot>, String> {
    let dir = snapshots_dir(app)?;
    let slug_key = normalize_slug_for_storage(slug);
    let mut graphs = Vec::new();
    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.ends_with("-graph.json") {
            continue;
        }
        let raw = match fs::read_to_string(path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let graph = match serde_json::from_str::<BracketGraphSnapshot>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if normalize_slug_for_storage(&graph.slug) == slug_key {
            graphs.push(graph);
        }
    }
    Ok(graphs)
}

fn merge_event_snapshot_files(snapshots: Vec<TournamentSnapshot>) -> Option<TournamentSnapshot> {
    let mut snapshots = snapshots.into_iter();
    let first = snapshots.next()?;
    let mut merged = TournamentSnapshot {
        tournament_id: first.tournament_id.clone(),
        slug: first.slug.clone(),
        name: first.name.clone(),
        events: Vec::new(),
        updated_at: first.updated_at,
    };
    let mut event_indexes = HashMap::<String, usize>::new();
    for snapshot in std::iter::once(first).chain(snapshots) {
        merged.tournament_id = snapshot.tournament_id;
        merged.slug = snapshot.slug;
        merged.name = snapshot.name;
        merged.updated_at = merged.updated_at.max(snapshot.updated_at);
        for event in snapshot.events {
            if let Some(index) = event_indexes.get(&event.event_id).copied() {
                if let Some(existing) = merged.events.get_mut(index) {
                    *existing = event;
                }
            } else {
                event_indexes.insert(event.event_id.clone(), merged.events.len());
                merged.events.push(event);
            }
        }
    }
    Some(merged)
}

pub fn reconcile_local_event_snapshot_names(
    app: &AppHandle,
    slug: &str,
    remote_tournament_id: &str,
    remote_tournament_name: &str,
    remote_events: &[TournamentEventPreviewItem],
) -> Result<(), String> {
    let normalized_slug = normalize_slug_for_storage(slug);
    let event_names = remote_events
        .iter()
        .map(|event| (event.event_id.as_str(), event.event_name.as_str()))
        .collect::<HashMap<&str, &str>>();

    for pristine in [false, true] {
        let dir = snapshots_dir(app)?;
        let suffix = if pristine {
            "-pristine.json"
        } else {
            "-snapshot.json"
        };
        for entry in
            fs::read_dir(&dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
        {
            let path = match entry {
                Ok(value) => value.path(),
                Err(_) => continue,
            };
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.ends_with(suffix) {
                continue;
            }

            let raw = match fs::read_to_string(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let mut snapshot = match serde_json::from_str::<TournamentSnapshot>(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if normalize_slug_for_storage(&snapshot.slug) != normalized_slug {
                continue;
            }
            let Some(event) = snapshot.events.first_mut() else {
                continue;
            };
            let Some(remote_name) = event_names.get(event.event_id.as_str()) else {
                continue;
            };
            if remote_name.trim().is_empty()
                || (event.name == *remote_name
                    && snapshot.tournament_id == remote_tournament_id
                    && snapshot.name == remote_tournament_name)
            {
                continue;
            }

            let event_id = event.event_id.clone();
            event.name = (*remote_name).to_owned();
            snapshot.tournament_id = remote_tournament_id.to_owned();
            snapshot.name = remote_tournament_name.to_owned();
            let next_path = if pristine {
                pristine_event_snapshot_path_with_keys(
                    app,
                    remote_tournament_id,
                    &normalized_slug,
                    &event_id,
                    remote_name,
                )?
            } else {
                event_snapshot_path_with_keys(
                    app,
                    remote_tournament_id,
                    &normalized_slug,
                    &event_id,
                    remote_name,
                )?
            };
            let next_json = serde_json::to_string_pretty(&snapshot)
                .map_err(|e| format!("スナップショットのJSON変換に失敗しました: {e}"))?;
            fs::write(&next_path, next_json)
                .map_err(|e| format!("スナップショット保存に失敗しました: {e}"))?;
            if next_path != path {
                let _ = fs::remove_file(path);
            }
        }
    }

    let dir = snapshots_dir(app)?;
    for entry in
        fs::read_dir(&dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.ends_with("-meta.json") {
            continue;
        }
        let raw = match fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let mut meta = match serde_json::from_str::<TournamentLocalMeta>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if normalize_slug_for_storage(&meta.slug) != normalized_slug {
            continue;
        }
        let Some(event_meta) = meta.events.first_mut() else {
            continue;
        };
        let Some(remote_name) = event_names.get(event_meta.event_id.as_str()) else {
            continue;
        };
        if remote_name.trim().is_empty()
            || (event_meta.event_name == *remote_name && meta.tournament_id == remote_tournament_id)
        {
            continue;
        }

        let event_id = event_meta.event_id.clone();
        event_meta.event_name = (*remote_name).to_owned();
        meta.tournament_id = remote_tournament_id.to_owned();
        let next_path = meta_path(
            app,
            remote_tournament_id,
            &normalized_slug,
            &event_id,
            remote_name,
        )?;
        let next_json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("ローカルメタのJSON変換に失敗しました: {e}"))?;
        fs::write(&next_path, next_json)
            .map_err(|e| format!("ローカルメタ保存に失敗しました: {e}"))?;
        if next_path != path {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

pub fn load_snapshot(app: &AppHandle, slug: &str) -> Result<TournamentSnapshot, String> {
    let started_at = Instant::now();
    if let Some(snapshot) = cached_progression_snapshot(slug) {
        storage_perf_log(|| {
            format!(
                "load_snapshot slug={} events={} sets={} cache=hit elapsed_us={}",
                normalize_slug_for_storage(slug),
                snapshot.events.len(),
                snapshot
                    .events
                    .iter()
                    .map(|event| event.sets.len())
                    .sum::<usize>(),
                started_at.elapsed().as_micros()
            )
        });
        return Ok(snapshot);
    }
    let (mut snapshot, needs_progression_rebuild) =
        load_snapshot_without_progression_rebuild(app, slug)?;
    if needs_progression_rebuild {
        rebuild_progression_from_completed_sets(&mut snapshot);
    }
    if needs_progression_rebuild && restore_pending_local_results(app, slug, &mut snapshot, true)? {
        rebuild_progression_from_completed_sets(&mut snapshot);
    }
    cache_progression_snapshot(&snapshot, true, true);
    storage_perf_log(|| {
        format!(
            "load_snapshot slug={} events={} sets={} progression_rebuilt={} cache=miss elapsed_us={}",
            normalize_slug_for_storage(slug),
            snapshot.events.len(),
            snapshot
                .events
                .iter()
                .map(|event| event.sets.len())
                .sum::<usize>(),
            needs_progression_rebuild,
            started_at.elapsed().as_micros()
        )
    });
    Ok(snapshot)
}

fn event_snapshot_file_matches(file_name: &str, slug: &str, event_id: &str, suffix: &str) -> bool {
    let event_fragment = format!(
        "-{}-{}-",
        sanitize_slug(&normalize_slug_for_storage(slug)),
        sanitize_slug(event_id),
    );
    file_name.ends_with(suffix) && file_name.contains(&event_fragment)
}

fn load_event_snapshot_from_files(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    pristine: bool,
) -> Result<Option<TournamentSnapshot>, String> {
    let started_at = Instant::now();
    let dir = snapshots_dir(app)?;
    let slug_key = normalize_slug_for_storage(slug);
    let suffix = if pristine {
        "-pristine.json"
    } else {
        "-snapshot.json"
    };
    let mut selected_snapshot: Option<TournamentSnapshot> = None;
    let mut scanned_files = 0;
    let mut matched_files = 0;
    let mut read_bytes = 0;

    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        scanned_files += 1;
        if !event_snapshot_file_matches(file_name, &slug_key, event_id, suffix) {
            continue;
        }
        matched_files += 1;
        let raw = match fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        read_bytes += raw.len();
        let mut snapshot = match serde_json::from_str::<TournamentSnapshot>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if normalize_slug_for_storage(&snapshot.slug) != slug_key {
            continue;
        }
        let Some(mut event) = snapshot
            .events
            .iter()
            .find(|event| event.event_id == event_id)
            .cloned()
        else {
            continue;
        };
        if !pristine {
            apply_source_based_tbd_labels(&mut event);
        }
        snapshot.events = vec![event];
        if selected_snapshot
            .as_ref()
            .is_none_or(|selected| snapshot.updated_at >= selected.updated_at)
        {
            selected_snapshot = Some(snapshot);
        }
    }

    storage_perf_log(|| {
        format!(
            "load_event_snapshot slug={} event={} pristine={} scanned_files={} matched_files={} read_bytes={} elapsed_us={}",
            slug_key,
            event_id,
            pristine,
            scanned_files,
            matched_files,
            read_bytes,
            started_at.elapsed().as_micros()
        )
    });
    Ok(selected_snapshot)
}

fn load_event_graph_snapshot_from_files(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<Option<TournamentSnapshot>, String> {
    let dir = snapshots_dir(app)?;
    let slug_key = normalize_slug_for_storage(slug);
    let mut selected_snapshot: Option<TournamentSnapshot> = None;
    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !event_snapshot_file_matches(file_name, &slug_key, event_id, "-graph.json") {
            continue;
        }
        let raw = match fs::read_to_string(path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let graph = match serde_json::from_str::<BracketGraphSnapshot>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if normalize_slug_for_storage(&graph.slug) != slug_key || graph.event.event_id != event_id {
            continue;
        }
        let snapshot = TournamentSnapshot {
            tournament_id: graph.tournament_id,
            slug: graph.slug,
            name: graph.tournament_name,
            events: vec![graph.event],
            updated_at: graph.updated_at,
        };
        if selected_snapshot
            .as_ref()
            .is_none_or(|selected| snapshot.updated_at >= selected.updated_at)
        {
            selected_snapshot = Some(snapshot);
        }
    }
    Ok(selected_snapshot)
}

fn load_event_snapshot(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentSnapshot, String> {
    let mut loaded_from_graph = false;
    let mut snapshot =
        if let Some(snapshot) = load_event_snapshot_from_files(app, slug, event_id, false)? {
            snapshot
        } else if let Some(snapshot) = load_event_graph_snapshot_from_files(app, slug, event_id)? {
            loaded_from_graph = true;
            snapshot
        } else {
            return Err(format!(
                "指定イベントのローカルsnapshotが見つかりません: {event_id}"
            ));
        };

    let has_pending_results = restore_pending_local_results(app, slug, &mut snapshot, false)?;
    let needs_progression_rebuild = loaded_from_graph || has_pending_results;
    if needs_progression_rebuild {
        rebuild_progression_from_completed_sets(&mut snapshot);
    }
    if has_pending_results && restore_pending_local_results(app, slug, &mut snapshot, true)? {
        rebuild_progression_from_completed_sets(&mut snapshot);
    } else if !needs_progression_rebuild {
        storage_perf_log(|| {
            format!(
                "rebuild_progression skipped event={} reason=stored_set_state",
                event_id
            )
        });
    }
    Ok(snapshot)
}

fn load_pristine_event_snapshot(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentSnapshot, String> {
    load_event_snapshot_from_files(app, slug, event_id, true)?.ok_or_else(|| {
        format!("原本スナップショット読込に失敗しました: event {event_id} が見つかりません。")
    })
}

fn load_snapshot_without_progression_rebuild(
    app: &AppHandle,
    slug: &str,
) -> Result<(TournamentSnapshot, bool), String> {
    // raw snapshot is the source of truth. The graph is a derived view that
    // rewrites sources and removes intermediate sets, so loading it first can
    // corrupt phase/set placement after a remote refresh.
    if let Some(mut snapshot) =
        merge_event_snapshot_files(load_event_snapshot_files(app, slug, false)?)
    {
        let has_pending_results = restore_pending_local_results(app, slug, &mut snapshot, false)?;
        return Ok((snapshot, has_pending_results));
    }

    // Keep loading older installations that only have graph files.
    let graphs = load_event_graph_files(app, slug)?;
    if !graphs.is_empty() {
        let (tournament_id, stored_slug, name, updated_at) = {
            let first = graphs.first().expect("graphs is not empty");
            (
                first.tournament_id.clone(),
                first.slug.clone(),
                first.tournament_name.clone(),
                first.updated_at,
            )
        };
        let mut snapshot = TournamentSnapshot {
            tournament_id,
            slug: stored_slug,
            name,
            events: graphs.into_iter().map(|graph| graph.event).collect(),
            updated_at,
        };
        restore_pending_local_results(app, slug, &mut snapshot, false)?;
        return Ok((snapshot, true));
    }
    Err("ローカルスナップショット読込に失敗しました: 保存済みデータが見つかりません。".to_owned())
}

fn restore_pending_local_results(
    app: &AppHandle,
    slug: &str,
    snapshot: &mut TournamentSnapshot,
    require_roster_match: bool,
) -> Result<bool, String> {
    let started_at = Instant::now();
    let pending_results = snapshot
        .events
        .iter()
        .map(|event| {
            load_local_meta(app, slug, &event.event_id).map(|meta| {
                (
                    event.event_id.clone(),
                    meta.pending_set_results,
                    meta.pending_grand_final_reset_results.len(),
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let pending_set_count = pending_results
        .iter()
        .map(|(_, results, _)| results.len())
        .sum::<usize>();
    let pending_reset_count = pending_results
        .iter()
        .map(|(_, _, resets)| resets)
        .sum::<usize>();
    let has_pending_results = pending_set_count > 0 || pending_reset_count > 0;
    let mut restored_any = false;

    for (event_id, results, _) in pending_results {
        let Some(event) = snapshot
            .events
            .iter_mut()
            .find(|event| event.event_id == event_id)
        else {
            continue;
        };
        let has_reset_markers = results
            .iter()
            .any(|result| result.reset_source_set_id.is_some());
        if require_roster_match {
            restored_any |= restore_matching_pending_results_for_event(event, &results);
        } else {
            for result in &results {
                restore_pending_result_to_event(event, result);
                restored_any = true;
            }
        }
        if has_reset_markers {
            apply_source_based_tbd_labels(event);
        }
    }
    storage_perf_log(|| {
        format!(
            "restore_pending slug={} events={} pending_sets={} pending_resets={} elapsed_us={}",
            normalize_slug_for_storage(slug),
            snapshot.events.len(),
            pending_set_count,
            pending_reset_count,
            started_at.elapsed().as_micros()
        )
    });
    Ok(if require_roster_match {
        restored_any
    } else {
        has_pending_results
    })
}

fn restore_matching_pending_results_for_event(
    event: &mut EventSnapshot,
    results: &[LocalSetResultMeta],
) -> bool {
    let mut restored_any = false;
    for result in results {
        if result.event_id != event.event_id {
            continue;
        }
        if !pending_result_matches_event_roster(event, result) {
            continue;
        }
        restore_pending_result_to_event(event, result);
        restored_any = true;
    }
    restored_any
}

fn pending_result_matches_event_roster(event: &EventSnapshot, result: &LocalSetResultMeta) -> bool {
    if result.reset_source_set_id.is_some() {
        return true;
    }
    let score_entrant_ids = result
        .slot_scores
        .iter()
        .map(|score| score.entrant_id.clone())
        .collect::<Vec<_>>();
    event
        .sets
        .iter()
        .find(|set| set.set_id == result.set_id)
        .is_some_and(|set| {
            result_entrant_ids_match_set_roster(set, &result.winner_id, &score_entrant_ids)
        })
}

fn pending_result_matches_snapshot_roster(
    snapshot: &TournamentSnapshot,
    event_id: &str,
    result: &LocalSetResultMeta,
) -> bool {
    snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .is_some_and(|event| pending_result_matches_event_roster(event, result))
}

fn restore_pending_result_to_event(event: &mut EventSnapshot, result: &LocalSetResultMeta) {
    let known_entrant_names = known_resolved_entrant_names(event);

    let Some(set) = event
        .sets
        .iter_mut()
        .find(|set| set.set_id == result.set_id)
    else {
        return;
    };

    if let Some(reset_source_set_id) = result.reset_source_set_id.as_deref() {
        if set.set_id != reset_source_set_id {
            for slot in &mut set.slots {
                slot.entrant_id = None;
                slot.entrant_name = "TBD".to_owned();
                slot.seed_id = None;
                slot.seed_num = None;
                slot.score = None;
            }
        }
        clear_set_result_state(set);
        return;
    }

    set.winner_id = result.confirmed.then_some(result.winner_id.clone());
    set.state = if result.confirmed { 3 } else { 2 };

    if result.confirmed {
        restore_missing_slot_entrants(
            set,
            result
                .slot_scores
                .iter()
                .map(|score| score.entrant_id.clone()),
            &known_entrant_names,
        );
    }

    for slot in &mut set.slots {
        if let Some(score) = result
            .slot_scores
            .iter()
            .find(|score| score.entrant_id == slot.entrant_id.as_deref().unwrap_or_default())
        {
            slot.score = Some(score.score as f64);
        }
    }
}

fn known_resolved_entrant_names(event: &EventSnapshot) -> HashMap<String, String> {
    let mut known_entrant_names = HashMap::new();
    for (entrant_id, entrant_name) in event
        .sets
        .iter()
        .flat_map(|set| set.slots.iter())
        .filter_map(|slot| {
            Some((
                slot.entrant_id.as_ref()?,
                is_resolved_entrant_name(&slot.entrant_name).then_some(&slot.entrant_name)?,
            ))
        })
    {
        known_entrant_names.insert(entrant_id.clone(), entrant_name.clone());
    }
    for seed in event
        .phase_groups
        .iter()
        .flat_map(|group| group.seeds.iter())
    {
        if let (Some(entrant_id), Some(entrant_name)) =
            (seed.entrant_id.as_ref(), seed.entrant_name.as_ref())
        {
            if is_resolved_entrant_name(entrant_name) {
                known_entrant_names.insert(entrant_id.clone(), entrant_name.clone());
            }
        }
    }
    known_entrant_names
}

fn known_resolved_entrant_names_for_round_robin_set(
    event: &EventSnapshot,
    set_id: &str,
) -> HashMap<String, String> {
    let Some(target_set) = event.sets.iter().find(|set| set.set_id == set_id) else {
        return HashMap::new();
    };
    let phase_group = event.phase_groups.iter().find(|group| {
        if let Some(phase_group_id) = target_set.phase_group_id.as_deref() {
            return group.phase_group_id == phase_group_id;
        }
        group.phase_order == target_set.phase_order
            && normalize_group_key(group.display_identifier.as_ref())
                == normalize_group_key(target_set.phase_group_display_identifier.as_ref())
    });
    let group_set_ids = phase_group
        .map(|group| {
            group
                .set_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let target_group_key = phase_group_key(target_set);

    let mut known_entrant_names = HashMap::new();
    for slot in event
        .sets
        .iter()
        .filter(|set| {
            if group_set_ids.is_empty() {
                phase_group_key(set) == target_group_key
            } else {
                group_set_ids.contains(set.set_id.as_str())
            }
        })
        .flat_map(|set| set.slots.iter())
    {
        if let (Some(entrant_id), true) = (
            slot.entrant_id.as_ref(),
            is_resolved_entrant_name(&slot.entrant_name),
        ) {
            known_entrant_names.insert(entrant_id.clone(), slot.entrant_name.clone());
        }
    }
    if let Some(phase_group) = phase_group {
        for seed in &phase_group.seeds {
            if let (Some(entrant_id), Some(entrant_name)) =
                (seed.entrant_id.as_ref(), seed.entrant_name.as_ref())
            {
                if is_resolved_entrant_name(entrant_name) {
                    known_entrant_names.insert(entrant_id.clone(), entrant_name.clone());
                }
            }
        }
    }
    known_entrant_names
}

fn restore_missing_slot_entrants(
    set: &mut SetSnapshot,
    entrant_ids: impl IntoIterator<Item = String>,
    known_entrant_names: &HashMap<String, String>,
) {
    let mut seen_entrant_ids = HashSet::new();
    let ordered_entrant_ids = entrant_ids
        .into_iter()
        .filter(|entrant_id| {
            !entrant_id.trim().is_empty() && seen_entrant_ids.insert(entrant_id.clone())
        })
        .collect::<Vec<_>>();
    let existing_entrant_ids = set
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.clone())
        .collect::<HashSet<_>>();
    let missing_entrant_ids = ordered_entrant_ids
        .iter()
        .filter(|entrant_id| !existing_entrant_ids.contains(*entrant_id))
        .cloned()
        .collect::<Vec<_>>();
    let empty_slot_count = set
        .slots
        .iter()
        .filter(|slot| slot.entrant_id.is_none())
        .count();

    if ordered_entrant_ids.len() != set.slots.len() || missing_entrant_ids.len() != empty_slot_count
    {
        return;
    }

    let mut entrants_to_restore = missing_entrant_ids.into_iter();
    for slot in &mut set.slots {
        if slot.entrant_id.is_none() {
            let Some(entrant_id) = entrants_to_restore.next() else {
                break;
            };
            slot.entrant_id = Some(entrant_id.clone());
            if let Some(entrant_name) = known_entrant_names.get(&entrant_id) {
                slot.entrant_name = entrant_name.clone();
            }
        }
    }
}

#[derive(Clone)]
struct ProgressionTarget {
    set_index: usize,
    slot_index: usize,
    relation: String,
    is_progression: bool,
    seed_targets: Vec<ProgressionSeedTarget>,
}

#[derive(Clone)]
struct ProgressionSeedTarget {
    group_index: usize,
    seed_index: usize,
    seed_id: String,
    seed_num: Option<i64>,
    placeholder_name: Option<String>,
    dependent_slots: Vec<(usize, usize)>,
}

type ProgressionTargetsByEvent = HashMap<String, HashMap<String, Vec<ProgressionTarget>>>;

struct CachedProgressionSnapshot {
    slug_key: String,
    snapshot: TournamentSnapshot,
    event_set_ids: HashMap<String, Vec<String>>,
    targets_by_event: ProgressionTargetsByEvent,
    complete: bool,
}

static PROGRESSION_CACHE: OnceLock<Mutex<Option<CachedProgressionSnapshot>>> = OnceLock::new();

fn cached_progression_snapshot(slug: &str) -> Option<TournamentSnapshot> {
    let slug_key = normalize_slug_for_storage(slug);
    let cache = PROGRESSION_CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    guard
        .as_ref()
        .filter(|entry| entry.slug_key == slug_key && entry.complete)
        .map(|entry| entry.snapshot.clone())
}

fn cache_progression_snapshot(
    snapshot: &TournamentSnapshot,
    complete: bool,
    rebuild_targets: bool,
) {
    let slug_key = normalize_slug_for_storage(&snapshot.slug);
    let cache = PROGRESSION_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|error| error.into_inner());

    let mut cached = guard.take().filter(|entry| entry.slug_key == slug_key);
    let was_complete = cached.as_ref().is_some_and(|entry| entry.complete);
    let mut merged_snapshot = if complete {
        snapshot.clone()
    } else {
        cached
            .as_ref()
            .map(|entry| entry.snapshot.clone())
            .unwrap_or_else(|| TournamentSnapshot {
                tournament_id: snapshot.tournament_id.clone(),
                slug: snapshot.slug.clone(),
                name: snapshot.name.clone(),
                events: Vec::new(),
                updated_at: snapshot.updated_at,
            })
    };
    for event in &snapshot.events {
        if let Some(existing) = merged_snapshot
            .events
            .iter_mut()
            .find(|existing| existing.event_id == event.event_id)
        {
            *existing = event.clone();
        } else {
            merged_snapshot.events.push(event.clone());
        }
    }
    merged_snapshot.tournament_id = snapshot.tournament_id.clone();
    merged_snapshot.slug = snapshot.slug.clone();
    merged_snapshot.name = snapshot.name.clone();
    merged_snapshot.updated_at = snapshot.updated_at;

    let mut event_set_ids = if complete {
        HashMap::new()
    } else {
        cached
            .as_mut()
            .map(|entry| std::mem::take(&mut entry.event_set_ids))
            .unwrap_or_default()
    };
    let mut targets_by_event = if complete {
        HashMap::new()
    } else {
        cached
            .as_mut()
            .map(|entry| std::mem::take(&mut entry.targets_by_event))
            .unwrap_or_default()
    };
    if rebuild_targets {
        for event in &snapshot.events {
            event_set_ids.insert(
                event.event_id.clone(),
                event.sets.iter().map(|set| set.set_id.clone()).collect(),
            );
            targets_by_event.insert(
                event.event_id.clone(),
                build_progression_targets_by_source(snapshot, event),
            );
        }
    }
    *guard = Some(CachedProgressionSnapshot {
        slug_key,
        snapshot: merged_snapshot,
        event_set_ids,
        targets_by_event,
        complete: complete || was_complete,
    });
}

fn cached_progression_targets(
    slug: &str,
    event_id: &str,
    source_set_id: &str,
) -> Option<Vec<ProgressionTarget>> {
    let slug_key = normalize_slug_for_storage(slug);
    let cache = PROGRESSION_CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    guard
        .as_ref()
        .filter(|entry| entry.slug_key == slug_key)
        .and_then(|entry| entry.targets_by_event.get(event_id))
        .and_then(|targets| targets.get(source_set_id))
        .cloned()
}

fn invalidate_progression_cache(slug: &str) {
    let slug_key = normalize_slug_for_storage(slug);
    let cache = PROGRESSION_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    if guard
        .as_ref()
        .is_some_and(|entry| entry.slug_key == slug_key)
    {
        *guard = None;
    }
}

fn build_progression_targets_by_source(
    snapshot: &TournamentSnapshot,
    event: &EventSnapshot,
) -> HashMap<String, Vec<ProgressionTarget>> {
    let graph = build_bracket_graph(snapshot, event);
    let set_index_by_id = event
        .sets
        .iter()
        .enumerate()
        .map(|(index, set)| (set.set_id.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut phase_groups_by_id =
        HashMap::<&str, Vec<(usize, &crate::models::PhaseGroupSnapshot)>>::new();
    let mut phase_groups_by_fallback_key =
        HashMap::<(Option<i64>, String), Vec<(usize, &crate::models::PhaseGroupSnapshot)>>::new();
    for (group_index, group) in event.phase_groups.iter().enumerate() {
        phase_groups_by_id
            .entry(group.phase_group_id.as_str())
            .or_default()
            .push((group_index, group));
        phase_groups_by_fallback_key
            .entry((
                group.phase_order,
                normalize_group_key(group.display_identifier.as_ref()),
            ))
            .or_default()
            .push((group_index, group));
    }
    let mut dependent_slots_by_seed_id = HashMap::<&str, Vec<(usize, usize)>>::new();
    for (dependent_set_index, dependent_set) in event.sets.iter().enumerate() {
        for dependent_slot_index in 0..dependent_set.slots.len() {
            let source = match dependent_slot_index {
                0 => dependent_set.entrant1_source.as_ref(),
                1 => dependent_set.entrant2_source.as_ref(),
                _ => None,
            };
            if let Some(source) =
                source.filter(|source| source.source_type.as_deref() == Some("seed"))
            {
                if let Some(seed_id) = source.type_id.as_deref() {
                    dependent_slots_by_seed_id
                        .entry(seed_id)
                        .or_default()
                        .push((dependent_set_index, dependent_slot_index));
                }
            }
        }
    }
    let mut targets_by_source = HashMap::<String, Vec<ProgressionTarget>>::new();

    for edge in graph.edges {
        let (Some(&source_index), Some(&target_index)) = (
            set_index_by_id.get(edge.from_set_id.as_str()),
            set_index_by_id.get(edge.to_set_id.as_str()),
        ) else {
            continue;
        };
        let source = &event.sets[source_index];
        let target = &event.sets[target_index];
        let source_progression_seed_id = match edge.relation.as_str() {
            "winner" => source.winner_progression_seed_id.as_deref(),
            "loser" => source.loser_progression_seed_id.as_deref(),
            _ => None,
        };
        let target_slot_seed_id = target
            .slots
            .get(edge.target_slot_index)
            .and_then(|slot| slot.seed_id.as_deref());
        let is_progression = edge.progression_id.is_some()
            || source_progression_seed_id
                .is_some_and(|seed_id| target_slot_seed_id == Some(seed_id));
        if graph_phase_group_key(source) != graph_phase_group_key(target) && !is_progression {
            continue;
        }
        let target_seed_id = target
            .slots
            .get(edge.target_slot_index)
            .and_then(|slot| slot.seed_id.as_deref());
        let seed_targets = if is_progression {
            let matching_groups = if let Some(phase_group_id) = target.phase_group_id.as_deref() {
                phase_groups_by_id
                    .get(phase_group_id)
                    .map(Vec::as_slice)
                    .unwrap_or_default()
            } else {
                phase_groups_by_fallback_key
                    .get(&(
                        target.phase_order,
                        normalize_group_key(target.phase_group_display_identifier.as_ref()),
                    ))
                    .map(Vec::as_slice)
                    .unwrap_or_default()
            };
            let seed_id_targets = matching_groups
                .iter()
                .flat_map(|&(group_index, group)| {
                    group
                        .seeds
                        .iter()
                        .position(|seed| target_seed_id == Some(seed.seed_id.as_str()))
                        .map(|seed_index| (group_index, seed_index, &group.seeds[seed_index]))
                })
                .collect::<Vec<_>>();
            let progression_seed_targets = source_progression_seed_id
                .map(|progression_seed_id| {
                    matching_groups
                        .iter()
                        .flat_map(|&(group_index, group)| {
                            group
                                .seeds
                                .iter()
                                .enumerate()
                                .filter(|(_, seed)| seed.seed_id == progression_seed_id)
                                .map(move |(seed_index, seed)| (group_index, seed_index, seed))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let selected_seed_nodes = if !progression_seed_targets.is_empty() {
                progression_seed_targets
            } else if !seed_id_targets.is_empty() {
                seed_id_targets
            } else if let Some(progression_id) = edge.progression_id.as_deref() {
                let progression_targets = matching_groups
                    .iter()
                    .flat_map(|&(group_index, group)| {
                        group
                            .seeds
                            .iter()
                            .enumerate()
                            .filter(|(_, seed)| {
                                seed.progression_id.as_deref() == Some(progression_id)
                            })
                            .map(move |(seed_index, seed)| (group_index, seed_index, seed))
                    })
                    .collect::<Vec<_>>();
                if progression_targets.len() == 1 {
                    progression_targets
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };
            selected_seed_nodes
                .into_iter()
                .map(|(group_index, seed_index, seed)| {
                    let seed_id = seed.seed_id.clone();
                    let dependent_slots = dependent_slots_by_seed_id
                        .get(seed_id.as_str())
                        .cloned()
                        .unwrap_or_default();
                    ProgressionSeedTarget {
                        group_index,
                        seed_index,
                        seed_id,
                        seed_num: seed.seed_num,
                        placeholder_name: seed.placeholder_name.clone(),
                        dependent_slots,
                    }
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        targets_by_source
            .entry(edge.from_set_id)
            .or_default()
            .push(ProgressionTarget {
                set_index: target_index,
                slot_index: edge.target_slot_index,
                relation: edge.relation,
                is_progression,
                seed_targets,
            });
    }

    for targets in targets_by_source.values_mut() {
        targets.sort_by_key(|target| (target.set_index, target.slot_index));
        targets.dedup_by(|left, right| {
            left.set_index == right.set_index
                && left.slot_index == right.slot_index
                && left.relation == right.relation
        });
    }
    targets_by_source
}

fn rebuild_progression_from_completed_sets(
    snapshot: &mut TournamentSnapshot,
) -> HashSet<(String, String)> {
    struct CompletedSet {
        event_index: usize,
        set_index: usize,
        event_id: String,
        set_id: String,
        phase_index: Option<usize>,
        winner_id: String,
        is_round_robin: bool,
    }

    let started_at = Instant::now();
    let event_count = snapshot.events.len();
    let set_count = snapshot
        .events
        .iter()
        .map(|event| event.sets.len())
        .sum::<usize>();
    let progression_targets_by_event = snapshot
        .events
        .iter()
        .map(|event| {
            (
                event.event_id.clone(),
                build_progression_targets_by_source(snapshot, event),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut invalidated_result_set_ids = HashSet::new();
    for event in &mut snapshot.events {
        for set in &mut event.sets {
            let Some(winner_id) = set.winner_id.as_ref() else {
                continue;
            };
            if !set
                .slots
                .iter()
                .any(|slot| slot.entrant_id.as_ref() == Some(winner_id))
            {
                clear_set_result_state(set);
                invalidated_result_set_ids.insert((event.event_id.clone(), set.set_id.clone()));
            }
        }
    }
    let preserved_scores = snapshot
        .events
        .iter()
        .flat_map(|event| {
            event.sets.iter().flat_map(|set| {
                set.slots.iter().filter_map(|slot| {
                    Some((
                        (
                            event.event_id.clone(),
                            set.set_id.clone(),
                            slot.entrant_id.clone()?,
                        ),
                        slot.score?,
                    ))
                })
            })
        })
        .collect::<HashMap<_, _>>();
    let mut completed_sets = Vec::new();
    for (event_index, event) in snapshot.events.iter().enumerate() {
        for (set_index, set) in event.sets.iter().enumerate() {
            let Some(winner_id) = set.winner_id.as_ref() else {
                continue;
            };
            completed_sets.push(CompletedSet {
                event_index,
                set_index,
                event_id: event.event_id.clone(),
                set_id: set.set_id.clone(),
                phase_index: crate::models::phase_sequence_index_for_set(event, set),
                winner_id: winner_id.clone(),
                is_round_robin: set.state == 3
                    && is_round_robin_set(snapshot, &event.event_id, set),
            });
        }
    }
    let completed_set_count = completed_sets.len();
    completed_sets.sort_by_key(|set| {
        set.phase_index
            .map(|index| (false, index))
            .unwrap_or((true, usize::MAX))
    });
    let mut completed_set_indices_by_phase = HashMap::<(usize, usize), Vec<usize>>::new();
    for (completed_index, set) in completed_sets.iter().enumerate() {
        if let Some(phase_index) = set.phase_index {
            completed_set_indices_by_phase
                .entry((set.event_index, phase_index))
                .or_default()
                .push(completed_index);
        }
    }

    for event in &mut snapshot.events {
        reset_derived_progression_sets(event);
        invalidated_result_set_ids.extend(
            apply_seed_sources_to_set_slots(event)
                .into_iter()
                .map(|set_id| (event.event_id.clone(), set_id)),
        );
    }

    let round_robin_groups = snapshot
        .events
        .iter()
        .flat_map(|event| {
            event
                .sets
                .iter()
                .filter(|set| is_round_robin_set(snapshot, &event.event_id, set))
                .map(|set| (event.event_id.clone(), phase_group_key(set)))
        })
        .collect::<HashSet<_>>();
    let phase_steps = snapshot
        .events
        .iter()
        .flat_map(|event| {
            event
                .phases
                .iter()
                .enumerate()
                .map(|(phase_index, _)| (event.event_id.clone(), phase_index))
        })
        .collect::<Vec<_>>();
    let mut replayed_completed_sets = HashSet::<(usize, usize)>::new();
    let mut replayed_round_robin_groups = HashSet::new();
    let mut event_indices_by_id = HashMap::with_capacity(snapshot.events.len());
    for (index, event) in snapshot.events.iter().enumerate() {
        event_indices_by_id
            .entry(event.event_id.clone())
            .or_insert(index);
    }
    let mut round_robin_groups_by_phase = HashMap::<(usize, usize), Vec<String>>::new();
    for (event_id, group_key) in &round_robin_groups {
        let Some(event_index) = event_indices_by_id.get(event_id).copied() else {
            continue;
        };
        let event = &snapshot.events[event_index];
        let Some(set) = event
            .sets
            .iter()
            .find(|set| phase_group_key(set) == *group_key)
        else {
            continue;
        };
        if let Some(phase_index) = crate::models::phase_sequence_index_for_set(event, set) {
            round_robin_groups_by_phase
                .entry((event_index, phase_index))
                .or_default()
                .push(group_key.clone());
        }
    }

    for (event_id, phase_index) in phase_steps {
        let Some(event_index) = event_indices_by_id.get(&event_id).copied() else {
            continue;
        };
        if let Some(completed_indices) =
            completed_set_indices_by_phase.get(&(event_index, phase_index))
        {
            for completed_index in completed_indices {
                let completed = &completed_sets[*completed_index];
                replayed_completed_sets.insert((completed.event_index, completed.set_index));

                let is_still_completed = snapshot
                    .events
                    .get(completed.event_index)
                    .and_then(|event| event.sets.get(completed.set_index))
                    .is_some_and(|set| {
                        set.state == 3
                            && set.winner_id.as_deref() == Some(completed.winner_id.as_str())
                    });
                if !is_still_completed {
                    continue;
                }

                if !completed.is_round_robin {
                    if let Some(targets_by_source) =
                        progression_targets_by_event.get(&completed.event_id)
                    {
                        apply_local_progression(
                            snapshot,
                            &completed.event_id,
                            &completed.set_id,
                            &completed.winner_id,
                            targets_by_source,
                        );
                    }
                }
            }
        }

        if let Some(group_keys) = round_robin_groups_by_phase.get(&(event_index, phase_index)) {
            for group_key in group_keys {
                replayed_round_robin_groups.insert((event_id.clone(), group_key.clone()));
                let mut invalidated_group_set_ids = HashSet::new();
                apply_completed_round_robin_progression(
                    snapshot,
                    &event_id,
                    group_key,
                    &mut invalidated_group_set_ids,
                );
                invalidated_result_set_ids.extend(
                    invalidated_group_set_ids
                        .into_iter()
                        .map(|set_id| (event_id.clone(), set_id)),
                );
            }
        }
    }

    for completed in &completed_sets {
        if replayed_completed_sets.contains(&(completed.event_index, completed.set_index)) {
            continue;
        }
        let is_still_completed = snapshot
            .events
            .get(completed.event_index)
            .and_then(|event| event.sets.get(completed.set_index))
            .is_some_and(|set| {
                set.state == 3 && set.winner_id.as_deref() == Some(completed.winner_id.as_str())
            });
        if !is_still_completed {
            continue;
        }
        if !completed.is_round_robin {
            if let Some(targets_by_source) = progression_targets_by_event.get(&completed.event_id) {
                apply_local_progression(
                    snapshot,
                    &completed.event_id,
                    &completed.set_id,
                    &completed.winner_id,
                    targets_by_source,
                );
            }
        }
    }
    for (event_id, group_key) in round_robin_groups {
        if replayed_round_robin_groups.contains(&(event_id.clone(), group_key.clone())) {
            continue;
        }
        let mut invalidated_group_set_ids = HashSet::new();
        apply_completed_round_robin_progression(
            snapshot,
            &event_id,
            &group_key,
            &mut invalidated_group_set_ids,
        );
        invalidated_result_set_ids.extend(
            invalidated_group_set_ids
                .into_iter()
                .map(|set_id| (event_id.clone(), set_id)),
        );
    }

    let normalize_sources_started_at = Instant::now();
    for event in &mut snapshot.events {
        normalize_completed_source_slots(event);
        apply_seed_sources_to_set_slots(event);
        for set in &mut event.sets {
            for slot in &mut set.slots {
                let Some(entrant_id) = slot.entrant_id.as_ref() else {
                    continue;
                };
                if invalidated_result_set_ids
                    .contains(&(event.event_id.clone(), set.set_id.clone()))
                {
                    continue;
                }
                if let Some(score) = preserved_scores.get(&(
                    event.event_id.clone(),
                    set.set_id.clone(),
                    entrant_id.clone(),
                )) {
                    slot.score = Some(*score);
                }
            }
        }
    }
    let normalize_sources_elapsed_us = normalize_sources_started_at.elapsed().as_micros();
    storage_perf_log(|| {
        format!(
            "rebuild_progression events={} sets={} completed_sets={} normalize_sources_us={} elapsed_us={}",
            event_count,
            set_count,
            completed_set_count,
            normalize_sources_elapsed_us,
            started_at.elapsed().as_micros()
        )
    });
    invalidated_result_set_ids
}

fn rebuild_event_progression_from_completed_sets(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
) -> HashSet<String> {
    let Some(event_index) = snapshot
        .events
        .iter()
        .position(|event| event.event_id == event_id)
    else {
        return HashSet::new();
    };
    let mut event_snapshot = TournamentSnapshot {
        tournament_id: snapshot.tournament_id.clone(),
        slug: snapshot.slug.clone(),
        name: snapshot.name.clone(),
        events: vec![snapshot.events[event_index].clone()],
        updated_at: snapshot.updated_at.clone(),
    };
    let invalidated_set_ids = rebuild_progression_from_completed_sets(&mut event_snapshot)
        .into_iter()
        .filter_map(|(invalidated_event_id, set_id)| {
            (invalidated_event_id == event_id).then_some(set_id)
        })
        .collect();
    if let Some(event) = event_snapshot.events.pop() {
        snapshot.events[event_index] = event;
    }
    invalidated_set_ids
}

fn rebuild_event_progression_preserving_pending_results(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    pending_results: &[LocalSetResultMeta],
) -> HashSet<String> {
    let mut invalidated_set_ids = rebuild_event_progression_from_completed_sets(snapshot, event_id);
    let restored_pending_results = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
        .is_some_and(|event| restore_matching_pending_results_for_event(event, pending_results));
    if restored_pending_results {
        invalidated_set_ids.extend(rebuild_event_progression_from_completed_sets(
            snapshot, event_id,
        ));
    }
    invalidated_set_ids
}

fn normalize_completed_source_slots(event: &mut EventSnapshot) {
    let source_lookup = SourceRelationLookup::new(event);
    let round_robin_set_ids = event
        .sets
        .iter()
        .filter(|set| is_round_robin_set_in_event(event, set))
        .map(|set| set.set_id.clone())
        .collect::<HashSet<_>>();
    let phase_index_by_set_id = event
        .sets
        .iter()
        .map(|set| {
            (
                set.set_id.clone(),
                crate::models::phase_sequence_index_for_set(event, set),
            )
        })
        .collect::<HashMap<_, _>>();
    let completed_sets = event
        .sets
        .iter()
        .filter(|set| {
            !round_robin_set_ids.contains(&set.set_id) && set.state == 3 && set.winner_id.is_some()
        })
        .cloned()
        .collect::<Vec<_>>();

    for source_set in &completed_sets {
        let winner_id = source_set.winner_id.as_deref().unwrap_or_default();
        let winner_name = source_set
            .slots
            .iter()
            .find(|slot| slot.entrant_id.as_deref() == Some(winner_id))
            .map(|slot| slot.entrant_name.as_str())
            .unwrap_or("TBD");
        let loser = source_set
            .slots
            .iter()
            .find(|slot| slot.entrant_id.as_deref().is_some_and(|id| id != winner_id));

        let target_indexes = event
            .sets
            .iter()
            .enumerate()
            .filter(|(_, target)| {
                if target.set_id == source_set.set_id {
                    return false;
                }
                if round_robin_set_ids.contains(&target.set_id) {
                    return false;
                }
                if (source_set.winner_placement.is_some() || source_set.loser_placement.is_some())
                    && phase_index_by_set_id
                        .get(target.set_id.as_str())
                        .copied()
                        .flatten()
                        .zip(
                            phase_index_by_set_id
                                .get(source_set.set_id.as_str())
                                .copied()
                                .flatten(),
                        )
                        .is_some_and(|(target_index, source_index)| target_index > source_index)
                {
                    return false;
                }
                true
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();

        for target_index in target_indexes {
            let slot_count = event.sets[target_index].slots.len().min(2);
            for slot_index in 0..slot_count {
                let relation = {
                    let target = &event.sets[target_index];
                    let source = match slot_index {
                        0 => target.entrant1_source.as_ref(),
                        1 => target.entrant2_source.as_ref(),
                        _ => None,
                    };
                    source.and_then(|source| {
                        source_relation_reaches_set(
                            event,
                            source,
                            source_set,
                            &mut HashSet::new(),
                            &source_lookup,
                        )
                    })
                };
                let target = &mut event.sets[target_index];
                let Some(slot) = target.slots.get_mut(slot_index) else {
                    continue;
                };
                match (relation, loser) {
                    (Some("winner"), _) => {
                        slot.entrant_id = Some(winner_id.to_owned());
                        slot.entrant_name = winner_name.to_owned();
                    }
                    (Some("loser"), Some(loser)) => {
                        slot.entrant_id = loser.entrant_id.clone();
                        slot.entrant_name = loser.entrant_name.clone();
                    }
                    _ => {}
                }
            }
        }
    }

    let grand_final_sets = event
        .sets
        .iter()
        .filter(|set| is_grand_final_set(set) && !is_grand_final_reset_set(set))
        .map(|set| {
            (
                normalize_group_key(set.phase_name.as_ref()),
                normalize_group_key(set.phase_group_name.as_ref()),
                set.set_id.clone(),
                set.winner_id.clone(),
                set.slots.clone(),
            )
        })
        .collect::<Vec<_>>();

    for reset_set in event
        .sets
        .iter_mut()
        .filter(|set| is_grand_final_reset_set(set))
    {
        let virtual_grand_final_set_id =
            source_grand_final_set_id_from_virtual_reset_set_id(&reset_set.set_id);
        let reset_phase = normalize_group_key(reset_set.phase_name.as_ref());
        let reset_group = normalize_group_key(reset_set.phase_group_name.as_ref());
        let Some((_, _, _, grand_final_winner_id, source_slots)) =
            grand_final_sets
                .iter()
                .find(|(phase, group, set_id, _, _)| {
                    virtual_grand_final_set_id
                        .as_deref()
                        .is_some_and(|grand_final_set_id| set_id == grand_final_set_id)
                        || (virtual_grand_final_set_id.is_none()
                            && *phase == reset_phase
                            && *group == reset_group)
                })
        else {
            continue;
        };

        if reset_set.winner_id.is_some() {
            continue;
        }

        let is_virtual_reset = virtual_grand_final_set_id.is_some();
        let mut ordered_slots = source_slots.clone();
        if is_virtual_reset {
            if let Some(winner_id) = grand_final_winner_id.as_deref() {
                if let Some(winner_index) = ordered_slots
                    .iter()
                    .position(|slot| slot.entrant_id.as_deref() == Some(winner_id))
                {
                    ordered_slots.swap(0, winner_index);
                }
            }
        } else {
            ordered_slots.reverse();
        }

        let mut changed = false;
        for (reset_slot, grand_final_slot) in reset_set.slots.iter_mut().zip(&ordered_slots) {
            if !is_virtual_reset && reset_slot.entrant_id.is_some() {
                continue;
            }
            if grand_final_slot.entrant_id.is_none() {
                continue;
            }
            reset_slot.entrant_id = grand_final_slot.entrant_id.clone();
            reset_slot.entrant_name = grand_final_slot.entrant_name.clone();
            reset_slot.seed_id = grand_final_slot.seed_id.clone();
            reset_slot.seed_num = grand_final_slot.seed_num;
            reset_slot.score = None;
            changed = true;
        }
        if changed {
            reset_set.state = if empty_slot_count(reset_set) == 0 {
                2
            } else {
                1
            };
        }
    }
}

fn reset_derived_progression_sets(event: &mut EventSnapshot) {
    for group in &mut event.phase_groups {
        for seed in &mut group.seeds {
            if seed.progression_id.is_some() {
                seed.entrant_id = None;
                seed.entrant_name = None;
            }
        }
    }

    for set in &mut event.sets {
        if set.phase_order.unwrap_or_default() <= 1
            || crate::models::is_intermediate_set(&event.phase_groups, set)
        {
            continue;
        }

        let completed_winner_id = (set.state == 3).then(|| set.winner_id.clone()).flatten();

        if completed_winner_id.is_some() {
            continue;
        }

        for (slot_index, slot) in set.slots.iter_mut().enumerate() {
            let source = match slot_index {
                0 => set.entrant1_source.as_ref(),
                1 => set.entrant2_source.as_ref(),
                _ => None,
            };
            slot.entrant_id = None;
            slot.entrant_name = source
                .and_then(|source| source.placeholder_name.clone())
                .or_else(|| source.and_then(|source| source.condition_string.clone()))
                .unwrap_or_else(|| "TBD".to_owned());
            slot.score = None;
        }
        set.state = 1;
        set.winner_id = None;
    }
}

fn apply_seed_sources_to_set_slots(event: &mut EventSnapshot) -> HashSet<String> {
    let seed_by_id = event
        .phase_groups
        .iter()
        .flat_map(|group| group.seeds.iter())
        .map(|seed| (seed.seed_id.as_str(), seed))
        .collect::<HashMap<_, _>>();
    let mut known_entrant_names = HashMap::new();
    for set in &event.sets {
        for (slot_index, slot) in set.slots.iter().enumerate() {
            let Some(entrant_id) = slot.entrant_id.as_ref() else {
                continue;
            };
            let source = match slot_index {
                0 => set.entrant1_source.as_ref(),
                1 => set.entrant2_source.as_ref(),
                _ => None,
            };
            let is_placeholder = is_placeholder_entrant_name(
                &slot.entrant_name,
                slot.seed_placeholder_name.as_deref(),
            ) || is_placeholder_entrant_name(
                &slot.entrant_name,
                source.and_then(|source| source.placeholder_name.as_deref()),
            );
            if is_resolved_entrant_name(&slot.entrant_name) && !is_placeholder {
                known_entrant_names
                    .entry(entrant_id.clone())
                    .or_insert_with(|| slot.entrant_name.clone());
            }
        }
    }

    let mut invalidated_result_set_ids = HashSet::new();
    for set in &mut event.sets {
        let had_result = set.winner_id.is_some()
            || set.state == 3
            || set.slots.iter().any(|slot| slot.score.is_some());
        let mut entrant_changed = false;
        for (slot_index, slot) in set.slots.iter_mut().enumerate() {
            let source = match slot_index {
                0 => set.entrant1_source.as_ref(),
                1 => set.entrant2_source.as_ref(),
                _ => None,
            };
            let Some(source) = source else {
                continue;
            };
            if source.source_type.as_deref() != Some("seed") {
                continue;
            }
            let Some(seed_id) = source.type_id.as_deref() else {
                continue;
            };
            let Some(seed) = seed_by_id.get(seed_id) else {
                continue;
            };

            let placeholder_name = seed
                .placeholder_name
                .clone()
                .or_else(|| source.placeholder_name.clone())
                .or_else(|| slot.seed_placeholder_name.clone());
            let current_entrant_name = slot.entrant_id.as_ref().and_then(|entrant_id| {
                let seed_matches_slot = seed
                    .entrant_id
                    .as_ref()
                    .is_none_or(|seed_entrant_id| seed_entrant_id == entrant_id);
                let is_placeholder = is_placeholder_entrant_name(
                    &slot.entrant_name,
                    seed.placeholder_name.as_deref(),
                ) || is_placeholder_entrant_name(
                    &slot.entrant_name,
                    source.placeholder_name.as_deref(),
                ) || is_placeholder_entrant_name(
                    &slot.entrant_name,
                    slot.seed_placeholder_name.as_deref(),
                );
                (seed_matches_slot
                    && is_resolved_entrant_name(&slot.entrant_name)
                    && !is_placeholder)
                    .then(|| slot.entrant_name.clone())
            });
            let entrant_id = seed.entrant_id.as_ref().or(slot.entrant_id.as_ref());
            let entrant_name = current_entrant_name
                .or_else(|| {
                    entrant_id.and_then(|entrant_id| known_entrant_names.get(entrant_id).cloned())
                })
                .or_else(|| {
                    seed.entrant_name
                        .as_deref()
                        .filter(|name| {
                            is_resolved_entrant_name(name)
                                && !is_placeholder_entrant_name(
                                    name,
                                    seed.placeholder_name.as_deref(),
                                )
                        })
                        .map(str::to_owned)
                })
                .or(placeholder_name.clone())
                .unwrap_or_else(|| "TBD".to_owned());
            slot.seed_id = Some(seed.seed_id.clone());
            slot.seed_num = seed.seed_num;
            slot.seed_placeholder_name = placeholder_name.clone();
            if seed.entrant_id.is_some() || slot.entrant_id.is_none() {
                let slot_entrant_changed = slot.entrant_id != seed.entrant_id;
                entrant_changed |= slot_entrant_changed;
                slot.entrant_id = seed.entrant_id.clone();
                if slot_entrant_changed {
                    slot.score = None;
                }
            }
            slot.entrant_name = entrant_name;
        }
        if entrant_changed {
            if had_result {
                clear_set_result_state(set);
            }
            invalidated_result_set_ids.insert(set.set_id.clone());
        }
    }
    invalidated_result_set_ids
}

pub fn list_local_snapshot_events(
    app: &AppHandle,
) -> Result<Vec<LocalSnapshotEventListItem>, String> {
    let dir = snapshots_dir(app)?;
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("保存済みスナップショット一覧の取得に失敗しました: {e}"))?;
    let mut items = HashMap::<(String, String), LocalSnapshotEventListItem>::new();

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !file_name.ends_with("-meta.json") {
            continue;
        }

        let raw = match fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let meta = match serde_json::from_str::<TournamentLocalMeta>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for event in &meta.events {
            let item = LocalSnapshotEventListItem {
                tournament_id: meta.tournament_id.clone(),
                slug: meta.slug.clone(),
                tournament_name: if meta.tournament_name.trim().is_empty() {
                    meta.slug.clone()
                } else {
                    meta.tournament_name.clone()
                },
                updated_at: meta.updated_at,
                event_id: event.event_id.clone(),
                event_name: event.event_name.clone(),
                event_alias: event.event_alias.clone(),
                last_selected_phase_name: event.last_selected_phase_name.clone(),
                last_selected_phase_group_name: event.last_selected_phase_group_name.clone(),
                set_count: 0,
            };
            let key = (
                normalize_slug_for_storage(&item.slug),
                item.event_id.clone(),
            );
            match items.entry(key) {
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    if item.updated_at > entry.get().updated_at {
                        entry.insert(item);
                    }
                }
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(item);
                }
            }
        }
    }

    let needs_graph_fallback =
        items.is_empty() || items.values().any(|item| item.tournament_name == item.slug);
    if needs_graph_fallback {
        for entry in fs::read_dir(&dir)
            .map_err(|e| format!("保存済みスナップショット一覧の取得に失敗しました: {e}"))?
        {
            let entry = match entry {
                Ok(value) => value,
                Err(_) => continue,
            };
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.ends_with("-graph.json") {
                continue;
            }
            let raw = match fs::read_to_string(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let graph = match serde_json::from_str::<BracketGraphSnapshot>(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let key = (
                normalize_slug_for_storage(&graph.slug),
                graph.event.event_id.clone(),
            );
            match items.entry(key) {
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    let item = entry.get_mut();
                    if item.tournament_name == item.slug {
                        item.tournament_name = graph.tournament_name;
                    }
                    item.set_count = graph.event.sets.len();
                }
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(LocalSnapshotEventListItem {
                        tournament_id: graph.tournament_id,
                        slug: graph.slug,
                        tournament_name: graph.tournament_name,
                        updated_at: graph.updated_at,
                        event_id: graph.event.event_id,
                        event_name: graph.event.name,
                        event_alias: None,
                        last_selected_phase_name: None,
                        last_selected_phase_group_name: None,
                        set_count: graph.event.sets.len(),
                    });
                }
            }
        }
    }

    let mut items = items.into_values().collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.tournament_name.cmp(&right.tournament_name))
            .then_with(|| left.event_name.cmp(&right.event_name))
    });

    Ok(items)
}

pub fn delete_local_snapshot_event(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<(), String> {
    let mut snapshot = load_snapshot(app, slug)?;
    let event_name = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.name.clone())
        .unwrap_or_default();
    let before_len = snapshot.events.len();
    snapshot.events.retain(|event| event.event_id != event_id);

    if snapshot.events.len() == before_len {
        return Err(format!("削除対象のイベントが見つかりません: {event_id}"));
    }

    let target_meta_path = meta_path(app, &snapshot.tournament_id, slug, event_id, &event_name)?;
    if target_meta_path.exists() {
        fs::remove_file(&target_meta_path)
            .map_err(|e| format!("ローカルメタ削除に失敗しました: {e}"))?;
    }

    let normalized_slug = normalize_slug_for_storage(slug);
    let graph_path = event_graph_path_with_keys(
        app,
        &snapshot.tournament_id,
        &normalized_slug,
        event_id,
        &event_name,
    )?;
    if graph_path.exists() {
        fs::remove_file(graph_path)
            .map_err(|e| format!("ブラケットグラフ削除に失敗しました: {e}"))?;
    }
    let event_snapshot_path = event_snapshot_path_with_keys(
        app,
        &snapshot.tournament_id,
        &normalized_slug,
        event_id,
        &event_name,
    )?;
    if event_snapshot_path.exists() {
        fs::remove_file(event_snapshot_path)
            .map_err(|e| format!("スナップショット削除に失敗しました: {e}"))?;
    }
    let pristine_path = pristine_event_snapshot_path_with_keys(
        app,
        &snapshot.tournament_id,
        &normalized_slug,
        event_id,
        &event_name,
    )?;
    if pristine_path.exists() {
        fs::remove_file(pristine_path)
            .map_err(|e| format!("原本スナップショット削除に失敗しました: {e}"))?;
    }

    snapshot.updated_at = Utc::now();
    save_snapshot(app, &snapshot)?;

    Ok(())
}

fn find_set_in_snapshot_mut<'a>(
    snapshot: &'a mut TournamentSnapshot,
    set_id: &str,
) -> Option<(String, &'a mut crate::models::SetSnapshot)> {
    for event in &mut snapshot.events {
        if let Some(set) = event.sets.iter_mut().find(|set| set.set_id == set_id) {
            return Some((event.event_id.clone(), set));
        }
    }

    None
}

fn is_losers_set(set: &crate::models::SetSnapshot) -> bool {
    if let Some(round) = set.round {
        if round < 0 {
            return true;
        }
    }

    let lowered = set.full_round_text.to_lowercase();
    lowered.contains("losers") || lowered.contains("loser") || lowered.contains("敗者")
}

fn bracket_round(set: &crate::models::SetSnapshot) -> Option<i64> {
    let round = set.round?.checked_abs()?;
    if is_losers_set(set) {
        round.checked_neg()
    } else {
        Some(round)
    }
}

fn is_grand_final_set(set: &crate::models::SetSnapshot) -> bool {
    let lowered = set.full_round_text.trim().to_lowercase();
    if lowered.contains("grand final")
        || lowered.contains("grand finals")
        || lowered.contains("グランド")
    {
        return true;
    }

    set.full_round_text
        .split(|ch: char| !ch.is_alphanumeric())
        .any(|token| token.eq_ignore_ascii_case("gf"))
}

fn is_resolved_entrant_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }

    let normalized = trimmed.to_ascii_uppercase();
    if normalized == "TBD" || normalized == "TBA" || normalized == "UNKNOWN" {
        return false;
    }

    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("winner of ") || lowered.starts_with("loser of ") {
        return false;
    }

    !(trimmed.starts_with("勝者") || trimmed.starts_with("敗者"))
}

fn is_placeholder_entrant_name(name: &str, placeholder_name: Option<&str>) -> bool {
    placeholder_name.is_some_and(|placeholder| {
        !placeholder.trim().is_empty() && name.trim() == placeholder.trim()
    })
}

fn is_set_matchup_ready(set: &crate::models::SetSnapshot) -> bool {
    if set.slots.len() < 2 {
        return false;
    }

    set.slots
        .iter()
        .all(|slot| slot.entrant_id.is_some() && is_resolved_entrant_name(&slot.entrant_name))
}

fn normalize_group_key(value: Option<&String>) -> String {
    value
        .map(|item| item.trim().to_lowercase())
        .unwrap_or_default()
}

fn empty_slot_count(set: &crate::models::SetSnapshot) -> usize {
    set.slots
        .iter()
        .filter(|slot| {
            slot.entrant_id.is_none() || slot.entrant_name.trim().eq_ignore_ascii_case("tbd")
        })
        .count()
}

fn is_slot_empty(slot: &crate::models::SetSlotSnapshot) -> bool {
    slot.entrant_id.is_none() || slot.entrant_name.trim().eq_ignore_ascii_case("tbd")
}

fn hidden_pipe_source_slot_indexes(set: &crate::models::SetSnapshot) -> Option<Vec<usize>> {
    let sources = [set.entrant1_source.as_ref(), set.entrant2_source.as_ref()];
    let meaningful_slots = sources
        .into_iter()
        .enumerate()
        .filter_map(|(slot_index, source)| {
            let has_source_metadata = source.is_some_and(|source| {
                source.condition.is_some() || source.condition_string.is_some()
            });
            let has_entrant = set
                .slots
                .get(slot_index)
                .is_some_and(|slot| slot.entrant_id.is_some());

            (has_source_metadata || has_entrant).then_some(slot_index)
        })
        .collect::<Vec<_>>();

    (meaningful_slots.len() == 1).then_some(meaningful_slots)
}

fn resolve_hidden_source_edges(
    source_set_id: &str,
    sets_by_id: &HashMap<&str, &crate::models::SetSnapshot>,
    intermediate_set_ids: &HashSet<&str>,
    progression_candidates_by_seed: &ProgressionCandidatesBySeed<'_>,
) -> Option<Vec<(String, String)>> {
    resolve_hidden_source_edges_with_visited(
        source_set_id,
        sets_by_id,
        intermediate_set_ids,
        progression_candidates_by_seed,
        &mut HashSet::new(),
    )
}

fn resolve_hidden_source_edges_with_visited(
    source_set_id: &str,
    sets_by_id: &HashMap<&str, &crate::models::SetSnapshot>,
    intermediate_set_ids: &HashSet<&str>,
    progression_candidates_by_seed: &ProgressionCandidatesBySeed<'_>,
    visited: &mut HashSet<String>,
) -> Option<Vec<(String, String)>> {
    let source_set = sets_by_id.get(source_set_id).copied()?;
    let condition_sources = [
        source_set.entrant1_source.as_ref(),
        source_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .filter(|source| {
        source_kind_from_api_source(source).is_some() && resolved_source_set_id(source).is_some()
    })
    .collect::<Vec<_>>();

    if !intermediate_set_ids.contains(source_set_id) && condition_sources.len() != 1 {
        return None;
    }
    if !visited.insert(source_set_id.to_owned()) {
        return Some(Vec::new());
    }

    let mut resolved = Vec::new();
    for source in condition_sources {
        let condition = source_kind_from_api_source(source).unwrap_or_default();
        let type_id = resolved_source_set_id(source).unwrap_or_default();

        if let Some(nested) = resolve_hidden_source_edges_with_visited(
            type_id,
            sets_by_id,
            intermediate_set_ids,
            progression_candidates_by_seed,
            visited,
        ) {
            resolved.extend(nested);
        } else if sets_by_id.contains_key(type_id) {
            resolved.push((type_id.to_owned(), condition.to_owned()));
        }
    }

    if resolved.is_empty() {
        for source in [
            source_set.entrant1_source.as_ref(),
            source_set.entrant2_source.as_ref(),
        ]
        .into_iter()
        .flatten()
        .filter(|source| source.source_type.as_deref() == Some("seed"))
        {
            let Some(source_id) = source.type_id.as_deref() else {
                continue;
            };
            let Some((candidate, relation)) = progression_candidates_by_seed
                .get(source_id)
                .and_then(|candidates| candidates.first())
            else {
                continue;
            };
            resolved.push((candidate.set_id.clone(), (*relation).to_owned()));
        }
    }

    Some(resolved)
}

fn resolved_source_set_id(source: &crate::models::SetEntrantSourceSnapshot) -> Option<&str> {
    source.resolved_set_id.as_deref().or_else(|| {
        (source.source_type.as_deref() != Some("seed"))
            .then_some(source.type_id.as_deref())
            .flatten()
    })
}

fn rewrite_intermediate_source(
    source: &mut Option<crate::models::SetEntrantSourceSnapshot>,
    target: &crate::models::SetSnapshot,
    set_name_by_id: &HashMap<String, String>,
    sets_by_id: &HashMap<&str, &crate::models::SetSnapshot>,
    intermediate_set_ids: &HashSet<&str>,
    progression_candidates_by_seed: &ProgressionCandidatesBySeed<'_>,
    winners_to_losers_rounds_by_group: &WinnersToLosersRoundMap,
) {
    let Some(source_value) = source.as_mut() else {
        return;
    };
    let Some(source_set_id) = resolved_source_set_id(source_value) else {
        return;
    };
    let Some(resolved) = resolve_hidden_source_edges(
        source_set_id,
        sets_by_id,
        intermediate_set_ids,
        progression_candidates_by_seed,
    ) else {
        return;
    };
    if resolved.len() != 1 {
        return;
    }

    let (resolved_set_id, relation) = &resolved[0];
    let Some(resolved_set) = sets_by_id.get(resolved_set_id.as_str()) else {
        return;
    };
    if !is_allowed_round_transition(
        resolved_set,
        target,
        relation,
        winners_to_losers_rounds_by_group,
    ) {
        return;
    }
    let Some(set_name) = set_name_by_id.get(resolved_set_id) else {
        return;
    };

    source_value.resolved_set_id = Some(resolved_set_id.clone());
    source_value.condition = Some(relation.clone());
    source_value.placeholder_name =
        sets_by_id
            .get(resolved_set_id.as_str())
            .and_then(|candidate| match relation.as_str() {
                "winner" => candidate.winner_progression_seed_placeholder_name.clone(),
                "loser" => candidate.loser_progression_seed_placeholder_name.clone(),
                _ => None,
            });
    source_value.condition_string = Some(format!("{relation} of {set_name}"));
}

fn progression_candidate_for_target<'a>(
    event: &EventSnapshot,
    target: &crate::models::SetSnapshot,
    source_id: &str,
    progression_candidates_by_group_and_seed: &ProgressionCandidatesByGroupAndSeed<'a>,
    progression_candidates_by_group_seed_and_round: &ProgressionCandidatesByGroupSeedAndRound<'a>,
    progression_candidates_by_seed: &ProgressionCandidatesBySeed<'a>,
    winners_to_losers_rounds_by_group: &WinnersToLosersRoundMap,
) -> Option<(&'a crate::models::SetSnapshot, &'static str)> {
    let target_phase_group_key = graph_phase_group_key(target);
    let same_group_candidates = progression_candidates_by_group_and_seed
        .get(&target_phase_group_key)
        .and_then(|candidates| candidates.get(source_id));
    let first_same_group_candidate = same_group_candidates
        .and_then(|candidates| candidates.first())
        .copied();
    if is_round_transition_exception(target)
        || first_same_group_candidate
            .is_some_and(|(candidate, _)| is_round_transition_exception(candidate))
    {
        return first_same_group_candidate.or_else(|| {
            progression_candidates_by_seed
                .get(source_id)
                .and_then(|candidates| {
                    candidates
                        .iter()
                        .find(|(candidate, _)| is_prior_phase_set(event, candidate, target))
                })
                .copied()
        });
    }

    if let Some(round) = bracket_round(target) {
        let expected_source_round = if round > 1 {
            round.checked_sub(1)
        } else if round < -1 {
            round.checked_add(1)
        } else {
            None
        };
        if let Some(previous_round) = expected_source_round {
            if let Some(candidate) = progression_candidates_by_group_seed_and_round
                .get(&target_phase_group_key)
                .and_then(|candidates| candidates.get(source_id))
                .and_then(|candidates| candidates.get(&previous_round))
            {
                return Some(*candidate);
            }
        }

        if let Some(candidates) = same_group_candidates {
            if let Some(candidate) = candidates.iter().find(|(candidate, relation)| {
                is_losers_set(candidate) != is_losers_set(target)
                    && winners_to_losers_round_match(
                        candidate,
                        target,
                        relation,
                        winners_to_losers_rounds_by_group,
                    ) == Some(true)
            }) {
                return Some(*candidate);
            }
            if let Some(candidate) = candidates.iter().find(|(candidate, relation)| {
                is_losers_set(candidate) != is_losers_set(target)
                    && winners_to_losers_round_match(
                        candidate,
                        target,
                        relation,
                        winners_to_losers_rounds_by_group,
                    )
                    .is_none()
            }) {
                return Some(*candidate);
            }
            return None;
        }
    } else if let Some(candidate) = first_same_group_candidate {
        return Some(candidate);
    }

    progression_candidates_by_seed
        .get(source_id)
        .and_then(|candidates| {
            candidates
                .iter()
                .find(|(candidate, _)| is_prior_phase_set(event, candidate, target))
        })
        .copied()
}

fn rewrite_progression_source(
    source: &mut Option<crate::models::SetEntrantSourceSnapshot>,
    target: &crate::models::SetSnapshot,
    event: &EventSnapshot,
    set_name_by_id: &HashMap<String, String>,
    progression_candidates_by_group_and_seed: &ProgressionCandidatesByGroupAndSeed<'_>,
    progression_candidates_by_group_seed_and_round: &ProgressionCandidatesByGroupSeedAndRound<'_>,
    progression_candidates_by_seed: &ProgressionCandidatesBySeed<'_>,
    winners_to_losers_rounds_by_group: &WinnersToLosersRoundMap,
) {
    let Some(source_value) = source.as_mut() else {
        return;
    };
    if source_value.source_type.as_deref() != Some("seed") {
        return;
    }
    if source_value.condition.is_some() && source_value.resolved_set_id.is_some() {
        return;
    }
    let Some(source_id) = source_value.type_id.as_deref() else {
        return;
    };

    let candidate = progression_candidate_for_target(
        event,
        target,
        source_id,
        progression_candidates_by_group_and_seed,
        progression_candidates_by_group_seed_and_round,
        progression_candidates_by_seed,
        winners_to_losers_rounds_by_group,
    );

    let Some((candidate, relation)) = candidate else {
        return;
    };
    let set_name = set_name_by_id.get(&candidate.set_id);

    source_value.resolved_set_id = Some(candidate.set_id.clone());
    source_value.condition = Some(relation.to_owned());
    source_value.placeholder_name = match relation {
        "winner" => candidate.winner_progression_seed_placeholder_name.clone(),
        "loser" => candidate.loser_progression_seed_placeholder_name.clone(),
        _ => None,
    }
    .or_else(|| set_name.map(|name| format!("{relation} of {name}")));
    if let Some(set_name) = set_name {
        source_value.condition_string = Some(format!("{relation} of {set_name}"));
    }
}

fn is_prior_phase_set(
    event: &EventSnapshot,
    source: &crate::models::SetSnapshot,
    target: &crate::models::SetSnapshot,
) -> bool {
    match (
        crate::models::phase_sequence_index_for_set(event, source),
        crate::models::phase_sequence_index_for_set(event, target),
    ) {
        (Some(source_index), Some(target_index)) => source_index < target_index,
        _ => source
            .phase_order
            .zip(target.phase_order)
            .is_some_and(|(source_order, target_order)| source_order < target_order),
    }
}

fn pick_pair_source_indexes(
    previous_count: usize,
    current_count: usize,
    current_index: usize,
) -> Vec<usize> {
    if previous_count == 0 || current_count == 0 {
        return Vec::new();
    }

    if previous_count == 1 {
        return vec![0];
    }

    if previous_count >= current_count * 2 {
        let first = current_index * 2;
        let second = current_index * 2 + 1;
        return [Some(first), Some(second)]
            .into_iter()
            .flatten()
            .filter(|index| *index < previous_count)
            .collect();
    }

    let mapped =
        ((current_index as f64 + 0.5) * previous_count as f64) / current_count as f64 - 0.5;
    let left = mapped.floor().max(0.0) as usize;
    let right = mapped.ceil().min((previous_count.saturating_sub(1)) as f64) as usize;

    if left == right {
        return vec![left];
    }

    vec![left, right]
}

fn format_alphabet_sequence(index: usize) -> String {
    let mut n = index as i64;
    let mut label = String::new();

    loop {
        let remainder = (n % 26) as u8;
        label.insert(0, (b'A' + remainder) as char);
        n = n / 26 - 1;
        if n < 0 {
            break;
        }
    }

    label
}

fn pick_pair_source_ids(
    previous_set_ids: &[String],
    current_count: usize,
    current_index: usize,
) -> Vec<String> {
    pick_pair_source_indexes(previous_set_ids.len(), current_count, current_index)
        .into_iter()
        .filter_map(|index| previous_set_ids.get(index).cloned())
        .collect()
}

fn normalize_source_text(kind: &str, set_code: &str) -> String {
    format!("{kind} of {set_code}")
}

fn is_grand_final_reset_set(set: &crate::models::SetSnapshot) -> bool {
    is_grand_final_set(set) && set.full_round_text.to_lowercase().contains("reset")
}

fn is_round_transition_exception(set: &crate::models::SetSnapshot) -> bool {
    if is_grand_final_reset_set(set) {
        return true;
    }

    let round_text = set.full_round_text.trim().to_lowercase();
    [
        "3rd place",
        "third place",
        "5th place",
        "fifth place",
        "3位決定戦",
        "5位決定戦",
    ]
    .iter()
    .any(|label| round_text.contains(label))
}

fn is_allowed_same_side_round_transition(
    source: &crate::models::SetSnapshot,
    target: &crate::models::SetSnapshot,
    relation: &str,
) -> bool {
    if is_round_transition_exception(source)
        || is_round_transition_exception(target)
        || graph_phase_group_key(source) != graph_phase_group_key(target)
        || !relation.eq_ignore_ascii_case("winner")
        || is_losers_set(source) != is_losers_set(target)
    {
        return true;
    }

    let (Some(source_round), Some(target_round)) = (bracket_round(source), bracket_round(target))
    else {
        return true;
    };

    if source_round > 0 {
        source_round.checked_add(1) == Some(target_round)
    } else if source_round < 0 {
        source_round.checked_sub(1) == Some(target_round)
    } else {
        true
    }
}

fn winners_to_losers_round_match(
    source: &crate::models::SetSnapshot,
    target: &crate::models::SetSnapshot,
    relation: &str,
    winners_to_losers_rounds_by_group: &WinnersToLosersRoundMap,
) -> Option<bool> {
    if is_round_transition_exception(source)
        || is_round_transition_exception(target)
        || !relation.eq_ignore_ascii_case("loser")
        || is_losers_set(source)
        || !is_losers_set(target)
        || graph_phase_group_key(source) != graph_phase_group_key(target)
    {
        return None;
    }

    let (Some(source_round), Some(target_round)) = (bracket_round(source), bracket_round(target))
    else {
        return None;
    };
    if source_round <= 0 || target_round >= 0 {
        return None;
    }

    let destination_rounds =
        winners_to_losers_rounds_by_group.get(&graph_phase_group_key(source))?;
    if let Some(destination_rounds) = destination_rounds.get(&source_round) {
        if destination_rounds.len() == 1 {
            return Some(destination_rounds.contains(&target_round));
        }
    }

    let nearest_lower_source_round = destination_rounds
        .iter()
        .filter_map(|(&round, destinations)| {
            if round < source_round && destinations.len() == 1 {
                Some((round, *destinations.iter().next()?))
            } else {
                None
            }
        })
        .max_by_key(|(round, _)| *round);
    let nearest_higher_source_round = destination_rounds
        .iter()
        .filter_map(|(&round, destinations)| {
            if round > source_round && destinations.len() == 1 {
                Some((round, *destinations.iter().next()?))
            } else {
                None
            }
        })
        .min_by_key(|(round, _)| *round);
    if nearest_lower_source_round.is_none() && nearest_higher_source_round.is_none() {
        return None;
    }

    let is_below_lower_destination = nearest_lower_source_round
        .is_none_or(|(_, destination_round)| target_round < destination_round);
    let is_above_higher_destination = nearest_higher_source_round
        .is_none_or(|(_, destination_round)| target_round > destination_round);
    Some(is_below_lower_destination && is_above_higher_destination)
}

fn is_allowed_round_transition(
    source: &crate::models::SetSnapshot,
    target: &crate::models::SetSnapshot,
    relation: &str,
    winners_to_losers_rounds_by_group: &WinnersToLosersRoundMap,
) -> bool {
    is_allowed_same_side_round_transition(source, target, relation)
        && winners_to_losers_round_match(
            source,
            target,
            relation,
            winners_to_losers_rounds_by_group,
        )
        .unwrap_or(true)
}

const VIRTUAL_GF_RESET_SET_ID_PREFIX: &str = "virtual_gf_reset_";

fn virtual_grand_final_reset_set_id(grand_final_set_id: &str) -> String {
    format!("{VIRTUAL_GF_RESET_SET_ID_PREFIX}{grand_final_set_id}")
}

fn source_grand_final_set_id_from_virtual_reset_set_id(set_id: &str) -> Option<String> {
    let source = set_id.strip_prefix(VIRTUAL_GF_RESET_SET_ID_PREFIX)?;
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_owned())
}

fn source_targets_losers_side(
    event: &EventSnapshot,
    source: &crate::models::SetEntrantSourceSnapshot,
) -> Option<bool> {
    if let Some(type_id) = resolved_source_set_id(source) {
        let normalized = type_id.trim();
        if !normalized.is_empty() {
            if let Some(source_set) = event.sets.iter().find(|set| set.set_id == normalized) {
                return Some(is_losers_set(source_set));
            }
        }
    }

    let condition_tokens = source
        .condition_string
        .as_deref()
        .map(normalized_reference_tokens)
        .unwrap_or_default();
    if condition_tokens.is_empty() {
        return None;
    }

    let set_display_code_by_id = build_set_display_code_by_id(event);
    let mut best_match: Option<(usize, bool)> = None;

    for (set_id, code) in &set_display_code_by_id {
        let normalized_code = normalize_reference_text(code);
        if normalized_code.is_empty() {
            continue;
        }

        if !condition_tokens
            .iter()
            .any(|token| token == &normalized_code)
        {
            continue;
        }

        let Some(source_set) = event.sets.iter().find(|set| set.set_id == *set_id) else {
            continue;
        };

        let rank = normalized_code.len();
        let is_losers = is_losers_set(source_set);
        match best_match {
            None => best_match = Some((rank, is_losers)),
            Some((best_rank, _)) if rank > best_rank => best_match = Some((rank, is_losers)),
            _ => {}
        }
    }

    best_match.map(|(_, is_losers)| is_losers)
}

fn same_phase_pool(left: &crate::models::SetSnapshot, right: &crate::models::SetSnapshot) -> bool {
    normalize_group_key(left.phase_name.as_ref()) == normalize_group_key(right.phase_name.as_ref())
        && normalize_group_key(left.phase_group_name.as_ref())
            == normalize_group_key(right.phase_group_name.as_ref())
}

fn same_phase_group(left: &crate::models::SetSnapshot, right: &crate::models::SetSnapshot) -> bool {
    if let (Some(left_id), Some(right_id)) = (
        left.phase_group_id.as_deref(),
        right.phase_group_id.as_deref(),
    ) {
        return left_id == right_id;
    }

    if left.phase_order.is_some()
        && right.phase_order.is_some()
        && left.phase_order != right.phase_order
    {
        return false;
    }

    let left_group = normalize_group_key(
        left.phase_group_display_identifier
            .as_ref()
            .or(left.phase_group_name.as_ref()),
    );
    let right_group = normalize_group_key(
        right
            .phase_group_display_identifier
            .as_ref()
            .or(right.phase_group_name.as_ref()),
    );
    if !left_group.is_empty() && !right_group.is_empty() {
        return left_group == right_group;
    }

    let left_phase = normalize_group_key(left.phase_name.as_ref());
    let right_phase = normalize_group_key(right.phase_name.as_ref());
    !left_phase.is_empty() && left_phase == right_phase
}

fn winner_is_from_losers_side(
    event: &EventSnapshot,
    grand_final_set: &crate::models::SetSnapshot,
    winner_id: &str,
) -> bool {
    let mut inferred_from_source = None;

    let winner_slot_index = grand_final_set
        .slots
        .iter()
        .position(|slot| slot.entrant_id.as_deref() == Some(winner_id));
    if let Some(slot_index) = winner_slot_index {
        if let Some(source) = entrant_source_for_slot(grand_final_set, slot_index) {
            inferred_from_source = source_targets_losers_side(event, source);

            if inferred_from_source.is_none() {
                if let Some(kind) = source_kind_from_api_source(source) {
                    inferred_from_source = Some(kind == "loser");
                }
            }
        }
    }

    if let Some(is_losers_side) = inferred_from_source {
        return is_losers_side;
    }

    let found_in_losers_lane = event.sets.iter().any(|set| {
        if !is_losers_set(set) || !same_phase_group(set, grand_final_set) {
            return false;
        }

        if set.winner_id.as_deref() == Some(winner_id) {
            return true;
        }

        // Losers側の試合に一度でも出場していれば、GFではLosers側由来として扱う。
        // winner_id が未確定の中間進行でも GF Reset 生成を取りこぼさないため。
        set.slots
            .iter()
            .any(|slot| slot.entrant_id.as_deref() == Some(winner_id))
    });

    if found_in_losers_lane {
        return true;
    }

    false
}

fn is_inactive_grand_final_reset_set(
    event: &EventSnapshot,
    reset_set: &crate::models::SetSnapshot,
) -> bool {
    if !is_grand_final_reset_set(reset_set) {
        return false;
    }

    let Some(grand_final) = event.sets.iter().find(|set| {
        is_grand_final_set(set)
            && !is_grand_final_reset_set(set)
            && same_phase_group(set, reset_set)
    }) else {
        return true;
    };
    !grand_final
        .winner_id
        .as_deref()
        .is_some_and(|winner_id| winner_is_from_losers_side(event, grand_final, winner_id))
}

fn move_entrant_slot_first(slots: &mut [crate::models::SetSlotSnapshot], entrant_id: &str) -> bool {
    let Some(entrant_index) = slots
        .iter()
        .position(|slot| slot.entrant_id.as_deref() == Some(entrant_id))
    else {
        return false;
    };
    if entrant_index == 0 {
        return false;
    }

    slots.swap(0, entrant_index);
    true
}

fn ordered_grand_final_reset_slots(
    grand_final_set: &crate::models::SetSnapshot,
) -> Vec<crate::models::SetSlotSnapshot> {
    let mut slots = grand_final_set
        .slots
        .iter()
        .map(|slot| crate::models::SetSlotSnapshot {
            entrant_id: slot.entrant_id.clone(),
            entrant_name: slot.entrant_name.clone(),
            seed_id: slot.seed_id.clone(),
            seed_num: slot.seed_num,
            seed_placeholder_name: slot.seed_placeholder_name.clone(),
            seed_origin_phase_group_id: slot.seed_origin_phase_group_id.clone(),
            seed_origin_phase_group_display_identifier: slot
                .seed_origin_phase_group_display_identifier
                .clone(),
            seed_origin_phase_order: slot.seed_origin_phase_order,
            seed_origin_placement: slot.seed_origin_placement,
            seed_origin_order: slot.seed_origin_order,
            score: None,
        })
        .collect::<Vec<_>>();
    if let Some(winner_id) = grand_final_set.winner_id.as_deref() {
        move_entrant_slot_first(&mut slots, winner_id);
    }
    slots
}

#[cfg(test)]
#[path = "storage/tests/grand_final_reset_order_tests.rs"]
mod grand_final_reset_order_tests;

fn ensure_virtual_grand_final_reset_set(
    event: &mut EventSnapshot,
    grand_final_set: &crate::models::SetSnapshot,
) {
    if event.sets.iter().any(|set| {
        is_grand_final_reset_set(set)
            && source_grand_final_set_id_from_virtual_reset_set_id(&set.set_id).is_none()
            && same_phase_pool(set, grand_final_set)
    }) {
        return;
    }

    let virtual_set_id = virtual_grand_final_reset_set_id(&grand_final_set.set_id);
    if let Some(virtual_set) = event
        .sets
        .iter_mut()
        .find(|set| set.set_id == virtual_set_id)
    {
        if virtual_set.winner_id.is_some() {
            return;
        }
        let mut slots = ordered_grand_final_reset_slots(grand_final_set);
        for slot in &mut slots {
            slot.score = virtual_set
                .slots
                .iter()
                .find(|existing| existing.entrant_id == slot.entrant_id)
                .and_then(|existing| existing.score);
        }
        virtual_set.slots = slots;
        virtual_set.state = if empty_slot_count(virtual_set) == 0 {
            2
        } else {
            1
        };
        return;
    }

    let slots = ordered_grand_final_reset_slots(grand_final_set);
    let has_empty = slots.iter().any(|slot| {
        slot.entrant_id.is_none() || slot.entrant_name.trim().eq_ignore_ascii_case("tbd")
    });

    event.sets.push(crate::models::SetSnapshot {
        set_id: virtual_set_id,
        phase_group_id: grand_final_set.phase_group_id.clone(),
        identifier: None,
        full_round_text: "Grand Final Reset".to_owned(),
        round: grand_final_set.round,
        phase_name: grand_final_set.phase_name.clone(),
        phase_group_name: grand_final_set.phase_group_name.clone(),
        phase_order: grand_final_set.phase_order,
        phase_group_display_identifier: grand_final_set.phase_group_display_identifier.clone(),
        phase_group_set_name: None,
        is_intermediate: false,
        state: if has_empty { 1 } else { 2 },
        winner_id: None,
        winner_placement: None,
        loser_placement: None,
        entrant1_source: None,
        entrant2_source: None,
        winner_progression_seed_id: None,
        winner_progression_id: None,
        winner_progression_seed_num: None,
        winner_progression_seed_placeholder_name: None,
        winner_progression_origin_phase_group_id: None,
        winner_progression_origin_phase_group_display_identifier: None,
        winner_progression_origin_phase_order: None,
        winner_progression_origin_placement: None,
        winner_progression_origin_order: None,
        loser_progression_seed_id: None,
        loser_progression_id: None,
        loser_progression_seed_num: None,
        loser_progression_seed_placeholder_name: None,
        loser_progression_origin_phase_group_id: None,
        loser_progression_origin_phase_group_display_identifier: None,
        loser_progression_origin_phase_order: None,
        loser_progression_origin_placement: None,
        loser_progression_origin_order: None,
        slots,
    });
}

fn hydrate_existing_grand_final_reset_sets(
    event: &mut EventSnapshot,
    grand_final_set: &crate::models::SetSnapshot,
) -> bool {
    let mut found = false;

    for reset_set in &mut event.sets {
        if !is_grand_final_reset_set(reset_set)
            || source_grand_final_set_id_from_virtual_reset_set_id(&reset_set.set_id).is_some()
            || !same_phase_pool(reset_set, grand_final_set)
        {
            continue;
        }

        found = true;
        if reset_set.winner_id.is_some() {
            continue;
        }

        let mut changed = false;

        while reset_set.slots.len() < grand_final_set.slots.len() {
            reset_set.slots.push(crate::models::SetSlotSnapshot {
                entrant_id: None,
                entrant_name: "TBD".to_owned(),
                seed_id: None,
                seed_num: None,
                seed_placeholder_name: None,
                seed_origin_phase_group_id: None,
                seed_origin_phase_group_display_identifier: None,
                seed_origin_phase_order: None,
                seed_origin_placement: None,
                seed_origin_order: None,
                score: None,
            });
        }

        for (slot_index, gf_slot) in grand_final_set.slots.iter().rev().enumerate() {
            let Some(reset_slot) = reset_set.slots.get_mut(slot_index) else {
                break;
            };

            if reset_slot.entrant_id.is_some() || gf_slot.entrant_id.is_none() {
                continue;
            }

            reset_slot.entrant_id = gf_slot.entrant_id.clone();
            reset_slot.entrant_name = gf_slot.entrant_name.clone();
            reset_slot.seed_id = gf_slot.seed_id.clone();
            reset_slot.seed_num = gf_slot.seed_num;
            reset_slot.score = None;
            changed = true;
        }

        if changed {
            reset_set.state = if empty_slot_count(reset_set) == 0 {
                2
            } else {
                1
            };
        }
    }

    found
}

fn build_set_display_code_by_id(event: &EventSnapshot) -> HashMap<String, String> {
    let mut ordered_sets = event.sets.iter().cloned().collect::<Vec<_>>();
    ordered_sets.sort_by(|left, right| {
        let left_is_losers = is_losers_set(left);
        let right_is_losers = is_losers_set(right);
        if left_is_losers != right_is_losers {
            return left_is_losers.cmp(&right_is_losers);
        }

        let left_is_gf = is_grand_final_set(left);
        let right_is_gf = is_grand_final_set(right);
        if left_is_gf != right_is_gf {
            return left_is_gf.cmp(&right_is_gf);
        }

        let left_is_reset = is_grand_final_reset_set(left);
        let right_is_reset = is_grand_final_reset_set(right);
        if left_is_reset != right_is_reset {
            return left_is_reset.cmp(&right_is_reset);
        }

        let left_round = left.round.unwrap_or(0).abs();
        let right_round = right.round.unwrap_or(0).abs();
        if left_round != right_round {
            return left_round.cmp(&right_round);
        }

        left.set_id.cmp(&right.set_id)
    });

    let ordered_ids = ordered_sets
        .into_iter()
        .map(|set| set.set_id.clone())
        .collect::<Vec<String>>();

    let mut map = HashMap::new();
    let mut used = HashSet::new();
    let mut next_code_index = 0_usize;
    let mut gf_seen = false;
    let mut reserved_after_gf = false;

    for set_id in ordered_ids {
        let current_set = event.sets.iter().find(|set| set.set_id == set_id).cloned();
        if let Some(identifier) = current_set
            .as_ref()
            .and_then(|set| set.identifier.as_deref())
            .map(str::trim)
            .filter(|identifier| !identifier.is_empty())
        {
            map.insert(set_id.clone(), identifier.to_owned());
            used.insert(identifier.to_owned());
            continue;
        }
        let current_is_losers = current_set.as_ref().is_some_and(is_losers_set);
        let current_is_gf = current_set.as_ref().is_some_and(is_grand_final_set);
        let current_is_reset = current_set.as_ref().is_some_and(is_grand_final_reset_set);

        if current_is_losers && gf_seen && reserved_after_gf && !current_is_reset {
            // Grand Final の次にあり得る GF Reset の枠を一つ飛ばし、
            // Losers はその次のコードから割り当てる。
            next_code_index += 1;
            reserved_after_gf = false;
        }

        let mut code = format_alphabet_sequence(next_code_index);
        while used.contains(&code) {
            next_code_index += 1;
            code = format_alphabet_sequence(next_code_index);
        }

        map.insert(set_id.clone(), code.clone());
        used.insert(code);
        next_code_index += 1;

        if current_is_gf {
            gf_seen = true;
            reserved_after_gf = true;
        }

        if current_is_reset {
            reserved_after_gf = false;
        }
    }

    map
}

fn normalize_reference_text(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
}

fn normalized_reference_tokens(value: &str) -> Vec<String> {
    let mut tokens = value
        .split(|ch: char| !ch.is_alphanumeric())
        .map(normalize_reference_text)
        .filter(|token| !token.is_empty())
        .collect::<Vec<String>>();
    tokens.sort();
    tokens.dedup();
    tokens
}

fn entrant_source_for_slot(
    set: &crate::models::SetSnapshot,
    slot_index: usize,
) -> Option<&crate::models::SetEntrantSourceSnapshot> {
    match slot_index {
        0 => set.entrant1_source.as_ref(),
        1 => set.entrant2_source.as_ref(),
        _ => None,
    }
}

fn normalize_source_condition(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|ch| *ch != '_' && *ch != '-' && !ch.is_whitespace())
        .collect::<String>()
}

fn source_kind_from_api_source(
    source: &crate::models::SetEntrantSourceSnapshot,
) -> Option<&'static str> {
    let merged = format!(
        "{} {}",
        source.condition.as_deref().unwrap_or_default(),
        source.condition_string.as_deref().unwrap_or_default()
    );
    let normalized = normalize_source_condition(&merged);
    if normalized.contains("loser") {
        return Some("loser");
    }
    if normalized.contains("winner") {
        return Some("winner");
    }
    None
}

fn source_set_code_from_api_source(
    source: &crate::models::SetEntrantSourceSnapshot,
    set_display_code_by_id: &HashMap<String, String>,
) -> Option<String> {
    if let Some(type_id) = resolved_source_set_id(source) {
        let trimmed = type_id.trim();
        if !trimmed.is_empty() {
            if let Some(code) = set_display_code_by_id.get(trimmed) {
                return Some(code.clone());
            }
        }
    }

    let condition_tokens = source
        .condition_string
        .as_deref()
        .map(normalized_reference_tokens)
        .unwrap_or_default();
    if condition_tokens.is_empty() {
        return None;
    }

    let mut best_match: Option<(usize, String)> = None;
    for code in set_display_code_by_id.values() {
        let normalized_code = normalize_reference_text(code);
        if normalized_code.is_empty() {
            continue;
        }

        let is_match = condition_tokens
            .iter()
            .any(|token| token == &normalized_code);
        if !is_match {
            continue;
        }

        let rank = normalized_code.len();
        match &best_match {
            None => best_match = Some((rank, code.clone())),
            Some((best_rank, best_code)) => {
                if rank > *best_rank || (rank == *best_rank && code < best_code) {
                    best_match = Some((rank, code.clone()));
                }
            }
        }
    }

    best_match.map(|(_, code)| code)
}

fn source_set_id_and_code_from_api_source(
    source: &crate::models::SetEntrantSourceSnapshot,
    set_display_code_by_id: &HashMap<String, String>,
) -> Option<(String, String)> {
    if let Some(type_id) = resolved_source_set_id(source) {
        let trimmed = type_id.trim();
        if !trimmed.is_empty() {
            if let Some(code) = set_display_code_by_id.get(trimmed) {
                return Some((trimmed.to_owned(), code.clone()));
            }
        }
    }

    let source_code = source_set_code_from_api_source(source, set_display_code_by_id)?;
    let normalized_source_code = normalize_reference_text(&source_code);
    let source_set_id = set_display_code_by_id.iter().find_map(|(set_id, code)| {
        if normalize_reference_text(code) == normalized_source_code {
            Some(set_id.clone())
        } else {
            None
        }
    })?;

    Some((source_set_id, source_code))
}

fn build_api_tbd_source_labels(event: &EventSnapshot) -> HashMap<String, String> {
    let set_display_code_by_id = build_set_display_code_by_id(event);
    let source_is_losers_by_set_id = event
        .sets
        .iter()
        .map(|set| (set.set_id.clone(), is_losers_set(set)))
        .collect::<HashMap<String, bool>>();
    let mut labels = HashMap::new();

    for set in &event.sets {
        let target_is_losers = is_losers_set(set);
        for slot_index in 0..set.slots.len() {
            let Some(slot) = set.slots.get(slot_index) else {
                continue;
            };
            if !is_slot_empty(slot) {
                continue;
            }

            let Some(source) = entrant_source_for_slot(set, slot_index) else {
                continue;
            };
            let source_label =
                source_set_id_and_code_from_api_source(source, &set_display_code_by_id).map(
                    |(source_set_id, source_set_code)| {
                        let kind = if target_is_losers {
                            // Losers側は「Winners由来なら loser of / Losers由来なら winner of」を優先する。
                            let source_is_losers = source_is_losers_by_set_id
                                .get(&source_set_id)
                                .copied()
                                .unwrap_or(false);
                            if source_is_losers {
                                "winner"
                            } else {
                                "loser"
                            }
                        } else {
                            source_kind_from_api_source(source).unwrap_or("winner")
                        };
                        normalize_source_text(kind, &source_set_code)
                    },
                );
            let placeholder_name = source
                .placeholder_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty());
            if let Some(label) = source_label.or_else(|| placeholder_name.map(str::to_owned)) {
                labels.insert(format!("{}:{}", set.set_id, slot_index), label);
            }
        }
    }

    labels
}

fn apply_source_based_tbd_labels(event: &mut EventSnapshot) {
    let labels = build_api_tbd_source_labels(event);
    let set_display_code_by_id = build_set_display_code_by_id(event);
    let known_entrant_names = event
        .sets
        .iter()
        .flat_map(|set| set.slots.iter())
        .filter_map(|slot| {
            let entrant_id = slot.entrant_id.as_ref()?;
            is_resolved_entrant_name(&slot.entrant_name)
                .then(|| (entrant_id.clone(), slot.entrant_name.clone()))
        })
        .collect::<HashMap<_, _>>();
    for set_index in 0..event.sets.len() {
        for slot_index in 0..event.sets[set_index].slots.len() {
            let key = format!("{}:{}", event.sets[set_index].set_id, slot_index);
            let label = labels.get(&key);

            let Some(slot) = event.sets[set_index].slots.get(slot_index) else {
                continue;
            };
            let existing_entrant_id = slot.entrant_id.clone();
            if existing_entrant_id.is_some() && is_resolved_entrant_name(&slot.entrant_name) {
                continue;
            }
            if let Some(entrant_id) = existing_entrant_id.as_ref() {
                if let Some(entrant_name) = known_entrant_names.get(entrant_id) {
                    event.sets[set_index].slots[slot_index].entrant_name = entrant_name.clone();
                    continue;
                }
            } else if !is_slot_empty(slot) {
                continue;
            }

            let target_is_losers = is_losers_set(&event.sets[set_index]);
            let source = entrant_source_for_slot(&event.sets[set_index], slot_index).cloned();
            let placeholder_name = label
                .cloned()
                .or_else(|| {
                    event.sets[set_index].slots[slot_index]
                        .seed_placeholder_name
                        .clone()
                })
                .or_else(|| {
                    source
                        .as_ref()
                        .and_then(|source| source.placeholder_name.clone())
                });
            let source_entrant = source.as_ref().and_then(|source| {
                let source_set_id =
                    source_set_id_and_code_from_api_source(source, &set_display_code_by_id)
                        .map(|(set_id, _)| set_id)?;
                let source_set = event
                    .sets
                    .iter()
                    .find(|candidate| candidate.set_id == source_set_id)?;
                let source_is_losers = is_losers_set(source_set);
                let kind = if target_is_losers {
                    if source_is_losers {
                        "winner"
                    } else {
                        "loser"
                    }
                } else {
                    source_kind_from_api_source(source).unwrap_or("winner")
                };
                match kind {
                    "winner" => source_set.winner_id.as_ref().and_then(|entrant_id| {
                        source_set
                            .slots
                            .iter()
                            .find(|candidate| candidate.entrant_id.as_ref() == Some(entrant_id))
                            .map(|candidate| (entrant_id.clone(), candidate.entrant_name.clone()))
                    }),
                    "loser" => source_set.winner_id.as_ref().and_then(|winner_id| {
                        source_set
                            .slots
                            .iter()
                            .find(|candidate| {
                                candidate.entrant_id.is_some()
                                    && candidate.entrant_id.as_ref() != Some(winner_id)
                            })
                            .and_then(|candidate| {
                                candidate
                                    .entrant_id
                                    .clone()
                                    .map(|entrant_id| (entrant_id, candidate.entrant_name.clone()))
                            })
                    }),
                    _ => None,
                }
            });

            let Some(slot) = event.sets[set_index].slots.get_mut(slot_index) else {
                continue;
            };
            if let Some((entrant_id, entrant_name)) = source_entrant {
                if existing_entrant_id
                    .as_deref()
                    .is_some_and(|existing_id| existing_id != entrant_id)
                {
                    continue;
                }
                slot.entrant_id = Some(entrant_id);
                slot.entrant_name = entrant_name;
                continue;
            }
            if existing_entrant_id.is_some() {
                continue;
            }
            slot.entrant_name = placeholder_name.unwrap_or_else(|| "TBD".to_owned());
        }
    }
}

#[cfg(test)]
fn advance_completed_set_to_next_real_sets(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    winner_id: &str,
    winner_name: &str,
    loser: Option<(&str, &str)>,
) {
    let source_lookup = SourceRelationLookup::new(event);
    let mut winner_placed = false;
    let mut loser_placed = false;
    for target_index in 0..event.sets.len() {
        if winner_placed && loser_placed {
            break;
        }

        let target_is_eligible = {
            let target = &event.sets[target_index];
            target.set_id != source_set.set_id
                && !crate::models::is_intermediate_set(&event.phase_groups, target)
                && !((source_set.winner_placement.is_some()
                    || source_set.loser_placement.is_some())
                    && is_later_phase_in_event_order(event, target, source_set))
        };
        if !target_is_eligible {
            continue;
        }

        let mut target_has_match = false;
        let slot_count = event.sets[target_index].slots.len().min(2);
        for slot_index in 0..slot_count {
            let source = {
                let target = &event.sets[target_index];
                match slot_index {
                    0 => target.entrant1_source.as_ref(),
                    1 => target.entrant2_source.as_ref(),
                    _ => None,
                }
            };
            let Some(relation) = source.and_then(|source| {
                source_relation_reaches_set(
                    event,
                    source,
                    source_set,
                    &mut HashSet::new(),
                    &source_lookup,
                )
            }) else {
                continue;
            };
            let entrant = match relation {
                "winner" => Some((winner_id, winner_name)),
                "loser" => loser,
                _ => None,
            };
            let Some((entrant_id, entrant_name)) = entrant else {
                continue;
            };
            target_has_match = true;
            if (relation == "winner" && winner_placed) || (relation == "loser" && loser_placed) {
                continue;
            }
            if let Some(slot) = event.sets[target_index].slots.get_mut(slot_index) {
                slot.entrant_id = Some(entrant_id.to_owned());
                slot.entrant_name = entrant_name.to_owned();
                slot.score = None;
                match relation {
                    "winner" => winner_placed = true,
                    "loser" => loser_placed = true,
                    _ => {}
                }
            }
        }

        if target_has_match {
            let target = &mut event.sets[target_index];
            if empty_slot_count(target) == 0 && target.state == 1 {
                target.state = 2;
            }
        }
    }
}

fn source_relation_reaches_set(
    event: &EventSnapshot,
    source: &crate::models::SetEntrantSourceSnapshot,
    source_set: &crate::models::SetSnapshot,
    visited: &mut HashSet<String>,
    lookup: &SourceRelationLookup,
) -> Option<&'static str> {
    if source.source_type.as_deref() == Some("bye") {
        return None;
    }

    // start.gg の typeId は set ID ではなく progression seed ID になることがある。
    // その場合でも winner/loser progression の対応を優先して解決する。
    let progression_relation =
        if source.type_id.as_deref() == source_set.winner_progression_seed_id.as_deref() {
            Some("winner")
        } else if source.type_id.as_deref() == source_set.loser_progression_seed_id.as_deref() {
            Some("loser")
        } else if source.type_id.as_deref() == source_set.winner_progression_id.as_deref() {
            Some("winner")
        } else if source.type_id.as_deref() == source_set.loser_progression_id.as_deref() {
            Some("loser")
        } else {
            None
        };
    if let Some(relation) = progression_relation {
        return Some(relation);
    }

    let source_relation = match source.condition.as_deref() {
        Some("winner") => Some("winner"),
        Some("loser") => Some("loser"),
        _ => source_kind_from_api_source(source),
    };
    if let Some(resolved_set_id) = source.resolved_set_id.as_deref() {
        return if resolved_set_id == source_set.set_id {
            source_relation
        } else {
            None
        };
    }
    if source.type_id.as_deref() == Some(source_set.set_id.as_str()) {
        return source_relation;
    }

    // API のsourceにset IDがない場合のみconditionStringを使う。
    // 同じset記号が別Poolにもある場合は、誤流入を避けるため照合しない。
    let source_code = lookup
        .display_code_by_set_id
        .get(&source_set.set_id)
        .map(String::as_str)
        .or(source_set.identifier.as_deref())
        .or(source_set.phase_group_set_name.as_deref());
    if let Some(source_code) = source_code {
        let source_tokens = source
            .condition_string
            .as_deref()
            .map(normalized_reference_tokens)
            .unwrap_or_default();
        let normalized_code = normalize_reference_text(&source_code);
        let code_matches_unique = lookup
            .set_ids_by_normalized_code
            .get(&normalized_code)
            .is_some_and(|set_ids| {
                set_ids.len() == 1 && set_ids.contains(source_set.set_id.as_str())
            });
        if !normalized_code.is_empty()
            && source_tokens.iter().any(|token| token == &normalized_code)
            && code_matches_unique
        {
            return source_relation;
        }
    }

    let nested_set_id = resolved_source_set_id(source)?;
    if !visited.insert(nested_set_id.to_owned()) {
        return None;
    }
    let nested_set_index = lookup.set_index_by_id.get(nested_set_id)?;
    let nested_set = event.sets.get(*nested_set_index)?;
    if !lookup.intermediate_set_ids.contains(nested_set_id) {
        return None;
    }
    let nested_relation = [
        nested_set.entrant1_source.as_ref(),
        nested_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .find_map(|nested_source| {
        source_relation_reaches_set(event, nested_source, source_set, visited, lookup)
    })?;

    let connected_source_count = [
        nested_set.entrant1_source.as_ref(),
        nested_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .filter(|nested_source| {
        nested_source.condition.is_some() && resolved_source_set_id(nested_source).is_some()
    })
    .count();
    if connected_source_count == 1 {
        return Some(nested_relation);
    }

    (source_kind_from_api_source(source) == Some(nested_relation)).then_some(nested_relation)
}

struct SourceRelationLookup {
    display_code_by_set_id: HashMap<String, String>,
    set_ids_by_normalized_code: HashMap<String, HashSet<String>>,
    set_index_by_id: HashMap<String, usize>,
    intermediate_set_ids: HashSet<String>,
}

impl SourceRelationLookup {
    fn new(event: &EventSnapshot) -> Self {
        let display_code_by_set_id = build_set_display_code_by_id(event);
        let mut set_ids_by_normalized_code = HashMap::<String, HashSet<String>>::new();
        for (set_id, code) in &display_code_by_set_id {
            let normalized_code = normalize_reference_text(code);
            if !normalized_code.is_empty() {
                set_ids_by_normalized_code
                    .entry(normalized_code)
                    .or_default()
                    .insert(set_id.clone());
            }
        }

        let mut set_index_by_id = HashMap::with_capacity(event.sets.len());
        for (index, set) in event.sets.iter().enumerate() {
            set_index_by_id.entry(set.set_id.clone()).or_insert(index);
        }

        let phase_group_set_ids = event
            .phase_groups
            .iter()
            .flat_map(|group| group.set_ids.iter().cloned())
            .collect::<HashSet<_>>();
        let has_phase_group_set_ids = event
            .phase_groups
            .iter()
            .any(|group| !group.set_ids.is_empty());
        let intermediate_set_ids = event
            .sets
            .iter()
            .filter(|set| {
                if has_phase_group_set_ids {
                    !phase_group_set_ids.contains(&set.set_id)
                } else {
                    set.is_intermediate
                }
            })
            .map(|set| set.set_id.clone())
            .collect();

        Self {
            display_code_by_set_id,
            set_ids_by_normalized_code,
            set_index_by_id,
            intermediate_set_ids,
        }
    }
}

fn is_round_robin_set_in_event(event: &EventSnapshot, set: &crate::models::SetSnapshot) -> bool {
    event.phase_groups.iter().any(|group| {
        group.phase_group_id == set.phase_group_id.as_deref().unwrap_or_default()
            && group
                .bracket_type
                .as_deref()
                .is_some_and(|bracket_type| bracket_type.eq_ignore_ascii_case("ROUND_ROBIN"))
    })
}

#[cfg(test)]
fn advance_completed_set_by_placement(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    winner_id: &str,
    winner_name: &str,
    loser: Option<(&str, &str)>,
) {
    let Some(source_phase_order) = source_set.phase_order else {
        return;
    };
    let source_group_snapshot = event.phase_groups.iter().find(|group| {
        group.phase_order == Some(source_phase_order)
            && normalize_group_key(group.display_identifier.as_ref())
                == normalize_group_key(source_set.phase_group_display_identifier.as_ref())
    });
    let Some((target_phase_id, target_phase_order)) = next_phase_id_and_order(
        event,
        source_group_snapshot.and_then(|group| group.phase_id.as_deref()),
        source_phase_order,
    ) else {
        return;
    };
    let source_group = normalize_group_key(source_set.phase_group_display_identifier.as_ref());

    let participants = [
        source_set
            .winner_progression_seed_id
            .as_ref()
            .map(|_| source_set.winner_placement.unwrap_or(0))
            .map(|placement| {
                (
                    placement,
                    source_set.winner_progression_seed_id.as_deref(),
                    source_set.winner_progression_id.as_deref(),
                    source_set.winner_progression_origin_order,
                    winner_id,
                    winner_name,
                )
            }),
        source_set
            .loser_progression_seed_id
            .as_ref()
            .map(|_| source_set.loser_placement.unwrap_or(0))
            .and_then(|placement| {
                loser.map(|(id, name)| {
                    (
                        placement,
                        source_set.loser_progression_seed_id.as_deref(),
                        source_set.loser_progression_id.as_deref(),
                        source_set.loser_progression_origin_order,
                        id,
                        name,
                    )
                })
            }),
    ];

    for participant in participants.into_iter().flatten() {
        let (
            placement,
            progression_seed_id,
            progression_id,
            origin_order,
            entrant_id,
            entrant_name,
        ) = participant;
        let target_groups = event.phase_groups.iter().filter(|group| {
            group.phase_order == Some(target_phase_order)
                && target_phase_id
                    .as_deref()
                    .is_none_or(|phase_id| group.phase_id.as_deref() == Some(phase_id))
        });
        let target_group_and_seed = progression_seed_id
            .and_then(|progression_seed_id| {
                target_groups.clone().find_map(|group| {
                    group
                        .seeds
                        .iter()
                        .find(|seed| seed.seed_id == progression_seed_id)
                        .map(|seed| {
                            (
                                group.phase_group_id.clone(),
                                group.display_identifier.clone(),
                                seed.seed_id.clone(),
                            )
                        })
                })
            })
            .or_else(|| {
                progression_id.and_then(|progression_id| {
                    target_groups.clone().find_map(|group| {
                        group
                            .seeds
                            .iter()
                            .find(|seed| seed.progression_id.as_deref() == Some(progression_id))
                            .map(|seed| {
                                (
                                    group.phase_group_id.clone(),
                                    group.display_identifier.clone(),
                                    seed.seed_id.clone(),
                                )
                            })
                    })
                })
            });
        let progression_target_seed_id = target_group_and_seed
            .as_ref()
            .map(|(_, _, seed_id)| seed_id.as_str());
        let target_group_display_identifier = target_group_and_seed
            .as_ref()
            .and_then(|(_, display_identifier, _)| display_identifier.as_ref());
        let Some(target_index) = event.sets.iter().position(|target| {
            target.phase_order == Some(target_phase_order)
                && target_group_display_identifier.is_none_or(|display_identifier| {
                    normalize_group_key(target.phase_group_display_identifier.as_ref())
                        == normalize_group_key(Some(display_identifier))
                })
                && target.slots.iter().any(|slot| {
                    is_slot_empty(slot)
                        && if let Some(seed_id) = progression_target_seed_id {
                            slot.seed_id.as_deref() == Some(seed_id)
                        } else {
                            progression_seed_id
                                .is_none_or(|seed_id| slot.seed_id.as_deref() == Some(seed_id))
                                || (slot.seed_origin_phase_order == Some(source_phase_order)
                                    && normalize_group_key(
                                        slot.seed_origin_phase_group_display_identifier.as_ref(),
                                    ) == source_group
                                    && slot.seed_origin_placement == Some(placement)
                                    && origin_order
                                        .is_none_or(|order| slot.seed_origin_order == Some(order)))
                        }
                })
        }) else {
            continue;
        };
        set_phase_group_seed_entrant(
            event,
            target_phase_order,
            target_group_and_seed
                .as_ref()
                .map(|(group_id, _, _)| group_id.as_str()),
            source_phase_order,
            &source_group,
            placement,
            origin_order,
            progression_id,
            progression_target_seed_id,
            entrant_id,
            entrant_name,
        );
        let Some(target) = event.sets.get_mut(target_index) else {
            continue;
        };
        let Some(slot_index) = target
            .slots
            .iter()
            .enumerate()
            .filter(|(_, slot)| {
                is_slot_empty(slot)
                    && if let Some(seed_id) = progression_target_seed_id {
                        slot.seed_id.as_deref() == Some(seed_id)
                    } else {
                        progression_seed_id
                            .is_none_or(|seed_id| slot.seed_id.as_deref() == Some(seed_id))
                            || (slot.seed_origin_phase_order == Some(source_phase_order)
                                && normalize_group_key(
                                    slot.seed_origin_phase_group_display_identifier.as_ref(),
                                ) == source_group
                                && slot.seed_origin_placement == Some(placement)
                                && origin_order
                                    .is_none_or(|order| slot.seed_origin_order == Some(order)))
                    }
            })
            .min_by_key(|(_, slot)| slot.seed_origin_order.unwrap_or(i64::MAX))
            .map(|(index, _)| index)
        else {
            continue;
        };
        {
            let Some(slot) = target.slots.get_mut(slot_index) else {
                continue;
            };
            slot.entrant_id = Some(entrant_id.to_owned());
            slot.entrant_name = entrant_name.to_owned();
            slot.score = None;
        }
        let target_is_intermediate =
            crate::models::is_intermediate_set(&event.phase_groups, target);
        let target_set_id = target.set_id.clone();
        let target_is_ready = empty_slot_count(target) == 0 && target.state == 1;
        if target_is_ready {
            target.state = 2;
        }
        if target_is_intermediate {
            propagate_intermediate_entrant_to_real_sets(
                event,
                &target_set_id,
                if progression_seed_id == source_set.winner_progression_seed_id.as_deref() {
                    "winner"
                } else {
                    "loser"
                },
                entrant_id,
                entrant_name,
                &mut HashSet::new(),
            );
        }
    }
}

#[cfg(test)]
fn propagate_intermediate_entrant_to_real_sets(
    event: &mut EventSnapshot,
    source_set_id: &str,
    relation: &str,
    entrant_id: &str,
    entrant_name: &str,
    visited: &mut HashSet<String>,
) {
    if !visited.insert(source_set_id.to_owned()) {
        return;
    }

    let targets = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(target_index, target)| {
            if target.set_id == source_set_id {
                return None;
            }
            let slot_index = [
                target.entrant1_source.as_ref(),
                target.entrant2_source.as_ref(),
            ]
            .into_iter()
            .enumerate()
            .find_map(|(slot_index, source)| {
                let source = source?;
                let points_to_source = resolved_source_set_id(source) == Some(source_set_id)
                    && source.condition.as_deref() == Some(relation);
                points_to_source.then_some(slot_index)
            })?;
            Some((
                target_index,
                slot_index,
                crate::models::is_intermediate_set(&event.phase_groups, target),
                target.set_id.clone(),
            ))
        })
        .collect::<Vec<_>>();

    for (target_index, slot_index, is_intermediate, target_set_id) in targets {
        let Some(target) = event.sets.get_mut(target_index) else {
            continue;
        };
        let Some(slot) = target.slots.get_mut(slot_index) else {
            continue;
        };
        slot.entrant_id = Some(entrant_id.to_owned());
        slot.entrant_name = entrant_name.to_owned();
        slot.score = None;
        if empty_slot_count(target) == 0 && target.state == 1 {
            target.state = 2;
        }

        if is_intermediate {
            propagate_intermediate_entrant_to_real_sets(
                event,
                &target_set_id,
                relation,
                entrant_id,
                entrant_name,
                visited,
            );
        }
    }
}

#[cfg(test)]
fn set_phase_group_seed_entrant(
    event: &mut EventSnapshot,
    target_phase_order: i64,
    target_group_id: Option<&str>,
    source_phase_order: i64,
    source_group: &str,
    placement: i64,
    origin_order: Option<i64>,
    progression_id: Option<&str>,
    fallback_seed_id: Option<&str>,
    entrant_id: &str,
    entrant_name: &str,
) {
    for group in &mut event.phase_groups {
        if group.phase_order != Some(target_phase_order)
            || target_group_id.is_some_and(|group_id| group.phase_group_id != group_id)
        {
            continue;
        }
        for seed in &mut group.seeds {
            let origin_matches = seed.origin_phase_order == Some(source_phase_order)
                && normalize_group_key(seed.origin_phase_group_display_identifier.as_ref())
                    == source_group
                && seed.origin_placement == Some(placement)
                && origin_order.is_none_or(|order| seed.origin_order == Some(order));
            let seed_matches = fallback_seed_id == Some(seed.seed_id.as_str());
            let progression_matches =
                progression_id.is_some_and(|id| seed.progression_id.as_deref() == Some(id));
            let matches_target = if progression_id.is_some() || fallback_seed_id.is_some() {
                progression_matches || seed_matches
            } else {
                origin_matches
            };
            if !matches_target {
                continue;
            }
            seed.entrant_id = Some(entrant_id.to_owned());
            seed.entrant_name = Some(entrant_name.to_owned());
        }
    }
}

fn phase_group_key(set: &crate::models::SetSnapshot) -> String {
    if let Some(phase_group_id) = set.phase_group_id.as_deref() {
        return format!("id:{phase_group_id}");
    }
    format!(
        "{}::{}",
        set.phase_order
            .map(|order| order.to_string())
            .or_else(|| set.phase_name.clone())
            .unwrap_or_default(),
        set.phase_group_display_identifier
            .clone()
            .or_else(|| set.phase_group_name.clone())
            .unwrap_or_default(),
    )
}

fn graph_phase_group_key(set: &crate::models::SetSnapshot) -> String {
    format!(
        "{}::{}",
        set.phase_order
            .map(|order| order.to_string())
            .or_else(|| set.phase_name.clone())
            .unwrap_or_default(),
        set.phase_group_display_identifier
            .clone()
            .or_else(|| set.phase_group_name.clone())
            .unwrap_or_default(),
    )
}

fn next_phase_id_and_order(
    event: &EventSnapshot,
    source_phase_id: Option<&str>,
    source_phase_order: i64,
) -> Option<(Option<String>, i64)> {
    let source_index = event
        .phases
        .iter()
        .position(|phase| source_phase_id.is_some_and(|phase_id| phase.phase_id == phase_id))
        .or_else(|| {
            event
                .phases
                .iter()
                .position(|phase| phase.phase_order == Some(source_phase_order))
        })?;

    event.phases.get(source_index + 1).and_then(|phase| {
        phase
            .phase_order
            .map(|order| (Some(phase.phase_id.clone()), order))
    })
}

fn is_later_phase_in_event_order(
    event: &EventSnapshot,
    target: &crate::models::SetSnapshot,
    source: &crate::models::SetSnapshot,
) -> bool {
    match (
        crate::models::phase_sequence_index_for_set(event, target),
        crate::models::phase_sequence_index_for_set(event, source),
    ) {
        (Some(target_index), Some(source_index)) => target_index > source_index,
        _ => false,
    }
}

fn hydrate_progression_entrant_to_seed_slots(
    event: &mut EventSnapshot,
    target_seed: &PhaseGroupSeedSnapshot,
    entrant_id: &str,
    entrant_name: &str,
) -> HashSet<String> {
    let mut invalidated_set_ids = HashSet::new();
    for target in &mut event.sets {
        let had_result = target.winner_id.is_some()
            || target.state == 3
            || target.slots.iter().any(|slot| slot.score.is_some());
        let mut entrant_changed = false;
        for slot_index in 0..target.slots.len() {
            let Some(slot) = target.slots.get(slot_index) else {
                continue;
            };
            let source = entrant_source_for_slot(target, slot_index);
            let source_seed_matches = source.is_some_and(|source| {
                source.source_type.as_deref().is_some_and(|source_type| {
                    source_type.eq_ignore_ascii_case("seed")
                        && source.type_id.as_deref() == Some(target_seed.seed_id.as_str())
                })
            });
            let slot_seed_matches = slot.seed_id.as_deref() == Some(target_seed.seed_id.as_str());
            let source_progression_matches = source.is_some_and(|source| {
                source.source_type.as_deref().is_some_and(|source_type| {
                    source_type.eq_ignore_ascii_case("seed")
                        && target_seed
                            .progression_id
                            .as_deref()
                            .is_some_and(|progression_id| {
                                source.type_id.as_deref() == Some(progression_id)
                            })
                })
            });
            if !slot_seed_matches && !source_seed_matches && !source_progression_matches {
                continue;
            }

            let Some(slot) = target.slots.get_mut(slot_index) else {
                continue;
            };
            entrant_changed |= slot.entrant_id.as_deref() != Some(entrant_id);
            slot.entrant_id = Some(entrant_id.to_owned());
            slot.entrant_name = entrant_name.to_owned();
            slot.score = None;
        }

        if had_result && entrant_changed {
            clear_set_result_state(target);
        }
        if entrant_changed {
            invalidated_set_ids.insert(target.set_id.clone());
        }
        if empty_slot_count(target) == 0 && target.state == 1 {
            target.state = 2;
        }
    }
    invalidated_set_ids
}

fn is_round_robin_set(
    snapshot: &TournamentSnapshot,
    event_id: &str,
    set: &crate::models::SetSnapshot,
) -> bool {
    snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .and_then(|event| {
            event.phase_groups.iter().find(|group| {
                if let Some(phase_group_id) = set.phase_group_id.as_deref() {
                    return group.phase_group_id == phase_group_id;
                }
                group.phase_order == set.phase_order
                    && normalize_group_key(group.display_identifier.as_ref())
                        == normalize_group_key(set.phase_group_display_identifier.as_ref())
            })
        })
        .and_then(|group| group.bracket_type.as_deref())
        .is_some_and(|bracket_type| bracket_type.eq_ignore_ascii_case("ROUND_ROBIN"))
}

fn is_completed_round_robin_group(
    snapshot: &TournamentSnapshot,
    event_id: &str,
    set_id: &str,
) -> bool {
    let Some(event) = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
    else {
        return false;
    };
    let Some(target_set) = event.sets.iter().find(|set| set.set_id == set_id) else {
        return false;
    };
    if !is_round_robin_set(snapshot, event_id, target_set) {
        return false;
    }

    let group_key = phase_group_key(target_set);
    let group_sets = event
        .sets
        .iter()
        .filter(|set| phase_group_key(set) == group_key)
        .collect::<Vec<_>>();
    !group_sets.is_empty()
        && group_sets.iter().all(|set| {
            set.state == 3
                && set.winner_id.is_some()
                && set.slots.iter().all(|slot| slot.entrant_id.is_some())
        })
}

fn apply_completed_round_robin_progression(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    group_key: &str,
    invalidated_set_ids: &mut HashSet<String>,
) {
    let Some(event) = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
    else {
        return;
    };
    let Some(source_group) = event
        .sets
        .iter()
        .find(|set| phase_group_key(set) == group_key)
        .and_then(|set| {
            event.phase_groups.iter().find(|group| {
                if let Some(phase_group_id) = set.phase_group_id.as_deref() {
                    return group.phase_group_id == phase_group_id;
                }
                group.phase_order == set.phase_order
                    && normalize_group_key(group.display_identifier.as_ref())
                        == normalize_group_key(set.phase_group_display_identifier.as_ref())
            })
        })
        .cloned()
    else {
        return;
    };
    let Some(source_phase_order) = source_group.phase_order else {
        return;
    };
    let Some((target_phase_id, target_phase_order)) =
        next_phase_id_and_order(event, source_group.phase_id.as_deref(), source_phase_order)
    else {
        return;
    };

    let group_sets = event
        .sets
        .iter()
        .filter(|set| phase_group_key(set) == group_key)
        .collect::<Vec<_>>();
    if group_sets.is_empty()
        || group_sets
            .iter()
            .any(|set| set.state != 3 || set.winner_id.is_none())
    {
        return;
    }

    let mut wins = HashMap::<String, i64>::new();
    let mut game_wins = HashMap::<String, f64>::new();
    let mut game_losses = HashMap::<String, f64>::new();
    let mut head_to_head = HashMap::<(String, String), i64>::new();
    let seed_num_by_entrant_id = source_group
        .seeds
        .iter()
        .filter_map(|seed| Some((seed.entrant_id.clone()?, seed.seed_num?)))
        .collect::<HashMap<String, i64>>();
    for set in &group_sets {
        let Some(winner_id) = set.winner_id.as_ref() else {
            return;
        };
        for slot in &set.slots {
            let Some(entrant_id) = slot.entrant_id.as_ref() else {
                return;
            };
            wins.entry(entrant_id.clone()).or_insert(0);
        }
        if set.slots.len() == 2 {
            let first = &set.slots[0];
            let second = &set.slots[1];
            if let (Some(first_id), Some(second_id), Some(first_score), Some(second_score)) = (
                &first.entrant_id,
                &second.entrant_id,
                first.score,
                second.score,
            ) {
                let first_score = round_robin_game_score_for_tiebreak(first_score);
                let second_score = round_robin_game_score_for_tiebreak(second_score);
                *game_wins.entry(first_id.clone()).or_insert(0.0) += first_score;
                *game_losses.entry(first_id.clone()).or_insert(0.0) += second_score;
                *game_wins.entry(second_id.clone()).or_insert(0.0) += second_score;
                *game_losses.entry(second_id.clone()).or_insert(0.0) += first_score;
            }
        }
        *wins.entry(winner_id.clone()).or_insert(0) += 1;
        if set.slots.len() >= 2 {
            if let Some(loser_id) = set
                .slots
                .iter()
                .filter_map(|slot| slot.entrant_id.as_ref())
                .find(|entrant_id| *entrant_id != winner_id)
            {
                *head_to_head
                    .entry((winner_id.clone(), loser_id.clone()))
                    .or_insert(0) += 1;
            }
        }
    }

    let all_entrant_ids = wins.keys().cloned().collect::<Vec<_>>();
    let tiebreak_order = source_group.tiebreak_order.clone();
    let head_to_head_points = round_robin_tiebreak_head_to_head_points(
        &all_entrant_ids,
        &tiebreak_order,
        &wins,
        &game_wins,
        &game_losses,
        &head_to_head,
    );
    let mut standings = all_entrant_ids;
    standings.sort_by(|left, right| {
        if tiebreak_order.is_empty() {
            wins.get(right)
                .copied()
                .unwrap_or_default()
                .cmp(&wins.get(left).copied().unwrap_or_default())
        } else {
            for rule in &tiebreak_order {
                let rule_order = compare_round_robin_tiebreak(
                    rule,
                    left,
                    right,
                    &wins,
                    &game_wins,
                    &game_losses,
                    &head_to_head_points,
                );
                if rule_order != Ordering::Equal {
                    return rule_order;
                }
            }
            Ordering::Equal
        }
        .then_with(|| {
            seed_num_by_entrant_id
                .get(left)
                .cmp(&seed_num_by_entrant_id.get(right))
        })
        .then_with(|| left.cmp(right))
    });

    let mut progressions = source_group.progressions_out.clone();
    progressions.sort_by(|left, right| {
        left.origin_placement
            .unwrap_or(i64::MAX)
            .cmp(&right.origin_placement.unwrap_or(i64::MAX))
            .then_with(|| {
                left.origin_order
                    .unwrap_or(i64::MAX)
                    .cmp(&right.origin_order.unwrap_or(i64::MAX))
            })
    });
    let assignments = progressions.into_iter().zip(standings).collect::<Vec<_>>();
    let target_group_ids = event
        .phase_groups
        .iter()
        .filter(|group| {
            group.phase_order == Some(target_phase_order)
                && target_phase_id
                    .as_deref()
                    .is_none_or(|phase_id| group.phase_id.as_deref() == Some(phase_id))
        })
        .map(|group| group.phase_group_id.clone())
        .collect::<HashSet<_>>();
    let target_seeds = event
        .phase_groups
        .iter()
        .filter(|group| target_group_ids.contains(&group.phase_group_id))
        .flat_map(|group| group.seeds.iter())
        .cloned()
        .collect::<Vec<_>>();
    let mut entrant_names_by_id = HashMap::<String, String>::new();
    for slot in event.sets.iter().flat_map(|set| set.slots.iter()) {
        if let Some(entrant_id) = slot.entrant_id.as_ref() {
            entrant_names_by_id
                .entry(entrant_id.clone())
                .or_insert_with(|| slot.entrant_name.clone());
        }
    }
    let mut seed_group_indexes = HashMap::<String, Vec<usize>>::new();
    for (group_index, group) in event.phase_groups.iter().enumerate() {
        for seed in &group.seeds {
            seed_group_indexes
                .entry(seed.seed_id.clone())
                .or_default()
                .push(group_index);
        }
    }
    let Some(event) = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    else {
        return;
    };
    for (progression, entrant_id) in assignments {
        let target_seed = target_seeds
            .iter()
            .find(|seed| {
                seed.progression_id.as_deref() == Some(progression.progression_id.as_str())
            })
            .cloned()
            .or_else(|| {
                target_seeds
                    .iter()
                    .find(|seed| {
                        seed.progression_id.is_none()
                            && seed.origin_phase_order == Some(source_phase_order)
                            && normalize_group_key(
                                seed.origin_phase_group_display_identifier.as_ref(),
                            ) == normalize_group_key(source_group.display_identifier.as_ref())
                            && seed.origin_placement == progression.origin_placement
                            && (progression.origin_order.is_none()
                                || seed.origin_order == progression.origin_order)
                    })
                    .cloned()
            });
        let Some(target_seed) = target_seed else {
            continue;
        };
        let entrant_name = entrant_names_by_id
            .get(&entrant_id)
            .cloned()
            .unwrap_or_else(|| "TBD".to_owned());
        if let Some(group_indexes) = seed_group_indexes.get(&target_seed.seed_id) {
            for group_index in group_indexes {
                if let Some(seed) = event.phase_groups.get_mut(*group_index).and_then(|group| {
                    group
                        .seeds
                        .iter_mut()
                        .find(|seed| seed.seed_id == target_seed.seed_id)
                }) {
                    seed.entrant_id = Some(entrant_id.clone());
                    seed.entrant_name = Some(entrant_name.clone());
                }
            }
        }
        invalidated_set_ids.extend(hydrate_progression_entrant_to_seed_slots(
            event,
            &target_seed,
            &entrant_id,
            &entrant_name,
        ));
    }
}

fn round_robin_game_score_for_tiebreak(score: f64) -> f64 {
    if score == -1.0 {
        0.0
    } else {
        score
    }
}

#[cfg(test)]
#[path = "storage/tests/round_robin_completion_tests.rs"]
mod round_robin_completion_tests;

#[cfg(test)]
#[path = "storage/tests/round_robin_game_score_tests.rs"]
mod round_robin_game_score_tests;

fn compare_round_robin_tiebreak(
    rule: &str,
    left: &str,
    right: &str,
    wins: &HashMap<String, i64>,
    game_wins: &HashMap<String, f64>,
    game_losses: &HashMap<String, f64>,
    head_to_head_points: &HashMap<String, i64>,
) -> Ordering {
    let normalized = normalize_round_robin_tiebreak_rule(rule);
    match normalized.as_str() {
        "SETWINS" | "SETSWON" | "TOTALSETSWON" | "WINS" => wins
            .get(right)
            .copied()
            .unwrap_or_default()
            .cmp(&wins.get(left).copied().unwrap_or_default()),
        "GAMEWINS" => game_wins
            .get(right)
            .copied()
            .unwrap_or_default()
            .total_cmp(&game_wins.get(left).copied().unwrap_or_default()),
        "GAMERATIO" | "GAMEWINPERCENTAGE" | "GAMEPERCENTAGE" | "WINPERCENTAGE" => {
            let percentage = |entrant_id: &str| {
                let total = game_wins.get(entrant_id).copied().unwrap_or_default()
                    + game_losses.get(entrant_id).copied().unwrap_or_default();
                if total > 0.0 {
                    game_wins.get(entrant_id).copied().unwrap_or_default() / total
                } else {
                    0.0
                }
            };
            percentage(right).total_cmp(&percentage(left))
        }
        "HEADTOHEAD" | "HEADTOHEADWINS" => head_to_head_points
            .get(right)
            .copied()
            .unwrap_or_default()
            .cmp(&head_to_head_points.get(left).copied().unwrap_or_default()),
        _ => Ordering::Equal,
    }
}

fn normalize_round_robin_tiebreak_rule(rule: &str) -> String {
    rule.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_uppercase())
        .collect()
}

fn round_robin_tiebreak_head_to_head_points(
    entrants: &[String],
    tiebreak_order: &[String],
    wins: &HashMap<String, i64>,
    game_wins: &HashMap<String, f64>,
    game_losses: &HashMap<String, f64>,
    head_to_head: &HashMap<(String, String), i64>,
) -> HashMap<String, i64> {
    let Some(head_to_head_index) = tiebreak_order.iter().position(|rule| {
        matches!(
            normalize_round_robin_tiebreak_rule(rule).as_str(),
            "HEADTOHEAD" | "HEADTOHEADWINS"
        )
    }) else {
        return HashMap::new();
    };
    let preceding_rules = &tiebreak_order[..head_to_head_index];
    let empty_head_to_head_points = HashMap::new();

    entrants
        .iter()
        .map(|entrant_id| {
            let tied_entrants = entrants
                .iter()
                .filter(|candidate_id| {
                    preceding_rules.iter().all(|rule| {
                        compare_round_robin_tiebreak(
                            rule,
                            candidate_id,
                            entrant_id,
                            wins,
                            game_wins,
                            game_losses,
                            &empty_head_to_head_points,
                        ) == Ordering::Equal
                    })
                })
                .cloned()
                .collect::<Vec<_>>();
            (
                entrant_id.clone(),
                standings_head_to_head_points(entrant_id, &tied_entrants, head_to_head),
            )
        })
        .collect()
}

fn standings_head_to_head_points(
    entrant_id: &str,
    standings: &[String],
    head_to_head: &HashMap<(String, String), i64>,
) -> i64 {
    standings
        .iter()
        .filter(|opponent_id| opponent_id.as_str() != entrant_id)
        .map(|opponent_id| {
            head_to_head
                .get(&(entrant_id.to_owned(), opponent_id.clone()))
                .copied()
                .unwrap_or_default()
        })
        .sum()
}

#[cfg(test)]
#[path = "storage/tests/round_robin_head_to_head_tiebreak_tests.rs"]
mod round_robin_head_to_head_tiebreak_tests;

fn apply_local_progression(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    source_set_id: &str,
    winner_id: &str,
    targets_by_source: &HashMap<String, Vec<ProgressionTarget>>,
) {
    apply_local_progression_inner(
        snapshot,
        event_id,
        source_set_id,
        winner_id,
        targets_by_source,
    );
}

fn apply_local_progression_incremental(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    source_set_id: &str,
    winner_id: &str,
    targets_by_source: &HashMap<String, Vec<ProgressionTarget>>,
) -> HashSet<String> {
    apply_local_progression_inner(
        snapshot,
        event_id,
        source_set_id,
        winner_id,
        targets_by_source,
    )
}

fn apply_local_progression_inner(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    source_set_id: &str,
    winner_id: &str,
    targets_by_source: &HashMap<String, Vec<ProgressionTarget>>,
) -> HashSet<String> {
    let Some(event) = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    else {
        return HashSet::new();
    };

    let Some(source_set) = event
        .sets
        .iter()
        .find(|set| set.set_id == source_set_id)
        .cloned()
    else {
        return HashSet::new();
    };

    let winner_name = source_set
        .slots
        .iter()
        .find(|slot| slot.entrant_id.as_deref() == Some(winner_id))
        .map(|slot| slot.entrant_name.clone())
        .unwrap_or_else(|| "TBD".to_owned());

    let loser_slot = source_set.slots.iter().find(|slot| {
        slot.entrant_id.as_deref().is_some() && slot.entrant_id.as_deref() != Some(winner_id)
    });

    let source_is_grand_final = is_grand_final_set(&source_set);
    let source_is_grand_final_reset = is_grand_final_reset_set(&source_set);

    if source_is_grand_final
        && !source_is_grand_final_reset
        && !crate::models::is_intermediate_set(&event.phase_groups, &source_set)
        && winner_is_from_losers_side(event, &source_set, winner_id)
    {
        let has_existing_reset = hydrate_existing_grand_final_reset_sets(event, &source_set);
        if !has_existing_reset {
            ensure_virtual_grand_final_reset_set(event, &source_set);
        }
    }

    apply_indexed_progression_targets(
        event,
        source_set_id,
        winner_id,
        &winner_name,
        loser_slot.and_then(|loser| {
            loser
                .entrant_id
                .as_ref()
                .map(|id| (id.as_str(), loser.entrant_name.as_str()))
        }),
        targets_by_source,
    )
}

fn apply_indexed_progression_targets(
    event: &mut EventSnapshot,
    source_set_id: &str,
    winner_id: &str,
    winner_name: &str,
    loser: Option<(&str, &str)>,
    targets_by_source: &HashMap<String, Vec<ProgressionTarget>>,
) -> HashSet<String> {
    let Some(targets) = targets_by_source.get(source_set_id) else {
        return HashSet::new();
    };
    let mut winner_placed = false;
    let mut loser_placed = false;
    let mut affected_targets = HashSet::new();
    let mut invalidated_targets = HashSet::new();

    for target in targets {
        let entrant = match target.relation.as_str() {
            "winner" => Some((winner_id, winner_name)),
            "loser" => loser,
            _ => None,
        };
        let Some((entrant_id, entrant_name)) = entrant else {
            continue;
        };
        let already_placed = match target.relation.as_str() {
            "winner" => winner_placed,
            "loser" => loser_placed,
            _ => true,
        };
        affected_targets.insert(target.set_index);
        if already_placed {
            continue;
        }
        let Some(target_set) = event.sets.get_mut(target.set_index) else {
            continue;
        };
        let Some(slot) = target_set.slots.get(target.slot_index) else {
            continue;
        };
        if slot.entrant_id.as_deref() != Some(entrant_id) {
            invalidated_targets.insert(target_set.set_id.clone());
            clear_set_result_state(target_set);
        }
        let Some(slot) = target_set.slots.get_mut(target.slot_index) else {
            continue;
        };
        slot.entrant_id = Some(entrant_id.to_owned());
        slot.entrant_name = entrant_name.to_owned();
        slot.score = None;
        match target.relation.as_str() {
            "winner" => winner_placed = true,
            "loser" => loser_placed = true,
            _ => {}
        }

        if target.is_progression {
            for seed_target in &target.seed_targets {
                if let Some(seed) = event
                    .phase_groups
                    .get_mut(seed_target.group_index)
                    .and_then(|group| group.seeds.get_mut(seed_target.seed_index))
                {
                    seed.entrant_id = Some(entrant_id.to_owned());
                    seed.entrant_name = Some(entrant_name.to_owned());
                }
                for &(dependent_set_index, dependent_slot_index) in &seed_target.dependent_slots {
                    let Some(dependent_set) = event.sets.get_mut(dependent_set_index) else {
                        continue;
                    };
                    let Some(dependent_slot) = dependent_set.slots.get(dependent_slot_index) else {
                        continue;
                    };
                    if dependent_slot.entrant_id.as_deref() != Some(entrant_id) {
                        invalidated_targets.insert(dependent_set.set_id.clone());
                        clear_set_result_state(dependent_set);
                    }
                    let Some(dependent_slot) = dependent_set.slots.get_mut(dependent_slot_index)
                    else {
                        continue;
                    };
                    dependent_slot.entrant_id = Some(entrant_id.to_owned());
                    dependent_slot.entrant_name = entrant_name.to_owned();
                    dependent_slot.seed_id = Some(seed_target.seed_id.clone());
                    dependent_slot.seed_num = seed_target.seed_num;
                    dependent_slot.seed_placeholder_name = seed_target.placeholder_name.clone();
                    dependent_slot.score = None;
                    affected_targets.insert(dependent_set_index);
                }
            }
        }
    }

    for target_index in affected_targets {
        if let Some(target) = event.sets.get_mut(target_index) {
            if empty_slot_count(target) == 0 && target.state == 1 {
                target.state = 2;
            }
        }
    }
    invalidated_targets
}

fn round_depth_for_sort(round: Option<i64>) -> i64 {
    round.map(|value| value.abs()).unwrap_or(i64::MAX / 4)
}

fn collect_affected_set_ids_for_reset(
    event: &EventSnapshot,
    source_set_id: &str,
) -> Result<Vec<String>, String> {
    if !event.sets.iter().any(|set| set.set_id == source_set_id) {
        return Err(format!("取り消し対象setが見つかりません: {source_set_id}"));
    }

    let mut affected_ids = HashSet::from([source_set_id.to_owned()]);
    let set_display_code_by_id = build_set_display_code_by_id(event);

    let mut changed = true;
    while changed {
        changed = false;

        for set in &event.sets {
            if affected_ids.contains(&set.set_id) {
                continue;
            }

            let references_affected_set = (0..set.slots.len()).any(|slot_index| {
                entrant_source_for_slot(set, slot_index)
                    .and_then(|source| {
                        source_set_id_and_code_from_api_source(source, &set_display_code_by_id)
                    })
                    .map(|(source_set_id, _)| affected_ids.contains(&source_set_id))
                    .unwrap_or(false)
            });
            if !references_affected_set {
                continue;
            }

            affected_ids.insert(set.set_id.clone());
            changed = true;
        }
    }

    let mut ordered = event
        .sets
        .iter()
        .filter(|set| affected_ids.contains(&set.set_id))
        .map(|set| set.set_id.clone())
        .collect::<Vec<String>>();

    ordered.sort_by(|left, right| {
        if left == source_set_id {
            return std::cmp::Ordering::Less;
        }
        if right == source_set_id {
            return std::cmp::Ordering::Greater;
        }

        let left_round = event
            .sets
            .iter()
            .find(|set| set.set_id == *left)
            .and_then(|set| set.round);
        let right_round = event
            .sets
            .iter()
            .find(|set| set.set_id == *right)
            .and_then(|set| set.round);

        round_depth_for_sort(left_round)
            .cmp(&round_depth_for_sort(right_round))
            .then_with(|| left.cmp(right))
    });

    Ok(ordered)
}

#[derive(Default)]
struct AffectedSetResetTargets {
    set_ids: Vec<String>,
    seed_ids: HashSet<String>,
}

fn has_result_or_pending_for_set_ids(
    event: &EventSnapshot,
    local_meta: &TournamentLocalMeta,
    set_ids: &HashSet<String>,
) -> bool {
    event.sets.iter().any(|set| {
        set_ids.contains(&set.set_id)
            && (set.winner_id.is_some() || set.slots.iter().any(|slot| slot.score.is_some()))
    }) || local_meta
        .pending_set_results
        .iter()
        .any(|result| result.event_id == event.event_id && set_ids.contains(&result.set_id))
        || local_meta
            .pending_grand_final_reset_results
            .iter()
            .any(|result| {
                result.event_id == event.event_id
                    && set_ids.contains(&result.source_grand_final_set_id)
            })
}

fn phase_group_for_set<'a>(
    event: &'a EventSnapshot,
    set: &crate::models::SetSnapshot,
) -> Option<&'a crate::models::PhaseGroupSnapshot> {
    event.phase_groups.iter().find(|group| {
        if let Some(phase_group_id) = set.phase_group_id.as_deref() {
            return group.phase_group_id == phase_group_id;
        }
        group.phase_order == set.phase_order
            && normalize_group_key(group.display_identifier.as_ref())
                == normalize_group_key(set.phase_group_display_identifier.as_ref())
    })
}

fn round_robin_progression_seed_ids(
    event: &EventSnapshot,
    set: &crate::models::SetSnapshot,
) -> HashSet<String> {
    let Some(source_group) = phase_group_for_set(event, set) else {
        return HashSet::new();
    };
    if !source_group
        .bracket_type
        .as_deref()
        .is_some_and(|bracket_type| bracket_type.eq_ignore_ascii_case("ROUND_ROBIN"))
    {
        return HashSet::new();
    }
    let Some(source_phase_order) = source_group.phase_order else {
        return HashSet::new();
    };
    let Some((target_phase_id, target_phase_order)) =
        next_phase_id_and_order(event, source_group.phase_id.as_deref(), source_phase_order)
    else {
        return HashSet::new();
    };

    let target_groups = event
        .phase_groups
        .iter()
        .filter(|group| {
            group.phase_order == Some(target_phase_order)
                && target_phase_id
                    .as_deref()
                    .is_none_or(|phase_id| group.phase_id.as_deref() == Some(phase_id))
        })
        .collect::<Vec<_>>();
    let mut seed_ids = HashSet::new();
    for progression in &source_group.progressions_out {
        let target_seed = target_groups
            .iter()
            .flat_map(|group| group.seeds.iter())
            .find(|seed| {
                seed.progression_id.as_deref() == Some(progression.progression_id.as_str())
            })
            .or_else(|| {
                target_groups
                    .iter()
                    .flat_map(|group| group.seeds.iter())
                    .find(|seed| {
                        seed.progression_id.is_none()
                            && seed.origin_phase_order == Some(source_phase_order)
                            && (seed.origin_phase_group_id.as_deref()
                                == Some(source_group.phase_group_id.as_str())
                                || normalize_group_key(
                                    seed.origin_phase_group_display_identifier.as_ref(),
                                ) == normalize_group_key(
                                    source_group.display_identifier.as_ref(),
                                ))
                            && seed.origin_placement == progression.origin_placement
                            && (progression.origin_order.is_none()
                                || seed.origin_order == progression.origin_order)
                    })
            });
        if let Some(seed) = target_seed {
            seed_ids.insert(seed.seed_id.clone());
        }
    }
    seed_ids
}

fn set_ids_depending_on_seed(event: &EventSnapshot, seed_id: &str) -> Vec<String> {
    event
        .sets
        .iter()
        .filter(|set| {
            (0..set.slots.len()).any(|slot_index| {
                entrant_source_for_slot(set, slot_index).is_some_and(|source| {
                    source.source_type.as_deref() == Some("seed")
                        && source.type_id.as_deref() == Some(seed_id)
                })
            })
        })
        .map(|set| set.set_id.clone())
        .collect()
}

fn clear_affected_progression_seeds(
    event: &mut EventSnapshot,
    seed_ids: &HashSet<String>,
    invalid_entrant_ids: &mut HashSet<String>,
) {
    for group in &mut event.phase_groups {
        for seed in &mut group.seeds {
            if !seed_ids.contains(&seed.seed_id) {
                continue;
            }
            if let Some(entrant_id) = seed.entrant_id.take() {
                invalid_entrant_ids.insert(entrant_id);
            }
            seed.entrant_name = None;
        }
    }
}

fn collect_affected_reset_targets(
    snapshot: &TournamentSnapshot,
    event: &EventSnapshot,
    source_set_id: &str,
) -> Result<AffectedSetResetTargets, String> {
    collect_affected_set_ids_for_reset(event, source_set_id)?;
    let progression_targets_by_source = build_progression_targets_by_source(snapshot, event);
    let mut affected_set_ids = HashSet::from([source_set_id.to_owned()]);
    let mut affected_seed_ids = HashSet::new();
    let mut pending_set_ids = vec![source_set_id.to_owned()];
    let mut expanded_set_ids = HashSet::new();

    while let Some(current_set_id) = pending_set_ids.pop() {
        for set_id in collect_affected_set_ids_for_reset(event, &current_set_id)? {
            if affected_set_ids.insert(set_id.clone()) {
                pending_set_ids.push(set_id);
            }
        }
        if !expanded_set_ids.insert(current_set_id.clone()) {
            continue;
        }

        if let Some(targets) = progression_targets_by_source.get(&current_set_id) {
            for target in targets {
                if let Some(target_set) = event.sets.get(target.set_index) {
                    if affected_set_ids.insert(target_set.set_id.clone()) {
                        pending_set_ids.push(target_set.set_id.clone());
                    }
                }
                for seed_target in &target.seed_targets {
                    affected_seed_ids.insert(seed_target.seed_id.clone());
                    for &(dependent_set_index, _) in &seed_target.dependent_slots {
                        if let Some(dependent_set) = event.sets.get(dependent_set_index) {
                            if affected_set_ids.insert(dependent_set.set_id.clone()) {
                                pending_set_ids.push(dependent_set.set_id.clone());
                            }
                        }
                    }
                }
            }
        }

        if let Some(set) = event.sets.iter().find(|set| set.set_id == current_set_id) {
            for seed_id in round_robin_progression_seed_ids(event, set) {
                affected_seed_ids.insert(seed_id.clone());
                for dependent_set_id in set_ids_depending_on_seed(event, &seed_id) {
                    if affected_set_ids.insert(dependent_set_id.clone()) {
                        pending_set_ids.push(dependent_set_id);
                    }
                }
            }
        }
    }

    let mut ordered = affected_set_ids.into_iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        let left_set = event.sets.iter().find(|set| set.set_id == *left);
        let right_set = event.sets.iter().find(|set| set.set_id == *right);
        let left_phase = left_set
            .and_then(|set| crate::models::phase_sequence_index_for_set(event, set))
            .unwrap_or(usize::MAX);
        let right_phase = right_set
            .and_then(|set| crate::models::phase_sequence_index_for_set(event, set))
            .unwrap_or(usize::MAX);
        let left_round = left_set.and_then(|set| set.round);
        let right_round = right_set.and_then(|set| set.round);
        if left == source_set_id {
            return std::cmp::Ordering::Less;
        }
        if right == source_set_id {
            return std::cmp::Ordering::Greater;
        }
        left_phase
            .cmp(&right_phase)
            .then_with(|| round_depth_for_sort(left_round).cmp(&round_depth_for_sort(right_round)))
            .then_with(|| left.cmp(right))
    });

    Ok(AffectedSetResetTargets {
        set_ids: ordered,
        seed_ids: affected_seed_ids,
    })
}

fn clear_set_result_state(set: &mut crate::models::SetSnapshot) {
    set.winner_id = None;
    for slot in &mut set.slots {
        slot.score = None;
    }
    set.state = if empty_slot_count(set) == 0 { 2 } else { 1 };
}

pub fn clear_reset_set_results_from_snapshot(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    set_ids: &[String],
) {
    let set_ids = set_ids.iter().collect::<HashSet<_>>();
    let Some(event) = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    else {
        return;
    };

    for set in &mut event.sets {
        if set_ids.contains(&set.set_id) {
            clear_set_result_state(set);
        }
    }
}

fn clear_invalid_entrants_from_set(
    set: &mut crate::models::SetSnapshot,
    invalid_entrant_ids: &HashSet<String>,
) {
    for slot in &mut set.slots {
        let should_clear = slot
            .entrant_id
            .as_ref()
            .map(|entrant_id| invalid_entrant_ids.contains(entrant_id))
            .unwrap_or(false);
        if !should_clear {
            continue;
        }

        slot.entrant_id = None;
        slot.entrant_name = "TBD".to_owned();
        slot.seed_id = None;
        slot.seed_num = None;
        slot.score = None;
    }

    clear_set_result_state(set);
}

pub fn list_affected_set_ids_for_reset(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    source_set_id: &str,
) -> Result<Vec<String>, String> {
    let snapshot = load_event_snapshot(app, slug, event_id)?;
    let event = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    collect_affected_reset_targets(&snapshot, event, source_set_id).map(|targets| targets.set_ids)
}

pub fn reset_local_set_result_with_dependencies(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    source_set_id: &str,
) -> Result<(TournamentWorkspace, Vec<String>), String> {
    let mut snapshot = load_event_snapshot(app, slug, event_id)?;
    let mut local_meta = load_local_meta(app, slug, event_id)?;

    let event_index = snapshot
        .events
        .iter()
        .position(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    let reset_targets = {
        let event = snapshot
            .events
            .get(event_index)
            .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;
        collect_affected_reset_targets(&snapshot, event, source_set_id)?
    };
    let affected_set_ids = reset_targets.set_ids;
    for set_id in &affected_set_ids {
        ensure_set_score_edit_enabled(&local_meta, &snapshot, event_id, set_id)?;
    }

    let remove_ids = affected_set_ids.iter().collect::<HashSet<&String>>();

    {
        let event = snapshot
            .events
            .get_mut(event_index)
            .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

        let source_set = event
            .sets
            .iter()
            .find(|set| set.set_id == source_set_id)
            .ok_or_else(|| format!("取り消し対象setが見つかりません: {source_set_id}"))?;
        let mut invalid_entrant_ids = source_set
            .slots
            .iter()
            .filter_map(|slot| slot.entrant_id.clone())
            .collect::<HashSet<String>>();

        clear_affected_progression_seeds(event, &reset_targets.seed_ids, &mut invalid_entrant_ids);

        for target_set_id in &affected_set_ids {
            let Some(set) = event
                .sets
                .iter_mut()
                .find(|set| set.set_id == *target_set_id)
            else {
                continue;
            };

            if target_set_id == source_set_id {
                clear_set_result_state(set);
                continue;
            }

            for entrant_id in set.slots.iter().filter_map(|slot| slot.entrant_id.clone()) {
                invalid_entrant_ids.insert(entrant_id);
            }
            if let Some(winner_id) = set.winner_id.as_ref() {
                invalid_entrant_ids.insert(winner_id.clone());
            }

            clear_invalid_entrants_from_set(set, &invalid_entrant_ids);
        }

        apply_source_based_tbd_labels(event);
    }

    local_meta
        .pending_set_results
        .retain(|item| !remove_ids.contains(&item.set_id));
    local_meta
        .pending_grand_final_reset_results
        .retain(|item| !remove_ids.contains(&item.source_grand_final_set_id));
    local_meta
        .set_play_sides
        .retain(|item| !remove_ids.contains(&item.set_id));

    let event_name = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.name.clone())
        .unwrap_or_else(|| "Unnamed event".to_owned());

    // 取り消し後にstart.ggとの差分を一括報告できるよう、reset差分をpendingに積む。
    for target_set_id in &affected_set_ids {
        local_meta.pending_set_results.push(LocalSetResultMeta {
            event_id: event_id.to_owned(),
            event_name: event_name.clone(),
            set_id: target_set_id.clone(),
            winner_id: String::new(),
            score_csv: String::new(),
            confirmed: true,
            direct_win: false,
            slot_scores: Vec::new(),
            reset_source_set_id: Some(source_set_id.to_owned()),
            recorded_at: Utc::now(),
        });
    }

    local_meta.updated_at = Utc::now();

    save_snapshot(app, &snapshot)?;
    save_local_meta(app, event_id, &local_meta)?;

    Ok((
        TournamentWorkspace {
            snapshot,
            local_meta,
        },
        affected_set_ids,
    ))
}

pub fn set_event_alias(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    event_alias: Option<String>,
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, slug, event_id)?;
    let event_index = if let Some(index) = local_meta
        .events
        .iter()
        .position(|event| event.event_id == event_id)
    {
        index
    } else {
        local_meta.events.push(EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
        local_meta.events.len().saturating_sub(1)
    };

    if let Some(event_meta) = local_meta.events.get_mut(event_index) {
        event_meta.event_alias = event_alias;
    }

    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;
    Ok(local_meta)
}

pub fn save_event_snapshot(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    event_id: &str,
    event_alias: Option<String>,
) -> Result<TournamentLocalMeta, String> {
    save_event_snapshot_with_pending_policy(app, snapshot, event_id, event_alias, false)
}

pub fn save_event_snapshot_and_discard_pending(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    event_id: &str,
    event_alias: Option<String>,
    pending_slug: &str,
) -> Result<TournamentLocalMeta, String> {
    if normalize_slug_for_storage(pending_slug) != normalize_slug_for_storage(&snapshot.slug) {
        save_event_snapshot(app, snapshot, event_id, event_alias)?;
        return discard_pending_set_results_for_snapshot_refresh(app, pending_slug, event_id);
    }

    save_event_snapshot_with_pending_policy(app, snapshot, event_id, event_alias, true)
}

fn save_event_snapshot_with_pending_policy(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    event_id: &str,
    event_alias: Option<String>,
    discard_pending_results: bool,
) -> Result<TournamentLocalMeta, String> {
    let started_at = Instant::now();
    let event_snapshot = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .cloned()
        .ok_or_else(|| format!("指定イベントが見つかりません: {event_id}"))?;
    let normalized_slug = normalize_slug_for_storage(&snapshot.slug);

    // start.gg取得時点の復元用原本は、ローカル進行用graphとは分離して保持する。
    let remote_snapshot = TournamentSnapshot {
        tournament_id: snapshot.tournament_id.clone(),
        slug: snapshot.slug.clone(),
        name: snapshot.name.clone(),
        events: vec![event_snapshot.clone()],
        updated_at: snapshot.updated_at,
    };
    save_event_snapshot_file(
        app,
        &remote_snapshot,
        &snapshot.tournament_id,
        &normalized_slug,
        &event_id,
        &event_snapshot.name,
        false,
    )?;
    remove_stale_event_snapshot_files(
        app,
        &snapshot.tournament_id,
        &normalized_slug,
        std::slice::from_ref(&event_snapshot),
        false,
    )?;

    // 同一slugの既存スナップショットを保持しつつ、対象eventのみ差し替える。
    // 更新時はgraphを読むと未報告のローカル進行が混ざるため、raw snapshotを基準にする。
    let mut merged_snapshot =
        merge_event_snapshot_files(load_event_snapshot_files(app, &snapshot.slug, false)?)
            .unwrap_or_else(|| TournamentSnapshot {
                tournament_id: snapshot.tournament_id.clone(),
                slug: snapshot.slug.clone(),
                name: snapshot.name.clone(),
                events: Vec::new(),
                updated_at: snapshot.updated_at,
            });

    merged_snapshot.tournament_id = snapshot.tournament_id.clone();
    merged_snapshot.slug = snapshot.slug.clone();
    merged_snapshot.name = snapshot.name.clone();
    merged_snapshot.updated_at = snapshot.updated_at;

    if let Some(existing) = merged_snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    {
        *existing = event_snapshot.clone();
        apply_source_based_tbd_labels(existing);
    } else {
        let mut next_event_snapshot = event_snapshot.clone();
        apply_source_based_tbd_labels(&mut next_event_snapshot);
        merged_snapshot.events.push(next_event_snapshot);
    }

    rebuild_progression_from_completed_sets(&mut merged_snapshot);
    let graph_event = merged_snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("保存対象イベントが見つかりません: {event_id}"))?;
    let graph = build_bracket_graph(&merged_snapshot, graph_event);
    save_event_graph_file(
        app,
        &graph,
        &merged_snapshot.tournament_id,
        &normalized_slug,
        &graph_event.event_id,
        &graph_event.name,
    )?;
    remove_stale_event_graph_files(
        app,
        &merged_snapshot.tournament_id,
        &normalized_slug,
        std::slice::from_ref(graph_event),
    )?;

    // 原本スナップショットも対象eventだけを更新し、他eventのファイルには触れない。
    let pristine_event_snapshot = TournamentSnapshot {
        tournament_id: snapshot.tournament_id.clone(),
        slug: snapshot.slug.clone(),
        name: snapshot.name.clone(),
        events: vec![event_snapshot.clone()],
        updated_at: snapshot.updated_at,
    };
    save_pristine_snapshot(app, &pristine_event_snapshot)?;

    let meta_load_started_at = Instant::now();
    let current_meta = load_local_meta(app, &merged_snapshot.slug, event_id)?;
    let meta_load_elapsed_us = meta_load_started_at.elapsed().as_micros();
    let meta_merge_started_at = Instant::now();
    let mut local_meta = merge_snapshot_into_meta(&merged_snapshot, event_id, current_meta);
    if let Some(event_meta) = local_meta
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    {
        event_meta.event_alias = event_alias;
    }
    if discard_pending_results {
        local_meta
            .pending_set_results
            .retain(|pending| pending.event_id != event_id);
        local_meta
            .pending_grand_final_reset_results
            .retain(|pending| pending.event_id != event_id);
    }
    local_meta.updated_at = Utc::now();
    let meta_merge_elapsed_us = meta_merge_started_at.elapsed().as_micros();
    let meta_save_started_at = Instant::now();
    save_local_meta(app, event_id, &local_meta)?;
    let meta_save_elapsed_us = meta_save_started_at.elapsed().as_micros();
    if !discard_pending_results {
        cache_progression_snapshot(&merged_snapshot, true, true);
    }
    storage_perf_log(|| {
        format!(
            "save_event_snapshot event={} sets={} discard_pending={} meta_load_us={} meta_merge_us={} meta_save_us={} total_us={}",
            event_id,
            event_snapshot.sets.len(),
            discard_pending_results,
            meta_load_elapsed_us,
            meta_merge_elapsed_us,
            meta_save_elapsed_us,
            started_at.elapsed().as_micros()
        )
    });

    Ok(local_meta)
}

pub fn save_local_meta(
    app: &AppHandle,
    event_id: &str,
    meta: &TournamentLocalMeta,
) -> Result<(), String> {
    let started_at = Instant::now();
    let mut normalized = meta.clone();
    normalized.events.retain(|event| event.event_id == event_id);
    if normalized.events.is_empty() {
        normalized.events.push(EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
    }
    normalized
        .pending_set_results
        .retain(|pending| pending.event_id == event_id);
    normalized
        .pending_grand_final_reset_results
        .retain(|pending| pending.event_id == event_id);

    let event_name = normalized
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.event_name.as_str())
        .unwrap_or_default();
    let path = meta_path(
        app,
        &normalized.tournament_id,
        &normalized.slug,
        event_id,
        event_name,
    )?;
    let serialize_started_at = Instant::now();
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("ローカルメタのJSON変換に失敗しました: {e}"))?;
    let serialize_elapsed_us = serialize_started_at.elapsed().as_micros();
    let bytes = json.len();
    let pending_set_count = normalized.pending_set_results.len();
    let pending_reset_count = normalized.pending_grand_final_reset_results.len();
    let write_started_at = Instant::now();
    fs::write(&path, json).map_err(|e| format!("ローカルメタ保存に失敗しました: {e}"))?;
    let write_elapsed_us = write_started_at.elapsed().as_micros();

    let meta_prefix = format!(
        "{}-{}-{}-",
        sanitize_slug(&normalized.tournament_id),
        sanitize_slug(&normalize_slug_for_storage(&normalized.slug)),
        sanitize_slug(event_id)
    );
    let cleanup_started_at = Instant::now();
    let mut scanned_files = 0;
    for entry in fs::read_dir(snapshots_dir(app)?)
        .map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let candidate = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = candidate.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        scanned_files += 1;
        if candidate != path
            && file_name.starts_with(&meta_prefix)
            && file_name.ends_with("-meta.json")
        {
            let _ = fs::remove_file(candidate);
        }
    }
    storage_perf_log(|| {
        format!(
            "save_local_meta event={} bytes={} pending_sets={} pending_resets={} serialize_us={} write_us={} cleanup_scan_files={} cleanup_us={} total_us={}",
            event_id,
            bytes,
            pending_set_count,
            pending_reset_count,
            serialize_elapsed_us,
            write_elapsed_us,
            scanned_files,
            cleanup_started_at.elapsed().as_micros(),
            started_at.elapsed().as_micros()
        )
    });

    Ok(())
}

pub fn load_local_meta(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentLocalMeta, String> {
    let dir = snapshots_dir(app)?;
    let mut loaded_raw = None;
    let mut last_error = None;
    for entry in
        fs::read_dir(dir).map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?
    {
        let path = match entry {
            Ok(value) => value.path(),
            Err(_) => continue,
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.ends_with("-meta.json") {
            continue;
        }

        match fs::read_to_string(&path) {
            Ok(raw) => {
                let parsed = serde_json::from_str::<TournamentLocalMeta>(&raw).ok();
                if parsed.as_ref().is_none_or(|meta| {
                    normalize_slug_for_storage(&meta.slug) != normalize_slug_for_storage(slug)
                        || !meta.events.iter().any(|event| event.event_id == event_id)
                }) {
                    continue;
                }
                loaded_raw = Some(raw);
                break;
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    let Some(raw) = loaded_raw else {
        if let Some(error) = last_error {
            return Err(format!("ローカルメタ読込に失敗しました: {error}"));
        }
        return Ok(build_empty_meta(slug, event_id));
    };

    let mut parsed: TournamentLocalMeta = serde_json::from_str(&raw)
        .map_err(|e| format!("ローカルメタのパースに失敗しました: {e}"))?;
    parsed.slug = slug.to_owned();
    parsed.events.retain(|event| event.event_id == event_id);
    if parsed.events.is_empty() {
        parsed.events.push(EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
    }
    parsed
        .pending_set_results
        .retain(|pending| pending.event_id == event_id);

    // 後方互換: 旧実装で virtual_gf_reset_* に紐づけていたpendingを
    // set_id非依存のGF Reset専用pendingへ移す。
    let mut migrated = Vec::new();
    parsed.pending_set_results.retain(|pending| {
        let Some(source_set_id) =
            source_grand_final_set_id_from_virtual_reset_set_id(&pending.set_id)
        else {
            return true;
        };

        migrated.push(LocalGrandFinalResetResultMeta {
            event_id: pending.event_id.clone(),
            event_name: pending.event_name.clone(),
            source_grand_final_set_id: source_set_id,
            winner_id: pending.winner_id.clone(),
            score_csv: pending.score_csv.clone(),
            confirmed: pending.confirmed,
            direct_win: pending.direct_win,
            slot_scores: pending.slot_scores.clone(),
            recorded_at: pending.recorded_at.clone(),
        });
        false
    });

    if !migrated.is_empty() {
        parsed
            .pending_grand_final_reset_results
            .retain(|item| item.event_id == event_id);
        parsed.pending_grand_final_reset_results.extend(migrated);
    }

    parsed
        .pending_grand_final_reset_results
        .retain(|pending| pending.event_id == event_id);
    Ok(parsed)
}

pub fn sync_local_meta_from_snapshot(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    event_id: &str,
) -> Result<TournamentLocalMeta, String> {
    let started_at = Instant::now();
    let load_started_at = Instant::now();
    let current_meta = load_local_meta(app, &snapshot.slug, event_id)?;
    let load_elapsed_us = load_started_at.elapsed().as_micros();
    let merge_started_at = Instant::now();
    let merged_meta = merge_snapshot_into_meta(snapshot, event_id, current_meta);
    let merge_elapsed_us = merge_started_at.elapsed().as_micros();
    save_local_meta(app, event_id, &merged_meta)?;
    storage_perf_log(|| {
        format!(
            "sync_local_meta event={} sets={} entrants={} load_us={} merge_us={} total_us={}",
            event_id,
            snapshot
                .events
                .iter()
                .find(|event| event.event_id == event_id)
                .map(|event| event.sets.len())
                .unwrap_or(0),
            merged_meta
                .events
                .iter()
                .find(|event| event.event_id == event_id)
                .map(|event| event.entrants.len())
                .unwrap_or(0),
            load_elapsed_us,
            merge_elapsed_us,
            started_at.elapsed().as_micros()
        )
    });
    Ok(merged_meta)
}

pub fn load_workspace(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentWorkspace, String> {
    let snapshot = load_event_snapshot(app, slug, event_id)?;
    let local_meta =
        merge_snapshot_into_meta(&snapshot, event_id, load_local_meta(app, slug, event_id)?);

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

fn replace_event_with_pristine_snapshot(
    snapshot: &mut TournamentSnapshot,
    pristine_snapshot: &TournamentSnapshot,
    event_id: &str,
) -> Result<(), String> {
    let pristine_event = pristine_snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .cloned()
        .ok_or_else(|| format!("取得時点のスナップショットにイベントがありません: {event_id}"))?;
    let current_event = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("復元対象イベントが見つかりません: {event_id}"))?;

    *current_event = pristine_event;
    Ok(())
}

fn locked_phase_group_ids_for_phase(
    event: &EventSnapshot,
    event_meta: &EventLocalMeta,
    phase_name: &str,
) -> HashSet<String> {
    let unlocked_phase_group_ids = event_meta
        .score_edit_enabled_phase_group_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut locked_phase_group_ids = event
        .phase_groups
        .iter()
        .filter(|group| {
            group.phase_name.as_deref().map(str::trim) == Some(phase_name)
                && !unlocked_phase_group_ids.contains(group.phase_group_id.as_str())
        })
        .map(|group| group.phase_group_id.clone())
        .collect::<HashSet<_>>();

    locked_phase_group_ids.extend(event.sets.iter().filter_map(|set| {
        let phase_group_id = set.phase_group_id.as_deref()?;
        (set.phase_name.as_deref().map(str::trim) == Some(phase_name)
            && !unlocked_phase_group_ids.contains(phase_group_id))
        .then(|| phase_group_id.to_owned())
    }));
    locked_phase_group_ids
}

#[cfg(test)]
mod snapshot_restore_scope_tests {
    use super::*;

    #[test]
    fn locked_pool_restore_scope_excludes_unlocked_pools_and_other_phases() {
        let event: EventSnapshot = serde_json::from_value(serde_json::json!({
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [
                { "phaseGroupId": "locked-a", "phaseName": "Phase 1" },
                { "phaseGroupId": "unlocked-a", "phaseName": "Phase 1" },
                { "phaseGroupId": "locked-b", "phaseName": "Phase 2" }
            ],
            "sets": []
        }))
        .expect("event snapshot should deserialize");
        let event_meta: EventLocalMeta = serde_json::from_value(serde_json::json!({
            "eventId": "event",
            "eventName": "Event",
            "entrants": [],
            "scoreEditEnabledPhaseGroupIds": ["unlocked-a"]
        }))
        .expect("event metadata should deserialize");

        assert_eq!(
            locked_phase_group_ids_for_phase(&event, &event_meta, "Phase 1"),
            HashSet::from(["locked-a".to_owned()])
        );
    }
}

pub fn restore_event_graph_from_snapshot(
    app: &AppHandle,
    input: RestoreEventGraphInput,
) -> Result<RestoreEventGraphResult, String> {
    let normalized_slug = normalize_slug_for_storage(&input.slug);
    let mut workspace = load_workspace(app, &normalized_slug, &input.event_id)?;
    let pristine_snapshot = load_pristine_event_snapshot(app, &normalized_slug, &input.event_id)?;
    let pristine_event = pristine_snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .cloned()
        .ok_or_else(|| {
            format!(
                "取得時点のスナップショットにイベントがありません: {}",
                input.event_id
            )
        })?;
    let mut affected_set_ids = HashSet::new();
    let mut restored_phase_group_ids = HashSet::new();

    match input.scope {
        SnapshotRestoreScope::All => {
            replace_event_with_pristine_snapshot(
                &mut workspace.snapshot,
                &pristine_snapshot,
                &input.event_id,
            )?;
            affected_set_ids.extend(pristine_event.sets.iter().map(|set| set.set_id.clone()));
        }
        SnapshotRestoreScope::CurrentPool => {
            let phase_group_id = input
                .phase_group_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "復元対象のPoolが選択されていません。".to_owned())?;
            if !pristine_event
                .sets
                .iter()
                .any(|set| set.phase_group_id.as_deref() == Some(phase_group_id))
            {
                return Err("スナップショットに対象Poolのsetがありません。".to_owned());
            }
            restored_phase_group_ids.insert(phase_group_id.to_owned());
        }
        SnapshotRestoreScope::LockedPoolsInCurrentPhase => {
            let phase_name = input
                .phase_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "復元対象のPhaseが選択されていません。".to_owned())?;
            let event_meta = workspace
                .local_meta
                .events
                .iter()
                .find(|event| event.event_id == input.event_id)
                .ok_or_else(|| "復元対象イベントの設定が見つかりません。".to_owned())?;
            restored_phase_group_ids =
                locked_phase_group_ids_for_phase(&pristine_event, event_meta, phase_name);
            if restored_phase_group_ids.is_empty() {
                return Err("選択中Phaseにスコア編集ロック中のPoolがありません。".to_owned());
            }
        }
    }

    if input.scope != SnapshotRestoreScope::All {
        let pristine_sets = pristine_event
            .sets
            .iter()
            .filter(|set| {
                set.phase_group_id
                    .as_ref()
                    .is_some_and(|id| restored_phase_group_ids.contains(id))
            })
            .map(|set| (set.set_id.clone(), set.clone()))
            .collect::<HashMap<_, _>>();
        if pristine_sets.is_empty() {
            return Err("復元対象Poolにsetがありません。".to_owned());
        }
        let event = workspace
            .snapshot
            .events
            .iter_mut()
            .find(|event| event.event_id == input.event_id)
            .ok_or_else(|| format!("復元対象イベントが見つかりません: {}", input.event_id))?;
        for (set_id, pristine_set) in pristine_sets {
            let current_set = event
                .sets
                .iter_mut()
                .find(|set| set.set_id == set_id)
                .ok_or_else(|| format!("復元対象setが見つかりません: {set_id}"))?;
            *current_set = pristine_set;
            affected_set_ids.insert(set_id);
        }
        for phase_group_id in &restored_phase_group_ids {
            if let Some(pristine_group) = pristine_event
                .phase_groups
                .iter()
                .find(|group| &group.phase_group_id == phase_group_id)
            {
                if let Some(current_group) = event
                    .phase_groups
                    .iter_mut()
                    .find(|group| &group.phase_group_id == phase_group_id)
                {
                    *current_group = pristine_group.clone();
                }
            }
        }
        affected_set_ids.extend(rebuild_event_progression_from_completed_sets(
            &mut workspace.snapshot,
            &input.event_id,
        ));
    }

    let mut local_meta = workspace.local_meta;
    if input.scope == SnapshotRestoreScope::All {
        local_meta
            .pending_set_results
            .retain(|item| item.event_id != input.event_id);
        local_meta
            .pending_grand_final_reset_results
            .retain(|item| item.event_id != input.event_id);
    } else {
        local_meta.pending_set_results.retain(|item| {
            item.event_id != input.event_id || !affected_set_ids.contains(&item.set_id)
        });
        local_meta.pending_grand_final_reset_results.retain(|item| {
            item.event_id != input.event_id
                || !affected_set_ids.contains(&item.source_grand_final_set_id)
        });
        local_meta.set_confirmation_history.retain(|item| {
            item.event_id != input.event_id || !affected_set_ids.contains(&item.set_id)
        });
        local_meta
            .set_play_sides
            .retain(|item| !affected_set_ids.contains(&item.set_id));
    }
    local_meta.updated_at = Utc::now();
    local_meta = merge_snapshot_into_meta(&workspace.snapshot, &input.event_id, local_meta);
    save_local_meta(app, &input.event_id, &local_meta)?;
    let event = workspace
        .snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .ok_or_else(|| format!("復元対象イベントが見つかりません: {}", input.event_id))?;
    let graph = build_bracket_graph(&workspace.snapshot, event);

    save_event_graph_file(
        app,
        &graph,
        &workspace.snapshot.tournament_id,
        &normalized_slug,
        &event.event_id,
        &event.name,
    )?;
    remove_stale_event_graph_files(
        app,
        &workspace.snapshot.tournament_id,
        &normalized_slug,
        std::slice::from_ref(event),
    )?;

    invalidate_progression_cache(&normalized_slug);
    let mut affected_set_ids = affected_set_ids.into_iter().collect::<Vec<_>>();
    affected_set_ids.sort();

    Ok(RestoreEventGraphResult {
        workspace: TournamentWorkspace {
            snapshot: workspace.snapshot,
            local_meta,
        },
        affected_set_ids,
    })
}

pub fn upsert_local_set_result(
    app: &AppHandle,
    input: LocalSetResultInput,
) -> Result<TournamentWorkspace, String> {
    upsert_local_set_result_inner(app, input, None)
}

pub fn apply_external_score_report(
    app: &AppHandle,
    input: ApplyExternalScoreReportInput,
) -> Result<TournamentWorkspace, String> {
    if !input.result.confirmed
        || input.sender_name.trim().is_empty()
        || input.sender_user_id.trim().len() != 8
        || !input
            .sender_user_id
            .trim()
            .bytes()
            .all(|byte| byte.is_ascii_digit())
    {
        return Err("外部報告の確定状態または送信者情報が不正です。".to_owned());
    }
    let winner_score = input
        .result
        .slot_scores
        .iter()
        .find(|score| score.entrant_id == input.result.winner_id)
        .map(|score| score.score);
    let other_scores = input
        .result
        .slot_scores
        .iter()
        .filter(|score| score.entrant_id != input.result.winner_id)
        .collect::<Vec<_>>();
    let valid_score_result = input.result.slot_scores.len() == 2
        && other_scores.len() == 1
        && winner_score.is_some_and(|score| {
            if input.result.direct_win {
                score == 0 && other_scores[0].score == 0
            } else {
                score >= 0 && (other_scores[0].score < 0 || score > other_scores[0].score)
            }
        });
    if !valid_score_result {
        return Err("外部報告のスコアまたは勝者が一致しません。".to_owned());
    }
    let authorization = input.sender_user_id;
    upsert_local_set_result_inner(app, input.result, Some(authorization))
}

fn upsert_local_set_result_inner(
    app: &AppHandle,
    input: LocalSetResultInput,
    external_report_authorization: Option<String>,
) -> Result<TournamentWorkspace, String> {
    let started_at = Instant::now();
    if input.set_id.starts_with("preview_") {
        return Err(
            "preview setは結果報告できません。スナップショットを更新して実setを取得してください。"
                .to_owned(),
        );
    }

    let mut snapshot = load_event_snapshot(app, &input.slug, &input.event_id)?;
    if snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .and_then(|event| {
            event
                .sets
                .iter()
                .find(|set| set.set_id == input.set_id)
                .map(|set| is_inactive_grand_final_reset_set(event, set))
        })
        .unwrap_or(false)
    {
        return Err(
            "Winners側のプレイヤーがGrand Finalに勝利したため、Grand Final Resetは行われません。"
                .to_owned(),
        );
    }
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;
    let existing_set_state = snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .and_then(|event| event.sets.iter().find(|set| set.set_id == input.set_id))
        .map(|set| {
            (
                set.state >= 3 && set.winner_id.is_some(),
                is_round_robin_set(&snapshot, &input.event_id, set),
            )
        })
        .ok_or_else(|| {
            "ローカル結果の保存対象setがローカルsnapshotに見つかりません。".to_owned()
        })?;
    if let Some(sender_user_id) = external_report_authorization {
        let phase_group_id = snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .and_then(|event| event.sets.iter().find(|set| set.set_id == input.set_id))
            .and_then(|set| set.phase_group_id.as_deref())
            .map(str::trim)
            .filter(|phase_group_id| !phase_group_id.is_empty())
            .ok_or_else(|| "外部報告の対象プールを特定できません。".to_owned())?
            .to_owned();
        let event_meta = local_meta
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .ok_or_else(|| "外部報告の対象イベントメタが見つかりません。".to_owned())?;
        if !external_score_report_is_applicable(
            event_meta,
            &phase_group_id,
            &sender_user_id,
            existing_set_state.0,
        ) {
            return Err(if existing_set_state.0 {
                "対象setはすでに確定済みのため外部報告を適用できません。".to_owned()
            } else {
                "外部報告の送信者または対象プールのロック状態が一致しません。".to_owned()
            });
        }
    } else {
        ensure_set_score_edit_enabled(&local_meta, &snapshot, &input.event_id, &input.set_id)?;
    }

    let event_name = snapshot
        .events
        .iter()
        .find_map(|event| {
            event
                .sets
                .iter()
                .any(|set| set.set_id == input.set_id)
                .then(|| event.name.clone())
        })
        .unwrap_or_else(|| "Unnamed event".to_owned());
    let (applied_event_id, should_advance, slot_entrant_ids) = {
        let known_entrant_names = snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .map(|event| {
                if existing_set_state.1 {
                    known_resolved_entrant_names_for_round_robin_set(event, &input.set_id)
                } else {
                    known_resolved_entrant_names(event)
                }
            })
            .unwrap_or_default();
        let (event_id, set_snapshot) = find_set_in_snapshot_mut(&mut snapshot, &input.set_id)
            .ok_or_else(|| {
                "ローカル結果の保存対象setがローカルsnapshotに見つかりません。".to_owned()
            })?;

        set_snapshot.winner_id = input.confirmed.then_some(input.winner_id.clone());
        set_snapshot.state = if input.confirmed { 3 } else { 2 };
        if input.confirmed {
            restore_missing_slot_entrants(
                set_snapshot,
                input
                    .slot_scores
                    .iter()
                    .map(|score| score.entrant_id.clone()),
                &known_entrant_names,
            );
        }
        let score_entrant_ids = input
            .slot_scores
            .iter()
            .map(|score| score.entrant_id.clone())
            .collect::<Vec<_>>();
        if input.winner_id.trim().is_empty()
            || !result_entrant_ids_match_set_roster(
                set_snapshot,
                &input.winner_id,
                &score_entrant_ids,
            )
        {
            return Err(
                "現在のset参加者と結果入力が一致しません。組み合わせを確認してから入力し直してください。"
                    .to_owned(),
            );
        }

        for slot in &mut set_snapshot.slots {
            if let Some(entrant_id) = slot.entrant_id.as_ref() {
                if let Some(found) = input
                    .slot_scores
                    .iter()
                    .find(|score| score.entrant_id == *entrant_id)
                {
                    slot.score = Some(found.score as f64);
                }
            }
        }

        let slot_entrant_ids = set_snapshot
            .slots
            .iter()
            .filter_map(|slot| slot.entrant_id.clone())
            .collect();
        (event_id.clone(), input.confirmed, slot_entrant_ids)
    };

    let score_csv = if input.direct_win {
        String::new()
    } else {
        derive_score_csv_from_slot_scores(&input.slot_scores, &input.winner_id)?
    };
    let source_grand_final_set_id =
        source_grand_final_set_id_from_virtual_reset_set_id(&input.set_id);
    let progression_slug = input.slug.clone();
    let progression_winner_id = input.winner_id.clone();

    let slot_scores = input
        .slot_scores
        .into_iter()
        .map(|slot| LocalSetScoreMeta {
            entrant_id: slot.entrant_id,
            score: slot.score,
        })
        .collect::<Vec<LocalSetScoreMeta>>();
    let recorded_at = Utc::now();
    if input.confirmed {
        append_set_confirmation_record(
            &mut local_meta,
            &applied_event_id,
            &input.set_id,
            &input.winner_id,
            slot_entrant_ids,
            recorded_at,
        );
    }

    if let Some(source_grand_final_set_id) = source_grand_final_set_id {
        local_meta.pending_grand_final_reset_results.retain(|item| {
            !(item.event_id == applied_event_id
                && item.source_grand_final_set_id == source_grand_final_set_id)
        });
        local_meta
            .pending_grand_final_reset_results
            .push(LocalGrandFinalResetResultMeta {
                event_id: applied_event_id.clone(),
                event_name: event_name.clone(),
                source_grand_final_set_id,
                winner_id: input.winner_id,
                score_csv,
                direct_win: input.direct_win,
                confirmed: input.confirmed,
                slot_scores,
                recorded_at: recorded_at.clone(),
            });
    } else {
        local_meta
            .pending_set_results
            .retain(|item| item.set_id != input.set_id);
        local_meta.pending_set_results.push(LocalSetResultMeta {
            event_id: applied_event_id.clone(),
            event_name: event_name.clone(),
            set_id: input.set_id.clone(),
            winner_id: input.winner_id,
            score_csv,
            direct_win: input.direct_win,
            confirmed: input.confirmed,
            slot_scores,
            reset_source_set_id: None,
            recorded_at,
        });
    }

    local_meta.slug = input.slug;
    local_meta.tournament_name = snapshot.name.clone();
    local_meta.tournament_id = snapshot.tournament_id.clone();
    local_meta.updated_at = Utc::now();

    let round_robin_group_completed = should_advance
        && existing_set_state.1
        && !existing_set_state.0
        && is_completed_round_robin_group(&snapshot, &applied_event_id, &input.set_id);
    let should_rebuild_progression =
        !existing_set_state.1 || existing_set_state.0 || round_robin_group_completed;

    if should_advance && !existing_set_state.0 && !existing_set_state.1 {
        let progression_started_at = Instant::now();
        let cached_targets =
            cached_progression_targets(&progression_slug, &applied_event_id, &input.set_id);
        let target_index_cache_hit = cached_targets.is_some();
        let targets = cached_targets
            .or_else(|| {
                snapshot
                    .events
                    .iter()
                    .find(|event| event.event_id == applied_event_id)
                    .and_then(|event| {
                        build_progression_targets_by_source(&snapshot, event).remove(&input.set_id)
                    })
            })
            .unwrap_or_default();
        let targets_by_source = HashMap::from([(input.set_id.clone(), targets)]);
        let changed_set_ids = apply_local_progression_incremental(
            &mut snapshot,
            &applied_event_id,
            &input.set_id,
            &progression_winner_id,
            &targets_by_source,
        );
        if !changed_set_ids.is_empty() {
            let mut affected_set_ids = changed_set_ids;
            let direct_target_has_state = snapshot
                .events
                .iter()
                .find(|event| event.event_id == applied_event_id)
                .is_some_and(|event| {
                    has_result_or_pending_for_set_ids(event, &local_meta, &affected_set_ids)
                });

            if direct_target_has_state {
                let changed_set_ids = affected_set_ids.iter().cloned().collect::<Vec<_>>();
                if let Some(event) = snapshot
                    .events
                    .iter()
                    .find(|event| event.event_id == applied_event_id)
                {
                    for changed_set_id in changed_set_ids {
                        if let Ok(dependent_targets) =
                            collect_affected_reset_targets(&snapshot, event, &changed_set_id)
                        {
                            affected_set_ids.extend(dependent_targets.set_ids);
                        }
                    }
                    affected_set_ids.remove(&input.set_id);
                }
            }

            if direct_target_has_state {
                if let Some(event) = snapshot
                    .events
                    .iter_mut()
                    .find(|event| event.event_id == applied_event_id)
                {
                    for set in &mut event.sets {
                        if affected_set_ids.contains(&set.set_id) {
                            clear_set_result_state(set);
                        }
                    }
                }
                affected_set_ids.extend(rebuild_event_progression_preserving_pending_results(
                    &mut snapshot,
                    &applied_event_id,
                    &local_meta.pending_set_results,
                ));
            }

            local_meta.pending_set_results.retain(|result| {
                !affected_set_ids.contains(&result.set_id)
                    || pending_result_matches_snapshot_roster(&snapshot, &applied_event_id, result)
            });
            local_meta
                .pending_grand_final_reset_results
                .retain(|result| !affected_set_ids.contains(&result.source_grand_final_set_id));
            local_meta
                .set_play_sides
                .retain(|side| !affected_set_ids.contains(&side.set_id));
        }
        storage_perf_log(|| {
            format!(
                "apply_progression_incremental event={} set={} target_count={} target_index_cache_hit={} elapsed_us={}",
                applied_event_id,
                input.set_id,
                targets_by_source.get(&input.set_id).map_or(0, Vec::len),
                target_index_cache_hit,
                progression_started_at.elapsed().as_micros()
            )
        });
    } else if (should_advance || existing_set_state.0) && should_rebuild_progression {
        let invalidated_set_ids = rebuild_event_progression_preserving_pending_results(
            &mut snapshot,
            &applied_event_id,
            &local_meta.pending_set_results,
        );
        local_meta.pending_set_results.retain(|result| {
            !invalidated_set_ids.contains(&result.set_id)
                || pending_result_matches_snapshot_roster(&snapshot, &applied_event_id, result)
        });
        local_meta
            .pending_grand_final_reset_results
            .retain(|result| !invalidated_set_ids.contains(&result.source_grand_final_set_id));
        local_meta
            .set_play_sides
            .retain(|side| !invalidated_set_ids.contains(&side.set_id));
    }

    save_local_meta(app, &applied_event_id, &local_meta)?;
    cache_progression_snapshot(&snapshot, false, should_rebuild_progression);
    save_event_graph_snapshot(app, &snapshot, &applied_event_id)?;

    storage_perf_log(|| {
        format!(
            "upsert_local_set_result event={} elapsed_us={}",
            applied_event_id,
            started_at.elapsed().as_micros()
        )
    });
    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn upsert_local_set_scores(
    app: &AppHandle,
    input: LocalSetScoreUpdateInput,
) -> Result<TournamentWorkspace, String> {
    let started_at = Instant::now();
    let mut snapshot = load_event_snapshot(app, &input.slug, &input.event_id)?;
    if snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .and_then(|event| {
            event
                .sets
                .iter()
                .find(|set| set.set_id == input.set_id)
                .map(|set| is_inactive_grand_final_reset_set(event, set))
        })
        .unwrap_or(false)
    {
        return Err("Winners側のプレイヤーがGrand Finalに勝利したため、Grand Final Resetのスコアは保存できません。".to_owned());
    }
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;
    ensure_set_score_edit_enabled(&local_meta, &snapshot, &input.event_id, &input.set_id)?;

    if snapshot
        .events
        .iter()
        .flat_map(|event| event.sets.iter())
        .any(|set| set.set_id == input.set_id && set.state >= 3)
    {
        return Err("確定済みsetのスコアは更新できません。影響setを取消してください。".to_owned());
    }

    if snapshot
        .events
        .iter()
        .flat_map(|event| event.sets.iter())
        .any(|set| set.set_id == input.set_id && set.state >= 3)
    {
        return Err("確定済みsetのスコアは更新できません。影響setを取消してください。".to_owned());
    }

    let applied_event_id = {
        let (event_id, set_snapshot) = find_set_in_snapshot_mut(&mut snapshot, &input.set_id)
            .ok_or_else(|| "スコア更新対象setがローカルsnapshotに見つかりません。".to_owned())?;

        set_snapshot.winner_id = None;
        if set_snapshot.state >= 3 {
            set_snapshot.state = 2;
        }

        for slot in &mut set_snapshot.slots {
            if let Some(entrant_id) = slot.entrant_id.as_ref() {
                if let Some(found) = input
                    .slot_scores
                    .iter()
                    .find(|score| score.entrant_id == *entrant_id)
                {
                    slot.score = Some(found.score as f64);
                }
            }
        }

        event_id.clone()
    };

    let event_name = snapshot
        .events
        .iter()
        .find(|event| event.event_id == applied_event_id)
        .map(|event| event.name.clone())
        .unwrap_or_default();
    let slot_scores = input
        .slot_scores
        .iter()
        .map(|slot| LocalSetScoreMeta {
            entrant_id: slot.entrant_id.clone(),
            score: slot.score,
        })
        .collect::<Vec<_>>();
    local_meta
        .pending_set_results
        .retain(|item| item.set_id != input.set_id);
    if let Some(source_grand_final_set_id) =
        source_grand_final_set_id_from_virtual_reset_set_id(&input.set_id)
    {
        local_meta.pending_grand_final_reset_results.retain(|item| {
            !(item.event_id == applied_event_id
                && item.source_grand_final_set_id == source_grand_final_set_id)
        });
        if !slot_scores.is_empty() {
            local_meta
                .pending_grand_final_reset_results
                .push(LocalGrandFinalResetResultMeta {
                    event_id: applied_event_id.clone(),
                    event_name,
                    source_grand_final_set_id,
                    winner_id: String::new(),
                    score_csv: String::new(),
                    direct_win: false,
                    confirmed: false,
                    slot_scores,
                    recorded_at: Utc::now(),
                });
        }
    } else if !slot_scores.is_empty() {
        local_meta.pending_set_results.push(LocalSetResultMeta {
            event_id: applied_event_id.clone(),
            event_name,
            set_id: input.set_id.clone(),
            winner_id: String::new(),
            score_csv: String::new(),
            direct_win: false,
            confirmed: false,
            slot_scores,
            reset_source_set_id: None,
            recorded_at: Utc::now(),
        });
    }

    local_meta.slug = input.slug;
    local_meta.tournament_id = snapshot.tournament_id.clone();
    local_meta.updated_at = Utc::now();

    save_local_meta(app, &applied_event_id, &local_meta)?;
    cache_progression_snapshot(&snapshot, false, true);
    save_event_graph_snapshot(app, &snapshot, &applied_event_id)?;

    storage_perf_log(|| {
        format!(
            "upsert_local_set_scores event={} elapsed_us={}",
            applied_event_id,
            started_at.elapsed().as_micros()
        )
    });
    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn remove_pending_set_results(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    set_ids: &[String],
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, slug, event_id)?;
    let remove_ids = set_ids.iter().collect::<HashSet<&String>>();
    local_meta
        .pending_set_results
        .retain(|item| !remove_ids.contains(&item.set_id));
    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;
    invalidate_progression_cache(slug);
    Ok(local_meta)
}

pub fn clear_pending_set_results(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, slug, event_id)?;
    if local_meta
        .pending_set_results
        .iter()
        .any(|item| item.event_id == event_id && item.confirmed)
        || local_meta
            .pending_grand_final_reset_results
            .iter()
            .any(|item| item.event_id == event_id && item.confirmed)
    {
        return Err(
            "確定済み結果を下書き破棄で削除することはできません。影響setを取消してください。"
                .to_owned(),
        );
    }

    let mut snapshot = load_event_snapshot(app, slug, event_id)?;
    let pristine_snapshot = load_pristine_event_snapshot(app, slug, event_id)
        .or_else(|_| load_event_snapshot(app, slug, event_id))?;

    let pending_set_ids = local_meta
        .pending_set_results
        .iter()
        .filter(|item| item.event_id == event_id)
        .map(|item| item.set_id.clone())
        .collect::<HashSet<String>>();
    let pending_gf_reset_source_set_ids = local_meta
        .pending_grand_final_reset_results
        .iter()
        .filter(|item| item.event_id == event_id)
        .map(|item| item.source_grand_final_set_id.clone())
        .collect::<HashSet<String>>();
    for set_id in pending_set_ids
        .iter()
        .chain(&pending_gf_reset_source_set_ids)
    {
        ensure_set_score_edit_enabled(&local_meta, &snapshot, event_id, set_id)?;
    }

    let mut restored_from_pristine = false;

    if let Some(pristine_event) = pristine_snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .cloned()
    {
        if let Some(existing_event) = snapshot
            .events
            .iter_mut()
            .find(|event| event.event_id == event_id)
        {
            *existing_event = pristine_event;
        } else {
            snapshot.events.push(pristine_event);
        }
        restored_from_pristine = true;
    }

    if !restored_from_pristine {
        if let Some(event) = snapshot
            .events
            .iter_mut()
            .find(|event| event.event_id == event_id)
        {
            for set in &mut event.sets {
                if pending_set_ids.contains(&set.set_id)
                    || pending_gf_reset_source_set_ids.contains(&set.set_id)
                {
                    clear_set_result_state(set);
                }
            }
            apply_source_based_tbd_labels(event);
        }
    }

    local_meta
        .pending_set_results
        .retain(|item| item.event_id != event_id);
    local_meta
        .pending_grand_final_reset_results
        .retain(|item| item.event_id != event_id);
    local_meta.updated_at = Utc::now();

    save_snapshot(app, &snapshot)?;
    save_local_meta(app, event_id, &local_meta)?;
    Ok(local_meta)
}

pub fn discard_pending_set_results_for_snapshot_refresh(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, slug, event_id)?;
    local_meta
        .pending_set_results
        .retain(|item| item.event_id != event_id);
    local_meta
        .pending_grand_final_reset_results
        .retain(|item| item.event_id != event_id);
    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;
    invalidate_progression_cache(slug);
    Ok(local_meta)
}

pub fn clear_pending_set_result_for_set(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    set_id: &str,
) -> Result<TournamentWorkspace, String> {
    let local_meta = load_local_meta(app, slug, event_id)?;
    let mut snapshot = load_event_snapshot(app, slug, event_id)?;
    ensure_set_score_edit_enabled(&local_meta, &snapshot, event_id, set_id)?;
    if local_meta
        .pending_set_results
        .iter()
        .any(|item| item.event_id == event_id && item.set_id == set_id && item.confirmed)
    {
        return Err(
            "確定済み結果を下書き破棄で削除することはできません。影響setを取消してください。"
                .to_owned(),
        );
    }

    let pristine_snapshot = load_pristine_event_snapshot(app, slug, event_id).ok();

    {
        let event = snapshot
            .events
            .iter_mut()
            .find(|event| event.event_id == event_id)
            .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

        let matchup_ready = event
            .sets
            .iter()
            .find(|set| set.set_id == set_id)
            .map(|set| {
                set.slots
                    .iter()
                    .filter(|slot| {
                        slot.entrant_id
                            .as_deref()
                            .map(str::trim)
                            .is_some_and(|entrant_id| !entrant_id.is_empty())
                    })
                    .count()
                    >= 2
            })
            .unwrap_or(false);
        if !matchup_ready {
            return Err("対戦カードが確定していないsetは下書きを破棄できません。".to_owned());
        }

        let mut restored_from_pristine = false;

        if let Some(pristine_event) = pristine_snapshot
            .as_ref()
            .and_then(|item| item.events.iter().find(|event| event.event_id == event_id))
        {
            if let Some(pristine_set) = pristine_event
                .sets
                .iter()
                .find(|set| set.set_id == set_id)
                .cloned()
            {
                if let Some(existing_set) = event.sets.iter_mut().find(|set| set.set_id == set_id) {
                    *existing_set = pristine_set;
                    restored_from_pristine = true;
                }
            }
        }

        if !restored_from_pristine {
            let target_set = event
                .sets
                .iter_mut()
                .find(|set| set.set_id == set_id)
                .ok_or_else(|| format!("下書き破棄対象setが見つかりません: {set_id}"))?;
            clear_set_result_state(target_set);
        }

        apply_source_based_tbd_labels(event);
    }

    let mut local_meta = local_meta;
    local_meta
        .pending_set_results
        .retain(|item| !(item.event_id == event_id && item.set_id == set_id));

    if let Some(source_grand_final_set_id) =
        source_grand_final_set_id_from_virtual_reset_set_id(set_id)
    {
        local_meta.pending_grand_final_reset_results.retain(|item| {
            !(item.event_id == event_id
                && item.source_grand_final_set_id == source_grand_final_set_id)
        });
    } else {
        local_meta.pending_grand_final_reset_results.retain(|item| {
            !(item.event_id == event_id && item.source_grand_final_set_id == set_id)
        });
    }

    local_meta.updated_at = Utc::now();

    save_snapshot(app, &snapshot)?;
    save_local_meta(app, event_id, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn remove_pending_grand_final_reset_results(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    source_grand_final_set_ids: &[String],
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, slug, event_id)?;
    let remove_ids = source_grand_final_set_ids
        .iter()
        .collect::<HashSet<&String>>();
    local_meta
        .pending_grand_final_reset_results
        .retain(|item| !remove_ids.contains(&item.source_grand_final_set_id));
    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;
    invalidate_progression_cache(slug);
    Ok(local_meta)
}

pub fn upsert_local_player_meta(
    app: &AppHandle,
    input: LocalPlayerMetaInput,
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;

    let event_index = if let Some(index) = local_meta
        .events
        .iter()
        .position(|event| event.event_id == input.event_id)
    {
        index
    } else {
        local_meta.events.push(EventLocalMeta {
            event_id: input.event_id.clone(),
            event_name: input.event_name.clone(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
        local_meta.events.len().saturating_sub(1)
    };

    let event_meta = local_meta
        .events
        .get_mut(event_index)
        .ok_or_else(|| "イベントメタの更新先を特定できませんでした。".to_owned())?;
    event_meta.event_name = input.event_name.clone();

    let character_names = normalize_character_names(&input.character_names);
    let auth_code = derive_auth_code(&input.slug, &input.event_id, &input.entrant_id);

    if let Some(existing) = event_meta
        .entrants
        .iter_mut()
        .find(|entrant| entrant.entrant_id == input.entrant_id)
    {
        existing.entrant_name = input.entrant_name.clone();
        existing.alias_name = input.alias_name.clone();
        existing.play_side = input.play_side;
        existing.character_names = character_names;
        existing.notes = input.notes;
        if existing.auth_code.trim().is_empty() {
            existing.auth_code = auth_code;
        }
    } else {
        event_meta.entrants.push(EventEntrantMeta {
            entrant_id: input.entrant_id,
            entrant_name: input.entrant_name,
            alias_name: input.alias_name,
            play_side: input.play_side,
            character_names,
            auth_code,
            notes: input.notes,
        });
    }

    local_meta.slug = input.slug;
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;
    Ok(local_meta)
}

pub fn upsert_local_set_play_side(
    app: &AppHandle,
    input: LocalSetPlaySideInput,
) -> Result<TournamentWorkspace, String> {
    let snapshot = load_event_snapshot(app, &input.slug, &input.event_id)?;
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;

    let set_snapshot = snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .and_then(|event| event.sets.iter().find(|set| set.set_id == input.set_id))
        .ok_or_else(|| "サイド保存対象のsetが見つかりません。".to_owned())?;

    let snapshot_entrant_ids = set_snapshot
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.clone())
        .collect::<Vec<String>>();
    let entrant_ids = if is_set_matchup_ready(set_snapshot) {
        snapshot_entrant_ids
    } else if let Some(opponent_id) = input.opponent_entrant_id.clone() {
        if opponent_id == input.entrant_id {
            return Err("サイド保存対象のentrantが重複しています。".to_owned());
        }
        vec![input.entrant_id.clone(), opponent_id]
    } else {
        return Err("対戦カードが確定していないsetはサイド設定できません。".to_owned());
    };

    if !entrant_ids.iter().any(|id| id == &input.entrant_id) {
        return Err("サイド保存対象のentrantがsetに含まれていません。".to_owned());
    }

    local_meta
        .set_play_sides
        .retain(|item| item.set_id != input.set_id);

    if let Some(play_side) = input.play_side {
        let opponent_id = entrant_ids
            .iter()
            .find(|id| id.as_str() != input.entrant_id)
            .cloned()
            .ok_or_else(|| "対戦カードが確定していないsetはサイド設定できません。".to_owned())?;

        local_meta.set_play_sides.push(SetPlaySideMeta {
            set_id: input.set_id.clone(),
            entrant_id: input.entrant_id,
            play_side: play_side.clone(),
        });
        local_meta.set_play_sides.push(SetPlaySideMeta {
            set_id: input.set_id,
            entrant_id: opponent_id,
            play_side: opposite_side(play_side),
        });
    }

    local_meta.slug = input.slug;
    local_meta.tournament_id = snapshot.tournament_id.clone();
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn save_event_management_meta(
    app: &AppHandle,
    input: SaveEventManagementMetaInput,
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;

    let event_index = if let Some(index) = local_meta
        .events
        .iter()
        .position(|event| event.event_id == input.event_id)
    {
        index
    } else {
        local_meta.events.push(EventLocalMeta {
            event_id: input.event_id.clone(),
            event_name: input.event_name.clone(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
        local_meta.events.len().saturating_sub(1)
    };

    let event_meta = local_meta
        .events
        .get_mut(event_index)
        .ok_or_else(|| "イベントメタの更新先を特定できませんでした。".to_owned())?;
    event_meta.event_name = input.event_name.clone();

    let next_setting = normalize_event_management_meta(input.setting);
    event_meta.event_management = Some(next_setting);

    local_meta.slug = input.slug;
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;
    Ok(local_meta)
}

pub fn set_phase_group_score_edit_lock(
    app: &AppHandle,
    input: SetPhaseGroupScoreEditLockInput,
) -> Result<TournamentWorkspace, String> {
    let snapshot = load_event_snapshot(app, &input.slug, &input.event_id)?;
    let phase_group_id = input.phase_group_id.trim();
    if phase_group_id.is_empty()
        || !snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .is_some_and(|event| {
                event
                    .phase_groups
                    .iter()
                    .any(|group| group.phase_group_id == phase_group_id)
            })
    {
        return Err("指定プールがローカルsnapshotに見つかりません。".to_owned());
    }

    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;
    let event_index = local_meta
        .events
        .iter()
        .position(|event| event.event_id == input.event_id)
        .unwrap_or_else(|| {
            local_meta.events.push(EventLocalMeta {
                event_id: input.event_id.clone(),
                event_name: input.event_name.clone(),
                event_alias: None,
                last_selected_phase_name: None,
                last_selected_phase_group_name: None,
                event_management: None,
                score_edit_enabled_phase_group_ids: Vec::new(),
                external_score_broadcast_phase_group_ids: Vec::new(),
                external_editors: Vec::new(),
                entrants: Vec::new(),
            });
            local_meta.events.len() - 1
        });
    let event_meta = local_meta
        .events
        .get_mut(event_index)
        .ok_or_else(|| "イベントメタの更新先を特定できませんでした。".to_owned())?;
    event_meta.event_name = input.event_name;
    if input.locked {
        event_meta
            .score_edit_enabled_phase_group_ids
            .retain(|enabled_id| enabled_id != phase_group_id);
    } else if !event_meta
        .score_edit_enabled_phase_group_ids
        .iter()
        .any(|enabled_id| enabled_id == phase_group_id)
    {
        event_meta
            .score_edit_enabled_phase_group_ids
            .push(phase_group_id.to_owned());
    }
    local_meta.slug = input.slug;
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn set_phase_group_external_score_broadcast(
    app: &AppHandle,
    input: SetPhaseGroupExternalScoreBroadcastInput,
) -> Result<TournamentWorkspace, String> {
    let snapshot = load_event_snapshot(app, &input.slug, &input.event_id)?;
    let phase_group_id = input.phase_group_id.trim();
    if phase_group_id.is_empty()
        || !snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .is_some_and(|event| {
                event
                    .phase_groups
                    .iter()
                    .any(|group| group.phase_group_id == phase_group_id)
            })
    {
        return Err("指定プールがローカルsnapshotに見つかりません。".to_owned());
    }

    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;
    let event_index = local_meta
        .events
        .iter()
        .position(|event| event.event_id == input.event_id)
        .unwrap_or_else(|| {
            local_meta.events.push(EventLocalMeta {
                event_id: input.event_id.clone(),
                event_name: input.event_name.clone(),
                event_alias: None,
                last_selected_phase_name: None,
                last_selected_phase_group_name: None,
                event_management: None,
                score_edit_enabled_phase_group_ids: Vec::new(),
                external_score_broadcast_phase_group_ids: Vec::new(),
                external_editors: Vec::new(),
                entrants: Vec::new(),
            });
            local_meta.events.len() - 1
        });
    let event_meta = local_meta
        .events
        .get_mut(event_index)
        .ok_or_else(|| "イベントメタの更新先を特定できませんでした。".to_owned())?;
    event_meta.event_name = input.event_name;
    if input.enabled {
        if !event_meta
            .external_score_broadcast_phase_group_ids
            .iter()
            .any(|enabled_id| enabled_id == phase_group_id)
        {
            event_meta
                .external_score_broadcast_phase_group_ids
                .push(phase_group_id.to_owned());
        }
    } else {
        event_meta
            .external_score_broadcast_phase_group_ids
            .retain(|enabled_id| enabled_id != phase_group_id);
    }
    local_meta.slug = input.slug;
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn set_phase_group_external_editor(
    app: &AppHandle,
    input: SetPhaseGroupExternalEditorInput,
) -> Result<TournamentWorkspace, String> {
    let snapshot = load_event_snapshot(app, &input.slug, &input.event_id)?;
    let phase_group_id = input.phase_group_id.trim();
    let sender_name = input.sender_name.trim();
    let sender_user_id = input.sender_user_id.trim();
    if phase_group_id.is_empty()
        || sender_name.is_empty()
        || sender_user_id.len() != 8
        || !sender_user_id.bytes().all(|byte| byte.is_ascii_digit())
        || !snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .is_some_and(|event| {
                event
                    .phase_groups
                    .iter()
                    .any(|group| group.phase_group_id == phase_group_id)
            })
    {
        return Err("外部編集者または指定プールの情報が不正です。".to_owned());
    }

    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;
    let event_index = local_meta
        .events
        .iter()
        .position(|event| event.event_id == input.event_id)
        .unwrap_or_else(|| {
            local_meta.events.push(EventLocalMeta {
                event_id: input.event_id.clone(),
                event_name: input.event_name.clone(),
                event_alias: None,
                last_selected_phase_name: None,
                last_selected_phase_group_name: None,
                event_management: None,
                score_edit_enabled_phase_group_ids: Vec::new(),
                external_score_broadcast_phase_group_ids: Vec::new(),
                external_editors: Vec::new(),
                entrants: Vec::new(),
            });
            local_meta.events.len() - 1
        });
    let event_meta = local_meta
        .events
        .get_mut(event_index)
        .ok_or_else(|| "イベントメタの更新先を特定できませんでした。".to_owned())?;
    event_meta.event_name = input.event_name;

    let editor = PhaseGroupExternalEditor {
        phase_group_id: phase_group_id.to_owned(),
        sender_name: sender_name.to_owned(),
        sender_user_id: sender_user_id.to_owned(),
    };
    if let Some(existing) = event_meta
        .external_editors
        .iter_mut()
        .find(|existing| existing.phase_group_id == phase_group_id)
    {
        *existing = editor;
    } else {
        event_meta.external_editors.push(editor);
    }

    local_meta.slug = input.slug;
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn set_event_last_phase_pool_selection(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    event_name: &str,
    phase_name: Option<&str>,
    phase_group_name: Option<&str>,
) -> Result<TournamentLocalMeta, String> {
    let mut local_meta = load_local_meta(app, slug, event_id)?;

    let event_index = if let Some(index) = local_meta
        .events
        .iter()
        .position(|event| event.event_id == event_id)
    {
        index
    } else {
        local_meta.events.push(EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: event_name.to_owned(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            score_edit_enabled_phase_group_ids: Vec::new(),
            external_score_broadcast_phase_group_ids: Vec::new(),
            external_editors: Vec::new(),
            entrants: Vec::new(),
        });
        local_meta.events.len().saturating_sub(1)
    };

    let normalized_phase_name = phase_name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let normalized_phase_group_name = phase_group_name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());

    let event_meta = local_meta
        .events
        .get_mut(event_index)
        .ok_or_else(|| "イベントメタの更新先を特定できませんでした。".to_owned())?;
    if !event_name.trim().is_empty() {
        event_meta.event_name = event_name.trim().to_owned();
    }
    event_meta.last_selected_phase_name = normalized_phase_name;
    event_meta.last_selected_phase_group_name = normalized_phase_group_name;

    local_meta.slug = slug.to_owned();
    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;
    Ok(local_meta)
}

#[cfg(test)]
#[path = "storage/tests/progression_source_tests.rs"]
mod progression_source_tests;
