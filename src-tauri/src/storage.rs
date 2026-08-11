use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::models::{
    EventEntrantMeta, EventLocalMeta, EventSnapshot, LocalPlayerMetaInput,
    LocalSetPlaySideInput, LocalSetResultInput, LocalSetResultMeta, LocalSetScoreMeta,
    LocalSnapshotEventListItem, SetPlaySideMeta, TournamentLocalMeta, TournamentSnapshot,
    TournamentWorkspace,
};

const STORAGE_DIR_NAME: &str = "savakan-gg";
const TOKEN_FILE: &str = "startgg-token.txt";
const SLUG_FILE: &str = "last-slug.txt";
const TEMP_TOKEN_FILE: &str = "token.txt";

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
    let file_name = format!("tournament-{}.json", sanitize_slug(slug));
    Ok(storage_dir(app)?.join(file_name))
}

fn meta_path(app: &AppHandle, slug: &str, event_id: &str) -> Result<PathBuf, String> {
    let file_name = format!(
        "tournament-meta-{}-{}.json",
        sanitize_slug(slug),
        sanitize_slug(event_id)
    );
    Ok(storage_dir(app)?.join(file_name))
}

fn slug_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(SLUG_FILE))
}

fn build_empty_meta(slug: &str, event_id: &str) -> TournamentLocalMeta {
    TournamentLocalMeta {
        tournament_id: String::new(),
        slug: slug.to_owned(),
        events: vec![EventLocalMeta {
            event_id: event_id.to_owned(),
            event_name: String::new(),
            event_alias: None,
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
    fs::write(path, json).map_err(|e| format!("スナップショット保存に失敗しました: {e}"))
}

pub fn load_snapshot(app: &AppHandle, slug: &str) -> Result<TournamentSnapshot, String> {
    let path = snapshot_path(app, slug)?;
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("ローカルスナップショット読込に失敗しました: {e}"))?;
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
            entrants: Vec::new(),
        });
        local_meta.events.len().saturating_sub(1)
    };

    if let Some(event_meta) = local_meta.events.get_mut(event_index) {
        event_meta.event_alias = event_alias;
    }

    local_meta.updated_at = Utc::now();
    save_local_meta(app, &local_meta)?;
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

    let event_only_snapshot = TournamentSnapshot {
        tournament_id: snapshot.tournament_id.clone(),
        slug: snapshot.slug.clone(),
        name: snapshot.name.clone(),
        events: vec![event_snapshot],
        updated_at: snapshot.updated_at,
    };

    save_snapshot(app, &event_only_snapshot)?;
    let mut local_meta = sync_local_meta_from_snapshot(app, &event_only_snapshot, event_id)?;
    if let Some(event_meta) = local_meta.events.iter_mut().find(|event| event.event_id == event_id) {
        event_meta.event_alias = event_alias;
    }
    local_meta.updated_at = Utc::now();
    save_local_meta(app, &local_meta)?;

    Ok(local_meta)
}

pub fn save_local_meta(app: &AppHandle, meta: &TournamentLocalMeta) -> Result<(), String> {
    let event_id = meta
        .events
        .first()
        .map(|event| event.event_id.as_str())
        .unwrap_or("");
    let path = meta_path(app, &meta.slug, event_id)?;
    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("ローカルメタのJSON変換に失敗しました: {e}"))?;
    fs::write(path, json).map_err(|e| format!("ローカルメタ保存に失敗しました: {e}"))
}

pub fn load_local_meta(app: &AppHandle, slug: &str, event_id: &str) -> Result<TournamentLocalMeta, String> {
    let path = meta_path(app, slug, event_id)?;
    if !path.exists() {
        return Ok(build_empty_meta(slug, event_id));
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("ローカルメタ読込に失敗しました: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("ローカルメタのパースに失敗しました: {e}"))
}

pub fn sync_local_meta_from_snapshot(
    app: &AppHandle,
    snapshot: &TournamentSnapshot,
    event_id: &str,
) -> Result<TournamentLocalMeta, String> {
    let current_meta = load_local_meta(app, &snapshot.slug, event_id)?;
    let merged_meta = merge_snapshot_into_meta(snapshot, event_id, current_meta);
    save_local_meta(app, &merged_meta)?;
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
    save_local_meta(app, &local_meta)?;
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
    save_local_meta(app, &local_meta)?;

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
    save_local_meta(app, &local_meta)?;
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
    save_local_meta(app, &local_meta)?;
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
    save_local_meta(app, &local_meta)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}
