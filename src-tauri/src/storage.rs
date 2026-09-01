use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::models::{
    EventEntrantMeta, EventLocalMeta, EventManagementMeta, EventSnapshot, GenericMessage,
    ItemListConfig, LocalPlayerMetaInput, LocalSetPlaySideInput, LocalSetResultInput,
    LocalSetResultMeta, LocalSetScoreMeta, LocalSnapshotEventListItem,
    SaveEventManagementMetaInput, SenderProfile, SetPlaySideMeta, TournamentLocalMeta,
    TournamentSnapshot, TournamentWorkspace,
};

const STORAGE_DIR_NAME: &str = "savakan-gg";
const TOKEN_FILE: &str = "startgg-token.txt";
const SLUG_FILE: &str = "last-slug.txt";
const ITEM_LISTS_FILE: &str = "item-lists.json";
const EVENT_MGMT_FILE: &str = "event-mgmt-settings.json";
const SENDER_PROFILE_FILE: &str = "sender-profile.json";
const GENERIC_MESSAGES_FILE: &str = "generic-messages.json";
const LAST_SNAPSHOT_SELECTION_FILE: &str = "last-snapshot-selection.json";
const TEMP_TOKEN_FILE: &str = "token.txt";
const EVENT_SETTING_CATEGORY_SLOT_COUNT: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastSnapshotSelection {
    pub slug: String,
    pub event_id: String,
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

fn alternate_slug_for_legacy_path(slug: &str) -> Option<String> {
    let trimmed = slug.trim().trim_matches('/');
    let normalized = normalize_slug_for_storage(slug);

    if let Some(rest) = trimmed.strip_prefix("tournament/") {
        let candidate = rest.trim_matches('/').to_owned();
        if candidate != normalized {
            return Some(candidate);
        }
        return None;
    }

    let candidate = format!("tournament/{normalized}");
    if candidate == trimmed {
        None
    } else {
        Some(candidate)
    }
}

fn snapshot_path_with_slug_key(app: &AppHandle, slug_key: &str) -> Result<PathBuf, String> {
    let file_name = format!("tournament-{}.json", sanitize_slug(slug_key));
    Ok(storage_dir(app)?.join(file_name))
}

fn meta_path_with_slug_key(app: &AppHandle, slug_key: &str, event_id: &str) -> Result<PathBuf, String> {
    let file_name = format!(
        "tournament-meta-{}-{}.json",
        sanitize_slug(slug_key),
        sanitize_slug(event_id)
    );
    Ok(storage_dir(app)?.join(file_name))
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dirの取得に失敗しました: {e}"))?
        .join(STORAGE_DIR_NAME);

    fs::create_dir_all(&path).map_err(|e| format!("保存先ディレクトリの作成に失敗しました: {e}"))?;
    Ok(path)
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(TOKEN_FILE))
}

fn snapshot_path(app: &AppHandle, slug: &str) -> Result<PathBuf, String> {
    let normalized = normalize_slug_for_storage(slug);
    snapshot_path_with_slug_key(app, &normalized)
}

fn meta_path(app: &AppHandle, slug: &str, event_id: &str) -> Result<PathBuf, String> {
    let normalized = normalize_slug_for_storage(slug);
    meta_path_with_slug_key(app, &normalized, event_id)
}

fn slug_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(SLUG_FILE))
}

fn item_lists_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(ITEM_LISTS_FILE))
}

fn event_mgmt_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(EVENT_MGMT_FILE))
}

fn sender_profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(SENDER_PROFILE_FILE))
}

fn generic_messages_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(GENERIC_MESSAGES_FILE))
}

fn last_snapshot_selection_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(LAST_SNAPSHOT_SELECTION_FILE))
}

fn build_empty_meta(slug: &str, event_id: &str) -> TournamentLocalMeta {
    TournamentLocalMeta {
        tournament_id: String::new(),
        slug: slug.to_owned(),
        events: vec![EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            event_management: None,
            entrants: Vec::new(),
        }],
        set_play_sides: Vec::new(),
        pending_set_results: Vec::new(),
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
    let mut category_allow_duplicates = normalize_allow_duplicates_array(&setting.category_allow_duplicates);

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

fn has_item_selection_setting_changed(
    existing: Option<&EventManagementMeta>,
    next: &EventManagementMeta,
) -> bool {
    let Some(current) = existing else {
        return true;
    };

    current.item_list_snapshots != next.item_list_snapshots
        || current.category_min_counts != next.category_min_counts
        || current.category_max_counts != next.category_max_counts
        || current.category_allow_duplicates != next.category_allow_duplicates
        || current.total_min_count != next.total_min_count
        || current.total_max_count != next.total_max_count
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
    let loser_slot = set
        .slots
        .iter()
        .find(|slot| slot.entrant_id.as_deref().is_some() && slot.entrant_id.as_deref() != Some(winner_id))?;

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
            sets: Vec::new(),
        });

    let event_index = if let Some(index) = meta.events.iter().position(|item| item.event_id == event.event_id) {
        index
    } else {
        meta.events.push(EventLocalMeta {
            event_id: event.event_id.clone(),
            event_name: event.name.clone(),
            event_alias: None,
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
        for slot in &set.slots {
            let Some(entrant_id) = &slot.entrant_id else {
                continue;
            };

            valid_set_slot_keys.insert(format!("{}:{}", set_id, entrant_id));

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

    meta
        .set_play_sides
        .retain(|item| valid_set_slot_keys.contains(&format!("{}:{}", item.set_id, item.entrant_id)));

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

    let raw = fs::read_to_string(path).map_err(|e| format!("保存済みトークン読込に失敗しました: {e}"))?;
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
) -> Result<(), String> {
    let path = last_snapshot_selection_path(app)?;
    let payload = LastSnapshotSelection {
        slug: slug.trim().to_owned(),
        event_id: event_id.trim().to_owned(),
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

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("保存済み大会設定読込に失敗しました: {e}"))?;
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
        return Err("ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0".to_owned());
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

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("送信者設定読込に失敗しました: {e}"))?;
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

fn call_message_identity(message: &GenericMessage) -> Option<String> {
    let meta = message.message_meta.as_ref()?;
    let call_id = meta.get("callId").and_then(|value| value.as_str()).map(|value| value.trim().to_owned());
    if let Some(call_id) = call_id.filter(|value| !value.is_empty()) {
        return Some(call_id);
    }

    let tournament_id = meta.get("tournamentId").and_then(|value| value.as_str())?.trim();
    let event_id = meta.get("eventId").and_then(|value| value.as_str())?.trim();
    let set_id = meta.get("setId").and_then(|value| value.as_str())?.trim();
    let entrant_id = meta.get("callEntrantId").and_then(|value| value.as_str())?.trim();

    if tournament_id.is_empty() || event_id.is_empty() || set_id.is_empty() || entrant_id.is_empty() {
        return None;
    }

    Some(format!("{tournament_id}:{event_id}:{set_id}:{entrant_id}"))
}

fn build_forced_resolve_message(root: &GenericMessage) -> GenericMessage {
    let message_id = format!("{}-forced-resolve-{}", root.message_id, Utc::now().timestamp_millis());

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

pub fn append_generic_message(app: &AppHandle, message: &GenericMessage) -> Result<(), String> {
    let mut messages = load_generic_messages(app)?.unwrap_or_default();

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
                        && call_message_identity(item).as_deref() == Some(call_identity.as_str())
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
        .position(|item| item.message_id == message.message_id)
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

        if sender_name.is_empty() || sender_user_id.is_empty() || body.is_empty() || created_at.is_empty() {
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

    Err("トークンの読込に失敗しました。保存済みトークン、またはtoken.txtを確認してください。"
        .to_owned())
}

pub fn save_snapshot(app: &AppHandle, snapshot: &TournamentSnapshot) -> Result<(), String> {
    let path = snapshot_path(app, &snapshot.slug)?;
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("スナップショットのJSON変換に失敗しました: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("スナップショット保存に失敗しました: {e}"))?;

    if let Some(legacy_slug) = alternate_slug_for_legacy_path(&snapshot.slug) {
        let legacy_path = snapshot_path_with_slug_key(app, &legacy_slug)?;
        if legacy_path != path && legacy_path.exists() {
            let _ = fs::remove_file(legacy_path);
        }
    }

    Ok(())
}

pub fn load_snapshot(app: &AppHandle, slug: &str) -> Result<TournamentSnapshot, String> {
    let mut candidate_paths = vec![snapshot_path(app, slug)?];
    if let Some(legacy_slug) = alternate_slug_for_legacy_path(slug) {
        candidate_paths.push(snapshot_path_with_slug_key(app, &legacy_slug)?);
    }

    let mut last_error = None;
    let mut loaded_raw = None;
    for path in candidate_paths {
        if !path.exists() {
            continue;
        }

        match fs::read_to_string(&path) {
            Ok(raw) => {
                loaded_raw = Some(raw);
                break;
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    let raw = if let Some(raw) = loaded_raw {
        raw
    } else if let Some(error) = last_error {
        return Err(format!("ローカルスナップショット読込に失敗しました: {error}"));
    } else {
        return Err("ローカルスナップショット読込に失敗しました: 保存済みデータが見つかりません。".to_owned());
    };

    serde_json::from_str(&raw)
        .map_err(|e| format!("ローカルスナップショットのパースに失敗しました: {e}"))
}

pub fn list_local_snapshot_events(app: &AppHandle) -> Result<Vec<LocalSnapshotEventListItem>, String> {
    let dir = storage_dir(app)?;
    let entries = fs::read_dir(&dir).map_err(|e| format!("保存済みスナップショット一覧の取得に失敗しました: {e}"))?;
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

        if !file_name.starts_with("tournament-") || !file_name.ends_with(".json") {
            continue;
        }
        if file_name.starts_with("tournament-meta-") {
            continue;
        }

        let raw = match fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let snapshot = match serde_json::from_str::<TournamentSnapshot>(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for event in snapshot.events {
            let event_alias = load_local_meta(app, &snapshot.slug, &event.event_id)
                .ok()
                .and_then(|meta| {
                    meta.events
                        .into_iter()
                        .find(|item| item.event_id == event.event_id)
                        .and_then(|item| item.event_alias)
                });

            items.push(LocalSnapshotEventListItem {
                tournament_id: snapshot.tournament_id.clone(),
                slug: snapshot.slug.clone(),
                tournament_name: snapshot.name.clone(),
                updated_at: snapshot.updated_at,
                event_id: event.event_id,
                event_name: event.name,
                event_alias,
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

pub fn delete_local_snapshot_event(app: &AppHandle, slug: &str, event_id: &str) -> Result<(), String> {
    let mut snapshot = load_snapshot(app, slug)?;
    let before_len = snapshot.events.len();
    snapshot.events.retain(|event| event.event_id != event_id);

    if snapshot.events.len() == before_len {
        return Err(format!("削除対象のイベントが見つかりません: {event_id}"));
    }

    let target_meta_path = meta_path(app, slug, event_id)?;
    if target_meta_path.exists() {
        fs::remove_file(&target_meta_path)
            .map_err(|e| format!("ローカルメタ削除に失敗しました: {e}"))?;
    }

    if snapshot.events.is_empty() {
        let target_snapshot_path = snapshot_path(app, slug)?;
        if target_snapshot_path.exists() {
            fs::remove_file(&target_snapshot_path)
                .map_err(|e| format!("スナップショット削除に失敗しました: {e}"))?;
        }

        let dir = storage_dir(app)?;
        let meta_prefix = format!("tournament-meta-{}-", sanitize_slug(slug));
        let entries = fs::read_dir(&dir)
            .map_err(|e| format!("保存ディレクトリの走査に失敗しました: {e}"))?;
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
            if !file_name.starts_with(&meta_prefix) || !file_name.ends_with(".json") {
                continue;
            }
            let _ = fs::remove_file(path);
        }
    } else {
        snapshot.updated_at = Utc::now();
        save_snapshot(app, &snapshot)?;
    }

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
    set.slots
        .iter()
        .position(|slot| slot.entrant_id.is_none() || slot.entrant_name.trim().eq_ignore_ascii_case("tbd"))
}

fn place_entrant_to_set(
    set: &mut crate::models::SetSnapshot,
    entrant_id: &str,
    entrant_name: &str,
) -> bool {
    let Some(slot_index) = first_empty_slot_index(set) else {
        return false;
    };

    if set
        .slots
        .iter()
        .any(|slot| slot.entrant_id.as_deref() == Some(entrant_id))
    {
        return false;
    }

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
    source_round: Option<i64>,
    source_is_losers: bool,
    source_phase_name: Option<&String>,
    source_phase_group_name: Option<&String>,
    winner_id: &str,
    winner_name: &str,
) -> bool {
    let src_phase = normalize_group_key(source_phase_name);
    let src_group = normalize_group_key(source_phase_group_name);

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

            Some((index, strictness_rank, round_gap, empty_count))
        })
        .collect::<Vec<(usize, i64, i64, usize)>>();

    candidates.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.0.cmp(&right.0))
    });

    for (index, _, _, _) in candidates {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, winner_id, winner_name) {
                return true;
            }
        }
    }

    false
}

fn drop_loser_to_losers_lane(
    event: &mut EventSnapshot,
    source_set_id: &str,
    source_round: Option<i64>,
    source_phase_name: Option<&String>,
    source_phase_group_name: Option<&String>,
    loser_id: &str,
    loser_name: &str,
) -> bool {
    let src_phase = normalize_group_key(source_phase_name);
    let src_group = normalize_group_key(source_phase_group_name);

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

            Some((index, strictness_rank, round_distance, empty_count))
        })
        .collect::<Vec<(usize, i64, i64, usize)>>();

    candidates.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.0.cmp(&right.0))
    });

    for (index, _, _, _) in candidates {
        if let Some(target) = event.sets.get_mut(index) {
            if place_entrant_to_set(target, loser_id, loser_name) {
                return true;
            }
        }
    }

    false
}

fn apply_local_progression(
    snapshot: &mut TournamentSnapshot,
    event_id: &str,
    source_set_id: &str,
    winner_id: &str,
) {
    let Some(event) = snapshot.events.iter_mut().find(|event| event.event_id == event_id) else {
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

    let loser_slot = source_set
        .slots
        .iter()
        .find(|slot| slot.entrant_id.as_deref().is_some() && slot.entrant_id.as_deref() != Some(winner_id));

    let source_is_losers = is_losers_set(&source_set);
    let _ = advance_winner_within_lane(
        event,
        source_set_id,
        source_set.round,
        source_is_losers,
        source_set.phase_name.as_ref(),
        source_set.phase_group_name.as_ref(),
        winner_id,
        &winner_name,
    );

    if !source_is_losers {
        if let Some(loser) = loser_slot {
            if let Some(loser_id) = loser.entrant_id.as_ref() {
                let _ = drop_loser_to_losers_lane(
                    event,
                    source_set_id,
                    source_set.round,
                    source_set.phase_name.as_ref(),
                    source_set.phase_group_name.as_ref(),
                    loser_id,
                    &loser.entrant_name,
                );
            }
        }
    }
}

fn round_depth_for_sort(round: Option<i64>) -> i64 {
    round.map(|value| value.abs()).unwrap_or(i64::MAX / 4)
}

fn collect_affected_set_ids_for_reset(
    event: &EventSnapshot,
    source_set_id: &str,
) -> Result<Vec<String>, String> {
    let source_set = event
        .sets
        .iter()
        .find(|set| set.set_id == source_set_id)
        .ok_or_else(|| format!("取り消し対象setが見つかりません: {source_set_id}"))?;

    let source_depth = round_depth_for_sort(source_set.round);
    let mut invalid_entrant_ids = source_set
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.clone())
        .collect::<HashSet<String>>();
    let mut affected_ids = HashSet::from([source_set_id.to_owned()]);

    let mut changed = true;
    while changed {
        changed = false;

        for set in &event.sets {
            if affected_ids.contains(&set.set_id) {
                continue;
            }

            if round_depth_for_sort(set.round) < source_depth {
                continue;
            }

            let intersects = set.slots.iter().any(|slot| {
                slot.entrant_id
                    .as_ref()
                    .map(|entrant_id| invalid_entrant_ids.contains(entrant_id))
                    .unwrap_or(false)
            });
            if !intersects {
                continue;
            }

            for entrant_id in set.slots.iter().filter_map(|slot| slot.entrant_id.clone()) {
                invalid_entrant_ids.insert(entrant_id);
            }
            if let Some(winner_id) = set.winner_id.as_ref() {
                invalid_entrant_ids.insert(winner_id.clone());
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
            let Some(set) = event.sets.iter_mut().find(|set| set.set_id == *target_set_id) else {
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

    // 同一slugの既存スナップショットを保持しつつ、対象eventのみ差し替える。
    let mut merged_snapshot = load_snapshot(app, &snapshot.slug).unwrap_or_else(|_| TournamentSnapshot {
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
        *existing = event_snapshot;
    } else {
        merged_snapshot.events.push(event_snapshot);
    }

    save_snapshot(app, &merged_snapshot)?;
    let mut local_meta = sync_local_meta_from_snapshot(app, &merged_snapshot, event_id)?;
    if let Some(event_meta) = local_meta.events.iter_mut().find(|event| event.event_id == event_id) {
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
            event_management: None,
            entrants: Vec::new(),
        });
    }
    normalized
        .pending_set_results
        .retain(|pending| pending.event_id == event_id);

    let path = meta_path(app, &normalized.slug, event_id)?;
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("ローカルメタのJSON変換に失敗しました: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("ローカルメタ保存に失敗しました: {e}"))?;

    if let Some(legacy_slug) = alternate_slug_for_legacy_path(&normalized.slug) {
        let legacy_path = meta_path_with_slug_key(app, &legacy_slug, event_id)?;
        if legacy_path != path && legacy_path.exists() {
            let _ = fs::remove_file(legacy_path);
        }
    }

    Ok(())
}

pub fn load_local_meta(app: &AppHandle, slug: &str, event_id: &str) -> Result<TournamentLocalMeta, String> {
    let mut candidate_paths = vec![meta_path(app, slug, event_id)?];
    if let Some(legacy_slug) = alternate_slug_for_legacy_path(slug) {
        candidate_paths.push(meta_path_with_slug_key(app, &legacy_slug, event_id)?);
    }

    let mut loaded_raw = None;
    let mut last_error = None;
    for path in candidate_paths {
        if !path.exists() {
            continue;
        }

        match fs::read_to_string(&path) {
            Ok(raw) => {
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

    let mut parsed: TournamentLocalMeta =
        serde_json::from_str(&raw).map_err(|e| format!("ローカルメタのパースに失敗しました: {e}"))?;
    parsed.slug = slug.to_owned();
    parsed.events.retain(|event| event.event_id == event_id);
    if parsed.events.is_empty() {
        parsed.events.push(EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
            event_management: None,
            entrants: Vec::new(),
        });
    }
    parsed
        .pending_set_results
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

pub fn load_workspace(app: &AppHandle, slug: &str, event_id: &str) -> Result<TournamentWorkspace, String> {
    let snapshot = load_snapshot(app, slug)?;
    let local_meta = merge_snapshot_into_meta(&snapshot, event_id, load_local_meta(app, slug, event_id)?);

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

pub fn upsert_local_set_result(
    app: &AppHandle,
    input: LocalSetResultInput,
) -> Result<TournamentWorkspace, String> {
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

    let winner_id_for_progress = input.winner_id.clone();
    let (applied_event_id, should_advance) = {
        let (event_id, set_snapshot) = find_set_in_snapshot_mut(&mut snapshot, &input.set_id)
            .ok_or_else(|| "ローカル結果の保存対象setがローカルsnapshotに見つかりません。".to_owned())?;

        set_snapshot.winner_id = Some(input.winner_id.clone());
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

    let score_csv = derive_score_csv_from_slot_scores(&input.slot_scores, &input.winner_id)?;

    local_meta
        .pending_set_results
        .retain(|item| item.set_id != input.set_id);
    local_meta.pending_set_results.push(LocalSetResultMeta {
        event_id: applied_event_id.clone(),
        event_name: event_name.clone(),
        set_id: input.set_id.clone(),
        winner_id: input.winner_id,
        score_csv,
        confirmed: input.confirmed,
        slot_scores: input
            .slot_scores
            .into_iter()
            .map(|slot| LocalSetScoreMeta {
                entrant_id: slot.entrant_id,
                score: slot.score,
            })
            .collect(),
        recorded_at: Utc::now(),
    });

    local_meta.slug = input.slug;
    local_meta.tournament_id = snapshot.tournament_id.clone();
    local_meta.updated_at = Utc::now();

    if should_advance {
        apply_local_progression(&mut snapshot, &applied_event_id, &input.set_id, &winner_id_for_progress);
    }

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
    Ok(find_set_in_snapshot(&snapshot, set_id).map(|(_, set)| set.winner_id.clone()).flatten())
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
    let should_clear_player_item_selections =
        has_item_selection_setting_changed(event_meta.event_management.as_ref(), &next_setting);

    event_meta.event_management = Some(next_setting);

    if should_clear_player_item_selections {
        for entrant in &mut event_meta.entrants {
            entrant.character_names.clear();
        }
    }

    local_meta.slug = input.slug;
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &input.event_id, &local_meta)?;
    Ok(local_meta)
}
