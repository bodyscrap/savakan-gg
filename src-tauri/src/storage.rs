use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::models::{
    BracketGraphEdge, BracketGraphSnapshot, EventEntrantMeta, EventLocalMeta, EventManagementMeta,
    EventSnapshot, GenericMessage, ItemListConfig, LocalGrandFinalResetResultMeta,
    LocalPlayerMetaInput, LocalSetPlaySideInput, LocalSetResultInput, LocalSetResultMeta,
    LocalSetScoreMeta, LocalSetScoreUpdateInput, LocalSnapshotEventListItem,
    MobileResultRequestInput, MobileResultRequestItem, PhaseGroupGraphSeedSnapshot,
    PhaseGroupSeedSnapshot, SaveEventManagementMetaInput, SenderProfile, SetPlaySideMeta,
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
        events: vec![EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            last_selected_phase_name: None,
            last_selected_phase_group_name: None,
            event_management: None,
            entrants: Vec::new(),
        }],
        set_play_sides: Vec::new(),
        pending_set_results: Vec::new(),
        pending_grand_final_reset_results: Vec::new(),
        updated_at: Utc::now(),
    }
}

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

fn normalize_score_csv(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(' ', "")
}

fn integer_score(value: Option<f64>) -> Option<i64> {
    let score = value?;
    let rounded = score.round();
    if (score - rounded).abs() > 0.000_001 {
        return None;
    }
    Some(rounded as i64)
}

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

fn is_pending_result_matched_with_set(
    pending: &LocalSetResultMeta,
    set: &crate::models::SetSnapshot,
) -> bool {
    // winner_id が空の場合は「結果取り消し(reset)」の差分を表す。
    if pending.winner_id.trim().is_empty() {
        return set.winner_id.is_none();
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

            if let Some(existing) = event_meta
                .entrants
                .iter_mut()
                .find(|item| item.entrant_id == *entrant_id)
            {
                existing.entrant_name = slot.entrant_name.clone();
                continue;
            }

            event_meta.entrants.push(EventEntrantMeta {
                entrant_id: entrant_id.clone(),
                entrant_name: slot.entrant_name.clone(),
                play_side: None,
                character_names: Vec::new(),
                auth_code: derive_auth_code(&snapshot.slug, &event.event_id, entrant_id),
                notes: None,
            });
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
    tournament_id: String,
    event_id: String,
    phase_name: String,
    phase_group_name: String,
    set_id: String,
    entrant_id: String,
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
    let entrant_id = message_meta_string(meta, "callEntrantId");
    let tournament_id = {
        let scoped = message_meta_string(meta, "scopeTournamentId");
        if !scoped.is_empty() {
            scoped
        } else {
            message_meta_string(meta, "tournamentId")
        }
    };
    let event_id = {
        let scoped = message_meta_string(meta, "scopeEventId");
        if !scoped.is_empty() {
            scoped
        } else {
            message_meta_string(meta, "eventId")
        }
    };
    let phase_name = {
        let scoped = message_meta_string(meta, "scopePhaseName");
        let legacy = if scoped.is_empty() {
            message_meta_string(meta, "phaseName")
        } else {
            scoped
        };
        if legacy.is_empty() {
            "Phase 未設定".to_owned()
        } else {
            legacy
        }
    };
    let phase_group_name = {
        let scoped = message_meta_string(meta, "scopePhaseGroupName");
        let legacy = if scoped.is_empty() {
            message_meta_string(meta, "phaseGroupName")
        } else {
            scoped
        };
        if legacy.is_empty() {
            "Pool 未設定".to_owned()
        } else {
            legacy
        }
    };

    if tournament_id.is_empty() || event_id.is_empty() || set_id.is_empty() || entrant_id.is_empty()
    {
        return None;
    }

    Some(CallMessageIdentity {
        tournament_id,
        event_id,
        phase_name,
        phase_group_name,
        set_id,
        entrant_id,
    })
}

fn call_identity_matches(left: &CallMessageIdentity, right: &CallMessageIdentity) -> bool {
    left.tournament_id == right.tournament_id
        && left.event_id == right.event_id
        && left.phase_name == right.phase_name
        && left.phase_group_name == right.phase_group_name
        && left.set_id == right.set_id
        && left.entrant_id == right.entrant_id
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

pub fn append_generic_message(app: &AppHandle, message: &GenericMessage) -> Result<(), String> {
    let mut messages = load_generic_messages(app)?.unwrap_or_default();

    if message.message_type == "resolve" && message.method == "call_player" {
        let known_call_thread = messages.iter().any(|item| {
            item.thread_id == message.thread_id
                && item.parent_message_id.is_none()
                && item.method == "call_player"
        });

        if !known_call_thread {
            // 未知の呼び出しスレッドに対する解決メッセージは取り込まない。
            return Ok(());
        }
    }

    if message.message_type == "normal"
        && message.parent_message_id.is_none()
        && message.method == "call_player"
    {
        if let Some(call_identity) = call_message_identity(message) {
            let matching_roots = messages
                .iter()
                .filter(|item| {
                    item.parent_message_id.is_none()
                        && item.method == "call_player"
                        && call_message_identity(item)
                            .map(|item_identity| {
                                call_identity_matches(&item_identity, &call_identity)
                            })
                            .unwrap_or(false)
                })
                .cloned()
                .collect::<Vec<_>>();

            for root in matching_roots {
                let thread_has_resolve = messages
                    .iter()
                    .any(|item| item.thread_id == root.thread_id && item.message_type == "resolve");

                if !thread_has_resolve {
                    messages.push(build_forced_resolve_message(&root));
                }
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

fn build_bracket_graph(
    snapshot: &TournamentSnapshot,
    event: &EventSnapshot,
) -> BracketGraphSnapshot {
    let phase_group_key = |set: &crate::models::SetSnapshot| {
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
    };

    let mut graph_event = event.clone();
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
        let target_phase_group_key = format!(
            "{}::{}",
            set.phase_order
                .map(|order| order.to_string())
                .or_else(|| set.phase_name.clone())
                .unwrap_or_default(),
            set.phase_group_display_identifier
                .clone()
                .or_else(|| set.phase_group_name.clone())
                .unwrap_or_default(),
        );

        rewrite_progression_source(
            &mut set.entrant1_source,
            &target_phase_group_key,
            event,
            &set_name_by_id,
        );
        rewrite_progression_source(
            &mut set.entrant2_source,
            &target_phase_group_key,
            event,
            &set_name_by_id,
        );
        rewrite_intermediate_source(&mut set.entrant1_source, event, &set_name_by_id);
        rewrite_intermediate_source(&mut set.entrant2_source, event, &set_name_by_id);
    }

    let mut raw_edges = Vec::new();
    for target in &event.sets {
        let target_phase_group_key = phase_group_key(target);
        let phase_group_sets = event
            .sets
            .iter()
            .filter(|candidate| phase_group_key(candidate) == target_phase_group_key)
            .collect::<Vec<_>>();

        for (target_slot_index, source) in [
            target.entrant1_source.as_ref(),
            target.entrant2_source.as_ref(),
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

            let progression_candidate = phase_group_sets
                .iter()
                .find_map(|candidate| {
                    if candidate.winner_progression_seed_id.as_deref()
                        == Some(progression_source_id)
                    {
                        return Some((*candidate, "winner"));
                    }
                    if candidate.loser_progression_seed_id.as_deref() == Some(progression_source_id)
                    {
                        return Some((*candidate, "loser"));
                    }
                    None
                })
                .or_else(|| {
                    event.sets.iter().find_map(|candidate| {
                        if candidate.winner_progression_seed_id.as_deref()
                            == Some(progression_source_id)
                        {
                            return Some((candidate, "winner"));
                        }
                        if candidate.loser_progression_seed_id.as_deref()
                            == Some(progression_source_id)
                        {
                            return Some((candidate, "loser"));
                        }
                        None
                    })
                });

            if let Some((candidate, relation)) = progression_candidate {
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

            if let Some(resolved_edges) = resolve_hidden_source_edges(event, source_set_id) {
                for (from_set_id, relation) in resolved_edges {
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

            if let Some(candidate) = phase_group_sets
                .iter()
                .find(|candidate| candidate.set_id == source_set_id)
            {
                if let Some(relation) = source.condition.as_deref() {
                    raw_edges.push(BracketGraphEdge {
                        from_set_id: candidate.set_id.clone(),
                        to_set_id: target.set_id.clone(),
                        target_slot_index,
                        relation: relation.to_ascii_lowercase(),
                        progression_id: None,
                    });
                }
            }
        }
    }

    let phase_group_keys = event
        .sets
        .iter()
        .map(phase_group_key)
        .collect::<HashSet<_>>();
    for phase_group_key_value in phase_group_keys {
        let group_sets = event
            .sets
            .iter()
            .filter(|set| phase_group_key(set) == phase_group_key_value)
            .collect::<Vec<_>>();
        let Some(first_losers_round) = group_sets
            .iter()
            .filter(|set| is_losers_set(set))
            .filter_map(|set| set.round.map(|round| round.abs()))
            .min()
        else {
            continue;
        };
        let Some(first_winners_round) = group_sets
            .iter()
            .filter(|set| !is_losers_set(set) && !is_grand_final_set(set))
            .filter_map(|set| set.round.map(|round| round.abs()))
            .min()
        else {
            continue;
        };

        let mut winners_first_ids = group_sets
            .iter()
            .filter(|set| {
                !is_losers_set(set)
                    && !is_grand_final_set(set)
                    && set.round.map(|round| round.abs()) == Some(first_winners_round)
            })
            .map(|set| set.set_id.clone())
            .collect::<Vec<_>>();
        let mut losers_first_ids = group_sets
            .iter()
            .filter(|set| {
                is_losers_set(set) && set.round.map(|round| round.abs()) == Some(first_losers_round)
            })
            .map(|set| set.set_id.clone())
            .collect::<Vec<_>>();
        winners_first_ids.sort();
        losers_first_ids.sort();

        for (target_index, target_set_id) in losers_first_ids.iter().enumerate() {
            let source_ids =
                pick_pair_source_ids(&winners_first_ids, losers_first_ids.len(), target_index);
            raw_edges.retain(|edge| edge.to_set_id != *target_set_id);
            for (target_slot_index, source_set_id) in source_ids.into_iter().enumerate() {
                raw_edges.push(BracketGraphEdge {
                    from_set_id: source_set_id,
                    to_set_id: target_set_id.clone(),
                    target_slot_index,
                    relation: "loser".to_owned(),
                    progression_id: None,
                });
            }
        }
    }

    let mut edges = Vec::new();
    let mut seen_edges = HashSet::new();
    for raw_edge in &raw_edges {
        if event
            .sets
            .iter()
            .find(|set| set.set_id == raw_edge.to_set_id)
            .is_some_and(|set| set.is_intermediate)
        {
            continue;
        }

        let mut pending_sources = vec![(raw_edge.from_set_id.clone(), raw_edge.relation.clone())];
        let mut visited = HashSet::new();

        while let Some((source_set_id, relation)) = pending_sources.pop() {
            if !visited.insert((source_set_id.clone(), relation.clone())) {
                continue;
            }

            let source_set = event.sets.iter().find(|set| set.set_id == source_set_id);
            if source_set.is_some_and(|set| set.is_intermediate) {
                for incoming in raw_edges
                    .iter()
                    .filter(|edge| edge.to_set_id == source_set_id)
                    .filter(|edge| {
                        source_set
                            .and_then(hidden_pipe_source_slot_indexes)
                            .is_none_or(|slot_indexes| {
                                slot_indexes.contains(&edge.target_slot_index)
                            })
                    })
                {
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
    let path = if pristine {
        pristine_event_snapshot_path_with_keys(app, tournament_id, slug_key, event_id, event_name)?
    } else {
        event_snapshot_path_with_keys(app, tournament_id, slug_key, event_id, event_name)?
    };
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("スナップショットのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("スナップショット保存に失敗しました: {e}"))
}

fn save_event_graph_file(
    app: &AppHandle,
    graph: &BracketGraphSnapshot,
    tournament_id: &str,
    slug_key: &str,
    event_id: &str,
    event_name: &str,
) -> Result<(), String> {
    let path = event_graph_path_with_keys(app, tournament_id, slug_key, event_id, event_name)?;
    let json = serde_json::to_string_pretty(graph)
        .map_err(|e| format!("ブラケットグラフのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("ブラケットグラフ保存に失敗しました: {e}"))
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
    let dir = snapshots_dir(app)?;
    let slug_key = normalize_slug_for_storage(slug);
    let suffix = if pristine {
        "-pristine.json"
    } else {
        "-snapshot.json"
    };
    let mut snapshots = Vec::new();
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
        if !file_name.ends_with(suffix) {
            continue;
        }
        let raw = match fs::read_to_string(path) {
            Ok(value) => value,
            Err(_) => continue,
        };
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
    // raw snapshot is the source of truth. The graph is a derived view that
    // rewrites sources and removes intermediate sets, so loading it first can
    // corrupt phase/set placement after a remote refresh.
    if let Some(mut snapshot) =
        merge_event_snapshot_files(load_event_snapshot_files(app, slug, false)?)
    {
        restore_pending_local_results(app, &slug, &mut snapshot)?;
        rebuild_progression_from_completed_sets(&mut snapshot);
        return Ok(snapshot);
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
        restore_pending_local_results(app, slug, &mut snapshot)?;
        rebuild_progression_from_completed_sets(&mut snapshot);
        return Ok(snapshot);
    }
    Err("ローカルスナップショット読込に失敗しました: 保存済みデータが見つかりません。".to_owned())
}

fn restore_pending_local_results(
    app: &AppHandle,
    slug: &str,
    snapshot: &mut TournamentSnapshot,
) -> Result<(), String> {
    let pending_results = snapshot
        .events
        .iter()
        .map(|event| {
            load_local_meta(app, slug, &event.event_id)
                .map(|meta| (event.event_id.clone(), meta.pending_set_results))
        })
        .collect::<Result<Vec<_>, _>>()?;

    for (event_id, results) in pending_results {
        let Some(event) = snapshot
            .events
            .iter_mut()
            .find(|event| event.event_id == event_id)
        else {
            continue;
        };
        for result in results {
            let Some(set) = event
                .sets
                .iter_mut()
                .find(|set| set.set_id == result.set_id)
            else {
                continue;
            };
            set.winner_id = result.confirmed.then_some(result.winner_id);
            set.state = if result.confirmed { 3 } else { 2 };
            for slot in &mut set.slots {
                if let Some(score) = result.slot_scores.iter().find(|score| {
                    score.entrant_id == slot.entrant_id.as_deref().unwrap_or_default()
                }) {
                    slot.score = Some(score.score as f64);
                }
            }
        }
    }
    Ok(())
}

fn rebuild_progression_from_completed_sets(snapshot: &mut TournamentSnapshot) {
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
    let mut completed_sets = snapshot
        .events
        .iter()
        .flat_map(|event| {
            event.sets.iter().filter_map(|set| {
                set.winner_id.as_ref().map(|winner_id| {
                    (
                        event.event_id.clone(),
                        set.set_id.clone(),
                        set.phase_order.unwrap_or(i64::MAX),
                        winner_id.clone(),
                    )
                })
            })
        })
        .collect::<Vec<_>>();
    completed_sets.sort_by_key(|item| item.2);

    for event in &mut snapshot.events {
        reset_derived_progression_sets(event);
    }

    for (event_id, set_id, _, winner_id) in completed_sets {
        let is_round_robin = snapshot
            .events
            .iter()
            .find(|event| event.event_id == event_id)
            .and_then(|event| event.sets.iter().find(|set| set.set_id == set_id))
            .is_some_and(|set| is_round_robin_set(snapshot, &event_id, set));
        if !is_round_robin {
            apply_local_progression(snapshot, &event_id, &set_id, &winner_id);
        }
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
    for (event_id, group_key) in round_robin_groups {
        apply_completed_round_robin_progression(snapshot, &event_id, &group_key);
    }

    for event in &mut snapshot.events {
        normalize_completed_source_slots(event);
        for set in &mut event.sets {
            for slot in &mut set.slots {
                let Some(entrant_id) = slot.entrant_id.as_ref() else {
                    continue;
                };
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
}

fn normalize_completed_source_slots(event: &mut EventSnapshot) {
    let is_round_robin_set = |set: &crate::models::SetSnapshot| {
        event.phase_groups.iter().any(|group| {
            group.phase_group_id == set.phase_group_id.as_deref().unwrap_or_default()
                && group
                    .bracket_type
                    .as_deref()
                    .is_some_and(|bracket_type| bracket_type.eq_ignore_ascii_case("ROUND_ROBIN"))
        })
    };
    let completed_sets = event
        .sets
        .iter()
        .filter(|set| !is_round_robin_set(set) && set.state == 3 && set.winner_id.is_some())
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
                if is_round_robin_set(target) {
                    return false;
                }
                if (source_set.winner_placement.is_some() || source_set.loser_placement.is_some())
                    && target.phase_order > source_set.phase_order
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
                        source_relation_reaches_set(event, source, source_set, &mut HashSet::new())
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

    let grand_final_slots = event
        .sets
        .iter()
        .filter(|set| is_grand_final_set(set) && !is_grand_final_reset_set(set))
        .map(|set| {
            (
                normalize_group_key(set.phase_name.as_ref()),
                normalize_group_key(set.phase_group_name.as_ref()),
                set.slots.clone(),
            )
        })
        .collect::<Vec<_>>();

    for reset_set in event
        .sets
        .iter_mut()
        .filter(|set| is_grand_final_reset_set(set))
    {
        let Some((_, _, grand_final_slots)) = grand_final_slots.iter().find(|(phase, group, _)| {
            *phase == normalize_group_key(reset_set.phase_name.as_ref())
                && *group == normalize_group_key(reset_set.phase_group_name.as_ref())
        }) else {
            continue;
        };

        if reset_set.winner_id.is_some() {
            continue;
        }

        for (reset_slot, grand_final_slot) in reset_set.slots.iter_mut().zip(grand_final_slots) {
            if grand_final_slot.entrant_id.is_none() {
                continue;
            }
            reset_slot.entrant_id = grand_final_slot.entrant_id.clone();
            reset_slot.entrant_name = grand_final_slot.entrant_name.clone();
            reset_slot.seed_id = grand_final_slot.seed_id.clone();
            reset_slot.seed_num = grand_final_slot.seed_num;
            reset_slot.score = None;
        }
        reset_set.state = if empty_slot_count(reset_set) == 0 {
            2
        } else {
            1
        };
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
        if set.phase_order.unwrap_or_default() <= 1 || set.is_intermediate {
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

fn load_pristine_snapshot(app: &AppHandle, slug: &str) -> Result<TournamentSnapshot, String> {
    if let Some(snapshot) = merge_event_snapshot_files(load_event_snapshot_files(app, slug, true)?)
    {
        return Ok(snapshot);
    }
    Err("原本スナップショット読込に失敗しました: 保存済みデータが見つかりません。".to_owned())
}

pub fn list_local_snapshot_events(
    app: &AppHandle,
) -> Result<Vec<LocalSnapshotEventListItem>, String> {
    let dir = snapshots_dir(app)?;
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("保存済みスナップショット一覧の取得に失敗しました: {e}"))?;
    let mut items = Vec::new();

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
        let snapshot = TournamentSnapshot {
            tournament_id: graph.tournament_id,
            slug: graph.slug,
            name: graph.tournament_name,
            events: vec![graph.event],
            updated_at: graph.updated_at,
        };

        for event in snapshot.events {
            let (event_alias, last_selected_phase_name, last_selected_phase_group_name) =
                load_local_meta(app, &snapshot.slug, &event.event_id)
                    .ok()
                    .and_then(|meta| {
                        meta.events
                            .into_iter()
                            .find(|item| item.event_id == event.event_id)
                            .map(|item| {
                                (
                                    item.event_alias,
                                    item.last_selected_phase_name,
                                    item.last_selected_phase_group_name,
                                )
                            })
                    })
                    .unwrap_or((None, None, None));

            items.push(LocalSnapshotEventListItem {
                tournament_id: snapshot.tournament_id.clone(),
                slug: snapshot.slug.clone(),
                tournament_name: snapshot.name.clone(),
                updated_at: snapshot.updated_at,
                event_id: event.event_id,
                event_name: event.name,
                event_alias,
                last_selected_phase_name,
                last_selected_phase_group_name,
                set_count: event.sets.len(),
            });
        }
    }

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

fn find_set_in_snapshot<'a>(
    snapshot: &'a TournamentSnapshot,
    set_id: &str,
) -> Option<(String, &'a crate::models::SetSnapshot)> {
    for event in &snapshot.events {
        if let Some(set) = event.sets.iter().find(|set| set.set_id == set_id) {
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

fn first_empty_slot_index(set: &crate::models::SetSnapshot) -> Option<usize> {
    set.slots.iter().position(|slot| {
        slot.entrant_id.is_none() || slot.entrant_name.trim().eq_ignore_ascii_case("tbd")
    })
}

fn is_slot_empty(slot: &crate::models::SetSlotSnapshot) -> bool {
    slot.entrant_id.is_none() || slot.entrant_name.trim().eq_ignore_ascii_case("tbd")
}

fn hidden_pipe_source_slot_indexes(set: &crate::models::SetSnapshot) -> Option<Vec<usize>> {
    if !set.is_intermediate {
        return None;
    }

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
    event: &EventSnapshot,
    source_set_id: &str,
) -> Option<Vec<(String, String)>> {
    resolve_hidden_source_edges_with_visited(event, source_set_id, &mut HashSet::new())
}

fn resolve_hidden_source_edges_with_visited(
    event: &EventSnapshot,
    source_set_id: &str,
    visited: &mut HashSet<String>,
) -> Option<Vec<(String, String)>> {
    let source_set = event.sets.iter().find(|set| set.set_id == source_set_id)?;
    let condition_sources = [
        source_set.entrant1_source.as_ref(),
        source_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .filter(|source| source.condition.is_some() && resolved_source_set_id(source).is_some())
    .collect::<Vec<_>>();

    if !source_set.is_intermediate && condition_sources.len() != 1 {
        return None;
    }
    if !visited.insert(source_set_id.to_owned()) {
        return Some(Vec::new());
    }

    let mut resolved = Vec::new();
    for source in condition_sources {
        let condition = source.condition.as_deref().unwrap_or_default();
        let type_id = resolved_source_set_id(source).unwrap_or_default();

        if let Some(nested) = resolve_hidden_source_edges_with_visited(event, type_id, visited) {
            resolved.extend(nested);
        } else if event
            .sets
            .iter()
            .any(|candidate| candidate.set_id == type_id)
        {
            resolved.push((type_id.to_owned(), condition.to_ascii_lowercase()));
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
            let Some((candidate, relation)) = progression_candidate_for_seed(event, source_id)
            else {
                continue;
            };
            resolved.push((candidate.set_id.clone(), relation.to_owned()));
        }
    }

    Some(resolved)
}

fn progression_candidate_for_seed<'a>(
    event: &'a EventSnapshot,
    source_id: &str,
) -> Option<(&'a crate::models::SetSnapshot, &'static str)> {
    event.sets.iter().find_map(|candidate| {
        if candidate.winner_progression_seed_id.as_deref() == Some(source_id) {
            return Some((candidate, "winner"));
        }
        if candidate.loser_progression_seed_id.as_deref() == Some(source_id) {
            return Some((candidate, "loser"));
        }
        None
    })
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
    event: &EventSnapshot,
    set_name_by_id: &HashMap<String, String>,
) {
    let Some(source_value) = source.as_mut() else {
        return;
    };
    let Some(source_set_id) = resolved_source_set_id(source_value) else {
        return;
    };
    let Some(resolved) = resolve_hidden_source_edges(event, source_set_id) else {
        return;
    };
    if resolved.len() != 1 {
        return;
    }

    let (resolved_set_id, relation) = &resolved[0];
    let Some(set_name) = set_name_by_id.get(resolved_set_id) else {
        return;
    };

    source_value.resolved_set_id = Some(resolved_set_id.clone());
    source_value.condition = Some(relation.clone());
    source_value.placeholder_name = event
        .sets
        .iter()
        .find(|candidate| candidate.set_id == *resolved_set_id)
        .and_then(|candidate| match relation.as_str() {
            "winner" => candidate.winner_progression_seed_placeholder_name.clone(),
            "loser" => candidate.loser_progression_seed_placeholder_name.clone(),
            _ => None,
        });
    source_value.condition_string = Some(format!("{relation} of {set_name}"));
}

fn rewrite_progression_source(
    source: &mut Option<crate::models::SetEntrantSourceSnapshot>,
    target_phase_group_key: &str,
    event: &EventSnapshot,
    set_name_by_id: &HashMap<String, String>,
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

    let phase_group_key = |set: &crate::models::SetSnapshot| {
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
    };
    let candidate = event
        .sets
        .iter()
        .filter(|candidate| phase_group_key(candidate) == target_phase_group_key)
        .find_map(|candidate| {
            if candidate.winner_progression_seed_id.as_deref() == Some(source_id) {
                return Some((candidate, "winner"));
            }
            if candidate.loser_progression_seed_id.as_deref() == Some(source_id) {
                return Some((candidate, "loser"));
            }
            None
        })
        .or_else(|| {
            event.sets.iter().find_map(|candidate| {
                if candidate.winner_progression_seed_id.as_deref() == Some(source_id) {
                    return Some((candidate, "winner"));
                }
                if candidate.loser_progression_seed_id.as_deref() == Some(source_id) {
                    return Some((candidate, "loser"));
                }
                None
            })
        });

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

fn build_round_columns_set_ids(event: &EventSnapshot, losers: bool) -> Vec<Vec<String>> {
    let mut grouped: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    let mut no_round = Vec::new();

    for set in &event.sets {
        if is_losers_set(set) != losers {
            continue;
        }

        if let Some(round) = set.round {
            grouped
                .entry(round.abs())
                .or_default()
                .push(set.set_id.clone());
        } else {
            no_round.push(set.set_id.clone());
        }
    }

    let mut columns = grouped.into_values().collect::<Vec<Vec<String>>>();
    for column in &mut columns {
        column.sort();
    }
    no_round.sort();

    if !no_round.is_empty() {
        columns.push(no_round);
    }

    columns
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

    let found_in_losers_lane = event.sets.iter().any(|set| {
        if !is_losers_set(set) {
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

    inferred_from_source.unwrap_or(false)
}

fn ensure_virtual_grand_final_reset_set(
    event: &mut EventSnapshot,
    grand_final_set: &crate::models::SetSnapshot,
) {
    if event
        .sets
        .iter()
        .any(|set| is_grand_final_reset_set(set) && same_phase_pool(set, grand_final_set))
    {
        return;
    }

    let virtual_set_id = virtual_grand_final_reset_set_id(&grand_final_set.set_id);
    if event.sets.iter().any(|set| set.set_id == virtual_set_id) {
        return;
    }

    let slots = grand_final_set
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
        .collect::<Vec<crate::models::SetSlotSnapshot>>();
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
        if !is_grand_final_reset_set(reset_set) || !same_phase_pool(reset_set, grand_final_set) {
            continue;
        }

        found = true;
        if reset_set.winner_id.is_some() {
            continue;
        }

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

        let mut changed = false;
        for (slot_index, gf_slot) in grand_final_set.slots.iter().enumerate() {
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

fn build_inferred_tbd_source_labels(event: &EventSnapshot) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let set_display_code_by_id = build_set_display_code_by_id(event);

    let winners_columns = build_round_columns_set_ids(event, false);
    let losers_columns = build_round_columns_set_ids(event, true);

    let winners_round_one_ids = winners_columns.first().cloned().unwrap_or_default();
    let losers_round_one = losers_columns.first().cloned().unwrap_or_default();
    if !losers_round_one.is_empty() && !winners_round_one_ids.is_empty() {
        for (current_index, set_id) in losers_round_one.iter().enumerate() {
            let sources = pick_pair_source_ids(
                &winners_round_one_ids,
                losers_round_one.len(),
                current_index,
            );
            for (source_index, source_set_id) in sources.iter().enumerate() {
                if let Some(code) = set_display_code_by_id.get(source_set_id) {
                    map.insert(
                        format!("{set_id}:{source_index}"),
                        normalize_source_text("loser", code),
                    );
                }
            }
        }
    }

    for column_index in 1..winners_columns.len() {
        let previous_ids = &winners_columns[column_index - 1];
        let current_ids = &winners_columns[column_index];
        for (current_index, set_id) in current_ids.iter().enumerate() {
            let sources = pick_pair_source_ids(previous_ids, current_ids.len(), current_index);
            for (source_index, source_set_id) in sources.iter().enumerate() {
                if let Some(code) = set_display_code_by_id.get(source_set_id) {
                    map.insert(
                        format!("{set_id}:{source_index}"),
                        normalize_source_text("winner", code),
                    );
                }
            }
        }
    }

    let mut winners_columns_by_count: HashMap<usize, Vec<Vec<String>>> = HashMap::new();
    for ids in &winners_columns {
        if ids.is_empty() {
            continue;
        }
        winners_columns_by_count
            .entry(ids.len())
            .or_default()
            .push(ids.clone());
    }
    let mut winners_count_use_cursor: HashMap<usize, usize> = HashMap::new();

    for column_index in 1..losers_columns.len() {
        let previous_ids = &losers_columns[column_index - 1];
        let current_ids = &losers_columns[column_index];
        let current_count = current_ids.len();

        if current_count == 0 {
            continue;
        }

        if previous_ids.len() == current_count {
            let candidate_winners_columns = winners_columns_by_count
                .get(&current_count)
                .cloned()
                .unwrap_or_default();
            let winner_cursor = *winners_count_use_cursor
                .get(&current_count)
                .unwrap_or(&0_usize);
            let winners_source_ids = candidate_winners_columns
                .get(winner_cursor)
                .cloned()
                .unwrap_or_default();

            if candidate_winners_columns.len() > winner_cursor {
                winners_count_use_cursor.insert(current_count, winner_cursor + 1);
            }

            for (current_index, set_id) in current_ids.iter().enumerate() {
                if let Some(losers_set_id) = previous_ids.get(current_index) {
                    if let Some(losers_code) = set_display_code_by_id.get(losers_set_id) {
                        map.insert(
                            format!("{set_id}:0"),
                            normalize_source_text("winner", losers_code),
                        );
                    }
                }

                if let Some(winners_source_id) = winners_source_ids.get(current_index) {
                    if let Some(winners_code) = set_display_code_by_id.get(winners_source_id) {
                        map.insert(
                            format!("{set_id}:1"),
                            normalize_source_text("loser", winners_code),
                        );
                    }
                }
            }
            continue;
        }

        for (current_index, set_id) in current_ids.iter().enumerate() {
            let sources = pick_pair_source_ids(previous_ids, current_count, current_index);
            for (source_index, source_set_id) in sources.iter().enumerate() {
                if let Some(code) = set_display_code_by_id.get(source_set_id) {
                    map.insert(
                        format!("{set_id}:{source_index}"),
                        normalize_source_text("winner", code),
                    );
                }
            }
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

fn source_reference_markers(full_round_text: &str) -> Vec<String> {
    let mut markers = Vec::new();
    let normalized = normalize_reference_text(full_round_text);
    if !normalized.is_empty() {
        markers.push(normalized);
    }

    let tail = full_round_text
        .split(|ch: char| ch == '-' || ch == ':' || ch == '/' || ch == '|')
        .last()
        .map(str::trim)
        .unwrap_or_default();
    let normalized_tail = normalize_reference_text(tail);
    if !normalized_tail.is_empty() {
        markers.push(normalized_tail);
    }

    let compact_tokens = full_round_text
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .filter(|token| token.len() <= 4)
        .map(normalize_reference_text)
        .filter(|token| !token.is_empty())
        .collect::<Vec<String>>();
    markers.extend(compact_tokens);

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for marker in markers {
        if seen.insert(marker.clone()) {
            deduped.push(marker);
        }
    }

    deduped
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
            if let Some(placeholder_name) = source
                .placeholder_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
            {
                labels.insert(
                    format!("{}:{}", set.set_id, slot_index),
                    placeholder_name.to_owned(),
                );
                continue;
            }
            let Some((source_set_id, source_set_code)) =
                source_set_id_and_code_from_api_source(source, &set_display_code_by_id)
            else {
                continue;
            };

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

            labels.insert(
                format!("{}:{}", set.set_id, slot_index),
                normalize_source_text(kind, &source_set_code),
            );
        }
    }

    labels
}

fn apply_source_based_tbd_labels(event: &mut EventSnapshot) {
    let labels = build_api_tbd_source_labels(event);
    if labels.is_empty() {
        return;
    }

    for set in &mut event.sets {
        for slot_index in 0..set.slots.len() {
            let key = format!("{}:{}", set.set_id, slot_index);
            let Some(label) = labels.get(&key) else {
                continue;
            };

            let Some(slot) = set.slots.get_mut(slot_index) else {
                continue;
            };
            if !is_slot_empty(slot) {
                continue;
            }

            slot.entrant_name = label.clone();
        }
    }
}

fn api_source_reference_rank(
    set: &crate::models::SetSnapshot,
    slot_index: usize,
    source_set_id: &str,
    source_markers: &[String],
    source_set_code: Option<&str>,
    prefer_loser_reference: bool,
) -> Option<i64> {
    let source = entrant_source_for_slot(set, slot_index)?;
    let type_id = resolved_source_set_id(source)
        .map(str::trim)
        .unwrap_or_default();

    let condition = source
        .condition
        .as_deref()
        .map(normalize_source_condition)
        .unwrap_or_default();

    let normalized_condition_string = source
        .condition_string
        .as_deref()
        .map(normalize_reference_text)
        .unwrap_or_default();
    let condition_tokens = source
        .condition_string
        .as_deref()
        .map(normalized_reference_tokens)
        .unwrap_or_default();

    let mut reference_markers = source_markers
        .iter()
        .filter(|marker| !marker.is_empty())
        .cloned()
        .collect::<Vec<String>>();
    if let Some(code) = source_set_code {
        let marker = normalize_reference_text(code);
        if !marker.is_empty() {
            reference_markers.push(marker);
        }
    }
    reference_markers.sort();
    reference_markers.dedup();

    let id_matches = !type_id.is_empty() && type_id == source_set_id;
    let marker_matches = (!normalized_condition_string.is_empty() || !condition_tokens.is_empty())
        && reference_markers.iter().any(|marker| {
            normalized_condition_string == *marker
                || condition_tokens.iter().any(|token| token == marker)
        });
    let related_to_source = id_matches || marker_matches;
    if !related_to_source {
        return None;
    }

    let expected = if prefer_loser_reference {
        "loser"
    } else {
        "winner"
    };
    let reversed = if prefer_loser_reference {
        "winner"
    } else {
        "loser"
    };

    if condition.contains(expected) {
        return Some(if id_matches { 0 } else { 1 });
    }
    if condition.contains(reversed) {
        return Some(if id_matches { 4 } else { 5 });
    }
    if condition.is_empty() {
        return Some(if id_matches { 1 } else { 2 });
    }
    Some(2)
}

fn unresolved_slot_reference_rank(
    slot: &crate::models::SetSlotSnapshot,
    source_markers: &[String],
    prefer_loser_reference: bool,
) -> Option<i64> {
    if !is_slot_empty(slot) {
        return None;
    }

    let normalized = normalize_reference_text(&slot.entrant_name);
    if normalized.is_empty()
        || normalized == "tbd"
        || normalized == "tba"
        || normalized == "unknown"
    {
        return None;
    }

    let mentions_source = source_markers
        .iter()
        .any(|marker| !marker.is_empty() && normalized.contains(marker));
    if !mentions_source {
        return None;
    }

    let mentions_loser = normalized.contains("loserof") || normalized.contains("敗者");
    let mentions_winner = normalized.contains("winnerof") || normalized.contains("勝者");

    if prefer_loser_reference {
        if mentions_loser {
            return Some(0);
        }
        if mentions_winner {
            return Some(2);
        }
        return Some(1);
    }

    if mentions_winner {
        return Some(0);
    }
    if mentions_loser {
        return Some(2);
    }
    Some(1)
}

fn inferred_slot_reference_rank(
    set: &crate::models::SetSnapshot,
    slot_index: usize,
    inferred_labels: &HashMap<String, String>,
    source_set_code: Option<&str>,
    prefer_loser_reference: bool,
) -> Option<i64> {
    let slot = set.slots.get(slot_index)?;
    if !is_slot_empty(slot) {
        return None;
    }

    let source_code = source_set_code?;
    let key = format!("{}:{}", set.set_id, slot_index);
    let label = inferred_labels.get(&key)?;
    let normalized = normalize_reference_text(label);
    if normalized.is_empty() {
        return None;
    }

    let expected = normalize_reference_text(&normalize_source_text(
        if prefer_loser_reference {
            "loser"
        } else {
            "winner"
        },
        source_code,
    ));
    if normalized == expected {
        return Some(0);
    }

    let reversed = normalize_reference_text(&normalize_source_text(
        if prefer_loser_reference {
            "winner"
        } else {
            "loser"
        },
        source_code,
    ));
    if normalized == reversed {
        return Some(3);
    }

    if normalized.contains(&expected) {
        return Some(1);
    }

    Some(2)
}

fn preferred_slot_by_unresolved_reference(
    target: &crate::models::SetSnapshot,
    source_markers: &[String],
    prefer_loser_reference: bool,
) -> Option<(usize, i64)> {
    let mut best: Option<(usize, i64)> = None;

    for (slot_index, slot) in target.slots.iter().enumerate() {
        let Some(rank) =
            unresolved_slot_reference_rank(slot, source_markers, prefer_loser_reference)
        else {
            continue;
        };

        match best {
            None => best = Some((slot_index, rank)),
            Some((best_slot, best_rank)) => {
                if rank < best_rank || (rank == best_rank && slot_index < best_slot) {
                    best = Some((slot_index, rank));
                }
            }
        }
    }

    best
}

fn infer_preferred_slot_index_for_winner(
    event: &EventSnapshot,
    source_set_id: &str,
    source_round: Option<i64>,
    source_is_losers: bool,
    source_phase_name: Option<&String>,
    source_phase_group_name: Option<&String>,
    target: &crate::models::SetSnapshot,
) -> Option<usize> {
    if target.slots.len() < 2 {
        return None;
    }

    let source_depth = source_round?.abs();
    let target_depth = target.round?.abs();
    if target_depth <= source_depth || target_depth - source_depth != 1 {
        return None;
    }

    let source_phase_order = event
        .sets
        .iter()
        .find(|set| set.set_id == source_set_id)
        .and_then(|set| set.phase_order);
    if source_phase_order != Some(1) || target.phase_order != Some(1) {
        return None;
    }

    let src_phase = normalize_group_key(source_phase_name);
    let src_group = normalize_group_key(source_phase_group_name);
    let target_phase = normalize_group_key(target.phase_name.as_ref());
    let target_group = normalize_group_key(target.phase_group_name.as_ref());
    if src_phase != target_phase || src_group != target_group {
        return None;
    }

    let previous_round_set_ids = event
        .sets
        .iter()
        .filter(|set| {
            is_losers_set(set) == source_is_losers
                && set.round.map(|round| round.abs()) == Some(source_depth)
                && normalize_group_key(set.phase_name.as_ref()) == src_phase
                && normalize_group_key(set.phase_group_name.as_ref()) == src_group
        })
        .map(|set| set.set_id.clone())
        .collect::<Vec<String>>();

    let current_round_set_ids = event
        .sets
        .iter()
        .filter(|set| {
            is_losers_set(set) == source_is_losers
                && set.round.map(|round| round.abs()) == Some(target_depth)
                && normalize_group_key(set.phase_name.as_ref()) == src_phase
                && normalize_group_key(set.phase_group_name.as_ref()) == src_group
        })
        .map(|set| set.set_id.clone())
        .collect::<Vec<String>>();

    let current_index = current_round_set_ids
        .iter()
        .position(|set_id| set_id == &target.set_id)?;
    let source_indexes = pick_pair_source_indexes(
        previous_round_set_ids.len(),
        current_round_set_ids.len(),
        current_index,
    );

    for (slot_index, source_index) in source_indexes.into_iter().enumerate() {
        if previous_round_set_ids
            .get(source_index)
            .is_some_and(|set_id| set_id == source_set_id)
        {
            return Some(slot_index);
        }
    }

    None
}

fn place_entrant_to_set(
    set: &mut crate::models::SetSnapshot,
    entrant_id: &str,
    entrant_name: &str,
    preferred_slot_index: Option<usize>,
) -> bool {
    if set
        .slots
        .iter()
        .any(|slot| slot.entrant_id.as_deref() == Some(entrant_id))
    {
        return false;
    }

    let slot_index = if let Some(preferred) = preferred_slot_index {
        if preferred >= set.slots.len() {
            first_empty_slot_index(set)
        } else if set.slots.get(preferred).is_some_and(is_slot_empty) {
            Some(preferred)
        } else if set.slots.len() == 2 {
            let other = if preferred == 0 { 1 } else { 0 };
            if set.slots.get(other).is_some_and(is_slot_empty) {
                let moved = set.slots.get(preferred).cloned();
                if let Some(item) = moved {
                    if let Some(slot) = set.slots.get_mut(other) {
                        *slot = item;
                    }
                    if let Some(slot) = set.slots.get_mut(preferred) {
                        slot.entrant_id = None;
                        slot.entrant_name = "TBD".to_owned();
                        slot.seed_id = None;
                        slot.seed_num = None;
                        slot.score = None;
                    }
                    Some(preferred)
                } else {
                    first_empty_slot_index(set)
                }
            } else {
                first_empty_slot_index(set)
            }
        } else {
            first_empty_slot_index(set)
        }
    } else {
        first_empty_slot_index(set)
    };

    let Some(slot_index) = slot_index else {
        return false;
    };

    if let Some(slot) = set.slots.get_mut(slot_index) {
        slot.entrant_id = Some(entrant_id.to_owned());
        slot.entrant_name = entrant_name.to_owned();
        slot.score = None;
    }

    if set.state == 3 {
        set.state = 1;
        set.winner_id = None;
        for slot in &mut set.slots {
            slot.score = None;
        }
    }

    if empty_slot_count(set) == 0 && set.state == 1 {
        set.state = 2;
    }

    true
}

fn advance_winner_within_lane(
    event: &mut EventSnapshot,
    source_set_id: &str,
    source_full_round_text: &str,
    inferred_labels: &HashMap<String, String>,
    source_set_code: Option<&str>,
    source_round: Option<i64>,
    source_is_losers: bool,
    source_phase_name: Option<&String>,
    source_phase_group_name: Option<&String>,
    winner_id: &str,
    winner_name: &str,
) -> bool {
    let src_phase = normalize_group_key(source_phase_name);
    let src_group = normalize_group_key(source_phase_group_name);
    let source_markers = source_reference_markers(source_full_round_text);
    let source_phase_order = event
        .sets
        .iter()
        .find(|set| set.set_id == source_set_id)
        .and_then(|set| set.phase_order);
    if source_phase_order != Some(1) {
        return false;
    }

    // Winners/Losersともに、phase/pool構造が完全一致しないケースに備えて段階的に緩和する。
    let mut candidates = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(index, target)| {
            if target.set_id == source_set_id {
                return None;
            }

            if is_losers_set(target) != source_is_losers {
                return None;
            }

            if target.phase_order != source_phase_order {
                return None;
            }

            let target_phase = normalize_group_key(target.phase_name.as_ref());
            let target_group = normalize_group_key(target.phase_group_name.as_ref());

            let phase_matches = target_phase == src_phase;
            let group_matches = target_group == src_group;

            let strictness_rank = if phase_matches && group_matches {
                0_i64
            } else if phase_matches {
                1_i64
            } else {
                2_i64
            };

            if target
                .slots
                .iter()
                .any(|slot| slot.entrant_id.as_deref() == Some(winner_id))
            {
                return None;
            }

            let empty_count = empty_slot_count(target);
            if empty_count == 0 {
                return None;
            }

            let round_gap = match (source_round, target.round) {
                (Some(src), Some(dst)) => {
                    let src_depth = src.abs();
                    let dst_depth = dst.abs();
                    if dst_depth > src_depth {
                        dst_depth - src_depth
                    } else {
                        return None;
                    }
                }
                _ => i64::MAX / 2,
            };

            let api_reference_match = (0..target.slots.len())
                .filter_map(|slot_index| {
                    api_source_reference_rank(
                        target,
                        slot_index,
                        source_set_id,
                        &source_markers,
                        source_set_code,
                        false,
                    )
                    .map(|rank| (slot_index, rank))
                })
                .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

            let structural_preferred_slot = infer_preferred_slot_index_for_winner(
                event,
                source_set_id,
                source_round,
                source_is_losers,
                source_phase_name,
                source_phase_group_name,
                target,
            );
            let unresolved_reference_match =
                preferred_slot_by_unresolved_reference(target, &source_markers, false);
            let inferred_reference_match = (0..target.slots.len())
                .filter_map(|slot_index| {
                    inferred_slot_reference_rank(
                        target,
                        slot_index,
                        inferred_labels,
                        source_set_code,
                        false,
                    )
                    .map(|rank| (slot_index, rank))
                })
                .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

            let preferred_slot_index = api_reference_match
                .as_ref()
                .map(|(index, _)| *index)
                .or(inferred_reference_match.as_ref().map(|(index, _)| *index))
                .or(unresolved_reference_match.as_ref().map(|(index, _)| *index))
                .or(structural_preferred_slot);
            let api_reference_rank = api_reference_match
                .as_ref()
                .map(|(_, rank)| *rank)
                .unwrap_or(4_i64);
            let unresolved_reference_rank = inferred_reference_match
                .as_ref()
                .map(|(_, rank)| *rank)
                .unwrap_or_else(|| {
                    unresolved_reference_match
                        .as_ref()
                        .map(|(_, rank)| *rank)
                        .unwrap_or(3_i64)
                });

            Some((
                index,
                api_reference_rank,
                unresolved_reference_rank,
                strictness_rank,
                round_gap,
                empty_count,
                preferred_slot_index,
            ))
        })
        .collect::<Vec<(usize, i64, i64, i64, i64, usize, Option<usize>)>>();

    candidates.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.6.is_none().cmp(&right.6.is_none()))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.4.cmp(&right.4))
            .then_with(|| left.5.cmp(&right.5))
            .then_with(|| left.0.cmp(&right.0))
    });

    for (index, _, _, _, _, _, preferred_slot_index) in candidates {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, winner_id, winner_name, preferred_slot_index) {
                return true;
            }
        }
    }

    false
}

fn advance_winner_via_progression(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    winner_id: &str,
    winner_name: &str,
) -> bool {
    let Some(source_phase_order) = source_set.phase_order else {
        return false;
    };
    let Some(target_phase_order) = source_phase_order.checked_add(1) else {
        return false;
    };

    let candidate_slots = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(index, target)| {
            if target.phase_order != Some(target_phase_order) {
                return None;
            }

            let preferred_slot_index = [
                target.entrant1_source.as_ref(),
                target.entrant2_source.as_ref(),
            ]
            .into_iter()
            .enumerate()
            .position(|(slot_index, source)| {
                source.is_some_and(|source| {
                    source_reaches_source_set(event, source, source_set, &mut HashSet::new())
                        || source_matches_source_set(source, source_set)
                        || source_set
                            .winner_progression_seed_id
                            .as_deref()
                            .is_some_and(|progression_seed_id| {
                                source_reaches_progression_seed(
                                    event,
                                    source,
                                    progression_seed_id,
                                    &mut HashSet::new(),
                                ) || source_matches_progression_slot(source_set, target, slot_index)
                            })
                })
            });

            preferred_slot_index.map(|slot_index| (index, slot_index))
        })
        .collect::<Vec<_>>();

    for (index, preferred_slot_index) in candidate_slots {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, winner_id, winner_name, Some(preferred_slot_index)) {
                return true;
            }
        }
    }

    false
}

fn advance_completed_set_to_next_real_sets(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    winner_id: &str,
    winner_name: &str,
    loser: Option<(&str, &str)>,
) {
    let targets = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(target_index, target)| {
            if target.set_id == source_set.set_id || target.is_intermediate {
                return None;
            }

            if (source_set.winner_placement.is_some() || source_set.loser_placement.is_some())
                && target.phase_order > source_set.phase_order
            {
                return None;
            }

            let slots = [
                target.entrant1_source.as_ref(),
                target.entrant2_source.as_ref(),
            ];
            let matches = slots
                .into_iter()
                .enumerate()
                .filter_map(|(slot_index, source)| {
                    let relation = source.and_then(|source| {
                        source_relation_reaches_set(event, source, source_set, &mut HashSet::new())
                    })?;
                    let entrant = match relation {
                        "winner" => Some((winner_id, winner_name)),
                        "loser" => loser,
                        _ => None,
                    }?;
                    Some((
                        slot_index,
                        relation,
                        entrant.0.to_owned(),
                        entrant.1.to_owned(),
                    ))
                })
                .collect::<Vec<_>>();

            (!matches.is_empty()).then_some((target_index, matches))
        })
        .collect::<Vec<_>>();

    let mut winner_placed = false;
    let mut loser_placed = false;
    for (target_index, matches) in targets {
        let target = &mut event.sets[target_index];
        for (slot_index, relation, entrant_id, entrant_name) in matches {
            let already_placed = match relation {
                "winner" => winner_placed,
                "loser" => loser_placed,
                _ => true,
            };
            if already_placed {
                continue;
            }
            if let Some(slot) = target.slots.get_mut(slot_index) {
                slot.entrant_id = Some(entrant_id);
                slot.entrant_name = entrant_name;
                slot.score = None;
                match relation {
                    "winner" => winner_placed = true,
                    "loser" => loser_placed = true,
                    _ => {}
                }
            }
        }
        if empty_slot_count(target) == 0 && target.state == 1 {
            target.state = 2;
        }
    }
}

fn source_relation_reaches_set(
    event: &EventSnapshot,
    source: &crate::models::SetEntrantSourceSnapshot,
    source_set: &crate::models::SetSnapshot,
    visited: &mut HashSet<String>,
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
        } else {
            None
        };
    if let Some(relation) = progression_relation {
        return Some(relation);
    }

    // API の source に set ID が入らない場合は conditionString の set 記号を使う。
    // 記号は英数字トークンの完全一致に限定し、A と AB の誤マッチを避ける。
    let source_code = build_set_display_code_by_id(event)
        .get(&source_set.set_id)
        .cloned()
        .or_else(|| source_set.identifier.clone())
        .or_else(|| source_set.phase_group_set_name.clone());
    if let Some(source_code) = source_code {
        let source_tokens = source
            .condition_string
            .as_deref()
            .map(normalized_reference_tokens)
            .unwrap_or_default();
        let normalized_code = normalize_reference_text(&source_code);
        if !normalized_code.is_empty()
            && source_tokens.iter().any(|token| token == &normalized_code)
        {
            return source_kind_from_api_source(source);
        }
    }

    let direct_set_match = if let Some(resolved_set_id) = source.resolved_set_id.as_deref() {
        resolved_set_id == source_set.set_id
    } else {
        source.type_id.as_deref() == Some(source_set.set_id.as_str())
            || (source.source_type.as_deref() == Some("seed")
                && (source.type_id.as_deref() == source_set.winner_progression_seed_id.as_deref()
                    || source.type_id.as_deref()
                        == source_set.loser_progression_seed_id.as_deref()))
    };
    if direct_set_match {
        return match source.condition.as_deref() {
            Some("winner") => Some("winner"),
            Some("loser") => Some("loser"),
            _ => None,
        };
    }

    let nested_set_id = resolved_source_set_id(source)?;
    if !visited.insert(nested_set_id.to_owned()) {
        return None;
    }
    let nested_set = event.sets.iter().find(|set| set.set_id == nested_set_id)?;
    if !nested_set.is_intermediate {
        return None;
    }
    let nested_relation = [
        nested_set.entrant1_source.as_ref(),
        nested_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .find_map(|nested_source| {
        source_relation_reaches_set(event, nested_source, source_set, visited)
    })?;

    (source.condition.as_deref() == Some(nested_relation)).then_some(nested_relation)
}

fn advance_to_exact_same_phase_target(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    expected_relation: &str,
    entrant_id: &str,
    entrant_name: &str,
) -> bool {
    let Some(source_phase_order) = source_set.phase_order else {
        return false;
    };

    for target_index in 0..event.sets.len() {
        if event.sets[target_index].set_id == source_set.set_id
            || event.sets[target_index].phase_order != Some(source_phase_order)
        {
            continue;
        }

        for slot_index in 0..event.sets[target_index].slots.len().min(2) {
            let relation = {
                let target = &event.sets[target_index];
                let source = match slot_index {
                    0 => target.entrant1_source.as_ref(),
                    1 => target.entrant2_source.as_ref(),
                    _ => None,
                };
                source.and_then(|source| {
                    source_relation_reaches_set(event, source, source_set, &mut HashSet::new())
                })
            };
            if relation != Some(expected_relation) {
                continue;
            }

            let target = &mut event.sets[target_index];
            if let Some(slot) = target.slots.get_mut(slot_index) {
                slot.entrant_id = Some(entrant_id.to_owned());
                slot.entrant_name = entrant_name.to_owned();
                slot.score = None;
            }
            if empty_slot_count(target) == 0 && target.state == 1 {
                target.state = 2;
            }
            return true;
        }
    }

    false
}

fn source_reaches_source_set(
    event: &EventSnapshot,
    source: &crate::models::SetEntrantSourceSnapshot,
    source_set: &crate::models::SetSnapshot,
    visited: &mut HashSet<String>,
) -> bool {
    if source.source_type.as_deref() == Some("bye") || source.condition.as_deref() == Some("loser")
    {
        return false;
    }

    if source.type_id.as_deref() == Some(source_set.set_id.as_str())
        || source.resolved_set_id.as_deref() == Some(source_set.set_id.as_str())
        || source.type_id.as_deref() == source_set.winner_progression_seed_id.as_deref()
    {
        return true;
    }

    let Some(nested_set_id) = resolved_source_set_id(source) else {
        return false;
    };
    if !visited.insert(nested_set_id.to_owned()) {
        return false;
    }

    let Some(nested_set) = event.sets.iter().find(|set| set.set_id == nested_set_id) else {
        return false;
    };
    [
        nested_set.entrant1_source.as_ref(),
        nested_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|nested_source| source_reaches_source_set(event, nested_source, source_set, visited))
}

fn source_matches_source_set(
    source: &crate::models::SetEntrantSourceSnapshot,
    source_set: &crate::models::SetSnapshot,
) -> bool {
    if source.condition.as_deref() != Some("winner") {
        return false;
    }

    let resolved_set_match = resolved_source_set_id(source) == Some(source_set.set_id.as_str());
    let raw_set_match = source.type_id.as_deref() == Some(source_set.set_id.as_str());
    let progression_seed_match = source
        .type_id
        .as_deref()
        .zip(source_set.winner_progression_seed_id.as_deref())
        .is_some_and(|(source_id, progression_seed_id)| source_id == progression_seed_id);

    resolved_set_match || raw_set_match || progression_seed_match
}

fn source_matches_progression_slot(
    source_set: &crate::models::SetSnapshot,
    target: &crate::models::SetSnapshot,
    slot_index: usize,
) -> bool {
    let Some(target_slot) = target.slots.get(slot_index) else {
        return false;
    };

    target_slot.seed_origin_phase_order == source_set.phase_order
        && target_slot.seed_origin_phase_group_display_identifier
            == source_set.phase_group_display_identifier
        && target_slot.seed_origin_placement.is_some_and(|placement| {
            source_set.winner_progression_seed_num == Some(placement)
                || source_set.loser_progression_seed_num == Some(placement)
        })
}

fn advance_winner_to_explicit_target(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    winner_id: &str,
    winner_name: &str,
) -> bool {
    let Some(source_phase_order) = source_set.phase_order else {
        return false;
    };

    let candidate_slots = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(index, target)| {
            if target.set_id == source_set.set_id || target.phase_order != Some(source_phase_order)
            {
                return None;
            }

            let slot_index = [
                target.entrant1_source.as_ref(),
                target.entrant2_source.as_ref(),
            ]
            .into_iter()
            .enumerate()
            .position(|(slot_index, source)| {
                source.is_some_and(|source| {
                    source_reaches_source_set(event, source, source_set, &mut HashSet::new())
                        && target.slots.get(slot_index).is_some_and(is_slot_empty)
                })
            });

            slot_index.map(|slot_index| (index, slot_index))
        })
        .collect::<Vec<_>>();

    for (index, slot_index) in candidate_slots {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, winner_id, winner_name, Some(slot_index)) {
                return true;
            }
        }
    }

    false
}

fn advance_loser_to_explicit_target(
    event: &mut EventSnapshot,
    source_set: &crate::models::SetSnapshot,
    loser_id: &str,
    loser_name: &str,
) -> bool {
    let Some(source_phase_order) = source_set.phase_order else {
        return false;
    };

    for target_index in 0..event.sets.len() {
        if event.sets[target_index].set_id == source_set.set_id
            || event.sets[target_index].phase_order != Some(source_phase_order)
        {
            continue;
        }

        let slot_index = [
            event.sets[target_index].entrant1_source.as_ref(),
            event.sets[target_index].entrant2_source.as_ref(),
        ]
        .into_iter()
        .enumerate()
        .position(|(slot_index, source)| {
            source.is_some_and(|source| {
                source.condition.as_deref() == Some("loser")
                    && (source.type_id.as_deref() == Some(source_set.set_id.as_str())
                        || source.resolved_set_id.as_deref() == Some(source_set.set_id.as_str()))
                    && event.sets[target_index]
                        .slots
                        .get(slot_index)
                        .is_some_and(is_slot_empty)
            })
        });

        if let Some(slot_index) = slot_index {
            if place_entrant_to_set(
                &mut event.sets[target_index],
                loser_id,
                loser_name,
                Some(slot_index),
            ) {
                return true;
            }
        }
    }

    false
}

fn source_reaches_progression_seed(
    event: &EventSnapshot,
    source: &crate::models::SetEntrantSourceSnapshot,
    progression_seed_id: &str,
    visited: &mut HashSet<String>,
) -> bool {
    if source.source_type.as_deref() == Some("seed") {
        return source.type_id.as_deref() == Some(progression_seed_id);
    }
    if source.source_type.as_deref() == Some("bye") {
        return false;
    }

    let Some(source_set_id) = resolved_source_set_id(source) else {
        return false;
    };
    if !visited.insert(source_set_id.to_owned()) {
        return false;
    }

    let Some(source_set) = event.sets.iter().find(|set| set.set_id == source_set_id) else {
        return false;
    };
    [
        source_set.entrant1_source.as_ref(),
        source_set.entrant2_source.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|nested_source| {
        source_reaches_progression_seed(event, nested_source, progression_seed_id, visited)
    })
}

fn drop_loser_to_losers_lane(
    event: &mut EventSnapshot,
    source_set_id: &str,
    source_full_round_text: &str,
    inferred_labels: &HashMap<String, String>,
    source_set_code: Option<&str>,
    source_round: Option<i64>,
    source_phase_name: Option<&String>,
    source_phase_group_name: Option<&String>,
    loser_id: &str,
    loser_name: &str,
) -> bool {
    let source_phase_order = event
        .sets
        .iter()
        .find(|set| set.set_id == source_set_id)
        .and_then(|set| set.phase_order);
    if source_phase_order != Some(1) {
        return false;
    }
    let src_phase = normalize_group_key(source_phase_name);
    let src_group = normalize_group_key(source_phase_group_name);
    let source_markers = source_reference_markers(source_full_round_text);

    // start.gg側のpool分割とLosers配置が一致しない場合があるため、段階的に緩和して候補を探す。
    let mut candidates = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(index, target)| {
            if target.set_id == source_set_id {
                return None;
            }

            if !is_losers_set(target) {
                return None;
            }

            if target.phase_order != source_phase_order {
                return None;
            }

            let target_phase = normalize_group_key(target.phase_name.as_ref());
            let target_group = normalize_group_key(target.phase_group_name.as_ref());

            let phase_matches = target_phase == src_phase;
            let group_matches = target_group == src_group;

            let strictness_rank = if phase_matches && group_matches {
                0_i64
            } else if phase_matches {
                1_i64
            } else {
                2_i64
            };

            if target
                .slots
                .iter()
                .any(|slot| slot.entrant_id.as_deref() == Some(loser_id))
            {
                return None;
            }

            let empty_count = empty_slot_count(target);
            if empty_count == 0 {
                return None;
            }

            let round_distance = match (source_round, target.round) {
                (Some(src), Some(dst)) => (dst + src).abs(),
                _ => i64::MAX / 2,
            };
            let api_reference_match = (0..target.slots.len())
                .filter_map(|slot_index| {
                    api_source_reference_rank(
                        target,
                        slot_index,
                        source_set_id,
                        &source_markers,
                        source_set_code,
                        true,
                    )
                    .map(|rank| (slot_index, rank))
                })
                .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
            let unresolved_reference_match =
                preferred_slot_by_unresolved_reference(target, &source_markers, true);
            let inferred_reference_match = (0..target.slots.len())
                .filter_map(|slot_index| {
                    inferred_slot_reference_rank(
                        target,
                        slot_index,
                        inferred_labels,
                        source_set_code,
                        true,
                    )
                    .map(|rank| (slot_index, rank))
                })
                .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
            let preferred_slot_index = api_reference_match
                .as_ref()
                .map(|(index, _)| *index)
                .or(unresolved_reference_match.as_ref().map(|(index, _)| *index))
                .or(inferred_reference_match.as_ref().map(|(index, _)| *index));
            let preferred_slot_index = inferred_reference_match
                .as_ref()
                .map(|(index, _)| *index)
                .or(preferred_slot_index);
            let preferred_slot_index = api_reference_match
                .as_ref()
                .map(|(index, _)| *index)
                .or(preferred_slot_index);
            let api_reference_rank = api_reference_match
                .as_ref()
                .map(|(_, rank)| *rank)
                .unwrap_or(4_i64);
            let unresolved_reference_rank = inferred_reference_match
                .as_ref()
                .map(|(_, rank)| *rank)
                .unwrap_or_else(|| {
                    unresolved_reference_match
                        .as_ref()
                        .map(|(_, rank)| *rank)
                        .unwrap_or(3_i64)
                });

            Some((
                index,
                api_reference_rank,
                unresolved_reference_rank,
                strictness_rank,
                round_distance,
                empty_count,
                preferred_slot_index,
            ))
        })
        .collect::<Vec<(usize, i64, i64, i64, i64, usize, Option<usize>)>>();

    candidates.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.6.is_none().cmp(&right.6.is_none()))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.4.cmp(&right.4))
            .then_with(|| left.5.cmp(&right.5))
            .then_with(|| left.0.cmp(&right.0))
    });

    for (index, _, _, _, _, _, preferred_slot_index) in candidates {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, loser_id, loser_name, preferred_slot_index) {
                return true;
            }
        }
    }

    false
}

fn advance_losers_winner_to_grand_final(
    event: &mut EventSnapshot,
    source_set_id: &str,
    source_full_round_text: &str,
    inferred_labels: &HashMap<String, String>,
    source_set_code: Option<&str>,
    source_phase_name: Option<&String>,
    source_phase_group_name: Option<&String>,
    winner_id: &str,
    winner_name: &str,
) -> bool {
    let src_phase = normalize_group_key(source_phase_name);
    let src_group = normalize_group_key(source_phase_group_name);
    let source_markers = source_reference_markers(source_full_round_text);

    let mut candidates = event
        .sets
        .iter()
        .enumerate()
        .filter_map(|(index, target)| {
            if target.set_id == source_set_id {
                return None;
            }
            if is_losers_set(target) {
                return None;
            }
            if !is_grand_final_set(target) {
                return None;
            }

            if target
                .slots
                .iter()
                .any(|slot| slot.entrant_id.as_deref() == Some(winner_id))
            {
                return None;
            }

            let empty_count = empty_slot_count(target);
            if empty_count == 0 {
                return None;
            }

            let target_phase = normalize_group_key(target.phase_name.as_ref());
            let target_group = normalize_group_key(target.phase_group_name.as_ref());
            let strictness_rank = if target_phase == src_phase && target_group == src_group {
                0_i64
            } else if target_phase == src_phase {
                1_i64
            } else {
                2_i64
            };

            let api_reference_match = (0..target.slots.len())
                .filter_map(|slot_index| {
                    api_source_reference_rank(
                        target,
                        slot_index,
                        source_set_id,
                        &source_markers,
                        source_set_code,
                        false,
                    )
                    .map(|rank| (slot_index, rank))
                })
                .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
            let unresolved_reference_match =
                preferred_slot_by_unresolved_reference(target, &source_markers, false);
            let inferred_reference_match = (0..target.slots.len())
                .filter_map(|slot_index| {
                    inferred_slot_reference_rank(
                        target,
                        slot_index,
                        inferred_labels,
                        source_set_code,
                        false,
                    )
                    .map(|rank| (slot_index, rank))
                })
                .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

            let preferred_slot_index = api_reference_match
                .as_ref()
                .map(|(index, _)| *index)
                .or(inferred_reference_match.as_ref().map(|(index, _)| *index))
                .or(unresolved_reference_match.as_ref().map(|(index, _)| *index));
            let api_reference_rank = api_reference_match
                .as_ref()
                .map(|(_, rank)| *rank)
                .unwrap_or(4_i64);
            let unresolved_reference_rank = inferred_reference_match
                .as_ref()
                .map(|(_, rank)| *rank)
                .unwrap_or_else(|| {
                    unresolved_reference_match
                        .as_ref()
                        .map(|(_, rank)| *rank)
                        .unwrap_or(3_i64)
                });

            Some((
                index,
                api_reference_rank,
                unresolved_reference_rank,
                strictness_rank,
                empty_count,
                preferred_slot_index,
            ))
        })
        .collect::<Vec<(usize, i64, i64, i64, usize, Option<usize>)>>();

    candidates.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.5.is_none().cmp(&right.5.is_none()))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.4.cmp(&right.4))
            .then_with(|| left.0.cmp(&right.0))
    });

    for (index, _, _, _, _, preferred_slot_index) in candidates {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, winner_id, winner_name, preferred_slot_index) {
                return true;
            }
        }
    }

    false
}

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
        source_set.winner_placement.map(|placement| {
            (
                placement,
                source_set.winner_progression_seed_id.as_deref(),
                source_set.winner_progression_id.as_deref(),
                source_set.winner_progression_origin_order,
                winner_id,
                winner_name,
            )
        }),
        source_set.loser_placement.and_then(|placement| {
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
        let target_group_and_seed = progression_id.and_then(|progression_id| {
            event
                .phase_groups
                .iter()
                .filter(|group| {
                    group.phase_order == Some(target_phase_order)
                        && target_phase_id
                            .as_deref()
                            .is_none_or(|phase_id| group.phase_id.as_deref() == Some(phase_id))
                })
                .find_map(|group| {
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
        let target_is_ready = empty_slot_count(target) == 0 && target.state == 1;
        if target_is_ready {
            target.state = 2;
        }
    }
}

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
            if !origin_matches
                && progression_id != seed.progression_id.as_deref()
                && fallback_seed_id != Some(seed.seed_id.as_str())
            {
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

fn next_phase_id_and_order(
    event: &EventSnapshot,
    source_phase_id: Option<&str>,
    source_phase_order: i64,
) -> Option<(Option<String>, i64)> {
    let source_order = event
        .phases
        .iter()
        .find(|phase| source_phase_id.is_some_and(|phase_id| phase.phase_id == phase_id))
        .and_then(|phase| phase.phase_order)
        .unwrap_or(source_phase_order);
    event
        .phases
        .iter()
        .filter_map(|phase| phase.phase_order.map(|order| (order, phase)))
        .filter(|(order, _)| *order > source_order)
        .min_by_key(|(order, _)| *order)
        .map(|(order, phase)| (Some(phase.phase_id.clone()), order))
        .or_else(|| source_order.checked_add(1).map(|order| (None, order)))
}

fn hydrate_progression_entrant_to_seed_slots(
    event: &mut EventSnapshot,
    target_seed: &PhaseGroupSeedSnapshot,
    entrant_id: &str,
    entrant_name: &str,
) {
    for target in &mut event.sets {
        let target_is_round_robin = event.phase_groups.iter().any(|group| {
            group.phase_group_id == target.phase_group_id.as_deref().unwrap_or_default()
                && group
                    .bracket_type
                    .as_deref()
                    .is_some_and(|bracket_type| bracket_type.eq_ignore_ascii_case("ROUND_ROBIN"))
        });
        if target_is_round_robin {
            continue;
        }
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
            let source_number_matches = source.is_some_and(|source| {
                source.group_seed_num == target_seed.seed_num
                    || source.seed_num == target_seed.seed_num
            });
            if !slot_seed_matches && !source_seed_matches && !source_number_matches {
                continue;
            }

            let Some(slot) = target.slots.get_mut(slot_index) else {
                continue;
            };
            slot.entrant_id = Some(entrant_id.to_owned());
            slot.entrant_name = entrant_name.to_owned();
            slot.score = None;
        }

        if empty_slot_count(target) == 0 && target.state == 1 {
            target.state = 2;
        }
    }
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

fn apply_completed_round_robin_progression(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    group_key: &str,
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
            if let Some(score) = slot.score {
                if entrant_id == winner_id {
                    *game_wins.entry(entrant_id.clone()).or_insert(0.0) += score;
                } else {
                    *game_losses.entry(entrant_id.clone()).or_insert(0.0) += score;
                }
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
    let head_to_head_points = all_entrant_ids
        .iter()
        .map(|entrant_id| {
            (
                entrant_id.clone(),
                standings_head_to_head_points(entrant_id, &all_entrant_ids, &head_to_head),
            )
        })
        .collect::<HashMap<_, _>>();
    let tiebreak_order = source_group.tiebreak_order.clone();
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
    let Some(event) = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    else {
        return;
    };
    for (progression, entrant_id) in assignments {
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
        let target_seed_by_progression = event
            .phase_groups
            .iter()
            .filter(|group| target_group_ids.contains(&group.phase_group_id))
            .flat_map(|group| group.seeds.iter())
            .find(|seed| {
                seed.progression_id.as_deref() == Some(progression.progression_id.as_str())
                    || (seed.origin_phase_order == progression.origin_phase_order
                        && normalize_group_key(seed.origin_phase_group_display_identifier.as_ref())
                            == normalize_group_key(
                                progression.origin_phase_group_display_identifier.as_ref(),
                            )
                        && seed.origin_placement == progression.origin_placement
                        && (progression.origin_order.is_none()
                            || seed.origin_order == progression.origin_order))
            })
            .cloned();
        let target_seed = target_seed_by_progression.or_else(|| {
            event
                .phase_groups
                .iter()
                .filter(|group| target_group_ids.contains(&group.phase_group_id))
                .flat_map(|group| group.seeds.iter())
                .find(|seed| {
                    seed.origin_phase_order == Some(source_phase_order)
                        && normalize_group_key(seed.origin_phase_group_display_identifier.as_ref())
                            == normalize_group_key(source_group.display_identifier.as_ref())
                        && seed.origin_placement == progression.origin_placement
                        && (progression.origin_order.is_none()
                            || seed.origin_order == progression.origin_order)
                })
                .cloned()
        });
        let Some(target_seed) = target_seed else {
            continue;
        };
        let entrant_name = event
            .sets
            .iter()
            .flat_map(|set| set.slots.iter())
            .find(|slot| slot.entrant_id.as_deref() == Some(entrant_id.as_str()))
            .map(|slot| slot.entrant_name.clone())
            .unwrap_or_else(|| "TBD".to_owned());
        for group in &mut event.phase_groups {
            if !group
                .seeds
                .iter()
                .any(|seed| seed.seed_id == target_seed.seed_id)
            {
                continue;
            }
            if let Some(seed) = group
                .seeds
                .iter_mut()
                .find(|seed| seed.seed_id == target_seed.seed_id)
            {
                seed.entrant_id = Some(entrant_id.clone());
                seed.entrant_name = Some(entrant_name.clone());
            }
        }
        hydrate_progression_entrant_to_seed_slots(event, &target_seed, &entrant_id, &entrant_name);
    }
}

fn compare_round_robin_tiebreak(
    rule: &str,
    left: &str,
    right: &str,
    wins: &HashMap<String, i64>,
    game_wins: &HashMap<String, f64>,
    game_losses: &HashMap<String, f64>,
    head_to_head_points: &HashMap<String, i64>,
) -> Ordering {
    let normalized = rule
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_uppercase())
        .collect::<String>();
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

fn apply_local_progression(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    source_set_id: &str,
    winner_id: &str,
) {
    let Some(event) = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    else {
        return;
    };

    let Some(source_set) = event
        .sets
        .iter()
        .find(|set| set.set_id == source_set_id)
        .cloned()
    else {
        return;
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
        && winner_is_from_losers_side(event, &source_set, winner_id)
    {
        let has_existing_reset = hydrate_existing_grand_final_reset_sets(event, &source_set);
        if !has_existing_reset {
            ensure_virtual_grand_final_reset_set(event, &source_set);
        }
    }

    advance_completed_set_by_placement(
        event,
        &source_set,
        winner_id,
        &winner_name,
        loser_slot.and_then(|loser| {
            loser
                .entrant_id
                .as_ref()
                .map(|id| (id.as_str(), loser.entrant_name.as_str()))
        }),
    );

    advance_completed_set_to_next_real_sets(
        event,
        &source_set,
        winner_id,
        &winner_name,
        loser_slot.and_then(|loser| {
            loser
                .entrant_id
                .as_ref()
                .map(|id| (id.as_str(), loser.entrant_name.as_str()))
        }),
    );

    apply_source_based_tbd_labels(event);
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

fn clear_set_result_state(set: &mut crate::models::SetSnapshot) {
    set.winner_id = None;
    for slot in &mut set.slots {
        slot.score = None;
    }
    set.state = if empty_slot_count(set) == 0 { 2 } else { 1 };
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
    let snapshot = load_snapshot(app, slug)?;
    let event = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    collect_affected_set_ids_for_reset(event, source_set_id)
}

pub fn reset_local_set_result_with_dependencies(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    source_set_id: &str,
) -> Result<(TournamentWorkspace, Vec<String>), String> {
    let mut snapshot = load_snapshot(app, slug)?;
    let mut local_meta = load_local_meta(app, slug, event_id)?;

    let event_index = snapshot
        .events
        .iter()
        .position(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    let affected_set_ids = {
        let event = snapshot
            .events
            .get(event_index)
            .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;
        collect_affected_set_ids_for_reset(event, source_set_id)?
    };

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

    save_snapshot(app, &merged_snapshot)?;

    // オフラインでも下書き破棄で戻せるよう、原本スナップショットを別保存する。
    let mut pristine_snapshot =
        load_pristine_snapshot(app, &snapshot.slug).unwrap_or_else(|_| merged_snapshot.clone());

    pristine_snapshot.tournament_id = snapshot.tournament_id.clone();
    pristine_snapshot.slug = snapshot.slug.clone();
    pristine_snapshot.name = snapshot.name.clone();
    pristine_snapshot.updated_at = snapshot.updated_at;

    if let Some(existing) = pristine_snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    {
        *existing = event_snapshot.clone();
    } else {
        pristine_snapshot.events.push(event_snapshot);
    }

    save_pristine_snapshot(app, &pristine_snapshot)?;

    let mut local_meta = sync_local_meta_from_snapshot(app, &merged_snapshot, event_id)?;
    if let Some(event_meta) = local_meta
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
    {
        event_meta.event_alias = event_alias;
    }
    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;

    Ok(local_meta)
}

pub fn save_local_meta(
    app: &AppHandle,
    event_id: &str,
    meta: &TournamentLocalMeta,
) -> Result<(), String> {
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
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("ローカルメタのJSON変換に失敗しました: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("ローカルメタ保存に失敗しました: {e}"))?;

    let meta_prefix = format!(
        "{}-{}-{}-",
        sanitize_slug(&normalized.tournament_id),
        sanitize_slug(&normalize_slug_for_storage(&normalized.slug)),
        sanitize_slug(event_id)
    );
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
        if candidate != path
            && file_name.starts_with(&meta_prefix)
            && file_name.ends_with("-meta.json")
        {
            let _ = fs::remove_file(candidate);
        }
    }

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
    let current_meta = load_local_meta(app, &snapshot.slug, event_id)?;
    let merged_meta = merge_snapshot_into_meta(snapshot, event_id, current_meta);
    save_local_meta(app, event_id, &merged_meta)?;
    Ok(merged_meta)
}

pub fn prune_pending_set_results_by_snapshot_match(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentLocalMeta, String> {
    let snapshot = load_snapshot(app, slug)?;
    let mut local_meta = load_local_meta(app, slug, event_id)?;

    let event_sets = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| &event.sets)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    local_meta.pending_set_results.retain(|pending| {
        if pending.event_id != event_id {
            return true;
        }

        let matched_set = event_sets.iter().find(|set| set.set_id == pending.set_id);
        let Some(set) = matched_set else {
            return true;
        };

        !is_pending_result_matched_with_set(pending, set)
    });

    local_meta.updated_at = Utc::now();
    save_local_meta(app, event_id, &local_meta)?;
    Ok(local_meta)
}

pub fn load_workspace(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentWorkspace, String> {
    let snapshot = load_snapshot(app, slug)?;
    let local_meta =
        merge_snapshot_into_meta(&snapshot, event_id, load_local_meta(app, slug, event_id)?);

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn upsert_local_set_result(
    app: &AppHandle,
    input: LocalSetResultInput,
) -> Result<TournamentWorkspace, String> {
    if input.set_id.starts_with("preview_") {
        return Err(
            "preview setは結果報告できません。スナップショットを更新して実setを取得してください。"
                .to_owned(),
        );
    }

    let mut snapshot = load_snapshot(app, &input.slug)?;
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;

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

    let (applied_event_id, should_advance) = {
        let (event_id, set_snapshot) = find_set_in_snapshot_mut(&mut snapshot, &input.set_id)
            .ok_or_else(|| {
                "ローカル結果の保存対象setがローカルsnapshotに見つかりません。".to_owned()
            })?;

        set_snapshot.winner_id = input.confirmed.then_some(input.winner_id.clone());
        set_snapshot.state = if input.confirmed { 3 } else { 2 };

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

        (event_id.clone(), input.confirmed)
    };

    let score_csv = if input.direct_win {
        String::new()
    } else {
        derive_score_csv_from_slot_scores(&input.slot_scores, &input.winner_id)?
    };
    let source_grand_final_set_id =
        source_grand_final_set_id_from_virtual_reset_set_id(&input.set_id);

    let slot_scores = input
        .slot_scores
        .into_iter()
        .map(|slot| LocalSetScoreMeta {
            entrant_id: slot.entrant_id,
            score: slot.score,
        })
        .collect::<Vec<LocalSetScoreMeta>>();

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
                recorded_at: Utc::now(),
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
            recorded_at: Utc::now(),
        });
    }

    local_meta.slug = input.slug;
    local_meta.tournament_id = snapshot.tournament_id.clone();
    local_meta.updated_at = Utc::now();

    if should_advance {
        rebuild_progression_from_completed_sets(&mut snapshot);
    }

    save_snapshot(app, &snapshot)?;
    save_local_meta(app, &applied_event_id, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn upsert_local_set_scores(
    app: &AppHandle,
    input: LocalSetScoreUpdateInput,
) -> Result<TournamentWorkspace, String> {
    let mut snapshot = load_snapshot(app, &input.slug)?;
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;

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
    }

    local_meta.slug = input.slug;
    local_meta.tournament_id = snapshot.tournament_id.clone();
    local_meta.updated_at = Utc::now();

    save_snapshot(app, &snapshot)?;
    save_local_meta(app, &applied_event_id, &local_meta)?;

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

    let mut snapshot = load_snapshot(app, slug)?;
    let pristine_snapshot =
        load_pristine_snapshot(app, slug).or_else(|_| load_snapshot(app, slug))?;

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
    Ok(local_meta)
}

pub fn clear_pending_set_result_for_set(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    set_id: &str,
) -> Result<TournamentWorkspace, String> {
    let local_meta = load_local_meta(app, slug, event_id)?;
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

    let mut snapshot = load_snapshot(app, slug)?;
    let pristine_snapshot = load_pristine_snapshot(app, slug).ok();

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
    Ok(local_meta)
}

pub fn pending_set_result_record(
    app: &AppHandle,
    slug: &str,
    event_id: &str,
    set_id: &str,
) -> Result<Option<LocalSetResultMeta>, String> {
    let local_meta = load_local_meta(app, slug, event_id)?;
    Ok(local_meta
        .pending_set_results
        .into_iter()
        .find(|item| item.set_id == set_id))
}

pub fn local_set_snapshot_winner_id(
    app: &AppHandle,
    slug: &str,
    set_id: &str,
) -> Result<Option<String>, String> {
    let snapshot = load_snapshot(app, slug)?;
    Ok(find_set_in_snapshot(&snapshot, set_id)
        .map(|(_, set)| set.winner_id.clone())
        .flatten())
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
    let snapshot = load_snapshot(app, &input.slug)?;
    let mut local_meta = load_local_meta(app, &input.slug, &input.event_id)?;

    let set_snapshot = snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .and_then(|event| event.sets.iter().find(|set| set.set_id == input.set_id))
        .ok_or_else(|| "サイド保存対象のsetが見つかりません。".to_owned())?;

    if !is_set_matchup_ready(set_snapshot) {
        return Err("対戦カードが確定していないsetはサイド設定できません。".to_owned());
    }

    let entrant_ids = set_snapshot
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.clone())
        .collect::<Vec<String>>();

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
