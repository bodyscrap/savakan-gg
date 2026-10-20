mod models;
mod call_list;
mod bracket_messages;
mod sender_users;
mod reporting;
mod startgg;
mod startgg_scalars;
mod storage;

use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use if_addrs::get_if_addrs;
use models::{
    ApplyExternalScoreReportInput, BracketBatchReportInput, BracketBatchReportResult,
    ClearLocalSetResultDraftInput, ClearPhaseGroupExternalEditorInput,
    CreateEventSnapshotBySlugInput, CreateEventSnapshotInput, FeatureMessage, ItemListConfig,
    LocalPlayerMetaInput, LocalSetPlaySideInput, LocalSetResultInput, LocalSetScoreInput,
    LocalSetScoreUpdateInput, LocalSnapshotEventListItem, MobileResultRequestInput,
    MobileResultRequestItem, PlaySide, ReportSetResultInput, ResetSetResultCascadeInput,
    ResetSetResultCascadeResult, RestoreEventGraphInput, RestoreEventGraphResult,
    SaveEventManagementMetaInput, SenderProfile, SetPhaseGroupExternalEditorInput,
    SetPhaseGroupExternalScoreBroadcastInput, SetPhaseGroupScoreEditLockInput, SetSnapshot,
    ShuffleInitialPhaseSeedsInput, TournamentPreview, TournamentShareArchive, TournamentSnapshot,
    TournamentWorkspace,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tiny_http::{Header, Response, Server};
use tokio::time::sleep;

const UDP_MAILBOX_PORT: u16 = 42690;
const OBS_OVERLAY_PORT: u16 = 42691;
const MOBILE_INPUT_PORT: u16 = 42692;
const MAILBOX_PROTOCOL: &str = "savakan-mailbox-v1";
const MAILBOX_METHOD_CALL_PLAYER: &str = "call_player";
const MAILBOX_METHOD_CALL_SYNC: &str = "call_player_sync";
const MAILBOX_METHOD_CALL_SYNC_REQUEST: &str = "call_player_sync_request";
const EVENT_SNAPSHOT_PROGRESS_EVENT: &str = "event_snapshot_progress";
const EVENT_BRACKET_REPORT_PROGRESS_EVENT: &str = "bracket_report_progress";
const EVENT_WORKSPACE_UPDATED: &str = "workspace_updated";
const EVENT_OBS_OVERLAY_STATE_CHANGED: &str = "obs_overlay_state_changed";
const VIRTUAL_GF_RESET_SET_ID_PREFIX: &str = "virtual_gf_reset_";
const GF_RESET_REPORT_RETRY_ATTEMPTS: usize = 12;
const GF_RESET_REPORT_RETRY_DELAY_MS: u64 = 500;
const GF_RESET_LINK_RETRY_ATTEMPTS: usize = 8;
const GF_RESET_LINK_RETRY_DELAY_MS: u64 = 700;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventSnapshotProgressPayload {
    phase: String,
    completed_sets: usize,
    total_sets: Option<usize>,
    current_page: Option<i64>,
    current_set_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BracketReportProgressPayload {
    phase: String,
    total_count: usize,
    processed_count: usize,
    reported_count: usize,
    skipped_count: usize,
    current_set_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdatedPayload {
    slug: String,
    event_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileOverlayToggleInput {
    slug: String,
    event_id: String,
    set_id: String,
    enabled: bool,
    force_switch: bool,
    event_name: String,
    #[serde(default)]
    event_alias: String,
    round_text: String,
    red_player_name: String,
    blue_player_name: String,
    red_set_wins: u32,
    blue_set_wins: u32,
    font_scale: f64,
}

fn emit_event_snapshot_progress(
    app: &tauri::AppHandle,
    progress: startgg::EventSnapshotFetchProgress,
) {
    let payload = EventSnapshotProgressPayload {
        phase: progress.phase.to_owned(),
        completed_sets: progress.completed_sets,
        total_sets: progress.total_sets,
        current_page: progress.current_page,
        current_set_id: progress.current_set_id,
    };

    let _ = app.emit(EVENT_SNAPSHOT_PROGRESS_EVENT, payload);
}

fn emit_bracket_report_progress(
    app: &tauri::AppHandle,
    phase: &str,
    total_count: usize,
    processed_count: usize,
    reported_count: usize,
    skipped_count: usize,
    current_set_id: Option<&str>,
) {
    let payload = BracketReportProgressPayload {
        phase: phase.to_owned(),
        total_count,
        processed_count,
        reported_count,
        skipped_count,
        current_set_id: current_set_id.map(str::to_owned),
    };

    let _ = app.emit(EVENT_BRACKET_REPORT_PROGRESS_EVENT, payload);
}

fn emit_workspace_updated(app: &tauri::AppHandle, slug: &str, event_id: &str) {
    let payload = WorkspaceUpdatedPayload {
        slug: slug.to_owned(),
        event_id: event_id.to_owned(),
    };

    let _ = app.emit(EVENT_WORKSPACE_UPDATED, payload);
}

fn emit_obs_overlay_state_changed(app: &tauri::AppHandle) {
    if let Ok(state) = snapshot_obs_overlay_state() {
        let _ = app.emit(EVENT_OBS_OVERLAY_STATE_CHANGED, state);
    }
}

static UDP_LISTENER_RUNNING: OnceLock<AtomicBool> = OnceLock::new();
static MESSAGE_ID_SEQUENCE: OnceLock<AtomicU64> = OnceLock::new();
static OBS_OVERLAY_SERVER_RUNNING: OnceLock<AtomicBool> = OnceLock::new();
static OBS_OVERLAY_STATE: OnceLock<Mutex<ObsOverlayRuntimeState>> = OnceLock::new();
static MOBILE_INPUT_SERVER_RUNNING: OnceLock<AtomicBool> = OnceLock::new();
static MOBILE_INPUT_AUTH_TOKEN: OnceLock<Mutex<String>> = OnceLock::new();

fn udp_listener_running() -> &'static AtomicBool {
    UDP_LISTENER_RUNNING.get_or_init(|| AtomicBool::new(false))
}

fn message_id_sequence() -> &'static AtomicU64 {
    MESSAGE_ID_SEQUENCE.get_or_init(|| AtomicU64::new(1))
}

fn obs_overlay_server_running() -> &'static AtomicBool {
    OBS_OVERLAY_SERVER_RUNNING.get_or_init(|| AtomicBool::new(false))
}

fn obs_overlay_state() -> &'static Mutex<ObsOverlayRuntimeState> {
    OBS_OVERLAY_STATE.get_or_init(|| {
        Mutex::new(ObsOverlayRuntimeState {
            active_set: None,
            event_alias: String::new(),
            preview_font_scale: 1.0,
            name_fit_mode: "shrink".to_owned(),
            show_set_info: true,
            show_event_alias: true,
            fully_stopped: false,
        })
    })
}

fn mobile_input_server_running() -> &'static AtomicBool {
    MOBILE_INPUT_SERVER_RUNNING.get_or_init(|| AtomicBool::new(false))
}

fn mobile_input_auth_token() -> &'static Mutex<String> {
    MOBILE_INPUT_AUTH_TOKEN.get_or_init(|| Mutex::new(String::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileInputPortalInfo {
    url: String,
    access_urls: Vec<String>,
    token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSetListItem {
    set_id: String,
    set_code: String,
    identifier: Option<String>,
    full_round_text: String,
    phase_name: Option<String>,
    phase_group_name: Option<String>,
    is_intermediate: bool,
    matchup_ready: bool,
    score_edit_locked: bool,
    state: i64,
    winner_id: Option<String>,
    entrant_names: Vec<String>,
    entrant_ids: Vec<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSetCallStatus {
    own_call_count: usize,
    other_call_count: usize,
    calling_players: Vec<String>,
    calling_entrant_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileResolvedCallCount {
    resolved_count: usize,
}

fn active_call_matches_set(message: &FeatureMessage, event_id: &str, set_id: &str) -> bool {
    message.method == "call_player"
        && message.message_type == "normal"
        && message.parent_message_id.is_none()
        && meta_string(message.message_meta.as_ref(), "eventId").as_deref() == Some(event_id)
        && meta_string(message.message_meta.as_ref(), "setId").as_deref() == Some(set_id)
}

fn load_active_calls_for_set(
    app: &tauri::AppHandle,
    event_id: &str,
    set_id: &str,
) -> Result<Vec<call_list::PlayerCall>, String> {
    Ok(call_list::load_player_calls(app.clone())?
        .into_iter()
        .filter(|call| active_call_matches_set(&call.message, event_id, set_id))
        .collect())
}

fn mobile_set_call_status(
    app: &tauri::AppHandle,
    event_id: &str,
    set_id: &str,
) -> Result<MobileSetCallStatus, String> {
    let sender_user_id = storage::load_sender_profile(app)?
        .map(|profile| profile.sender_user_id)
        .unwrap_or_default();
    let calls = load_active_calls_for_set(app, event_id, set_id)?;
    let (own_calls, other_calls): (Vec<_>, Vec<_>) = calls.iter().partition(|call| {
        call.message.sender_user_id == sender_user_id && !sender_user_id.is_empty()
    });
    Ok(MobileSetCallStatus {
        own_call_count: own_calls.len(),
        other_call_count: other_calls.len(),
        calling_players: calls
            .iter()
            .map(|call| {
                meta_string(call.message.message_meta.as_ref(), "callEntrantName")
                    .unwrap_or_else(|| call.message.subject.clone())
            })
            .collect(),
        calling_entrant_ids: calls
            .iter()
            .filter_map(|call| meta_string(call.message.message_meta.as_ref(), "callEntrantId"))
            .collect(),
    })
}

fn ensure_mobile_set_has_no_active_calls(
    app: &tauri::AppHandle,
    event_id: &str,
    set_id: &str,
) -> Result<(), String> {
    let status = mobile_set_call_status(app, event_id, set_id)?;
    if status.other_call_count > 0 {
        return Err(
            "他端末が発行した未解決の呼び出しがあります。発行端末で解決してください。"
                .to_owned(),
        );
    }
    if status.own_call_count > 0 {
        return Err("このSetに未解決の呼び出しがあります。解決してから操作してください。".to_owned());
    }
    Ok(())
}

fn resolve_mobile_calls_for_set(
    app: &tauri::AppHandle,
    event_id: &str,
    set_id: &str,
) -> Result<usize, String> {
    let profile = storage::load_sender_profile(app)?
        .ok_or("送信者設定を読み込めないため、呼び出しを解決できません。")?;
    let calls = load_active_calls_for_set(app, event_id, set_id)?;
    if calls
        .iter()
        .any(|call| call.message.sender_user_id != profile.sender_user_id)
    {
        return Err("他端末が発行した呼び出しがあります。発行端末で解決してください。".to_owned());
    }

    let mut resolved_count = 0;
    for call in calls {
        let input = SendMailboxMessageInput {
            destination: Some(call_list::DESTINATION.to_owned()),
            profile: profile.clone(),
            method: "call_player".to_owned(),
            subject: format!("Resolved: {}", call.message.subject),
            body: "呼び出しを解決しました。".to_owned(),
            delivery_target_mode: "broadcast".to_owned(),
            delivery_target_ip: None,
            message_type: Some("resolve".to_owned()),
            message_meta: call.message.message_meta.clone(),
            thread_id: None,
            parent_message_id: None,
        };
        let message = build_message_from_input(&input)?;
        call_list::send(app, &input, message)?;
        resolved_count += 1;
    }

    if !load_active_calls_for_set(app, event_id, set_id)?.is_empty() {
        return Err("このSetの呼び出しがまだ解決されていません。".to_owned());
    }
    Ok(resolved_count)
}

fn mobile_set_has_matchup(slots: &[models::SetSlotSnapshot]) -> bool {
    slots.len() >= 2
        && slots.iter().take(2).all(|slot| {
            slot.entrant_id
                .as_deref()
                .is_some_and(|entrant_id| !entrant_id.trim().is_empty())
        })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileEventInfo {
    event_alias: String,
    event_alias_is_default: bool,
    tournament_name: String,
    event_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSetSlotItem {
    entrant_id: Option<String>,
    entrant_name: String,
    score: Option<f64>,
    play_side: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSetDetailItem {
    set_id: String,
    set_code: String,
    full_round_text: String,
    round: Option<i64>,
    phase_name: Option<String>,
    phase_group_name: Option<String>,
    state: i64,
    winner_id: Option<String>,
    direct_win: bool,
    score_edit_locked: bool,
    slots: Vec<MobileSetSlotItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileSetSideAssignmentInput {
    entrant_id: String,
    play_side: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileSetSaveInput {
    slug: String,
    event_id: String,
    winner_id: Option<String>,
    slot_scores: Vec<LocalSetScoreInput>,
    #[serde(default)]
    side_assignments: Vec<MobileSetSideAssignmentInput>,
    #[serde(default)]
    direct_win: bool,
    confirmed: bool,
}

fn play_side_label(side: PlaySide) -> String {
    match side {
        PlaySide::OneP => "1P".to_owned(),
        PlaySide::TwoP => "2P".to_owned(),
    }
}

fn parse_play_side_value(value: Option<&str>) -> Result<Option<PlaySide>, String> {
    let normalized = value.map(str::trim).unwrap_or_default();
    if normalized.is_empty() {
        return Ok(None);
    }

    if normalized.eq_ignore_ascii_case("1P") {
        return Ok(Some(PlaySide::OneP));
    }
    if normalized.eq_ignore_ascii_case("2P") {
        return Ok(Some(PlaySide::TwoP));
    }

    Err("playSide は 1P / 2P / 空文字 を指定してください。".to_owned())
}

fn is_losers_set(set: &SetSnapshot) -> bool {
    if let Some(round) = set.round {
        if round < 0 {
            return true;
        }
    }

    let lowered = set.full_round_text.to_lowercase();
    lowered.contains("losers") || lowered.contains("loser") || lowered.contains("敗者")
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

fn build_set_display_code_by_id(sets: &[SetSnapshot]) -> HashMap<String, String> {
    let mut ordered_sets = sets.iter().cloned().collect::<Vec<_>>();
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
        if map.contains_key(&set_id) {
            continue;
        }

        let current_set = sets.iter().find(|set| set.set_id == set_id);
        if let Some(identifier) = current_set
            .and_then(|set| set.identifier.as_deref())
            .map(str::trim)
            .filter(|identifier| !identifier.is_empty())
        {
            map.insert(set_id.clone(), identifier.to_owned());
            used.insert(identifier.to_owned());
            continue;
        }
        let current_is_losers = current_set.as_ref().is_some_and(|set| is_losers_set(set));
        let current_is_gf = current_set
            .as_ref()
            .is_some_and(|set| is_grand_final_set(set));
        let current_is_reset = current_set
            .as_ref()
            .is_some_and(|set| is_grand_final_reset_set(set));

        if current_is_losers && gf_seen && reserved_after_gf && !current_is_reset {
            next_code_index += 1;
            reserved_after_gf = false;
        }

        let mut code = format_alphabet_sequence(next_code_index);
        while used.contains(&code) {
            next_code_index += 1;
            code = format_alphabet_sequence(next_code_index);
        }

        map.insert(set_id, code.clone());
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

fn is_grand_final_set(set: &SetSnapshot) -> bool {
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

fn is_grand_final_reset_set(set: &SetSnapshot) -> bool {
    is_grand_final_set(set) && set.full_round_text.to_lowercase().contains("reset")
}

fn is_visible_grand_final_reset(sets: &[SetSnapshot], reset_set: &SetSnapshot) -> bool {
    if !is_grand_final_reset_set(reset_set) {
        return true;
    }

    let reset_phase = normalize_optional_key(reset_set.phase_name.as_ref());
    let reset_group = normalize_optional_key(reset_set.phase_group_name.as_ref());

    sets.iter().any(|set| {
        is_grand_final_set(set)
            && !is_grand_final_reset_set(set)
            && set.state == 3
            && normalize_optional_key(set.phase_name.as_ref()) == reset_phase
            && normalize_optional_key(set.phase_group_name.as_ref()) == reset_group
    })
}

fn sort_pending_set_results_by_phase_order(
    pending: &mut [models::LocalSetResultMeta],
    event: &models::EventSnapshot,
) {
    let phase_sequence_by_set_id = event
        .sets
        .iter()
        .map(|set| {
            (
                set.set_id.as_str(),
                models::phase_sequence_index_for_set(event, set)
                    .map(|index| (false, index))
                    .unwrap_or((true, usize::MAX)),
            )
        })
        .collect::<HashMap<_, _>>();

    pending.sort_by(|left, right| {
        let left_phase_sequence = phase_sequence_by_set_id
            .get(left.set_id.as_str())
            .copied()
            .unwrap_or((true, usize::MAX));
        let right_phase_sequence = phase_sequence_by_set_id
            .get(right.set_id.as_str())
            .copied()
            .unwrap_or((true, usize::MAX));

        left_phase_sequence
            .cmp(&right_phase_sequence)
            .then_with(|| left.recorded_at.cmp(&right.recorded_at))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_stream_start_only_records_real_starts_and_restarts() {
        let mut input: ObsOverlaySetInput = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "slug": "tournament/slug",
            "eventId": "event",
            "setId": "set-a",
            "eventName": "Event",
            "eventAlias": "",
            "roundText": "Round 1",
            "redPlayerName": "Player A",
            "bluePlayerName": "Player B",
            "redSetWins": 0,
            "blueSetWins": 0,
            "fontScale": 1.0
        }))
        .unwrap();
        assert!(input.starts_new_set(None));
        assert!(input.starts_new_set(Some("set-b")));
        assert!(input.starts_new_set(Some("__test__")));
        assert!(!input.starts_new_set(Some("set-a")));
        input.red_set_wins = 1;
        input.red_player_name = "Alias A".to_owned();
        assert!(!input.starts_new_set(Some("set-a")));
        input.enabled = false;
        assert!(!input.starts_new_set(Some("set-a")));
        assert!(!input.starts_new_set(None));
        input.enabled = true;
        assert!(input.starts_new_set(None));
        input.set_id = "__test__".to_owned();
        assert!(!input.starts_new_set(None));
        assert!(!input.starts_new_set(Some("set-a")));
    }

    fn make_call_message(
        event_id: &str,
        set_id: &str,
        message_type: &str,
        parent_message_id: Option<&str>,
        method: &str,
    ) -> FeatureMessage {
        FeatureMessage {
            destination: Some(call_list::DESTINATION.to_owned()),
            message_id: "call-id".to_owned(),
            thread_id: "call-id".to_owned(),
            parent_message_id: parent_message_id.map(str::to_owned),
            message_type: message_type.to_owned(),
            message_meta: Some(serde_json::json!({
                "eventId": event_id,
                "setId": set_id,
            })),
            method: method.to_owned(),
            subject: "Call".to_owned(),
            sender_name: "Player".to_owned(),
            sender_user_id: "12345678".to_owned(),
            sender_ip: "127.0.0.1".to_owned(),
            body: String::new(),
            created_at: "2025-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn active_call_matches_only_unresolved_root_calls_for_the_exact_set() {
        let call = make_call_message("event-1", "set-1", "normal", None, "call_player");

        assert!(active_call_matches_set(&call, "event-1", "set-1"));
        assert!(!active_call_matches_set(&call, "event-2", "set-1"));
        assert!(!active_call_matches_set(&call, "event-1", "set-2"));
        assert!(!active_call_matches_set(
            &make_call_message("event-1", "set-1", "resolve", None, "call_player"),
            "event-1",
            "set-1"
        ));
        assert!(!active_call_matches_set(
            &make_call_message("event-1", "set-1", "normal", Some("parent"), "call_player"),
            "event-1",
            "set-1"
        ));
        assert!(!active_call_matches_set(
            &make_call_message("event-1", "set-1", "normal", None, "other_method"),
            "event-1",
            "set-1"
        ));
    }

    fn make_set(set_id: &str, full_round_text: &str, round: Option<i64>) -> SetSnapshot {
        SetSnapshot {
            set_id: set_id.to_owned(),
            phase_group_id: None,
            identifier: None,
            full_round_text: full_round_text.to_owned(),
            round,
            phase_name: None,
            phase_group_name: None,
            phase_order: None,
            phase_group_display_identifier: None,
            phase_group_set_name: None,
            is_intermediate: false,
            state: 0,
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
            slots: vec![],
        }
    }

    fn make_pending_result(set_id: &str, recorded_at_seconds: i64) -> models::LocalSetResultMeta {
        models::LocalSetResultMeta {
            event_id: "event".to_owned(),
            event_name: "event".to_owned(),
            set_id: set_id.to_owned(),
            winner_id: format!("winner-{set_id}"),
            score_csv: "2-0".to_owned(),
            direct_win: false,
            confirmed: true,
            slot_scores: Vec::new(),
            reset_source_set_id: None,
            recorded_at: chrono::DateTime::<chrono::Utc>::from_timestamp(recorded_at_seconds, 0)
                .unwrap(),
        }
    }

    fn make_slot(entrant_id: Option<&str>, entrant_name: &str) -> models::SetSlotSnapshot {
        models::SetSlotSnapshot {
            entrant_id: entrant_id.map(str::to_owned),
            entrant_name: entrant_name.to_owned(),
            seed_id: None,
            seed_num: None,
            seed_placeholder_name: None,
            seed_origin_phase_group_id: None,
            seed_origin_phase_group_display_identifier: None,
            seed_origin_phase_order: None,
            seed_origin_placement: None,
            seed_origin_order: None,
            score: None,
        }
    }

    #[test]
    fn mobile_set_matchup_readiness_uses_entrant_ids_not_display_names() {
        let slots = vec![
            make_slot(Some("entrant-a"), "Winner of Round 1 Set 1"),
            make_slot(Some("entrant-b"), "TBD"),
        ];

        assert!(mobile_set_has_matchup(&slots));
        assert!(!mobile_set_has_matchup(&[
            make_slot(Some("entrant-a"), "Player A"),
            make_slot(None, "Player B"),
        ]));
        assert!(!mobile_set_has_matchup(&[
            make_slot(Some("entrant-a"), "Player A"),
            make_slot(Some("  "), "Player B"),
        ]));
    }

    #[test]
    fn mobile_set_resolution_assigns_loser_source_entrant() {
        let mut source_set = make_set("source-set", "Winners Round 1", Some(1));
        source_set.winner_id = Some("winner-id".to_owned());
        source_set.slots = vec![
            models::SetSlotSnapshot {
                entrant_id: Some("winner-id".to_owned()),
                entrant_name: "Winner".to_owned(),
                seed_id: None,
                seed_num: None,
                seed_placeholder_name: None,
                seed_origin_phase_group_id: None,
                seed_origin_phase_group_display_identifier: None,
                seed_origin_phase_order: None,
                seed_origin_placement: None,
                seed_origin_order: None,
                score: Some(2.0),
            },
            models::SetSlotSnapshot {
                entrant_id: Some("loser-id".to_owned()),
                entrant_name: "Loser".to_owned(),
                seed_id: None,
                seed_num: None,
                seed_placeholder_name: None,
                seed_origin_phase_group_id: None,
                seed_origin_phase_group_display_identifier: None,
                seed_origin_phase_order: None,
                seed_origin_placement: None,
                seed_origin_order: None,
                score: Some(0.0),
            },
        ];

        let mut losers_set = make_set("losers-set", "Losers Round 1", Some(-1));
        losers_set.entrant2_source = Some(models::SetEntrantSourceSnapshot {
            source_type: Some("set".to_owned()),
            type_id: Some("source-set".to_owned()),
            resolved_set_id: None,
            condition: Some("loser".to_owned()),
            condition_string: Some("Loser of Winners Round 1".to_owned()),
            placeholder_name: None,
            group_seed_num: None,
            seed_num: None,
            placement: None,
            origin_phase_group_id: None,
            origin_phase_group_display_identifier: None,
            origin_phase_order: None,
            origin_placement: None,
        });
        losers_set.slots = vec![
            models::SetSlotSnapshot {
                entrant_id: Some("other-id".to_owned()),
                entrant_name: "Other".to_owned(),
                seed_id: None,
                seed_num: None,
                seed_placeholder_name: None,
                seed_origin_phase_group_id: None,
                seed_origin_phase_group_display_identifier: None,
                seed_origin_phase_order: None,
                seed_origin_placement: None,
                seed_origin_order: None,
                score: None,
            },
            models::SetSlotSnapshot {
                entrant_id: None,
                entrant_name: "Loser of Winners Round 1".to_owned(),
                seed_id: None,
                seed_num: None,
                seed_placeholder_name: None,
                seed_origin_phase_group_id: None,
                seed_origin_phase_group_display_identifier: None,
                seed_origin_phase_order: None,
                seed_origin_placement: None,
                seed_origin_order: None,
                score: None,
            },
        ];

        let event = models::EventSnapshot {
            event_id: "event".to_owned(),
            name: "event".to_owned(),
            phases: Vec::new(),
            phase_groups: Vec::new(),
            sets: vec![source_set, losers_set],
        };

        let resolved = resolve_mobile_set_entrants(&event, "losers-set").unwrap();

        assert_eq!(resolved.slots[1].entrant_id.as_deref(), Some("loser-id"));
        assert_eq!(resolved.slots[1].entrant_name, "Loser");
        assert_eq!(resolved.slots[1].score, None);
    }

    #[test]
    fn mobile_detail_prefers_pending_scores_and_preserves_direct_win() {
        let mut detail = MobileSetDetailItem {
            set_id: "set".to_owned(),
            set_code: "A".to_owned(),
            full_round_text: "Round 1".to_owned(),
            round: Some(1),
            phase_name: None,
            phase_group_name: None,
            state: 2,
            winner_id: None,
            direct_win: false,
            score_edit_locked: true,
            slots: vec![
                MobileSetSlotItem {
                    entrant_id: Some("entrant-1".to_owned()),
                    entrant_name: "Player 1".to_owned(),
                    score: Some(0.0),
                    play_side: None,
                },
                MobileSetSlotItem {
                    entrant_id: Some("entrant-2".to_owned()),
                    entrant_name: "Player 2".to_owned(),
                    score: Some(0.0),
                    play_side: None,
                },
            ],
        };
        let mut pending = make_pending_result("set", 1);
        pending.winner_id = "entrant-1".to_owned();
        pending.slot_scores = vec![
            models::LocalSetScoreMeta {
                entrant_id: "entrant-1".to_owned(),
                score: 3,
            },
            models::LocalSetScoreMeta {
                entrant_id: "entrant-2".to_owned(),
                score: 1,
            },
        ];

        apply_pending_mobile_result(&mut detail, &pending);

        assert!(!detail.direct_win);
        assert_eq!(detail.state, 3);
        assert_eq!(detail.winner_id.as_deref(), Some("entrant-1"));
        assert_eq!(detail.slots[0].score, Some(3.0));
        assert_eq!(detail.slots[1].score, Some(1.0));

        pending.direct_win = true;
        pending
            .slot_scores
            .iter_mut()
            .for_each(|slot| slot.score = 0);
        apply_pending_mobile_result(&mut detail, &pending);

        assert!(detail.direct_win);
        assert_eq!(detail.slots[0].score, None);
        assert_eq!(detail.slots[1].score, None);
    }

    #[test]
    fn confirmed_results_are_sorted_by_phase_then_registration_time() {
        let mut qualifiers = make_set("qualifiers", "Round Robin", Some(1));
        qualifiers.phase_order = Some(1);
        qualifiers.phase_group_id = Some("qualifiers-group".to_owned());
        let mut middle = make_set("middle", "Middle Round", Some(1));
        middle.phase_order = Some(3);
        middle.phase_group_id = Some("middle-group".to_owned());
        let mut finals_first = make_set("finals-first", "Finals Round", Some(1));
        finals_first.phase_order = Some(2);
        finals_first.phase_group_id = Some("finals-group".to_owned());
        let mut finals_second = make_set("finals-second", "Finals Round", Some(2));
        finals_second.phase_order = Some(2);
        finals_second.phase_group_id = Some("finals-group".to_owned());
        let phase_groups: Vec<models::PhaseGroupSnapshot> = serde_json::from_value(
            serde_json::json!([
                { "phaseGroupId": "qualifiers-group", "phaseId": "qualifiers-phase", "phaseOrder": 1 },
                { "phaseGroupId": "middle-group", "phaseId": "middle-phase", "phaseOrder": 3 },
                { "phaseGroupId": "finals-group", "phaseId": "finals-phase", "phaseOrder": 2 }
            ]),
        )
        .expect("test phase groups should deserialize");
        let event = models::EventSnapshot {
            event_id: "event".to_owned(),
            name: "event".to_owned(),
            phases: vec![
                models::PhaseSnapshot {
                    phase_id: "qualifiers-phase".to_owned(),
                    name: Some("Qualifiers".to_owned()),
                    phase_order: Some(1),
                },
                models::PhaseSnapshot {
                    phase_id: "middle-phase".to_owned(),
                    name: Some("Middle".to_owned()),
                    phase_order: Some(3),
                },
                models::PhaseSnapshot {
                    phase_id: "finals-phase".to_owned(),
                    name: Some("Finals".to_owned()),
                    phase_order: Some(2),
                },
            ],
            phase_groups,
            sets: vec![qualifiers, middle, finals_first, finals_second],
        };
        let mut pending = vec![
            make_pending_result("finals-second", 3),
            make_pending_result("middle", 4),
            make_pending_result("qualifiers", 5),
            make_pending_result("finals-first", 2),
        ];

        sort_pending_set_results_by_phase_order(&mut pending, &event);

        assert_eq!(
            pending
                .iter()
                .map(|item| item.set_id.as_str())
                .collect::<Vec<_>>(),
            vec!["qualifiers", "middle", "finals-first", "finals-second"]
        );
    }

    #[test]
    fn grand_final_keeps_losers_after_the_reserved_slot() {
        let mut sets = Vec::new();
        for index in 0..7 {
            sets.push(make_set(
                &format!("W{index}"),
                "Winners Round 1",
                Some(index as i64 + 1),
            ));
        }
        sets.push(make_set("GF", "Grand Final", Some(1)));
        sets.push(make_set("LR1", "Losers Round 1", Some(-1)));

        let codes = build_set_display_code_by_id(&sets);

        assert_eq!(codes.get("GF"), Some(&"H".to_owned()));
        assert_eq!(codes.get("LR1"), Some(&"J".to_owned()));
    }

    #[test]
    fn grand_final_reset_takes_the_reserved_slot_before_losers() {
        let mut sets = Vec::new();
        for index in 0..7 {
            sets.push(make_set(
                &format!("W{index}"),
                "Winners Round 1",
                Some(index as i64 + 1),
            ));
        }
        sets.push(make_set("GF", "Grand Final", Some(1)));
        sets.push(make_set("GFR", "Grand Final Reset", Some(1)));
        sets.push(make_set("LR1", "Losers Round 1", Some(-1)));

        let codes = build_set_display_code_by_id(&sets);

        assert_eq!(codes.get("GF"), Some(&"H".to_owned()));
        assert_eq!(codes.get("GFR"), Some(&"I".to_owned()));
        assert_eq!(codes.get("LR1"), Some(&"J".to_owned()));
    }
}

fn resolve_winner_id_from_slot_scores(
    target_set: &SetSnapshot,
    slot_scores: &[LocalSetScoreInput],
) -> Option<String> {
    let mut known_scores = target_set
        .slots
        .iter()
        .filter_map(|slot| {
            let entrant_id = slot.entrant_id.as_ref()?.clone();
            let score = slot_scores
                .iter()
                .find(|item| item.entrant_id == entrant_id)
                .map(|item| item.score)?;
            Some((entrant_id, score))
        })
        .collect::<Vec<(String, i64)>>();

    if known_scores.len() < 2 {
        return None;
    }

    known_scores.sort_by(|left, right| left.0.cmp(&right.0));

    let dq_loser = known_scores
        .iter()
        .find(|(_, score)| *score < 0)
        .map(|(entrant_id, _)| entrant_id.clone());
    if let Some(loser_id) = dq_loser {
        return known_scores
            .iter()
            .find(|(entrant_id, _)| *entrant_id != loser_id)
            .map(|(entrant_id, _)| entrant_id.clone());
    }

    let mut best: Option<(String, i64)> = None;
    let mut duplicated_top = false;
    for (entrant_id, score) in known_scores {
        match &best {
            None => {
                best = Some((entrant_id, score));
                duplicated_top = false;
            }
            Some((_, best_score)) if score > *best_score => {
                best = Some((entrant_id, score));
                duplicated_top = false;
            }
            Some((_, best_score)) if score == *best_score => {
                duplicated_top = true;
            }
            _ => {}
        }
    }

    if duplicated_top {
        None
    } else {
        best.map(|(entrant_id, _)| entrant_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsOverlaySetInput {
    enabled: bool,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    event_id: String,
    set_id: String,
    event_name: String,
    event_alias: String,
    round_text: String,
    red_player_name: String,
    blue_player_name: String,
    red_set_wins: u32,
    blue_set_wins: u32,
    font_scale: f64,
}

impl ObsOverlaySetInput {
    fn starts_new_set(&self, active_set_id: Option<&str>) -> bool {
        self.enabled && self.set_id.trim() != "__test__" && active_set_id != Some(self.set_id.trim())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsOverlayState {
    active: bool,
    fully_stopped: bool,
    current_set_id: Option<String>,
    event_name: Option<String>,
    event_alias: Option<String>,
    round_text: Option<String>,
    red_player_name: String,
    blue_player_name: String,
    red_set_wins: u32,
    blue_set_wins: u32,
    font_scale: f64,
    name_fit_mode: String,
    show_set_info: bool,
    show_event_alias: bool,
    overlay_url: String,
}

#[derive(Debug, Clone)]
struct ObsOverlayActiveSet {
    set_id: String,
    event_name: String,
    event_alias: String,
    round_text: String,
    red_player_name: String,
    blue_player_name: String,
    red_set_wins: u32,
    blue_set_wins: u32,
    font_scale: f64,
}

#[derive(Debug, Clone)]
struct ObsOverlayRuntimeState {
    active_set: Option<ObsOverlayActiveSet>,
    event_alias: String,
    preview_font_scale: f64,
    name_fit_mode: String,
    show_set_info: bool,
    show_event_alias: bool,
    fully_stopped: bool,
}

fn normalize_name_fit_mode(value: &str) -> &'static str {
    if value.trim().eq_ignore_ascii_case("shrink") {
        "shrink"
    } else {
        "truncate"
    }
}

fn clamp_font_scale(value: f64) -> f64 {
    if !value.is_finite() {
        return 1.0;
    }
    value.clamp(0.6, 2.0)
}

fn overlay_url() -> String {
    format!("http://127.0.0.1:{OBS_OVERLAY_PORT}/overlay")
}

fn snapshot_obs_overlay_state() -> Result<ObsOverlayState, String> {
    let guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    if let Some(active) = &guard.active_set {
        return Ok(ObsOverlayState {
            active: true,
            fully_stopped: false,
            current_set_id: Some(active.set_id.clone()),
            event_name: Some(active.event_name.clone()),
            event_alias: Some(active.event_alias.clone()),
            round_text: Some(active.round_text.clone()),
            red_player_name: active.red_player_name.clone(),
            blue_player_name: active.blue_player_name.clone(),
            red_set_wins: active.red_set_wins,
            blue_set_wins: active.blue_set_wins,
            font_scale: active.font_scale,
            name_fit_mode: guard.name_fit_mode.clone(),
            show_set_info: guard.show_set_info,
            show_event_alias: guard.show_event_alias,
            overlay_url: overlay_url(),
        });
    }

    let preview_font_scale = clamp_font_scale(guard.preview_font_scale);

    Ok(ObsOverlayState {
        active: false,
        fully_stopped: guard.fully_stopped,
        current_set_id: None,
        event_name: None,
        event_alias: Some(guard.event_alias.clone()),
        round_text: None,
        red_player_name: String::new(),
        blue_player_name: String::new(),
        red_set_wins: 0,
        blue_set_wins: 0,
        font_scale: preview_font_scale,
        name_fit_mode: guard.name_fit_mode.clone(),
        show_set_info: guard.show_set_info,
        show_event_alias: guard.show_event_alias,
        overlay_url: overlay_url(),
    })
}

fn build_overlay_html() -> &'static str {
    r#"<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Savakan OBS Overlay</title>
  <script>
    function applyOverlayLanguage() {
      let language = 'ja';
      try {
        if (localStorage.getItem('savakan.mobile.language') === 'en') language = 'en';
      } catch (_) {}
      document.documentElement.lang = language;
      document.title = language === 'en' ? 'Savakan OBS Overlay' : 'Savakan OBS オーバーレイ';
    }
    applyOverlayLanguage();
    window.addEventListener('storage', applyOverlayLanguage);
    // プレビューモード検出とスケール係数の管理
    const isPreview = new URLSearchParams(window.location.search).has('preview');
        function setContainerScaleBySize(width, height) {
            const w = Number(width);
            const h = Number(height);
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
                return;
            }
            const scale = Math.min(w / 1920, h / 1080);
            if (Number.isFinite(scale) && scale > 0) {
                document.documentElement.style.setProperty('--container-scale', String(scale));
            }
        }

        function setContainerScaleFromViewport() {
            setContainerScaleBySize(window.innerWidth, window.innerHeight);
        }

    if (isPreview) {
            setContainerScaleFromViewport();
            window.addEventListener('resize', () => {
                setContainerScaleFromViewport();
            });

      // 親フレームからのメッセージでコンテナ幅を受け取る
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'preview-container-width') {
                    setContainerScaleBySize(event.data.width, event.data.height);
        }
      });
    }
  </script>
    <style>
        @font-face {
            font-family: "SavakanOverlayJP";
            src:
                local("BIZ UDPGothic"),
                local("Yu Gothic UI"),
                local("Yu Gothic"),
                local("Meiryo UI"),
                local("Meiryo"),
                local("Noto Sans CJK JP"),
                local("Noto Sans JP"),
                local("Hiragino Kaku Gothic ProN"),
                local("MS PGothic");
            font-style: normal;
            font-display: swap;
        }
        :root {
            --container-scale: 1;
            --scale: 1;
            --name-size: calc(56px * var(--scale) * var(--container-scale));
            --count-size: calc(54px * var(--scale) * var(--container-scale));
            --set-main-size: calc(32px * var(--container-scale));
            --set-sub-size: calc(28px * var(--container-scale));
        }
        html, body {
            margin: 0;
            width: 1920px;
            height: 1080px;
            overflow: hidden;
            background: transparent;
            font-family: "SavakanOverlayJP", "Yu Gothic UI", "Meiryo", sans-serif;
        }
        .stage {
            width: calc(1920px * var(--container-scale));
            height: calc(1080px * var(--container-scale));
            position: relative;
            background: transparent;
        }
        .hud {
            position: absolute;
            top: calc(6px * var(--container-scale));
            left: 50%;
            transform: translateX(-50%);
            width: min(calc(1800px * var(--container-scale)), calc(100% - calc(36px * var(--container-scale))));
            display: grid;
            grid-template-columns: 2.22fr 0.48fr 1.30fr 0.48fr 2.22fr;
            align-items: start;
            gap: calc(16px * var(--container-scale));
            pointer-events: none;
        }
        .hud.hide-set-info .set-cell {
            visibility: hidden;
            opacity: 0;
        }
        body.full-stop .hud {
            visibility: hidden;
            opacity: 0;
        }
        .cell {
            display: grid;
            gap: 0;
            color: #fff;
            text-shadow:
                calc(-2px * var(--container-scale)) calc(-2px * var(--container-scale)) 0 rgba(0, 0, 0, 0.76),
                calc(2px * var(--container-scale)) calc(-2px * var(--container-scale)) 0 rgba(0, 0, 0, 0.76),
                calc(-2px * var(--container-scale)) calc(2px * var(--container-scale)) 0 rgba(0, 0, 0, 0.76),
                calc(2px * var(--container-scale)) calc(2px * var(--container-scale)) 0 rgba(0, 0, 0, 0.76),
                0 0 calc(14px * var(--container-scale)) rgba(0, 0, 0, 0.5);
        }
        .plate {
            min-height: calc(83px * var(--container-scale));
            border-radius: calc(12px * var(--container-scale));
            border: calc(2px * var(--container-scale)) solid rgba(255, 255, 255, 0.32);
            display: grid;
            align-items: center;
            padding: calc(10px * var(--container-scale)) calc(14px * var(--container-scale));
            box-sizing: border-box;
            backdrop-filter: blur(calc(2px * var(--container-scale)));
        }
        .plate-p1 {
            background: linear-gradient(180deg, rgba(185, 28, 28, 0.86), rgba(127, 29, 29, 0.84));
        }
        .plate-p2 {
            background: linear-gradient(180deg, rgba(30, 64, 175, 0.86), rgba(30, 58, 138, 0.84));
        }
        .plate-set {
            background: linear-gradient(180deg, rgba(75, 85, 99, 0.88), rgba(55, 65, 81, 0.88));
        }
        .player-cell.p1,
        .player-cell.p2 {
            text-align: center;
        }
        .player-cell .plate {
            justify-items: center;
        }
        .score-cell {
            text-align: center;
        }
        .set-cell {
            text-align: center;
        }
        .name {
            font-weight: 900;
            font-size: var(--name-size);
            line-height: 1;
            letter-spacing: 0.02em;
            width: 100%;
            font-family: "SavakanOverlayJP", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        body.fit-shrink .name {
            text-overflow: clip;
        }
        .count {
            font-weight: 900;
            font-size: var(--count-size);
            line-height: 1;
            letter-spacing: 0.02em;
            font-variant-numeric: tabular-nums;
            font-feature-settings: "tnum" 1;
        }
        .set-main {
            font-weight: 900;
            font-size: var(--set-main-size);
            line-height: 1.1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .set-sub {
            margin-top: calc(6px * var(--container-scale));
            font-weight: 800;
            font-size: var(--set-sub-size);
            line-height: 1.05;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-variant-numeric: tabular-nums;
            font-feature-settings: "tnum" 1;
        }
        .event-alias {
            position: absolute;
            left: 33.3333%;
            bottom: calc(12px * var(--container-scale));
            width: 33.3333%;
            box-sizing: border-box;
            padding: calc(7px * var(--container-scale)) calc(14px * var(--container-scale));
            border: calc(2px * var(--container-scale)) solid rgba(255, 255, 255, 0.92);
            border-radius: 0;
            background: rgba(0, 0, 0, 0.88);
            color: #fff;
            font-size: calc(28px * var(--scale) * var(--container-scale));
            font-weight: 800;
            line-height: 1.1;
            text-align: center;
            text-shadow:
                calc(-2px * var(--container-scale)) calc(-2px * var(--container-scale)) 0 rgba(0, 0, 0, 0.76),
                calc(2px * var(--container-scale)) calc(2px * var(--container-scale)) 0 rgba(0, 0, 0, 0.76),
                0 0 calc(14px * var(--container-scale)) rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        body.full-stop .event-alias,
        body.hide-event-alias .event-alias,
        .event-alias:empty {
            display: none;
        }
    </style>
</head>
<body>
  <div class="stage">
    <div id="hud" class="hud">
      <section class="cell player-cell p1">
        <div class="plate plate-p1">
                    <div id="redName" class="name"></div>
        </div>
      </section>
      <section class="cell score-cell">
        <div class="plate plate-p1">
                    <div id="redCount" class="count"></div>
        </div>
      </section>
      <section class="cell set-cell">
        <div class="plate plate-set">
          <div id="setMain" class="set-main">-</div>
          <div id="setSub" class="set-sub">-</div>
        </div>
      </section>
      <section class="cell score-cell">
        <div class="plate plate-p2">
                    <div id="blueCount" class="count"></div>
        </div>
      </section>
      <section class="cell player-cell p2">
        <div class="plate plate-p2">
                    <div id="blueName" class="name"></div>
        </div>
      </section>
    </div>
  </div>
    <div id="eventAlias" class="event-alias"></div>
  <script>
        function toSafeWins(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return 0;
      }
            return Math.min(99, Math.max(0, Math.trunc(n)));
    }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getRenderedLineCount(element) {
            if (!element) {
                return 0;
            }

            const computedStyle = window.getComputedStyle(element);
            const lineHeight = Number.parseFloat(computedStyle.lineHeight);
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
                return 1;
            }

            return Math.max(1, Math.round(element.scrollHeight / lineHeight));
        }

        function alignSlotPlayerNameLines() {
            const nameElements = Array.from(slotRows.querySelectorAll('.slot-player-name'));
            if (nameElements.length < 2) {
                return;
            }

            const lineCounts = nameElements.map((element) => getRenderedLineCount(element));
            const maxLines = Math.max(...lineCounts);
            if (maxLines <= 1 || lineCounts.every((count) => count === maxLines)) {
                return;
            }

            nameElements.forEach((element, index) => {
                const rawName = String(element.getAttribute('data-slot-player-name') || '');
                const missingLines = maxLines - lineCounts[index];
                if (missingLines <= 0) {
                    element.innerHTML = escapeHtml(rawName);
                    return;
                }

                const blankLines = '<br><span class="slot-player-name-pad" aria-hidden="true">&nbsp;</span>'.repeat(missingLines);
                element.innerHTML = `${escapeHtml(rawName)}${blankLines}`;
            });
        }

        function fitNameToPlate(element, text, mode) {
            element.textContent = text;
            element.style.fontSize = '';

            if (mode !== 'shrink' || text === '') {
                return;
            }

            const baseSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
            const available = element.clientWidth;
            const needed = element.scrollWidth;
            if (!Number.isFinite(baseSize) || baseSize <= 0 || available <= 0 || needed <= 0 || needed <= available) {
                return;
            }

            const minScale = 0.58;
            const minSize = baseSize * minScale;
            const safetyPixels = 3;
            const targetWidth = Math.max(1, available - safetyPixels);
            const ratio = targetWidth / needed;
            let nextSize = Math.max(minSize, baseSize * ratio);
            element.style.fontSize = `${nextSize}px`;

            // CJK glyph metrics can leave the final character clipped at exact-fit sizes.
            // Apply a small post-fit reduction until the measured width is safely within bounds.
            let guard = 0;
            while (element.scrollWidth > targetWidth && nextSize > minSize && guard < 10) {
                nextSize = Math.max(minSize, nextSize - 0.35);
                element.style.fontSize = `${nextSize}px`;
                guard += 1;
            }
        }

        function abbreviateSetInfoText(value) {
            return String(value)
                .replace(/\bWinners\b/gi, 'W')
                .replace(/\bWinner\b/gi, 'W')
                .replace(/\bLosers\b/gi, 'L')
                .replace(/\bLoser\b/gi, 'L')
                .trim();
        }

        function fitSetInfoToPlate(element, text) {
            const baseText = String(text || '').trim();
            const abbreviatedText = abbreviateSetInfoText(baseText);

            element.textContent = baseText;
            element.style.fontSize = '';

            if (baseText === '') {
                return;
            }

            const baseSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
            const available = element.clientWidth;
            const needed = element.scrollWidth;
            if (!Number.isFinite(baseSize) || baseSize <= 0 || available <= 0 || needed <= 0) {
                return;
            }

            if (needed <= available) {
                return;
            }

            if (abbreviatedText !== baseText) {
                element.textContent = abbreviatedText;
                element.style.fontSize = '';

                const abbreviatedNeeded = element.scrollWidth;
                if (abbreviatedNeeded <= available) {
                    return;
                }
            }

            const minScale = 0.76;
            const minSize = baseSize * minScale;
            const safetyPixels = 3;
            const targetWidth = Math.max(1, available - safetyPixels);
            const ratio = targetWidth / element.scrollWidth;
            let nextSize = Math.max(minSize, baseSize * ratio);
            element.style.fontSize = `${nextSize}px`;

            let guard = 0;
            while (element.scrollWidth > targetWidth && nextSize > minSize && guard < 10) {
                nextSize = Math.max(minSize, nextSize - 0.35);
                element.style.fontSize = `${nextSize}px`;
                guard += 1;
            }
        }

    async function tick() {
      try {
        const response = await fetch(`/api/overlay-state?ts=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) {
          return;
        }
        const state = await response.json();
        const scale = Number(state.fontScale || 1);
        document.documentElement.style.setProperty('--scale', String(Number.isFinite(scale) ? scale : 1));
        const isActive = Boolean(state.active);
                const isFullyStopped = Boolean(state.fullyStopped);
                const nameFitMode = String(state.nameFitMode || 'shrink').trim().toLowerCase() === 'shrink'
                    ? 'shrink'
                    : 'truncate';
                document.body.classList.toggle('fit-shrink', nameFitMode === 'shrink');
                document.body.classList.toggle('full-stop', isFullyStopped);
                document.body.classList.toggle('hide-event-alias', !Boolean(state.showEventAlias));
                const showSetInfo = Boolean(state.showSetInfo);
                const redName = isActive ? String(state.redPlayerName || '').trim() : '';
                const blueName = isActive ? String(state.bluePlayerName || '').trim() : '';
                const redWins = isActive ? String(toSafeWins(state.redSetWins)) : '';
                const blueWins = isActive ? String(toSafeWins(state.blueSetWins)) : '';
                const roundRaw = isActive ? String(state.roundText || '') : '';
                const lines = roundRaw
                    .split(/\r?\n/)
                    .map((item) => item.trim())
                    .filter((item) => item !== '');
                const setMain = lines[0] || '-';
                const setSub = lines[1] || '-';
            const hud = document.getElementById('hud');
            hud?.classList.toggle('hide-set-info', !showSetInfo);
            const redNameEl = document.getElementById('redName');
            const blueNameEl = document.getElementById('blueName');
            fitNameToPlate(redNameEl, redName, nameFitMode);
            fitNameToPlate(blueNameEl, blueName, nameFitMode);
                document.getElementById('redCount').textContent = redWins;
                document.getElementById('blueCount').textContent = blueWins;
                                fitSetInfoToPlate(document.getElementById('setMain'), setMain);
                fitSetInfoToPlate(document.getElementById('setSub'), setSub);
                document.getElementById('eventAlias').textContent = String(state.eventAlias || '').trim();
      } catch (_err) {
        // ignore and retry.
      }
    }
    tick();
    setInterval(tick, 450);
  </script>
</body>
</html>"#
}

fn handle_obs_overlay_http_request(request: tiny_http::Request) {
    let path = request.url().split('?').next().unwrap_or("/");
    let no_cache_header = Header::from_bytes(
        b"Cache-Control",
        b"no-store, no-cache, must-revalidate, max-age=0",
    )
    .ok();

    if path == "/" || path == "/overlay" {
        let mut response = Response::from_string(build_overlay_html().to_owned());
        if let Ok(header) = Header::from_bytes(b"Content-Type", b"text/html; charset=utf-8") {
            response = response.with_header(header);
        }
        if let Some(header) = no_cache_header.clone() {
            response = response.with_header(header);
        }
        let _ = request.respond(response);
        return;
    }

    if path == "/api/overlay-state" {
        match snapshot_obs_overlay_state() {
            Ok(state) => {
                let payload = serde_json::to_string(&state)
                    .unwrap_or_else(|_| "{\"active\":false,\"overlayUrl\":\"\"}".to_owned());
                let mut response = Response::from_string(payload);
                if let Ok(header) =
                    Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8")
                {
                    response = response.with_header(header);
                }
                if let Some(header) = no_cache_header.clone() {
                    response = response.with_header(header);
                }
                let _ = request.respond(response);
            }
            Err(err) => {
                let mut response = Response::from_string(format!(
                    "{{\"error\":\"{}\"}}",
                    err.replace('"', "\\\"")
                ));
                if let Ok(header) =
                    Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8")
                {
                    response = response.with_header(header);
                }
                if let Some(header) = no_cache_header {
                    response = response.with_header(header);
                }
                let _ = request.respond(response.with_status_code(500));
            }
        }
        return;
    }

    let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
}

fn start_obs_overlay_server_if_needed() -> Result<(), String> {
    if obs_overlay_server_running().load(Ordering::SeqCst) {
        return Ok(());
    }

    let server = Server::http(format!("0.0.0.0:{OBS_OVERLAY_PORT}"))
        .map_err(|e| format!("OBSオーバーレイWebサーバーの起動に失敗しました: {e}"))?;

    obs_overlay_server_running().store(true, Ordering::SeqCst);

    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_obs_overlay_http_request(request);
        }

        obs_overlay_server_running().store(false, Ordering::SeqCst);
    });

    Ok(())
}

fn generate_mobile_input_token() -> String {
    let seq = message_id_sequence().fetch_add(1, Ordering::SeqCst);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("m{}{:x}", now, seq)
}

fn rotate_mobile_input_token() -> Result<String, String> {
    let mut guard = mobile_input_auth_token()
        .lock()
        .map_err(|_| "スマートフォン入力トークンのロック取得に失敗しました。".to_owned())?;
    let token = generate_mobile_input_token();
    *guard = token.clone();
    Ok(token)
}

fn current_mobile_input_token() -> Result<String, String> {
    let guard = mobile_input_auth_token()
        .lock()
        .map_err(|_| "スマートフォン入力トークンのロック取得に失敗しました。".to_owned())?;
    Ok(guard.clone())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0_usize;

    while index < bytes.len() {
        let b = bytes[index];
        if b == b'+' {
            output.push(b' ');
            index += 1;
            continue;
        }

        if b == b'%' && index + 2 < bytes.len() {
            let hi = bytes[index + 1] as char;
            let lo = bytes[index + 2] as char;
            if hi.is_ascii_hexdigit() && lo.is_ascii_hexdigit() {
                let text = [hi, lo].iter().collect::<String>();
                if let Ok(hex) = u8::from_str_radix(&text, 16) {
                    output.push(hex);
                    index += 3;
                    continue;
                }
            }
        }

        output.push(b);
        index += 1;
    }

    String::from_utf8_lossy(&output).to_string()
}

fn query_param_from_url(url: &str, key: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        if pair.trim().is_empty() {
            continue;
        }

        let mut parts = pair.splitn(2, '=');
        let raw_key = parts.next().unwrap_or_default();
        let raw_value = parts.next().unwrap_or_default();
        let decoded_key = percent_decode(raw_key);

        if decoded_key == key {
            return Some(percent_decode(raw_value));
        }
    }

    None
}

fn mobile_input_html() -> String {
    r#"<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Savakan Mobile Input</title>
    <script>/* MOBILE_LOCALIZATION */</script>
    <style>
        :root {
            --bg: #f7f7f5;
            --panel: #ffffff;
            --line: #d6d9df;
            --ink: #111827;
            --muted: #5b6471;
            --accent: #0f766e;
            --accent-2: #0e7490;
            --shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: "Noto Sans JP", "Yu Gothic UI", sans-serif;
            color: var(--ink);
            background: radial-gradient(circle at 100% 0%, #d1fae5 0%, rgba(209, 250, 229, 0) 45%),
                                    linear-gradient(180deg, #f0fdf4 0%, var(--bg) 28%);
            min-height: 100vh;
            padding: 14px;
        }
        .card {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 14px;
            box-shadow: var(--shadow);
            padding: 12px;
        }
        h1 {
            margin: 0 0 8px;
            font-size: 1.06rem;
        }
        .meta {
            margin: 0;
            color: var(--muted);
            font-size: 0.82rem;
        }
        .checkbox-row {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 0.45rem;
            font-size: 0.82rem;
            color: var(--ink);
        }
        .checkbox-row input {
            width: auto;
            margin: 0;
        }
        .row {
            display: grid;
            gap: 8px;
            margin-top: 10px;
        }
        input, button, select, textarea {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 10px;
            font: inherit;
            background: #fff;
        }
        button {
            background: linear-gradient(90deg, var(--accent), var(--accent-2));
            border: none;
            color: #fff;
            font-weight: 700;
        }
        .set-list {
            margin-top: 10px;
            display: grid;
            gap: 8px;
            max-height: 50vh;
            overflow: auto;
        }
        .set-item {
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 10px;
            background: #fff;
        }
        .set-item h2 {
            margin: 0;
            font-size: 0.94rem;
        }
        .players {
            margin: 8px 0 0;
            padding-left: 18px;
            color: #1f2937;
        }
        .detail-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .detail-close {
            width: auto;
            min-width: 6.5rem;
            padding: 8px 10px;
            background: #e2e8f0;
            color: #0f172a;
            border: 1px solid #cbd5e1;
        }
        .detail-head-actions {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .detail {
            margin-top: 12px;
            border-top: 1px solid var(--line);
            padding-top: 12px;
        }
        .detail-title-row {
            display: flex;
            align-items: baseline;
            gap: 8px;
            flex-wrap: wrap;
        }
        .detail-set-id {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 999px;
            background: #e2e8f0;
            color: #0f172a;
            font-size: 0.72rem;
            font-weight: 700;
        }
        .detail-head-actions-row {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .detail-head-actions-row button {
            flex: 1;
        }
        .side-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .side-actions button {
            flex: 1;
        }
        .overlay-button-row {
            display: flex;
            gap: 0.5rem;
            flex-wrap: nowrap;
        }
        .overlay-button-row button {
            flex: 1 1 0;
            min-width: 0;
        }
        .slot-row {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            margin-top: 8px;
            align-items: stretch;
        }
        .player-card {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 8px;
            border: 1px solid rgba(148, 163, 184, 0.7);
            border-radius: 10px;
            background: rgba(15, 23, 42, 0.02);
            min-width: 0;
            width: 100%;
            box-sizing: border-box;
        }
        .player-card.side-1p {
            border-color: #fca5a5;
            background: #fef2f2;
        }
        .player-card.side-2p {
            border-color: #93c5fd;
            background: #eff6ff;
        }
        .player-card.side-1p .slot-side-label {
            color: #b91c1c;
        }
        .player-card.side-2p .slot-side-label {
            color: #1d4ed8;
        }
        .player-card.score-high,
        .player-card.score-high .slot-player-name,
        .player-card.score-high .set-score-input {
            color: #15803d;
        }
        .player-top {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 4px;
            min-height: 2rem;
            width: 100%;
            min-width: 0;
        }
        .player-card.call-active {
            opacity: 0.5;
        }
        .player-top-head {
            width: 100%;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            min-width: 0;
        }
        .slot-side-label {
            font-size: 0.68rem;
            font-weight: 700;
            color: var(--muted);
            letter-spacing: 0.04em;
            text-transform: uppercase;
            flex-shrink: 0;
        }
        .slot-player-name {
            display: block;
            width: 100%;
            min-width: 0;
            max-width: 100%;
            font-weight: 700;
            line-height: 1.25;
            font-size: clamp(0.62rem, 3.2vw, 0.9rem);
            overflow-wrap: anywhere;
            word-break: break-word;
            white-space: normal;
            text-wrap: pretty;
        }
        .slot-player-name-pad {
            display: inline-block;
            width: 0;
        }
        .slot-side-picker {
            display: none;
        }
        .player-controls {
            display: grid;
            grid-template-columns: 1fr;
            gap: 6px;
        }
        .score-step-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }
        .score-step-btn {
            width: 100%;
            min-width: 0;
            padding: 6px 0;
            font-weight: 700;
        }
        .set-score-input {
            width: 100%;
            min-width: 0;
            text-align: center;
        }
        .win-btn {
            width: 100%;
            padding: 8px;
            background: #ecfdf5;
            border: 1px solid #6ee7b7;
            color: #047857;
            font-weight: 700;
        }
        .direct-score-label {
            display: block;
            padding: 8px;
            border: 1px solid #86efac;
            background: #f0fdf4;
            color: #166534;
            font-weight: 800;
            text-align: center;
        }
        .slot-lock-note {
            color: var(--muted);
            font-size: 0.78rem;
            justify-self: end;
        }
        .player-card .dq-btn {
            width: auto;
            min-width: 3rem;
            padding: 8px;
            background: #fff7ed;
            border: 1px solid #fdba74;
            color: #9a3412;
            font-weight: 700;
        }
        .player-top-head .dq-btn {
            min-width: 0;
            padding: 4px 8px;
            font-size: 0.74rem;
            line-height: 1.2;
        }
        .detail-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 10px;
        }
        .status {
            margin-top: 8px;
            color: #14532d;
            font-size: 0.82rem;
            min-height: 1.3em;
        }
        .status-sub {
            margin-top: 2px;
            color: var(--muted);
            font-size: 0.76rem;
            min-height: 1.2em;
        }
        button:disabled,
        input:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <section class="card">
        <label class="checkbox-row">
            <span data-i18n="language">言語</span>
            <select id="mobileLanguage" aria-label="言語" style="width: auto;">
                <option value="ja">日本語</option>
                <option value="en">English</option>
            </select>
        </label>
        <h1 id="pageTitle">スマートフォン結果入力依頼</h1>
        <p id="scopeLabel" class="meta">読み込み中...</p>

        <div id="searchView">
            <div class="row">
                <input id="searchBox" placeholder="Set名 / ラウンド / プレイヤー名で検索" />
                <button id="searchBtn" type="button" data-i18n="search">検索</button>
            </div>
            <label class="checkbox-row">
                <input id="matchupReadyOnlyCheckbox" type="checkbox" checked />
                <span data-i18n="inputtableOnly">入力可能な試合のみ</span>
            </label>

            <div id="setList" class="set-list"></div>
        </div>

        <div id="detailBox" class="detail" hidden>
            <div class="detail-head">
                <div class="detail-title-row">
                    <h2 id="detailRound" style="margin: 0;"></h2>
                    <span id="detailSetId" class="detail-set-id"></span>
                </div>
            </div>
            <p id="detailPhasePool" class="meta" style="margin-top: 4px;"></p>
            <p id="detailMeta" class="meta" style="margin-top: 4px;"></p>
            <p id="callStatusLabel" class="meta" style="margin-top: 4px;" role="status" aria-live="polite"></p>
            <label class="checkbox-row">
                <input id="onePOnTopCheckbox" type="checkbox" checked />
                <span data-i18n="onePLeft">1Pを左に表示</span>
            </label>

            <div id="sideActions" class="side-actions">
                <button id="swapSideBtn" type="button" data-i18n="swapSides">1P/2P入替</button>
                <button id="randomSideBtn" type="button" data-i18n="random">ランダム</button>
            </div>

            <div class="detail-head-actions-row">
                <button id="refreshDetailBtn" class="detail-close" type="button" data-i18n="refresh">情報取得</button>
                <button id="discardBtn" type="button" class="detail-close" data-i18n="discard">下書きを破棄</button>
            </div>

            <div class="detail-head-actions-row">
                <button id="closeDetailBtn" class="detail-close" type="button" data-i18n="back">一覧へ戻る</button>
            </div>

            <div id="overlayBox" class="row" hidden>
                <p id="overlayStatus" class="meta"></p>
                <div class="overlay-button-row">
                    <button id="overlayToggleBtn" type="button">配信開始</button>
                    <button id="resolveCallsBtn" type="button" data-i18n="resolveCalls">呼出解決</button>
                    <button id="overlayStopBtn" type="button" data-i18n="stopCompletely" style="background: #e2e8f0; color: #0f172a; border-color: #cbd5e1;">完全停止</button>
                </div>
            </div>

            <div id="slotRows"></div>

            <div class="detail-actions">
                <button id="updateBtn" type="button" data-i18n="update">更新</button>
                <button id="confirmBtn" type="button" data-i18n="confirm">確定</button>
            </div>
            <p id="submitStatus" class="status"></p>
            <p id="randomActionTime" class="status-sub"></p>
        </div>
    </section>

    <script>
        const params = new URLSearchParams(location.search);
        const token = params.get('token') || '';
        const slug = params.get('slug') || '';
        const eventId = params.get('eventId') || '';
        const pollMsRaw = params.get('pollMs') || '';

        function normalizePollMs(raw) {
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) {
                return 1500;
            }
            const rounded = Math.trunc(parsed);
            if (rounded < 500) {
                return 500;
            }
            if (rounded > 10000) {
                return 10000;
            }
            return rounded;
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getRenderedLineCount(element) {
            if (!element) {
                return 0;
            }

            const computedStyle = window.getComputedStyle(element);
            const lineHeight = Number.parseFloat(computedStyle.lineHeight);
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
                return 1;
            }

            return Math.max(1, Math.round(element.scrollHeight / lineHeight));
        }

        function alignSlotPlayerNameLines() {
            const nameElements = Array.from(slotRows.querySelectorAll('.slot-player-name'));
            if (nameElements.length < 2) {
                return;
            }

            const lineCounts = nameElements.map((element) => getRenderedLineCount(element));
            const maxLines = Math.max(...lineCounts);
            if (maxLines <= 1 || lineCounts.every((count) => count === maxLines)) {
                return;
            }

            nameElements.forEach((element, index) => {
                const rawName = String(element.getAttribute('data-slot-player-name') || '');
                const missingLines = maxLines - lineCounts[index];
                if (missingLines <= 0) {
                    element.innerHTML = escapeHtml(rawName);
                    return;
                }

                const blankLines = '<br><span class="slot-player-name-pad" aria-hidden="true">&nbsp;</span>'.repeat(missingLines);
                element.innerHTML = `${escapeHtml(rawName)}${blankLines}`;
            });
        }

        const autoRefreshMs = normalizePollMs(pollMsRaw);
        const pageTitle = document.getElementById('pageTitle');
        const scopeLabel = document.getElementById('scopeLabel');
        const searchView = document.getElementById('searchView');
        const searchBox = document.getElementById('searchBox');
        const matchupReadyOnlyCheckbox = document.getElementById('matchupReadyOnlyCheckbox');
        const setList = document.getElementById('setList');
        const detailBox = document.getElementById('detailBox');
        const closeDetailBtn = document.getElementById('closeDetailBtn');
        const refreshDetailBtn = document.getElementById('refreshDetailBtn');
        const detailRound = document.getElementById('detailRound');
        const detailSetId = document.getElementById('detailSetId');
        const detailPhasePool = document.getElementById('detailPhasePool');
        const detailMeta = document.getElementById('detailMeta');
        const callStatusLabel = document.getElementById('callStatusLabel');
        const onePOnTopCheckbox = document.getElementById('onePOnTopCheckbox');
        const sideActions = document.getElementById('sideActions');
        const swapSideBtn = document.getElementById('swapSideBtn');
        const randomSideBtn = document.getElementById('randomSideBtn');
        const overlayBox = document.getElementById('overlayBox');
        const overlayStatus = document.getElementById('overlayStatus');
        const overlayToggleBtn = document.getElementById('overlayToggleBtn');
        const overlayStopBtn = document.getElementById('overlayStopBtn');
        const resolveCallsBtn = document.getElementById('resolveCallsBtn');
        const slotRows = document.getElementById('slotRows');
        const discardBtn = document.getElementById('discardBtn');
        const updateBtn = document.getElementById('updateBtn');
        const confirmBtn = document.getElementById('confirmBtn');
        const submitStatus = document.getElementById('submitStatus');
        const randomActionTime = document.getElementById('randomActionTime');
        let selectedSet = null;
        let overlayState = null;
        let selectedSetCallStatus = null;
        let mobileEventAlias = '';
        let eventInfoPromise = Promise.resolve();
        let callStatusRequestInProgress = false;
        let displayOnePOnTop = true;
        let mobileSideDrafts = {};
        let directWinnerId = null;
        let shouldRefreshSetListOnReturn = false;

        function updateHeaderInfo(info) {
            const eventAlias = (info && info.eventAlias && info.eventAlias.trim()) || '';
            // Keep the existing payload fallback independent of the display language.
            mobileEventAlias = eventAlias || mobileMessages.title[0];
            const tournamentName = (info && info.tournamentName && info.tournamentName.trim()) || '-';
            const eventName = (info && info.eventName && info.eventName.trim()) || '-';
            if (pageTitle) {
                const useDefaultTitle = !eventAlias || Boolean(info?.eventAliasIsDefault);
                setLocalizedText(pageTitle, useDefaultTitle ? 'title' : '');
                if (!useDefaultTitle) pageTitle.textContent = eventAlias;
            }
            if (scopeLabel) {
                setLocalizedText(scopeLabel, '');
                scopeLabel.textContent = `${tournamentName} / ${eventName}`;
            }
        }

        async function fetchEventInfo() {
            const url = `/mobile/api/event-meta?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) {
                    updateHeaderInfo(null);
                    return;
                }
                const info = await response.json();
                updateHeaderInfo(info);
            } catch (error) {
                updateHeaderInfo(null);
            }
        }

        function showSearchView() {
            const shouldRefresh = shouldRefreshSetListOnReturn;
            shouldRefreshSetListOnReturn = false;

            if (searchView) {
                searchView.hidden = false;
            }
            if (detailBox) {
                detailBox.hidden = true;
            }
            if (overlayBox) {
                overlayBox.hidden = true;
            }
            setLocalizedText(submitStatus, '');

            if (shouldRefresh) {
                void fetchSets();
            }
        }

        function showDetailView() {
            if (searchView) {
                searchView.hidden = true;
            }
            if (detailBox) {
                detailBox.hidden = false;
            }
            if (overlayBox) {
                overlayBox.hidden = false;
            }
        }

        async function fetchSetCallStatus() {
            if (!selectedSet) {
                throw new Error(t('selectSet'));
            }
            const url = `/mobile/api/sets/${encodeURIComponent(selectedSet.setId)}/calls?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            return await response.json();
        }

        function hasActiveSetCalls() {
            return Boolean(selectedSetCallStatus
                && (selectedSetCallStatus.ownCallCount > 0 || selectedSetCallStatus.otherCallCount > 0));
        }

        function isEntrantCalled(entrantId) {
            const callingEntrantIds = selectedSetCallStatus?.callingEntrantIds || [];
            return callingEntrantIds.some((calledEntrantId) => String(calledEntrantId) === String(entrantId));
        }

        function updateSetCallControls() {
            const hasActiveCalls = hasActiveSetCalls();
            if (callStatusLabel) {
                const callingPlayers = selectedSetCallStatus?.callingPlayers || [];
                setLocalizedText(callStatusLabel, !selectedSetCallStatus && selectedSet
                    ? 'callsUnknown' : hasActiveCalls ? 'calling' : '', {
                        players: () => callingPlayers.length > 0 ? callingPlayers.join(' / ') : t('unknownPlayer'),
                    });
            }
            if (resolveCallsBtn) {
                const completed = isCompletedSet(selectedSet);
                resolveCallsBtn.hidden = completed || !hasActiveCalls;
                resolveCallsBtn.disabled = !selectedSetCallStatus || !hasActiveCalls || completed;
                setLocalizedText(resolveCallsBtn, completed
                    ? 'completedCalls'
                    : selectedSetCallStatus && selectedSetCallStatus.otherCallCount > 0
                        ? 'otherCallsHint'
                        : '', {}, 'title');
            }
            if (overlayToggleBtn) {
                overlayToggleBtn.hidden = !selectedSetCallStatus || hasActiveCalls;
            }
            if (overlayStopBtn) {
                overlayStopBtn.hidden = !selectedSetCallStatus || hasActiveCalls;
            }
            applySetCallInputLock();

            if (detailMeta && isCompletedSet(selectedSet) && hasActiveCalls) {
                setLocalizedText(detailMeta, 'completedCalls');
            }

            if (!overlayToggleBtn || !selectedSet) {
                return;
            }
            const currentSetId = overlayState && overlayState.currentSetId
                ? String(overlayState.currentSetId)
                : '';
            const isCurrent = Boolean(overlayState && overlayState.active
                && currentSetId === String(selectedSet.setId));
            if (!isCurrent) {
                overlayToggleBtn.disabled = !selectedSetCallStatus || Boolean(hasActiveCalls);
            }
        }

        function applySetCallInputLock() {
            const callsActive = hasActiveSetCalls();
            const callStatusUnknown = Boolean(selectedSet && !selectedSetCallStatus);
            const callInputLocked = callsActive || callStatusUnknown;
            const completed = isCompletedSet(selectedSet);
            const scoreEditLocked = Boolean(selectedSet?.scoreEditLocked);
            const matchupReady = isMatchupReady(selectedSet);
            if (discardBtn) {
                discardBtn.disabled = callInputLocked || completed || scoreEditLocked || !matchupReady;
            }
            if (updateBtn) {
                updateBtn.disabled = callInputLocked || completed || scoreEditLocked || !matchupReady;
            }
            if (confirmBtn) {
                confirmBtn.disabled = callInputLocked || completed || scoreEditLocked || !matchupReady;
            }
            if (swapSideBtn) {
                swapSideBtn.disabled = callInputLocked || completed || !matchupReady;
            }
            if (randomSideBtn) {
                randomSideBtn.disabled = callInputLocked || completed || !matchupReady;
            }
            if (slotRows) {
                for (const card of slotRows.querySelectorAll('[data-side-entrant-id]')) {
                    card.classList.toggle('call-active', isEntrantCalled(card.getAttribute('data-side-entrant-id')));
                }
                for (const control of slotRows.querySelectorAll('button, input')) {
                    if (!Object.prototype.hasOwnProperty.call(control.dataset, 'callBaseDisabled')) {
                        control.dataset.callBaseDisabled = String(control.disabled);
                    }
                    control.disabled = callInputLocked || control.dataset.callBaseDisabled === 'true';
                }
            }
        }

        async function refreshSetCallStatus() {
            if (callStatusRequestInProgress) {
                return selectedSetCallStatus;
            }
            selectedSetCallStatus = null;
            updateSetCallControls();
            callStatusRequestInProgress = true;
            try {
                selectedSetCallStatus = await fetchSetCallStatus();
                updateSetCallControls();
                return selectedSetCallStatus;
            } catch (error) {
                updateSetCallControls();
                setLocalizedText(submitStatus, 'callCheckFailed', { error: () => mobileErrorDetail(error?.message || String(error)) });
                return null;
            } finally {
                callStatusRequestInProgress = false;
            }
        }

        async function pollSetCallStatus() {
            if (!selectedSet || !detailBox || detailBox.hidden || callStatusRequestInProgress) {
                return;
            }
            const pollingSetId = String(selectedSet.setId);
            callStatusRequestInProgress = true;
            try {
                const status = await fetchSetCallStatus();
                if (selectedSet && String(selectedSet.setId) === pollingSetId) {
                    selectedSetCallStatus = status;
                    updateSetCallControls();
                }
            } catch (error) {
                if (selectedSet && String(selectedSet.setId) === pollingSetId) {
                    selectedSetCallStatus = null;
                    updateSetCallControls();
                    setLocalizedText(submitStatus, 'callCheckFailed', { error: () => mobileErrorDetail(error?.message || String(error)) });
                }
            } finally {
                callStatusRequestInProgress = false;
            }
        }

        async function resolveSetCallsFromDetail() {
            if (!selectedSet) {
                return;
            }
            if (isCompletedSet(selectedSet)) {
                setLocalizedText(submitStatus, 'completedCalls');
                return;
            }
            try {
                const callStatus = await refreshSetCallStatus();
                if (!callStatus) {
                    return;
                }
                if (callStatus.otherCallCount > 0) {
                    setLocalizedText(submitStatus, 'otherCalls');
                    window.alert(t('otherCalls'));
                    return;
                }
                if (callStatus.ownCallCount === 0) {
                    setLocalizedText(submitStatus, 'noCalls');
                    return;
                }
                if (!window.confirm(t('resolveConfirm', { count: callStatus.ownCallCount }))) {
                    return;
                }

                const resolveUrl = `/mobile/api/sets/${encodeURIComponent(selectedSet.setId)}/resolve-calls?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
                const response = await fetch(resolveUrl, { method: 'POST' });
                if (!response.ok) {
                    const text = await response.text();
                    setLocalizedText(submitStatus, 'resolveFailed', { error: () => mobileErrorDetail(text) });
                    return;
                }

                const latestStatus = await refreshSetCallStatus();
                if (latestStatus && latestStatus.ownCallCount === 0 && latestStatus.otherCallCount === 0) {
                    setLocalizedText(submitStatus, 'callsResolved');
                } else if (latestStatus) {
                    setLocalizedText(submitStatus, latestStatus.otherCallCount > 0 ? 'otherCalls' : 'callsRemain');
                }
            } catch (error) {
                setLocalizedText(submitStatus, 'resolveFailed', { error: () => mobileErrorDetail(error?.message || String(error)) });
            }
        }

        async function resolveCallsBeforeSetAction(actionKey) {
            if (!selectedSet) {
                setLocalizedText(submitStatus, 'selectSet');
                return false;
            }

            try {
                const callStatus = await fetchSetCallStatus();
                if (callStatus.otherCallCount > 0) {
                    const values = { action: () => t(actionKey) };
                    setLocalizedText(submitStatus, 'otherCallsBlock', values);
                    window.alert(t('otherCallsBlock', values));
                    return false;
                }
                if (callStatus.ownCallCount === 0) {
                    return true;
                }

                const shouldResolve = window.confirm(
                    t('resolveBeforeAction', { count: callStatus.ownCallCount, action: t(actionKey) }),
                );
                if (!shouldResolve) {
                    return false;
                }

                const resolveUrl = `/mobile/api/sets/${encodeURIComponent(selectedSet.setId)}/resolve-calls?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
                const resolveResponse = await fetch(resolveUrl, { method: 'POST' });
                if (!resolveResponse.ok) {
                    throw new Error(await resolveResponse.text());
                }

                const latestStatus = await fetchSetCallStatus();
                selectedSetCallStatus = latestStatus;
                updateSetCallControls();
                if (latestStatus.ownCallCount > 0 || latestStatus.otherCallCount > 0) {
                    const messageKey = latestStatus.otherCallCount > 0 ? 'otherCalls' : 'callsRemain';
                    setLocalizedText(submitStatus, messageKey);
                    window.alert(t(messageKey));
                    return false;
                }
                return true;
            } catch (error) {
                setLocalizedText(submitStatus, 'callCheckBeforeFailed', {
                    action: () => t(actionKey),
                    error: () => mobileErrorDetail(error?.message || String(error)),
                });
                return false;
            }
        }

        async function discardMobileDrafts() {
            if (!selectedSet) {
                return;
            }

            setLocalizedText(submitStatus, 'discarding');

            const url = `/mobile/api/sets/${encodeURIComponent(selectedSet.setId)}/discard?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
            const res = await fetch(url, {
                method: 'POST',
            });

            if (!res.ok) {
                const text = await res.text();
                setLocalizedText(submitStatus, 'discardFailed', { error: () => mobileErrorDetail(text) });
                return;
            }

            const detail = await res.json();
            selectedSet = detail;
            directWinnerId = detail.directWin && detail.winnerId ? String(detail.winnerId) : null;
            setLocalizedText(detailMeta, '');
            detailSetId.textContent = getDisplaySetLabel(detail);
            mobileSideDrafts = buildMobileSideDraftsFromDetail(detail);
            renderDetailSlots(detail);
            await refreshOverlayState();
            shouldRefreshSetListOnReturn = true;
            setLocalizedText(submitStatus, 'discarded');
        }

        function normalizeScoreValue(score) {
            if (score === null || score === undefined) {
                return null;
            }

            const text = String(score).trim();
            if (text === '') {
                return null;
            }
            if (/^dq$/i.test(text)) {
                return -1;
            }

            const parsed = Number(text);
            if (!Number.isFinite(parsed)) {
                return null;
            }
            return Math.trunc(parsed);
        }

        function formatScoreInputValue(score) {
            const normalized = normalizeScoreValue(score);
            if (normalized === -1) {
                return 'DQ';
            }
            if (normalized === null) {
                return '';
            }
            return String(normalized);
        }

        function nextScoreAfterStep(currentValue, adjust) {
            const current = normalizeScoreValue(currentValue);
            const base = current === null ? 0 : current;
            const next = base + adjust;
            if (next < 0) {
                return 0;
            }
            return next;
        }

        function normalizeManualScoreInput(value) {
            const raw = String(value ?? '').trim();
            if (raw === '') {
                return '';
            }
            if (/^dq$/i.test(raw)) {
                return 'DQ';
            }

            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) {
                return raw;
            }
            if (parsed <= -1) {
                return 'DQ';
            }
            return String(Math.trunc(parsed));
        }

        function initializeEmptyScoresForStep() {
            const scoreInputs = slotRows.querySelectorAll('[data-score-entrant-id]');
            for (const scoreInput of scoreInputs) {
                const parsed = normalizeScoreValue(scoreInput.value);
                if (parsed === null) {
                    scoreInput.value = '0';
                }
            }
        }

        function buildMobileSideDraftsFromDetail(detail) {
            const slots = Array.isArray(detail?.slots) ? detail.slots.filter((slot) => slot && slot.entrantId) : [];
            const nextDrafts = {};

            for (const slot of slots) {
                const entrantId = slot.entrantId || '';
                const side = String(slot.playSide || '').trim();
                if (entrantId !== '' && (side === '1P' || side === '2P')) {
                    nextDrafts[entrantId] = side;
                }
            }

            if (slots.length >= 2) {
                const unresolvedSlots = slots.filter((slot) => {
                    const entrantId = slot.entrantId || '';
                    return entrantId !== '' && !nextDrafts[entrantId];
                });

                if (unresolvedSlots.length === 2) {
                    const [firstUnresolved, secondUnresolved] = unresolvedSlots;
                    if (firstUnresolved?.entrantId) {
                        nextDrafts[firstUnresolved.entrantId] = '1P';
                    }
                    if (secondUnresolved?.entrantId) {
                        nextDrafts[secondUnresolved.entrantId] = '2P';
                    }
                } else if (unresolvedSlots.length === 1) {
                    const existingSlot = slots.find((slot) => {
                        const entrantId = slot.entrantId || '';
                        return entrantId !== '' && (nextDrafts[entrantId] === '1P' || nextDrafts[entrantId] === '2P');
                    });
                    const existingSide = existingSlot?.entrantId ? nextDrafts[existingSlot.entrantId] : '';
                    const missingEntrantId = unresolvedSlots[0]?.entrantId || '';
                    if (missingEntrantId !== '') {
                        nextDrafts[missingEntrantId] = existingSide === '1P' ? '2P' : '1P';
                    }
                }
            }

            return nextDrafts;
        }

        function getCurrentPlaySideForEntrant(detail, entrantId) {
            if (!entrantId) {
                return '';
            }

            const draftSide = String(mobileSideDrafts[entrantId] || '').trim();
            if (draftSide === '1P' || draftSide === '2P') {
                return draftSide;
            }

            const slots = Array.isArray(detail?.slots) ? detail.slots : [];
            const currentSlot = slots.find((slot) => (slot.entrantId || '') === entrantId);
            const currentSide = String(currentSlot?.playSide || '').trim();
            if (currentSide === '1P' || currentSide === '2P') {
                return currentSide;
            }

            return '';
        }

        function isMatchupReady(detail) {
            const slots = Array.isArray(detail?.slots) ? detail.slots.filter((slot) => slot) : [];
            return slots.length >= 2 && slots.every((slot) => Boolean(slot.entrantId));
        }

        function isCompletedSet(detail) {
            return Number(detail?.state || 0) === 3;
        }

        function isListItemMatchupReady(set) {
            return Boolean(set?.matchupReady);
        }

        function isListItemInputtable(set) {
            if (Boolean(set?.isIntermediate) || Boolean(set?.scoreEditLocked)) {
                return false;
            }
            const isCompleted = Number(set?.state || 0) === 3;
            return isListItemMatchupReady(set) && !isCompleted;
        }

        function getDisplaySetLabel(detail) {
            const setCode = String(detail?.setCode || '').trim();
            if (setCode) {
                return `Set ${setCode}`;
            }

            return detail?.setId ? `Set ${detail.setId}` : 'Set';
        }

        function getOrderedSlots(detail) {
            const slots = Array.isArray(detail?.slots) ? detail.slots.filter((slot) => slot) : [];
            if (slots.length < 2) {
                return slots;
            }

            if (!displayOnePOnTop) {
                return slots;
            }

            const sideRank = (slot) => {
                const entrantId = slot?.entrantId || '';
                const side = getCurrentPlaySideForEntrant(detail, entrantId);
                if (side === '1P') {
                    return 0;
                }
                if (side === '2P') {
                    return 1;
                }
                return 2;
            };

            return slots.slice().sort((left, right) => {
                const leftRank = sideRank(left);
                const rightRank = sideRank(right);
                if (leftRank !== rightRank) {
                    return leftRank - rightRank;
                }
                return slots.indexOf(left) - slots.indexOf(right);
            });
        }

        function applyDisplayOrder(nextOnePOnTop) {
            displayOnePOnTop = nextOnePOnTop;
            if (onePOnTopCheckbox) {
                onePOnTopCheckbox.checked = nextOnePOnTop;
            }
            if (selectedSet) {
                renderDetailSlots(selectedSet);
            }
        }

        function resolveSideForSlot(detail, entrantId, fallbackSlotIndex) {
            const draftSide = String(mobileSideDrafts[entrantId] || '').trim();
            if (draftSide === '1P' || draftSide === '2P') {
                return draftSide;
            }

            const slot = Array.isArray(detail?.slots) ? detail.slots.find((candidate) => (candidate.entrantId || '') === entrantId) : null;
            const savedSide = String(slot?.playSide || '').trim();
            if (savedSide === '1P' || savedSide === '2P') {
                return savedSide;
            }

            return fallbackSlotIndex === 0 ? '1P' : '2P';
        }

        function swapSides() {
            if (!selectedSet || isCompletedSet(selectedSet) || hasActiveSetCalls()) {
                return;
            }

            const slots = Array.isArray(selectedSet.slots) ? selectedSet.slots.filter((slot) => slot && slot.entrantId) : [];
            if (slots.length < 2) {
                return;
            }

            const upper = slots[0];
            const lower = slots[1];
            const upperId = upper.entrantId || '';
            const lowerId = lower.entrantId || '';
            if (!upperId || !lowerId) {
                return;
            }

            const upperCurrent = resolveSideForSlot(selectedSet, upperId, 0);
            const lowerCurrent = resolveSideForSlot(selectedSet, lowerId, 1);

            mobileSideDrafts[upperId] = lowerCurrent;
            mobileSideDrafts[lowerId] = upperCurrent;
            renderDetailSlots(selectedSet);
        }

        function randomizeSides() {
            if (!selectedSet || isCompletedSet(selectedSet) || hasActiveSetCalls()) {
                return;
            }

            const slots = Array.isArray(selectedSet.slots) ? selectedSet.slots.filter((slot) => slot && slot.entrantId) : [];
            if (slots.length < 2) {
                return;
            }

            const upper = slots[0];
            const lower = slots[1];
            const upperId = upper.entrantId || '';
            const lowerId = lower.entrantId || '';
            if (!upperId || !lowerId) {
                return;
            }

            const upperCurrent = resolveSideForSlot(selectedSet, upperId, 0);
            const lowerCurrent = resolveSideForSlot(selectedSet, lowerId, 1);
            const upperIsOneP = Math.random() < 0.5;
            mobileSideDrafts[upperId] = upperIsOneP ? '1P' : '2P';
            mobileSideDrafts[lowerId] = upperIsOneP ? '2P' : '1P';

            if (submitStatus) {
                const changed = mobileSideDrafts[upperId] !== upperCurrent || mobileSideDrafts[lowerId] !== lowerCurrent;
                setLocalizedText(submitStatus, changed ? 'randomChanged' : 'randomUnchanged');
            }
            if (randomActionTime) {
                const now = new Date();
                setLocalizedText(randomActionTime, 'executedAt', {
                    time: () => now.toLocaleTimeString(mobileLanguage === 'en' ? 'en-US' : 'ja-JP', { hour12: false }),
                });
            }

            renderDetailSlots(selectedSet);
        }

        function setEntrantPlaySide(entrantId, playSide) {
            if (!selectedSet || isCompletedSet(selectedSet) || hasActiveSetCalls() || !entrantId) {
                return;
            }

            const normalizedSide = String(playSide || '').trim();
            if (normalizedSide !== '1P' && normalizedSide !== '2P') {
                return;
            }

            mobileSideDrafts = {
                ...mobileSideDrafts,
                [entrantId]: normalizedSide,
            };
            renderDetailSlots(selectedSet);
        }

        function renderDetailSlots(detail) {
            const slots = getOrderedSlots(detail);
            const matchupReady = isMatchupReady(detail);
            const completed = isCompletedSet(detail);
            const scoreEditLocked = Boolean(detail?.scoreEditLocked);
            setLocalizedText(detailMeta, scoreEditLocked
                ? 'poolLockedDetail'
                : completed
                ? 'completedDetail'
                : '');
            const visibleSlots = slots.slice(0, 2);
            const numericScores = matchupReady
                ? visibleSlots.map((slot) => normalizeScoreValue(slot?.score)).filter((value) => value !== null)
                : [];
            const highestScore = numericScores.length > 0 ? Math.max(...numericScores) : null;
            const hasUniqueHighScore = highestScore !== null && numericScores.filter((value) => value === highestScore).length === 1;

            const playerCards = visibleSlots.map((slot, index) => {
                const entrantId = slot?.entrantId || '';
                const hasEntrant = Boolean(entrantId);
                const score = slot?.score ?? '';
                const numericScore = normalizeScoreValue(score);
                const isHigher = matchupReady && hasUniqueHighScore && numericScore !== null && numericScore === highestScore;
                const currentSide = getCurrentPlaySideForEntrant(detail, entrantId);
                const sideLabel = currentSide || (() => {
                    const otherSlots = visibleSlots.filter((candidate) => candidate !== slot);
                    const otherAssignedSide = otherSlots
                        .map((candidate) => getCurrentPlaySideForEntrant(detail, candidate?.entrantId || ''))
                        .find((candidateSide) => candidateSide === '1P' || candidateSide === '2P');
                    if (otherAssignedSide === '1P') {
                        return '2P';
                    }
                    if (otherAssignedSide === '2P') {
                        return '1P';
                    }
                    return displayOnePOnTop ? (index === 0 ? '1P' : '2P') : (index === 0 ? '2P' : '1P');
                })();
                const directWinButton = matchupReady && hasEntrant
                    ? `<button class="win-btn" type="button" data-i18n="${directWinnerId === entrantId ? 'clearWin' : 'win'}" data-win-entrant-id="${entrantId}" ${completed || scoreEditLocked ? 'disabled' : ''}>${t(directWinnerId === entrantId ? 'clearWin' : 'win')}</button>`
                    : '';
                const directScore = directWinnerId && hasEntrant
                    ? (directWinnerId === entrantId ? 'W' : 'L')
                    : null;
                const scoreControls = hasEntrant
                    ? `<div class="player-controls">
                        ${directWinButton}
                        ${directScore ? `<span class="direct-score-label">${directScore}</span>` : `<input class="set-score-input ${isHigher ? 'score-high' : ''}" data-score-entrant-id="${entrantId}" type="text" inputmode="numeric" pattern="-?[0-9]*" min="-1" step="1" value="${formatScoreInputValue(score)}" ${completed || scoreEditLocked ? 'disabled' : ''} />
                        <div class="score-step-row">
                            <button class="score-step-btn" type="button" data-score-adjust="1" data-score-entrant-id="${entrantId}" ${completed || scoreEditLocked || directWinnerId ? 'disabled' : ''}>+</button>
                            <button class="score-step-btn" type="button" data-score-adjust="-1" data-score-entrant-id="${entrantId}" ${completed || scoreEditLocked || directWinnerId ? 'disabled' : ''}>−</button>
                        </div>`}
                        ${scoreEditLocked ? `<span class="slot-lock-note" data-i18n="poolLocked">${t('poolLocked')}</span>` : (completed ? `<span class="slot-lock-note" data-i18n="completedSet">${t('completedSet')}</span>` : (matchupReady ? '' : `<span class="slot-lock-note" data-i18n="matchupPending">${t('matchupPending')}</span>`))}
                    </div>`
                    : `<div class="player-controls"><span class="slot-lock-note" data-i18n="matchupPending">${t('matchupPending')}</span></div>`;
                const dqButton = matchupReady && hasEntrant
                    ? `<button class="dq-btn" type="button" data-dq-entrant-id="${entrantId}" ${completed || scoreEditLocked ? 'disabled' : ''}>DQ</button>`
                    : '';
                const callActiveClass = isEntrantCalled(entrantId) ? 'call-active' : '';
                const sideClass = sideLabel === '1P' ? 'side-1p' : (sideLabel === '2P' ? 'side-2p' : '');
                const escapedEntrantName = escapeHtml(slot?.entrantName || 'TBD');
                return `<div class="player-card ${callActiveClass} ${sideClass} ${isHigher ? 'score-high' : ''}" data-slot-order="${index}" data-side-entrant-id="${entrantId}">
                    <div class="player-top">
                        <div class="player-top-head">
                            <span class="slot-side-label">${sideLabel}</span>
                            ${dqButton}
                        </div>
                        <span class="slot-player-name" data-slot-player-name="${escapedEntrantName}">${escapedEntrantName}</span>
                    </div>
                    ${scoreControls}
                </div>`;
            }).join('');

            slotRows.innerHTML = `<div class="slot-row">${playerCards}</div>`;
            alignSlotPlayerNameLines();
            applySetCallInputLock();

            for (const input of slotRows.querySelectorAll('[data-score-entrant-id]')) {
                input.addEventListener('input', () => {
                    const normalized = normalizeManualScoreInput(input.value);
                    if (normalized !== input.value) {
                        input.value = normalized;
                    }
                    updateHigherScoreHighlight();
                });
            }

            for (const stepButton of slotRows.querySelectorAll('[data-score-adjust]')) {
                stepButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    const entrantId = stepButton.getAttribute('data-score-entrant-id') || '';
                    const adjust = Number(stepButton.getAttribute('data-score-adjust') || '0');
                    if (!entrantId || !Number.isFinite(adjust)) {
                        return;
                    }

                    const input = slotRows.querySelector(`[data-score-entrant-id="${CSS.escape(entrantId)}"]`);
                    if (!input) {
                        return;
                    }

                    initializeEmptyScoresForStep();
                    const next = nextScoreAfterStep(input.value, adjust);
                    input.value = formatScoreInputValue(next);
                    updateHigherScoreHighlight();
                });
            }

            for (const dqButton of slotRows.querySelectorAll('[data-dq-entrant-id]')) {
                dqButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    const targetEntrantId = dqButton.getAttribute('data-dq-entrant-id') || '';
                    if (!targetEntrantId || hasActiveSetCalls() || !selectedSetCallStatus) {
                        return;
                    }

                    const scoreInputs = slotRows.querySelectorAll('[data-score-entrant-id]');
                    let otherEntrantId = '';
                    for (const scoreInput of scoreInputs) {
                        const entrantId = scoreInput.getAttribute('data-score-entrant-id') || '';
                        if (entrantId && entrantId !== targetEntrantId) {
                            otherEntrantId = entrantId;
                            break;
                        }
                    }

                    for (const scoreInput of scoreInputs) {
                        const entrantId = scoreInput.getAttribute('data-score-entrant-id') || '';
                        if (!entrantId) {
                            continue;
                        }
                        if (entrantId === targetEntrantId) {
                            scoreInput.value = 'DQ';
                        } else if (entrantId === otherEntrantId) {
                            scoreInput.value = '0';
                        }
                    }

                    updateHigherScoreHighlight();
                    applySetCallInputLock();
                });
            }

            for (const winButton of slotRows.querySelectorAll('[data-win-entrant-id]')) {
                winButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    const targetEntrantId = winButton.getAttribute('data-win-entrant-id') || '';
                    directWinnerId = directWinnerId === targetEntrantId ? null : targetEntrantId;
                    if (directWinnerId) {
                        for (const scoreInput of slotRows.querySelectorAll('[data-score-entrant-id]')) {
                            scoreInput.value = '';
                        }
                    }
                    renderDetailSlots(selectedSet);
                });
            }

            for (const sideButton of slotRows.querySelectorAll('[data-set-side]')) {
                sideButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    const entrantId = sideButton.getAttribute('data-side-entrant-id-btn') || '';
                    const playSide = sideButton.getAttribute('data-set-side') || '';
                    setEntrantPlaySide(entrantId, playSide);
                });
            }

            updateHigherScoreHighlight();
        }

        function updateHigherScoreHighlight() {
            const rows = Array.from(slotRows.querySelectorAll('.player-card'));
            const scoreValues = rows.map((row) => {
                const input = row.querySelector('[data-score-entrant-id]');
                return normalizeScoreValue(input ? input.value : null);
            });
            const numericScores = scoreValues.filter((value) => value !== null);
            const highestScore = numericScores.length > 0 ? Math.max(...numericScores) : null;
            const hasUniqueHighScore = highestScore !== null && numericScores.filter((value) => value === highestScore).length === 1;

            for (const row of rows) {
                const input = row.querySelector('[data-score-entrant-id]');
                const scoreValue = normalizeScoreValue(input ? input.value : null);
                const isHigher = hasUniqueHighScore && scoreValue !== null && scoreValue === highestScore;
                row.classList.toggle('score-high', isHigher);
                if (input) {
                    input.classList.toggle('score-high', isHigher);
                }
            }
        }

        function toOverlayGameWins(score) {
            const parsed = Number(score);
            if (!Number.isFinite(parsed)) {
                return 0;
            }
            return Math.max(0, Math.trunc(parsed));
        }

        function getDetailSlotByPlaySide(detail, playSide) {
            const slots = Array.isArray(detail?.slots) ? detail.slots : [];
            return slots.find((slot) => String(slot.playSide || '').trim() === playSide) || null;
        }

        function buildOverlayPayloadFromDetail(detail, eventAlias = mobileEventAlias) {
            const onePSlot = getDetailSlotByPlaySide(detail, '1P') || (Array.isArray(detail?.slots) ? detail.slots[0] || null : null);
            const twoPSlot = getDetailSlotByPlaySide(detail, '2P') || (Array.isArray(detail?.slots) ? detail.slots[1] || null : null);
            const setLabel = getDisplaySetLabel(detail);
            const roundLine = String(detail?.fullRoundText || '').trim();
            const overlayRoundText = roundLine ? `${roundLine}\n${setLabel}` : setLabel;
            return {
                slug,
                eventId,
                setId: detail?.setId || '',
                eventAlias,
                eventName: detail?.phaseName || '',
                roundText: overlayRoundText,
                redPlayerName: onePSlot?.entrantName || 'RED',
                bluePlayerName: twoPSlot?.entrantName || 'BLUE',
                redSetWins: toOverlayGameWins(onePSlot?.score),
                blueSetWins: toOverlayGameWins(twoPSlot?.score),
                fontScale: 1,
            };
        }

        function getOverlaySetLabelFromState(state) {
            const roundText = String(state?.roundText || '');
            const lines = roundText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
            if (lines.length >= 2) {
                return lines[1];
            }
            return 'Set -';
        }

        async function fetchOverlayState() {
            const url = `/mobile/api/overlay-state?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                return null;
            }

            return await res.json();
        }

        async function refreshOverlayState() {
            overlayState = await fetchOverlayState();
            if (!overlayBox) {
                return;
            }

            const active = Boolean(overlayState && overlayState.active);
            const currentSetId = overlayState && overlayState.currentSetId ? String(overlayState.currentSetId) : '';
            const isCurrent = Boolean(selectedSet && selectedSet.setId && currentSetId && selectedSet.setId === currentSetId);

            if (!overlayStatus || !overlayToggleBtn) {
                return;
            }

            if (!active) {
                setLocalizedText(overlayStatus, overlayState && overlayState.fullyStopped ? 'streamFullyStopped' : 'streamStopped');
                setLocalizedText(overlayToggleBtn, 'startStream');
                overlayToggleBtn.disabled = !selectedSet;
                if (overlayStopBtn) {
                    overlayStopBtn.disabled = Boolean(overlayState && overlayState.fullyStopped);
                }
                updateSetCallControls();
                return;
            }

            if (isCurrent) {
                setLocalizedText(overlayStatus, 'streamCurrent', { set: getOverlaySetLabelFromState(overlayState) });
                setLocalizedText(overlayToggleBtn, 'stopStream');
                overlayToggleBtn.disabled = false;
                if (overlayStopBtn) {
                    overlayStopBtn.disabled = false;
                }
                updateSetCallControls();
                return;
            }

            setLocalizedText(overlayStatus, 'streamOther', { set: getOverlaySetLabelFromState(overlayState) });
            setLocalizedText(overlayToggleBtn, 'forceSwitch');
            overlayToggleBtn.disabled = !selectedSet;
            if (overlayStopBtn) {
                overlayStopBtn.disabled = false;
            }
            updateSetCallControls();
        }

        async function stopOverlayCompletely() {
            const response = await fetch('/mobile/api/overlay-stop?slug=' + encodeURIComponent(slug) + '&eventId=' + encodeURIComponent(eventId) + '&token=' + encodeURIComponent(token), {
                method: 'POST',
            });

            if (!response.ok) {
                const text = await response.text();
                setLocalizedText(submitStatus, 'stopFailed', { error: () => mobileErrorDetail(text) });
                return;
            }

            overlayState = await response.json();
            await refreshOverlayState();
            setLocalizedText(submitStatus, 'streamHidden');
        }

        async function toggleOverlayFromDetail() {
            if (!selectedSet) {
                return;
            }

            await eventInfoPromise;
            const payload = buildOverlayPayloadFromDetail(selectedSet);
            const active = Boolean(overlayState && overlayState.active);
            const currentSetId = overlayState && overlayState.currentSetId ? String(overlayState.currentSetId) : '';
            const isCurrent = Boolean(currentSetId && currentSetId === selectedSet.setId);

            const enabled = !active || !isCurrent;
            const forceSwitch = active && !isCurrent;
            if (enabled) {
                const callStatus = await refreshSetCallStatus();
                if (!callStatus) {
                    return;
                }
                if (callStatus.ownCallCount > 0 || callStatus.otherCallCount > 0) {
                    const messageKey = isCompletedSet(selectedSet) ? 'completedCalls' : 'callsBlockStream';
                    setLocalizedText(submitStatus, messageKey);
                    window.alert(t(messageKey));
                    return;
                }
            }

            if (forceSwitch) {
                const currentSetLabel = getOverlaySetLabelFromState(overlayState);
                const ok = window.confirm(t('forceSwitchConfirm', { set: currentSetLabel }));
                if (!ok) {
                    return;
                }
            }

            const response = await fetch('/mobile/api/overlay-toggle?slug=' + encodeURIComponent(slug) + '&eventId=' + encodeURIComponent(eventId) + '&token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    enabled: forceSwitch ? true : enabled,
                    forceSwitch,
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                setLocalizedText(submitStatus, 'streamUpdateFailed', { error: () => mobileErrorDetail(text) });
                return;
            }

            overlayState = await response.json();
            await refreshOverlayState();
            setLocalizedText(submitStatus, overlayState.active
                ? (overlayState.currentSetId === selectedSet.setId ? 'streamStarted' : 'streamSwitched')
                : 'streamEnded');
        }

        async function syncOverlayFromDetailIfNeeded() {
            if (!selectedSet || !overlayState || !overlayState.active) {
                return;
            }

            const currentSetId = overlayState.currentSetId ? String(overlayState.currentSetId) : '';
            if (currentSetId !== String(selectedSet.setId || '')) {
                return;
            }

            const payload = buildOverlayPayloadFromDetail(selectedSet, overlayState.eventAlias ?? '');
            const response = await fetch('/mobile/api/overlay-toggle?slug=' + encodeURIComponent(slug) + '&eventId=' + encodeURIComponent(eventId) + '&token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    enabled: true,
                    forceSwitch: false,
                }),
            });

            if (!response.ok) {
                return;
            }

            overlayState = await response.json();
            await refreshOverlayState();
        }

        async function fetchSets() {
            setLocalizedText(submitStatus, '');
            const q = encodeURIComponent(searchBox.value || '');
            const url = `/mobile/api/sets?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&q=${q}&token=${encodeURIComponent(token)}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                setList.innerHTML = `<p class="meta" data-i18n="fetchFailed">${t('fetchFailed')}</p>`;
                return;
            }
            const sets = await res.json();
            if (!Array.isArray(sets) || sets.length === 0) {
                setList.innerHTML = `<p class="meta" data-i18n="noSets">${t('noSets')}</p>`;
                return;
            }

            const onlyInputtable = !matchupReadyOnlyCheckbox || Boolean(matchupReadyOnlyCheckbox.checked);
            const filteredSets = onlyInputtable
                ? sets.filter((set) => isListItemInputtable(set))
                : sets;
            if (filteredSets.length === 0) {
                setList.innerHTML = `<p class="meta" data-i18n="noSets">${t('noSets')}</p>`;
                return;
            }

            setList.innerHTML = filteredSets.map((set) => {
                const players = Array.isArray(set.entrantNames) ? set.entrantNames.join(' / ') : '';
                const identifier = String(set.identifier || '').trim();
                const setLabel = identifier ? `Set ${identifier}` : (String(set.setCode || '').trim() ? `Set ${set.setCode}` : `Set ${set.setId}`);
                const phaseLabel = [set.phaseName, set.phaseGroupName]
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                    .join(' / ');
                return `<article class="set-item" data-set-id="${escapeHtml(set.setId)}">
                    <h2>${escapeHtml(set.fullRoundText)}</h2>
                    <p class="meta">${escapeHtml(setLabel)}</p>
                    ${phaseLabel ? `<p class="meta">${escapeHtml(phaseLabel)}</p>` : ''}
                    ${set.scoreEditLocked ? `<p class="meta" data-i18n="lockedList">${t('lockedList')}</p>` : ''}
                    <p class="meta">${escapeHtml(players)}</p>
                </article>`;
            }).join('');

            for (const item of setList.querySelectorAll('[data-set-id]')) {
                item.addEventListener('click', async () => {
                    const setId = item.getAttribute('data-set-id') || '';
                    await fetchSetDetail(setId);
                });
            }
        }

        async function fetchSetDetail(setId, options = {}) {
            const silent = Boolean(options.silent);
            const url = `/mobile/api/sets/${encodeURIComponent(setId)}?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                let errorBody = '';
                try {
                    errorBody = (await res.text()).trim();
                } catch (_) {
                    errorBody = '';
                }
                if (!silent) {
                    setLocalizedText(submitStatus, 'detailFailed', { error: () => mobileErrorDetail(errorBody || `HTTP ${res.status}`) });
                }
                throw new Error(errorBody || `HTTP ${res.status}`);
            }

            const detail = await res.json();
            const previousSetId = selectedSet && selectedSet.setId ? String(selectedSet.setId) : '';
            selectedSet = detail;
            if (previousSetId !== String(detail.setId || '')) {
                selectedSetCallStatus = null;
                updateSetCallControls();
            }
            directWinnerId = detail.directWin && detail.winnerId ? String(detail.winnerId) : null;
            displayOnePOnTop = onePOnTopCheckbox ? Boolean(onePOnTopCheckbox.checked) : true;
            if (onePOnTopCheckbox && previousSetId !== String(detail.setId || '')) {
                displayOnePOnTop = true;
                onePOnTopCheckbox.checked = true;
            }
            mobileSideDrafts = buildMobileSideDraftsFromDetail(detail);
            showDetailView();
            detailRound.textContent = detail.fullRoundText || '-';
            detailSetId.textContent = getDisplaySetLabel(detail);
            detailPhasePool.textContent = [detail.phaseName, detail.phaseGroupName]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(' / ');
            setLocalizedText(detailMeta, '');
            if (sideActions) {
                sideActions.hidden = false;
            }
            await refreshOverlayState();
            await refreshSetCallStatus();
            renderDetailSlots(detail);
        }

        function isDetailEditingNow() {
            const active = document.activeElement;
            if (!active) {
                return false;
            }

            if (slotRows && slotRows.contains(active)) {
                return true;
            }

            return false;
        }

        function collectSlotScores() {
            const slotScores = [];
            for (const input of slotRows.querySelectorAll('[data-score-entrant-id]')) {
                const entrantId = input.getAttribute('data-score-entrant-id') || '';
                const parsed = normalizeScoreValue(input.value);
                if (!entrantId || parsed === null) {
                    continue;
                }
                slotScores.push({ entrantId, score: Math.trunc(parsed) });
            }

            return slotScores;
        }

        function collectSideAssignments() {
            const sideAssignments = [];
            const slots = Array.isArray(selectedSet?.slots) ? selectedSet.slots.filter((slot) => slot && slot.entrantId) : [];
            for (const slot of slots) {
                const entrantId = slot.entrantId || '';
                if (!entrantId) {
                    continue;
                }
                const playSide = getCurrentPlaySideForEntrant(selectedSet, entrantId);
                if (playSide !== '1P' && playSide !== '2P') {
                    continue;
                }
                sideAssignments.push({
                    entrantId,
                    playSide,
                });
            }
            return sideAssignments;
        }

        async function saveSetFromDetail(confirmed, callsAlreadyResolved = false) {
            if (!selectedSet) {
                setLocalizedText(submitStatus, 'selectSet');
                return;
            }
            if (hasActiveSetCalls()) {
                setLocalizedText(submitStatus, 'callsBlockResult');
                return;
            }

            if (isCompletedSet(selectedSet)) {
                setLocalizedText(submitStatus, 'completedResult');
                return;
            }

            if (confirmed && !isMatchupReady(selectedSet)) {
                setLocalizedText(submitStatus, 'matchupCannotConfirm');
                return;
            }
            if (!callsAlreadyResolved
                && !(await resolveCallsBeforeSetAction(confirmed ? 'confirmResult' : 'updateResult'))) {
                return;
            }

            const slotScores = collectSlotScores();
            const sideAssignments = collectSideAssignments();

            const payload = {
                slug,
                eventId,
                winnerId: directWinnerId,
                slotScores: directWinnerId
                    ? (selectedSet.slots || []).filter((slot) => slot && slot.entrantId).map((slot) => ({ entrantId: slot.entrantId, score: 0 }))
                    : slotScores,
                sideAssignments,
                directWin: Boolean(directWinnerId),
                confirmed,
            };

            const url = `/mobile/api/sets/${encodeURIComponent(selectedSet.setId)}/save?slug=${encodeURIComponent(slug)}&eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const text = await res.text();
                setLocalizedText(submitStatus, 'saveFailed', { error: () => mobileErrorDetail(text) });
                return;
            }

            const detail = await res.json();
            selectedSet = detail;
            directWinnerId = detail.directWin && detail.winnerId ? String(detail.winnerId) : null;
            setLocalizedText(detailMeta, '');
            detailSetId.textContent = getDisplaySetLabel(detail);
            mobileSideDrafts = buildMobileSideDraftsFromDetail(detail);

            for (const scoreInput of slotRows.querySelectorAll('[data-score-entrant-id]')) {
                const entrantId = scoreInput.getAttribute('data-score-entrant-id') || '';
                const next = (detail.slots || []).find((slot) => (slot.entrantId || '') === entrantId);
                if (!next) {
                    continue;
                }
                scoreInput.value = next.score === null || next.score === undefined ? '' : String(next.score);
            }

            renderDetailSlots(detail);

            await syncOverlayFromDetailIfNeeded();

            if (confirmed) {
                shouldRefreshSetListOnReturn = true;
            }

            setLocalizedText(submitStatus, confirmed ? 'resultConfirmed' : 'resultUpdated');
        }

        document.getElementById('searchBtn').addEventListener('click', () => { void fetchSets(); });
        if (matchupReadyOnlyCheckbox) {
            matchupReadyOnlyCheckbox.addEventListener('change', () => { void fetchSets(); });
        }
        eventInfoPromise = fetchEventInfo();
        closeDetailBtn.addEventListener('click', () => {
            showSearchView();
        });
        if (discardBtn) {
            discardBtn.addEventListener('click', () => {
                discardMobileDrafts();
            });
        }
        refreshDetailBtn.addEventListener('click', () => {
            if (!selectedSet || !selectedSet.setId) {
                return;
            }
            setLocalizedText(submitStatus, 'refreshing');
            void fetchSetDetail(selectedSet.setId, { silent: true })
                .then(() => {
                    setLocalizedText(submitStatus, 'refreshed');
                })
                .catch((error) => {
                    const message = error && error.message ? String(error.message).trim() : '';
                    setLocalizedText(submitStatus, message ? 'detailFailed' : 'detailFailedEmpty', { error: () => mobileErrorDetail(message) });
                });
        });
        searchBox.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void fetchSets();
            }
        });
        updateBtn.addEventListener('click', () => { void saveSetFromDetail(false); });
        confirmBtn.addEventListener('click', async () => {
            if (!selectedSet) {
                return;
            }
            if (!(await resolveCallsBeforeSetAction('confirmResult'))) {
                return;
            }

            const scoreSummary = (selectedSet.slots || [])
                .filter((slot) => slot && slot.entrantId)
                .map((slot) => {
                    if (directWinnerId) {
                        return `${slot.entrantName || 'TBD'}: ${slot.entrantId === directWinnerId ? 'W' : 'L'}`;
                    }
                    const scores = collectSlotScores();
                    const score = scores.find((item) => item.entrantId === slot.entrantId);
                    return `${slot.entrantName || 'TBD'}: ${score ? score.score : t('notEntered')}`;
                })
                .join('\n');
            const setLabel = selectedSet.fullRoundText || getDisplaySetLabel(selectedSet);
            const ok = window.confirm(
                t('confirmResultPrompt', { set: setLabel, scores: scoreSummary || t('opponentsPending') }),
            );
            if (ok) {
                void saveSetFromDetail(true, true);
            }
        });
        overlayToggleBtn.addEventListener('click', () => {
            void toggleOverlayFromDetail();
        });
        if (resolveCallsBtn) {
            resolveCallsBtn.addEventListener('click', () => {
                void resolveSetCallsFromDetail();
            });
        }

        if (overlayStopBtn) {
            overlayStopBtn.addEventListener('click', () => {
                void stopOverlayCompletely();
            });
        }

        if (swapSideBtn) {
            swapSideBtn.addEventListener('click', () => {
                swapSides();
            });
        }

        if (randomSideBtn) {
            randomSideBtn.addEventListener('click', () => {
                randomizeSides();
            });
        }

        if (onePOnTopCheckbox) {
            onePOnTopCheckbox.addEventListener('change', () => {
                applyDisplayOrder(Boolean(onePOnTopCheckbox.checked));
            });
        }

        setLocalizedText(pageTitle, 'title');
        setLocalizedText(scopeLabel, 'loading');
        setLocalizedText(searchBox, 'searchPlaceholder', {}, 'placeholder');
        setLocalizedText(overlayToggleBtn, 'startStream');
        document.getElementById('mobileLanguage').addEventListener('change', (event) => {
            changeMobileLanguage(event.target.value);
        });
        applyMobileLanguage();

        window.addEventListener('unhandledrejection', (event) => {
            setLocalizedText(submitStatus, 'requestFailed', {
                error: () => mobileErrorDetail(event.reason?.message || String(event.reason)),
            });
        });

        window.setInterval(() => {
            void pollSetCallStatus();
        }, autoRefreshMs);

        void fetchSets();
    </script>
</body>
</html>"#
        .replace(
            "/* MOBILE_LOCALIZATION */",
            &include_str!("web/mobile-localization.js").replace(
                "/* MOBILE_MESSAGES */",
                include_str!("web/mobile-translations.json"),
            ),
        )
}

#[cfg(test)]
mod embedded_web_localization_tests {
    use super::{build_overlay_html, mobile_input_html};
    use std::collections::BTreeSet;

    fn placeholders(message: &str) -> BTreeSet<&str> {
        message
            .split('{')
            .skip(1)
            .map(|part| part.split('}').next().expect("closing placeholder brace"))
            .collect()
    }

    #[test]
    fn mobile_translations_are_complete_and_keep_matching_placeholders() {
        let messages: serde_json::Value =
            serde_json::from_str(include_str!("web/mobile-translations.json")).unwrap();
        let html = mobile_input_html();
        for (key, translations) in messages.as_object().unwrap() {
            let pair = translations.as_array().unwrap();
            assert_eq!(pair.len(), 2, "{key} must have Japanese and English");
            let ja = pair[0].as_str().unwrap();
            let en = pair[1].as_str().unwrap();
            assert!(!ja.trim().is_empty() && !en.trim().is_empty(), "{key}");
            assert_eq!(placeholders(ja), placeholders(en), "{key}");
            assert!(
                html.contains(&format!("'{key}'"))
                    || html.contains(&format!("data-i18n=\"{key}\"")),
                "unused translation: {key}"
            );
        }
        for (index, _) in html.match_indices("t('") {
            if html[..index]
                .chars()
                .next_back()
                .is_some_and(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '$'))
            {
                continue;
            }
            let key = html[index + 3..].split('\'').next().unwrap();
            assert!(messages.get(key).is_some(), "missing translation: {key}");
        }
        for part in html.split("data-i18n=\"").skip(1) {
            let key = part.split('"').next().unwrap();
            if !key.starts_with("${") {
                assert!(messages.get(key).is_some(), "missing label: {key}");
            }
        }
    }

    #[test]
    fn mobile_html_embeds_localization_and_explicit_language_controls() {
        let html = mobile_input_html();
        assert!(!html.contains("/* MOBILE_LOCALIZATION */"));
        assert!(!html.contains("/* MOBILE_MESSAGES */"));
        assert!(html.contains("id=\"mobileLanguage\""));
        assert!(html.contains("<html lang=\"ja\">"));
        assert!(html.contains("localStorage.setItem(mobileLanguageStorageKey, mobileLanguage)"));
        assert!(html.contains("document.documentElement.lang = mobileLanguage"));
        assert!(html.contains("setLocalizedText(submitStatus, 'saveFailed'"));
        assert!(html.contains("eventAliasIsDefault"));
        let main_script = html.rsplit("<script>").next().unwrap();
        assert!(
            !main_script
                .chars()
                .any(|ch| matches!(ch, '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9fff}')),
            "mobile JS labels must use the dictionary, not Japanese literals"
        );
        assert!(!html.contains("location.reload"));
        assert!(!html.contains("TreeWalker"));
        assert!(!html.contains("MutationObserver"));
    }

    #[test]
    fn obs_overlay_keeps_language_controls_out_of_capture() {
        let html = build_overlay_html();
        assert!(html.contains("applyOverlayLanguage()"));
        assert!(html.contains("document.documentElement.lang = language"));
        assert!(!html.contains("<select"));
        assert!(!html.contains("data-i18n"));
        assert!(html.contains("String(state.redPlayerName || '')"));
        assert!(html.contains("String(state.bluePlayerName || '')"));
        assert!(html.contains("String(state.eventAlias || '')"));
    }
}

fn is_mobile_authorized(url: &str) -> bool {
    let supplied = query_param_from_url(url, "token").unwrap_or_default();
    if supplied.is_empty() {
        return false;
    }

    match current_mobile_input_token() {
        Ok(expected) => !expected.is_empty() && supplied == expected,
        Err(_) => false,
    }
}

fn respond_json(request: tiny_http::Request, status: i32, payload: String) {
    let mut response = Response::from_string(payload).with_status_code(status);
    if let Ok(content_type) =
        Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8")
    {
        response = response.with_header(content_type);
    }
    if let Ok(no_cache) = Header::from_bytes(
        b"Cache-Control",
        b"no-store, no-cache, must-revalidate, max-age=0",
    ) {
        response = response.with_header(no_cache);
    }

    let _ = request.respond(response);
}

fn parse_limit(url: &str) -> usize {
    query_param_from_url(url, "limit")
        .and_then(|value| value.parse::<usize>().ok())
        .map(|value| value.clamp(1, 200))
        .unwrap_or(80)
}

fn build_mobile_set_detail_from_workspace(
    workspace: &TournamentWorkspace,
    event_id: &str,
    set_id: &str,
) -> Option<MobileSetDetailItem> {
    let event = workspace
        .snapshot
        .events
        .iter()
        .find(|item| item.event_id == event_id)?;
    let set = resolve_mobile_set_entrants(event, set_id)?;
    let set_display_code_by_id = build_set_display_code_by_id(&event.sets);
    let mut side_by_key = std::collections::HashMap::<String, String>::new();
    for item in &workspace.local_meta.set_play_sides {
        if item.set_id != set.set_id {
            continue;
        }
        side_by_key.insert(
            item.entrant_id.clone(),
            play_side_label(item.play_side.clone()),
        );
    }

    build_mobile_set_detail_from_set_snapshot(
        &set,
        set_display_code_by_id.get(&set.set_id).cloned(),
        side_by_key,
    )
}

fn resolve_mobile_set_entrants(
    event: &crate::models::EventSnapshot,
    set_id: &str,
) -> Option<SetSnapshot> {
    let mut set = event
        .sets
        .iter()
        .find(|item| item.set_id == set_id)?
        .clone();
    for (slot_index, slot) in set.slots.iter_mut().enumerate() {
        if slot.entrant_id.is_some() {
            continue;
        }
        let source = match slot_index {
            0 => set.entrant1_source.as_ref(),
            1 => set.entrant2_source.as_ref(),
            _ => None,
        };
        if let Some(resolved) = resolve_mobile_entrant_from_source(
            source,
            event,
            &mut HashSet::from([set.set_id.clone()]),
        ) {
            slot.entrant_id = resolved.entrant_id;
            slot.entrant_name = resolved.entrant_name;
        }
    }

    for slot in &mut set.slots {
        let Some(entrant_id) = slot.entrant_id.as_deref() else {
            continue;
        };
        if !is_mobile_resolved_entrant_name(&slot.entrant_name) {
            if let Some(name) = event
                .sets
                .iter()
                .flat_map(|candidate| candidate.slots.iter())
                .find(|candidate| candidate.entrant_id.as_deref() == Some(entrant_id))
                .filter(|candidate| is_mobile_resolved_entrant_name(&candidate.entrant_name))
                .map(|candidate| candidate.entrant_name.clone())
                .or_else(|| {
                    event
                        .phase_groups
                        .iter()
                        .flat_map(|group| group.seeds.iter())
                        .find(|seed| {
                            seed.entrant_id.as_deref() == Some(entrant_id)
                                && seed
                                    .entrant_name
                                    .as_deref()
                                    .is_some_and(is_mobile_resolved_entrant_name)
                        })
                        .and_then(|seed| seed.entrant_name.clone())
                })
            {
                slot.entrant_name = name;
            }
        }
    }

    Some(set)
}

fn is_mobile_resolved_entrant_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }
    let normalized = trimmed.to_ascii_uppercase();
    !matches!(normalized.as_str(), "TBD" | "TBA" | "UNKNOWN")
        && !trimmed.to_ascii_lowercase().starts_with("winner of ")
        && !trimmed.to_ascii_lowercase().starts_with("loser of ")
        && !trimmed.starts_with("勝者")
        && !trimmed.starts_with("敗者")
}

fn resolve_mobile_entrant_from_source(
    source: Option<&crate::models::SetEntrantSourceSnapshot>,
    event: &crate::models::EventSnapshot,
    visited: &mut HashSet<String>,
) -> Option<crate::models::SetSlotSnapshot> {
    let source = source?;
    if source.source_type.as_deref() == Some("seed") {
        if let Some(seed) = event
            .phase_groups
            .iter()
            .flat_map(|group| group.seeds.iter())
            .find(|seed| Some(seed.seed_id.as_str()) == source.type_id.as_deref())
        {
            if let Some(entrant_id) = seed.entrant_id.as_ref() {
                return Some(crate::models::SetSlotSnapshot {
                    entrant_id: Some(entrant_id.clone()),
                    entrant_name: seed
                        .entrant_name
                        .clone()
                        .unwrap_or_else(|| "TBD".to_owned()),
                    seed_id: Some(seed.seed_id.clone()),
                    seed_num: seed.seed_num,
                    seed_placeholder_name: seed.placeholder_name.clone(),
                    seed_origin_phase_group_id: seed.origin_phase_group_id.clone(),
                    seed_origin_phase_group_display_identifier: seed
                        .origin_phase_group_display_identifier
                        .clone(),
                    seed_origin_phase_order: seed.origin_phase_order,
                    seed_origin_placement: seed.origin_placement,
                    seed_origin_order: seed.origin_order,
                    score: None,
                });
            }
        }

        let progression_source = event.sets.iter().find_map(|candidate| {
            if candidate.winner_progression_seed_id.as_deref() == source.type_id.as_deref()
                || candidate.winner_progression_id.as_deref() == source.type_id.as_deref()
            {
                Some((candidate, "winner"))
            } else if candidate.loser_progression_seed_id.as_deref() == source.type_id.as_deref()
                || candidate.loser_progression_id.as_deref() == source.type_id.as_deref()
            {
                Some((candidate, "loser"))
            } else {
                None
            }
        });
        if let Some((source_set, relation)) = progression_source {
            return source_set.winner_id.as_ref().and_then(|winner_id| {
                source_set
                    .slots
                    .iter()
                    .find(|slot| {
                        slot.entrant_id.as_ref().is_some_and(|entrant_id| {
                            if relation == "winner" {
                                entrant_id == winner_id
                            } else {
                                entrant_id != winner_id
                            }
                        })
                    })
                    .cloned()
            });
        }
        return None;
    }

    let source_set_id = source
        .resolved_set_id
        .as_deref()
        .or(source.type_id.as_deref())?;
    if !visited.insert(source_set_id.to_owned()) {
        return None;
    }
    let source_set = event.sets.iter().find(|set| set.set_id == source_set_id)?;
    let condition = source.condition.as_deref().unwrap_or_default();
    if let Some(winner_id) = source_set.winner_id.as_ref() {
        if condition == "winner" || condition == "loser" {
            return source_set
                .slots
                .iter()
                .find(|slot| {
                    slot.entrant_id.as_ref().is_some_and(|entrant_id| {
                        if condition == "winner" {
                            entrant_id == winner_id
                        } else {
                            entrant_id != winner_id
                        }
                    })
                })
                .cloned();
        }
    }

    if crate::models::is_intermediate_set(&event.phase_groups, source_set) {
        for nested_source in [
            source_set.entrant1_source.as_ref(),
            source_set.entrant2_source.as_ref(),
        ] {
            if let Some(slot) = resolve_mobile_entrant_from_source(nested_source, event, visited) {
                return Some(slot);
            }
        }
    }
    None
}

fn build_mobile_set_detail_from_set_snapshot(
    set: &SetSnapshot,
    set_code: Option<String>,
    side_by_key: std::collections::HashMap<String, String>,
) -> Option<MobileSetDetailItem> {
    let set_code = set_code.unwrap_or_else(|| set.set_id.clone());

    Some(MobileSetDetailItem {
        set_id: set.set_id.clone(),
        set_code,
        full_round_text: set.full_round_text.clone(),
        round: set.round,
        phase_name: set.phase_name.clone(),
        phase_group_name: set.phase_group_name.clone(),
        state: set.state,
        winner_id: set.winner_id.clone(),
        direct_win: false,
        score_edit_locked: true,
        slots: set
            .slots
            .iter()
            .map(|slot| MobileSetSlotItem {
                entrant_id: slot.entrant_id.clone(),
                entrant_name: slot.entrant_name.clone(),
                score: slot.score,
                play_side: slot
                    .entrant_id
                    .as_ref()
                    .and_then(|entrant_id| side_by_key.get(entrant_id).cloned()),
            })
            .collect::<Vec<MobileSetSlotItem>>(),
    })
}

fn apply_pending_mobile_result(
    detail: &mut MobileSetDetailItem,
    pending: &models::LocalSetResultMeta,
) {
    detail.direct_win = pending.direct_win;
    if pending.confirmed {
        detail.state = 3;
    }
    if detail
        .winner_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
        && !pending.winner_id.trim().is_empty()
    {
        detail.winner_id = Some(pending.winner_id.clone());
    }

    for slot in &mut detail.slots {
        if pending.direct_win {
            slot.score = None;
            continue;
        }
        let Some(entrant_id) = slot.entrant_id.as_deref() else {
            continue;
        };
        if let Some(score) = pending
            .slot_scores
            .iter()
            .find(|score| score.entrant_id == entrant_id)
        {
            slot.score = Some(score.score as f64);
        }
    }
}

fn hydrate_mobile_detail_with_local_meta(
    mut detail: MobileSetDetailItem,
    workspace: &TournamentWorkspace,
    event_id: &str,
    set_id: &str,
) -> MobileSetDetailItem {
    let event_meta = workspace
        .local_meta
        .events
        .iter()
        .find(|event| event.event_id == event_id);
    let entrant_name_by_id = event_meta
        .map(|event| {
            event
                .entrants
                .iter()
                .map(|entrant| (entrant.entrant_id.clone(), entrant.entrant_name.clone()))
                .collect::<HashMap<String, String>>()
        })
        .unwrap_or_default();
    let alias_name_by_id = event_meta
        .filter(|event| {
            event
                .event_management
                .as_ref()
                .is_some_and(|setting| setting.use_alias_name)
        })
        .map(|event| {
            event
                .entrants
                .iter()
                .filter(|entrant| !entrant.alias_name.trim().is_empty())
                .map(|entrant| {
                    (
                        entrant.entrant_id.clone(),
                        entrant.alias_name.trim().to_owned(),
                    )
                })
                .collect::<HashMap<String, String>>()
        })
        .unwrap_or_default();
    let entrant_id_by_name = entrant_name_by_id
        .iter()
        .map(|(entrant_id, entrant_name)| (entrant_name.trim().to_lowercase(), entrant_id.clone()))
        .collect::<HashMap<String, String>>();

    let pending = workspace
        .local_meta
        .pending_set_results
        .iter()
        .rev()
        .find(|item| item.event_id == event_id && item.set_id == set_id);

    let mut side_by_id = HashMap::<String, String>::new();
    for item in &workspace.local_meta.set_play_sides {
        if item.set_id != set_id {
            continue;
        }
        side_by_id.insert(
            item.entrant_id.clone(),
            play_side_label(item.play_side.clone()),
        );
    }

    let mut candidate_ids = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    let mut push_candidate = |candidate: &str| {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            return;
        }
        if seen.insert(trimmed.to_owned()) {
            candidate_ids.push(trimmed.to_owned());
        }
    };

    for slot in &detail.slots {
        if let Some(entrant_id) = slot.entrant_id.as_deref() {
            push_candidate(entrant_id);
        } else {
            let key = slot.entrant_name.trim().to_lowercase();
            if let Some(entrant_id) = entrant_id_by_name.get(&key) {
                push_candidate(entrant_id);
            }
        }
    }
    for item in &workspace.local_meta.set_play_sides {
        if item.set_id == set_id {
            push_candidate(&item.entrant_id);
        }
    }
    if let Some(pending) = pending {
        for slot in &pending.slot_scores {
            push_candidate(&slot.entrant_id);
        }
        push_candidate(&pending.winner_id);
    }

    let mut slot_by_id = HashMap::<String, MobileSetSlotItem>::new();
    for slot in detail.slots.iter().cloned() {
        if let Some(entrant_id) = slot.entrant_id.clone() {
            slot_by_id.insert(entrant_id, slot);
        } else {
            let key = slot.entrant_name.trim().to_lowercase();
            if let Some(entrant_id) = entrant_id_by_name.get(&key) {
                let mut next_slot = slot.clone();
                next_slot.entrant_id = Some(entrant_id.clone());
                slot_by_id.insert(entrant_id.clone(), next_slot);
            }
        }
    }

    if candidate_ids.len() >= 2 {
        detail.slots = candidate_ids
            .into_iter()
            .take(2)
            .map(|entrant_id| {
                let mut slot = slot_by_id.remove(&entrant_id).unwrap_or(MobileSetSlotItem {
                    entrant_id: Some(entrant_id.clone()),
                    entrant_name: entrant_name_by_id
                        .get(&entrant_id)
                        .cloned()
                        .unwrap_or_else(|| "TBD".to_owned()),
                    score: None,
                    play_side: None,
                });

                slot.entrant_id = Some(entrant_id.clone());
                if slot.entrant_name.trim().is_empty()
                    || slot.entrant_name.eq_ignore_ascii_case("TBD")
                {
                    if let Some(name) = entrant_name_by_id.get(&entrant_id) {
                        slot.entrant_name = name.clone();
                    }
                }
                if slot
                    .play_side
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
                {
                    slot.play_side = side_by_id.get(&entrant_id).cloned();
                }

                slot
            })
            .collect::<Vec<MobileSetSlotItem>>();
    }

    if let Some(pending) = pending {
        apply_pending_mobile_result(&mut detail, pending);
    }
    detail.score_edit_locked = storage::is_set_score_edit_locked(workspace, event_id, set_id);
    if detail.full_round_text.trim().is_empty() {
        detail.full_round_text = format!("Set {}", detail.set_code);
    }
    for slot in &mut detail.slots {
        if let Some(alias_name) = slot
            .entrant_id
            .as_ref()
            .and_then(|entrant_id| alias_name_by_id.get(entrant_id))
        {
            slot.entrant_name = alias_name.clone();
        }
    }

    detail
}

fn build_mobile_set_detail_local_only(
    workspace: &TournamentWorkspace,
    event_id: &str,
    set_id: &str,
) -> Option<MobileSetDetailItem> {
    if let Some(base) = build_mobile_set_detail_from_workspace(workspace, event_id, set_id) {
        return Some(hydrate_mobile_detail_with_local_meta(
            base, workspace, event_id, set_id,
        ));
    }

    let pending = workspace
        .local_meta
        .pending_set_results
        .iter()
        .rev()
        .find(|item| item.event_id == event_id && item.set_id == set_id)?;

    let entrant_name_by_id = workspace
        .local_meta
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| {
            event
                .entrants
                .iter()
                .map(|entrant| (entrant.entrant_id.clone(), entrant.entrant_name.clone()))
                .collect::<HashMap<String, String>>()
        })
        .unwrap_or_default();

    let mut side_by_id = HashMap::<String, String>::new();
    for item in &workspace.local_meta.set_play_sides {
        if item.set_id == set_id {
            side_by_id.insert(
                item.entrant_id.clone(),
                play_side_label(item.play_side.clone()),
            );
        }
    }

    let mut slots = pending
        .slot_scores
        .iter()
        .take(2)
        .map(|slot| MobileSetSlotItem {
            entrant_id: Some(slot.entrant_id.clone()),
            entrant_name: entrant_name_by_id
                .get(&slot.entrant_id)
                .cloned()
                .unwrap_or_else(|| "TBD".to_owned()),
            score: Some(slot.score as f64),
            play_side: side_by_id.get(&slot.entrant_id).cloned(),
        })
        .collect::<Vec<MobileSetSlotItem>>();

    for item in &workspace.local_meta.set_play_sides {
        if item.set_id != set_id {
            continue;
        }
        if slots
            .iter()
            .any(|slot| slot.entrant_id.as_deref() == Some(item.entrant_id.as_str()))
        {
            continue;
        }
        slots.push(MobileSetSlotItem {
            entrant_id: Some(item.entrant_id.clone()),
            entrant_name: entrant_name_by_id
                .get(&item.entrant_id)
                .cloned()
                .unwrap_or_else(|| "TBD".to_owned()),
            score: None,
            play_side: Some(play_side_label(item.play_side.clone())),
        });
        if slots.len() >= 2 {
            break;
        }
    }

    Some(MobileSetDetailItem {
        set_id: set_id.to_owned(),
        set_code: set_id.to_owned(),
        full_round_text: format!("Set {set_id}"),
        round: None,
        phase_name: None,
        phase_group_name: None,
        state: if pending.confirmed { 3 } else { 2 },
        winner_id: if pending.winner_id.trim().is_empty() {
            None
        } else {
            Some(pending.winner_id.clone())
        },
        direct_win: pending.direct_win,
        score_edit_locked: true,
        slots,
    })
}

fn load_target_workspace(
    app: &tauri::AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<TournamentWorkspace, String> {
    storage::load_workspace(app, slug, event_id)
}

fn handle_mobile_input_http_request(app: &tauri::AppHandle, mut request: tiny_http::Request) {
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("/");

    if !path.starts_with("/mobile") {
        let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
        return;
    }

    if !is_mobile_authorized(&url) {
        respond_json(request, 401, "{\"error\":\"unauthorized\"}".to_owned());
        return;
    }

    if path == "/mobile" || path == "/mobile/" {
        let mut response = Response::from_string(mobile_input_html().to_owned());
        if let Ok(content_type) = Header::from_bytes(b"Content-Type", b"text/html; charset=utf-8") {
            response = response.with_header(content_type);
        }
        if let Ok(no_cache) = Header::from_bytes(
            b"Cache-Control",
            b"no-store, no-cache, must-revalidate, max-age=0",
        ) {
            response = response.with_header(no_cache);
        }
        let _ = request.respond(response);
        return;
    }

    if path == "/mobile/api/event-meta" && request.method() == &tiny_http::Method::Get {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();

        if slug.trim().is_empty() || event_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug and eventId are required\"}".to_owned(),
            );
            return;
        }

        let workspace = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let event = workspace
            .snapshot
            .events
            .iter()
            .find(|item| item.event_id == event_id)
            .cloned();
        let tournament_name = workspace.snapshot.name.trim().to_owned();
        let event_name = event
            .map(|item| item.name.trim().to_owned())
            .unwrap_or_default();
        let local_meta = match storage::load_local_meta(app, &slug, &event_id) {
            Ok(value) => value,
            Err(_) => models::TournamentLocalMeta {
                tournament_id: workspace.snapshot.tournament_id.clone(),
                slug: slug.to_owned(),
                tournament_name: workspace.snapshot.name.clone(),
                events: Vec::new(),
                set_play_sides: Vec::new(),
                pending_set_results: Vec::new(),
                pending_grand_final_reset_results: Vec::new(),
                set_confirmation_history: Vec::new(),
                set_stream_starts: Vec::new(),
                updated_at: chrono::Utc::now(),
            },
        };
        let saved_event_alias = local_meta
            .events
            .iter()
            .find(|item| item.event_id == event_id)
            .and_then(|item| item.event_alias.clone())
            .filter(|value| !value.trim().is_empty());
        let event_alias_is_default =
            saved_event_alias.is_none() && tournament_name.is_empty() && event_name.is_empty();
        let event_alias = saved_event_alias.unwrap_or_else(|| {
            if tournament_name.is_empty() && event_name.is_empty() {
                "スマートフォン結果入力依頼".to_owned()
            } else if tournament_name.is_empty() {
                event_name.clone()
            } else if event_name.is_empty() {
                tournament_name.clone()
            } else {
                format!("{tournament_name} / {event_name}")
            }
        });

        let payload = serde_json::to_string(&MobileEventInfo {
            event_alias,
            event_alias_is_default,
            tournament_name,
            event_name,
        })
        .unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, payload);
        return;
    }

    if path == "/mobile/api/sets" && request.method() == &tiny_http::Method::Get {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();
        let query = query_param_from_url(&url, "q")
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let limit = parse_limit(&url);

        if slug.trim().is_empty() || event_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug and eventId are required\"}".to_owned(),
            );
            return;
        }

        let workspace = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let event = match workspace
            .snapshot
            .events
            .iter()
            .find(|item| item.event_id == event_id)
        {
            Some(value) => value,
            None => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"指定eventが見つかりません: {}\"}}", event_id),
                );
                return;
            }
        };
        let sets = event
            .sets
            .iter()
            .filter_map(|set| resolve_mobile_set_entrants(event, &set.set_id))
            .collect::<Vec<_>>();
        let confirmed_pending_set_ids = workspace
            .local_meta
            .pending_set_results
            .iter()
            .filter(|pending| pending.event_id == event_id && pending.confirmed)
            .map(|pending| pending.set_id.as_str())
            .collect::<HashSet<_>>();

        let set_display_code_by_id = build_set_display_code_by_id(&sets);

        let mut items = sets
            .iter()
            .filter(|set| !crate::models::is_intermediate_set(&event.phase_groups, set))
            .filter(|set| is_visible_grand_final_reset(&sets, set))
            .filter(|set| {
                if query.is_empty() {
                    return true;
                }

                let set_code = set_display_code_by_id
                    .get(&set.set_id)
                    .cloned()
                    .unwrap_or_else(|| set.set_id.clone());
                let set_name = format!("Set {}", set_code);
                let mut haystacks = vec![
                    set_code.to_lowercase(),
                    set_name.to_lowercase(),
                    set.full_round_text.to_lowercase(),
                ];
                if let Some(identifier) = set.identifier.as_deref() {
                    haystacks.push(identifier.to_lowercase());
                }
                if let Some(phase_name) = set.phase_name.as_deref() {
                    haystacks.push(phase_name.to_lowercase());
                }
                if let Some(phase_group_name) = set.phase_group_name.as_deref() {
                    haystacks.push(phase_group_name.to_lowercase());
                }
                for slot in &set.slots {
                    haystacks.push(slot.entrant_name.to_lowercase());
                }

                haystacks.into_iter().any(|value| value.contains(&query))
            })
            .map(|set| MobileSetListItem {
                set_id: set.set_id.clone(),
                set_code: set_display_code_by_id
                    .get(&set.set_id)
                    .cloned()
                    .unwrap_or_else(|| set.set_id.clone()),
                identifier: set.identifier.clone(),
                full_round_text: set.full_round_text.clone(),
                phase_name: set.phase_name.clone(),
                phase_group_name: set.phase_group_name.clone(),
                is_intermediate: crate::models::is_intermediate_set(&event.phase_groups, set),
                matchup_ready: mobile_set_has_matchup(&set.slots),
                score_edit_locked: storage::is_set_score_edit_locked(
                    &workspace,
                    &event_id,
                    &set.set_id,
                ),
                state: if confirmed_pending_set_ids.contains(set.set_id.as_str()) {
                    3
                } else {
                    set.state
                },
                winner_id: set.winner_id.clone(),
                entrant_names: set
                    .slots
                    .iter()
                    .map(|slot| slot.entrant_name.clone())
                    .collect::<Vec<String>>(),
                entrant_ids: set
                    .slots
                    .iter()
                    .map(|slot| slot.entrant_id.clone())
                    .collect::<Vec<Option<String>>>(),
            })
            .collect::<Vec<MobileSetListItem>>();

        items.sort_by(|left, right| {
            left.full_round_text
                .cmp(&right.full_round_text)
                .then_with(|| left.set_id.cmp(&right.set_id))
        });
        items.truncate(limit);

        let payload = serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_owned());
        respond_json(request, 200, payload);
        return;
    }

    if path.starts_with("/mobile/api/sets/")
        && path.ends_with("/calls")
        && request.method() == &tiny_http::Method::Get
    {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();
        let set_id = percent_decode(
            path.trim_start_matches("/mobile/api/sets/")
                .trim_end_matches("/calls")
                .trim_end_matches('/'),
        );
        if slug.trim().is_empty() || event_id.trim().is_empty() || set_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and setId are required\"}".to_owned(),
            );
            return;
        }
        let workspace = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };
        if !workspace
            .snapshot
            .events
            .iter()
            .find(|event| event.event_id == event_id)
            .is_some_and(|event| resolve_mobile_set_entrants(event, &set_id).is_some())
        {
            respond_json(request, 404, "{\"error\":\"set not found\"}".to_owned());
            return;
        }
        let status = match mobile_set_call_status(app, &event_id, &set_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };
        respond_json(
            request,
            200,
            serde_json::to_string(&status).unwrap_or_else(|_| "{}".to_owned()),
        );
        return;
    }

    if path.starts_with("/mobile/api/sets/")
        && path.ends_with("/resolve-calls")
        && request.method() == &tiny_http::Method::Post
    {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();
        let set_id = percent_decode(
            path.trim_start_matches("/mobile/api/sets/")
                .trim_end_matches("/resolve-calls")
                .trim_end_matches('/'),
        );
        if slug.trim().is_empty() || event_id.trim().is_empty() || set_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and setId are required\"}".to_owned(),
            );
            return;
        }
        let workspace = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };
        let Some(detail) = build_mobile_set_detail_local_only(&workspace, &event_id, &set_id) else {
            respond_json(request, 404, "{\"error\":\"set not found\"}".to_owned());
            return;
        };
        if detail.state == 3 {
            respond_json(
                request,
                409,
                "{\"error\":\"確定済みSetの呼び出しは呼び出しリストから解決してください。\"}"
                    .to_owned(),
            );
            return;
        }
        let resolved_count = match resolve_mobile_calls_for_set(app, &event_id, &set_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    409,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };
        respond_json(
            request,
            200,
            serde_json::to_string(&MobileResolvedCallCount { resolved_count })
                .unwrap_or_else(|_| "{}".to_owned()),
        );
        return;
    }

    if path.starts_with("/mobile/api/sets/") && request.method() == &tiny_http::Method::Get {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();
        let set_id = percent_decode(path.trim_start_matches("/mobile/api/sets/"));

        if slug.trim().is_empty() || event_id.trim().is_empty() || set_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and setId are required\"}".to_owned(),
            );
            return;
        }

        let workspace = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let detail = match build_mobile_set_detail_local_only(&workspace, &event_id, &set_id) {
            Some(detail) => detail,
            None => {
                respond_json(request, 404, "{\"error\":\"set not found\"}".to_owned());
                return;
            }
        };

        let payload = serde_json::to_string(&detail).unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, payload);
        return;
    }

    if path.starts_with("/mobile/api/sets/")
        && path.ends_with("/save")
        && request.method() == &tiny_http::Method::Post
    {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();
        let set_id = percent_decode(
            path.trim_start_matches("/mobile/api/sets/")
                .trim_end_matches("/save")
                .trim_end_matches('/'),
        );

        if slug.trim().is_empty() || event_id.trim().is_empty() || set_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and setId are required\"}".to_owned(),
            );
            return;
        }

        let mut body = String::new();
        if let Err(err) = request.as_reader().read_to_string(&mut body) {
            respond_json(
                request,
                400,
                format!("{{\"error\":\"{}\"}}", err.to_string().replace('"', "\\\"")),
            );
            return;
        }

        let payload = match serde_json::from_str::<MobileSetSaveInput>(&body) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.to_string().replace('"', "\\\"")),
                );
                return;
            }
        };

        if payload.slug != slug || payload.event_id != event_id {
            respond_json(
                request,
                400,
                "{\"error\":\"path/query and payload scope mismatch\"}".to_owned(),
            );
            return;
        }

        let workspace_before = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let Some(target_set) = workspace_before
            .snapshot
            .events
            .iter()
            .find(|event| event.event_id == event_id)
            .and_then(|event| resolve_mobile_set_entrants(event, &set_id))
        else {
            respond_json(request, 404, "{\"error\":\"set not found\"}".to_owned());
            return;
        };

        if let Err(err) = ensure_mobile_set_has_no_active_calls(app, &event_id, &set_id) {
            respond_json(
                request,
                409,
                format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
            );
            return;
        }

        if storage::is_set_score_edit_locked(&workspace_before, &event_id, &set_id) {
            respond_json(
                request,
                423,
                "{\"error\":\"このプールは編集ロック中のため、スマートフォンからスコアを変更できません。\"}".to_owned(),
            );
            return;
        }

        if target_set.state == 3 {
            respond_json(
                request,
                400,
                "{\"error\":\"completed set results cannot be changed\"}".to_owned(),
            );
            return;
        }

        let known_entrant_ids = target_set
            .slots
            .iter()
            .filter_map(|slot| slot.entrant_id.clone())
            .collect::<Vec<String>>();

        for slot in &payload.slot_scores {
            if !known_entrant_ids.iter().any(|id| id == &slot.entrant_id) {
                respond_json(
                    request,
                    400,
                    "{\"error\":\"slotScores contains unknown entrantId\"}".to_owned(),
                );
                return;
            }
        }

        for assignment in &payload.side_assignments {
            if !known_entrant_ids
                .iter()
                .any(|id| id == &assignment.entrant_id)
            {
                respond_json(
                    request,
                    400,
                    "{\"error\":\"sideAssignments contains unknown entrantId\"}".to_owned(),
                );
                return;
            }
            if let Err(err) = parse_play_side_value(assignment.play_side.as_deref()) {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        }

        for assignment in &payload.side_assignments {
            let play_side = parse_play_side_value(assignment.play_side.as_deref())
                .ok()
                .flatten();
            let opponent_entrant_id = known_entrant_ids
                .iter()
                .find(|id| id.as_str() != assignment.entrant_id)
                .cloned();
            if let Err(err) = save_local_set_play_side(
                app.clone(),
                LocalSetPlaySideInput {
                    slug: slug.clone(),
                    event_id: event_id.clone(),
                    set_id: set_id.clone(),
                    entrant_id: assignment.entrant_id.clone(),
                    opponent_entrant_id,
                    play_side,
                },
            ) {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        }

        let winner_id = payload
            .winner_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| resolve_winner_id_from_slot_scores(&target_set, &payload.slot_scores));

        if let Some(value) = winner_id.as_ref() {
            if !known_entrant_ids.iter().any(|id| id == value) {
                respond_json(
                    request,
                    400,
                    "{\"error\":\"winnerId is not in target set\"}".to_owned(),
                );
                return;
            }
        }

        let _saved_workspace = if let Some(winner_id) = winner_id {
            match save_local_set_result(
                app.clone(),
                LocalSetResultInput {
                    slug: slug.clone(),
                    event_id: event_id.clone(),
                    set_id: set_id.clone(),
                    winner_id,
                    confirmed: payload.confirmed,
                    direct_win: payload.direct_win,
                    slot_scores: payload.slot_scores.clone(),
                },
            ) {
                Ok(value) => value,
                Err(err) => {
                    respond_json(
                        request,
                        400,
                        format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                    );
                    return;
                }
            }
        } else {
            if payload.confirmed {
                respond_json(
                    request,
                    400,
                    "{\"error\":\"winnerId cannot be resolved for confirmed save\"}".to_owned(),
                );
                return;
            }

            match save_local_set_scores(
                app.clone(),
                LocalSetScoreUpdateInput {
                    slug: slug.clone(),
                    event_id: event_id.clone(),
                    set_id: set_id.clone(),
                    slot_scores: payload.slot_scores.clone(),
                },
            ) {
                Ok(value) => value,
                Err(err) => {
                    respond_json(
                        request,
                        400,
                        format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                    );
                    return;
                }
            }
        };

        let workspace_after = match load_target_workspace(app, &slug, &event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let detail = build_mobile_set_detail_local_only(&workspace_after, &event_id, &set_id);

        let Some(detail) = detail else {
            respond_json(
                request,
                500,
                "{\"error\":\"saved but failed to reload set detail\"}".to_owned(),
            );
            return;
        };

        emit_workspace_updated(app, &slug, &event_id);

        let result = serde_json::to_string(&detail).unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, result);
        return;
    }

    if path.starts_with("/mobile/api/sets/")
        && path.ends_with("/discard")
        && request.method() == &tiny_http::Method::Post
    {
        let slug = query_param_from_url(&url, "slug").unwrap_or_default();
        let event_id = query_param_from_url(&url, "eventId").unwrap_or_default();
        let set_id = percent_decode(
            path.trim_start_matches("/mobile/api/sets/")
                .trim_end_matches("/discard")
                .trim_end_matches('/'),
        );

        if slug.trim().is_empty() || event_id.trim().is_empty() || set_id.trim().is_empty() {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and setId are required\"}".to_owned(),
            );
            return;
        }

        let workspace_after =
            match storage::clear_pending_set_result_for_set(app, &slug, &event_id, &set_id) {
                Ok(value) => value,
                Err(err) => {
                    respond_json(
                        request,
                        400,
                        format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                    );
                    return;
                }
            };

        let detail = match build_mobile_set_detail_local_only(&workspace_after, &event_id, &set_id)
        {
            Some(detail) => detail,
            None => {
                respond_json(request, 404, "{\"error\":\"set not found\"}".to_owned());
                return;
            }
        };

        emit_workspace_updated(app, &slug, &event_id);

        let overlay_should_stop = snapshot_obs_overlay_state()
            .ok()
            .and_then(|state| state.current_set_id)
            .as_deref()
            == Some(set_id.as_str());
        if overlay_should_stop {
            let _ = set_obs_overlay_fully_stopped(true);
        }
        emit_obs_overlay_state_changed(app);

        let payload = serde_json::to_string(&detail).unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, payload);
        return;
    }

    if path == "/mobile/api/overlay-state" && request.method() == &tiny_http::Method::Get {
        respond_json(
            request,
            200,
            serde_json::to_string(&snapshot_obs_overlay_state().unwrap_or_else(|_| {
                ObsOverlayState {
                    active: false,
                    fully_stopped: false,
                    current_set_id: None,
                    event_name: None,
                    event_alias: None,
                    round_text: None,
                    red_player_name: String::new(),
                    blue_player_name: String::new(),
                    red_set_wins: 0,
                    blue_set_wins: 0,
                    font_scale: 1.0,
                    name_fit_mode: "shrink".to_owned(),
                    show_set_info: true,
                    show_event_alias: true,
                    overlay_url: overlay_url(),
                }
            }))
            .unwrap_or_else(|_| "{}".to_owned()),
        );
        return;
    }

    if path == "/mobile/api/overlay-toggle" && request.method() == &tiny_http::Method::Post {
        let mut body = String::new();
        if let Err(err) = request.as_reader().read_to_string(&mut body) {
            respond_json(
                request,
                400,
                format!("{{\"error\":\"{}\"}}", err.to_string().replace('"', "\\\"")),
            );
            return;
        }

        let payload = match serde_json::from_str::<MobileOverlayToggleInput>(&body) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.to_string().replace('"', "\\\"")),
                );
                return;
            }
        };

        if payload.slug.trim().is_empty()
            || payload.event_id.trim().is_empty()
            || payload.set_id.trim().is_empty()
        {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and setId are required\"}".to_owned(),
            );
            return;
        }

        if payload.enabled {
            if let Err(err) =
                ensure_mobile_set_has_no_active_calls(app, &payload.event_id, &payload.set_id)
            {
                respond_json(
                    request,
                    409,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        }

        let input = ObsOverlaySetInput {
            enabled: payload.enabled,
            slug: payload.slug.clone(),
            event_id: payload.event_id.clone(),
            set_id: payload.set_id.clone(),
            event_name: payload.event_name.clone(),
            event_alias: payload.event_alias.clone(),
            round_text: payload.round_text.clone(),
            red_player_name: payload.red_player_name.clone(),
            blue_player_name: payload.blue_player_name.clone(),
            red_set_wins: payload.red_set_wins,
            blue_set_wins: payload.blue_set_wins,
            font_scale: payload.font_scale,
        };

        let state = if payload.enabled {
            match apply_obs_overlay_toggle(app, input.clone(), payload.force_switch) {
                Ok(value) => value,
                Err(err) if !payload.force_switch => {
                    if let Ok(current) = snapshot_obs_overlay_state() {
                        if current.active
                            && current.current_set_id.as_deref() != Some(payload.set_id.as_str())
                        {
                            respond_json(
                                request,
                                409,
                                serde_json::to_string(&current).unwrap_or_else(|_| "{}".to_owned()),
                            );
                            return;
                        }
                    }
                    respond_json(
                        request,
                        500,
                        format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                    );
                    return;
                }
                Err(err) => {
                    respond_json(
                        request,
                        500,
                        format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                    );
                    return;
                }
            }
        } else {
            match apply_obs_overlay_toggle(app, input, false) {
                Ok(value) => value,
                Err(err) => {
                    if let Ok(current) = snapshot_obs_overlay_state() {
                        if current.active
                            && current.current_set_id.as_deref() != Some(payload.set_id.as_str())
                        {
                            respond_json(
                                request,
                                409,
                                serde_json::to_string(&current).unwrap_or_else(|_| "{}".to_owned()),
                            );
                            return;
                        }
                    }
                    respond_json(
                        request,
                        500,
                        format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                    );
                    return;
                }
            }
        };

        emit_obs_overlay_state_changed(app);
        let result = serde_json::to_string(&state).unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, result);
        return;
    }

    if path == "/mobile/api/overlay-stop" && request.method() == &tiny_http::Method::Post {
        let query_slug = query_param_from_url(request.url(), "slug").unwrap_or_default();
        let query_event_id = query_param_from_url(request.url(), "eventId").unwrap_or_default();
        let query_token = query_param_from_url(request.url(), "token").unwrap_or_default();

        if query_slug.trim().is_empty()
            || query_event_id.trim().is_empty()
            || query_token.trim().is_empty()
        {
            respond_json(
                request,
                400,
                "{\"error\":\"slug, eventId and token are required\"}".to_owned(),
            );
            return;
        }

        let token = match current_mobile_input_token() {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        if query_token != token {
            respond_json(request, 401, "{\"error\":\"invalid token\"}".to_owned());
            return;
        }

        let state = match set_obs_overlay_fully_stopped(true) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        emit_obs_overlay_state_changed(app);
        let result = serde_json::to_string(&state).unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, result);
        return;
    }

    if path == "/mobile/api/result-requests" && request.method() == &tiny_http::Method::Post {
        let mut body = String::new();
        if let Err(err) = request.as_reader().read_to_string(&mut body) {
            respond_json(
                request,
                400,
                format!("{{\"error\":\"{}\"}}", err.to_string().replace('"', "\\\"")),
            );
            return;
        }

        let payload = match serde_json::from_str::<MobileResultRequestInput>(&body) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.to_string().replace('"', "\\\"")),
                );
                return;
            }
        };

        let workspace = match load_target_workspace(app, &payload.slug, &payload.event_id) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    400,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let Some(target_set) = workspace
            .snapshot
            .events
            .iter()
            .find(|event| event.event_id == payload.event_id)
            .and_then(|event| resolve_mobile_set_entrants(event, &payload.set_id))
        else {
            respond_json(
                request,
                400,
                "{\"error\":\"target set does not exist\"}".to_owned(),
            );
            return;
        };

        if storage::is_set_score_edit_locked(&workspace, &payload.event_id, &payload.set_id) {
            respond_json(
                request,
                423,
                "{\"error\":\"このプールは編集ロック中のため、スマートフォンから結果を送信できません。\"}".to_owned(),
            );
            return;
        }

        let known_entrant_ids = target_set
            .slots
            .iter()
            .filter_map(|slot| slot.entrant_id.clone())
            .collect::<Vec<String>>();

        if let Some(winner_id) = payload.winner_id.as_deref() {
            if !winner_id.trim().is_empty() && !known_entrant_ids.iter().any(|id| id == winner_id) {
                respond_json(
                    request,
                    400,
                    "{\"error\":\"winnerId is not in target set\"}".to_owned(),
                );
                return;
            }
        }

        for slot in &payload.slot_scores {
            if !known_entrant_ids.iter().any(|id| id == &slot.entrant_id) {
                respond_json(
                    request,
                    400,
                    "{\"error\":\"slotScores contains unknown entrantId\"}".to_owned(),
                );
                return;
            }
        }

        let stored = match storage::append_mobile_result_request(app, payload) {
            Ok(value) => value,
            Err(err) => {
                respond_json(
                    request,
                    500,
                    format!("{{\"error\":\"{}\"}}", err.replace('"', "\\\"")),
                );
                return;
            }
        };

        let response = serde_json::to_string(&stored).unwrap_or_else(|_| "{}".to_owned());
        respond_json(request, 200, response);
        return;
    }

    let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
}

fn start_mobile_input_server_if_needed(app: tauri::AppHandle) -> Result<(), String> {
    if mobile_input_server_running().load(Ordering::SeqCst) {
        return Ok(());
    }

    let server = Server::http(format!("0.0.0.0:{MOBILE_INPUT_PORT}"))
        .map_err(|e| format!("スマートフォン入力Webサーバーの起動に失敗しました: {e}"))?;

    mobile_input_server_running().store(true, Ordering::SeqCst);

    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_mobile_input_http_request(&app, request);
        }
        mobile_input_server_running().store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
fn get_obs_overlay_state() -> Result<ObsOverlayState, String> {
    start_obs_overlay_server_if_needed()?;
    snapshot_obs_overlay_state()
}

#[tauri::command]
fn set_obs_overlay_font_scale(font_scale: f64) -> Result<ObsOverlayState, String> {
    start_obs_overlay_server_if_needed()?;

    let mut guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    let next_scale = clamp_font_scale(font_scale);
    guard.preview_font_scale = next_scale;
    if let Some(active) = guard.active_set.as_mut() {
        active.font_scale = next_scale;
    }

    drop(guard);
    snapshot_obs_overlay_state()
}

#[tauri::command]
fn set_obs_overlay_name_fit_mode(name_fit_mode: String) -> Result<ObsOverlayState, String> {
    start_obs_overlay_server_if_needed()?;

    let mut guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    guard.name_fit_mode = normalize_name_fit_mode(&name_fit_mode).to_owned();
    drop(guard);
    snapshot_obs_overlay_state()
}

#[tauri::command]
fn set_obs_overlay_show_set_info(show_set_info: bool) -> Result<ObsOverlayState, String> {
    start_obs_overlay_server_if_needed()?;

    let mut guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    guard.show_set_info = show_set_info;
    drop(guard);
    snapshot_obs_overlay_state()
}

#[tauri::command]
fn set_obs_overlay_show_event_alias(show_event_alias: bool) -> Result<ObsOverlayState, String> {
    start_obs_overlay_server_if_needed()?;

    let mut guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    guard.show_event_alias = show_event_alias;
    drop(guard);
    snapshot_obs_overlay_state()
}

#[tauri::command]
fn set_obs_overlay_fully_stopped(fully_stopped: bool) -> Result<ObsOverlayState, String> {
    start_obs_overlay_server_if_needed()?;

    let mut guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    guard.fully_stopped = fully_stopped;
    if fully_stopped {
        guard.active_set = None;
    }

    drop(guard);
    let state = snapshot_obs_overlay_state()?;
    Ok(state)
}

fn apply_obs_overlay_toggle(
    app: &tauri::AppHandle,
    input: ObsOverlaySetInput,
    force_switch: bool,
) -> Result<ObsOverlayState, String> {
    let set_id = input.set_id.trim().to_owned();

    if input.enabled {
        if set_id.is_empty() {
            return Err("配信対象のsetIdが未指定です。".to_owned());
        }
        start_obs_overlay_server_if_needed()?;
    }

    let mut guard = obs_overlay_state()
        .lock()
        .map_err(|_| "オーバーレイ状態のロック取得に失敗しました。".to_owned())?;

    let next_scale = clamp_font_scale(input.font_scale);

    if input.enabled {
        if let Some(active) = &guard.active_set {
            if active.set_id != set_id {
                if !force_switch {
                    return Err(format!("すでに別のsetが配信中です: {}", active.set_id));
                }
            }
        }

        if input.starts_new_set(guard.active_set.as_ref().map(|active| active.set_id.as_str())) {
            if input.slug.trim().is_empty() || input.event_id.trim().is_empty() {
                return Err("配信開始時刻の保存には大会slugとeventIdが必要です。".to_owned());
            }
            let mut workspace = storage::load_workspace(app, &input.slug, &input.event_id)?;
            let set = workspace
                .snapshot
                .events
                .iter()
                .find(|event| event.event_id == input.event_id)
                .and_then(|event| resolve_mobile_set_entrants(event, &set_id))
                .ok_or_else(|| format!("配信対象のsetが見つかりません: {set_id}"))?;
            if storage::record_set_stream_start(
                &mut workspace,
                &input.event_id,
                &set,
                chrono::Utc::now(),
            ) {
                storage::save_local_meta(app, &input.event_id, &workspace.local_meta)?;
            }
        }

        let red_name = {
            let trimmed = input.red_player_name.trim();
            if trimmed.is_empty() {
                "RED".to_owned()
            } else {
                trimmed.to_owned()
            }
        };
        let blue_name = {
            let trimmed = input.blue_player_name.trim();
            if trimmed.is_empty() {
                "BLUE".to_owned()
            } else {
                trimmed.to_owned()
            }
        };

        guard.active_set = Some(ObsOverlayActiveSet {
            set_id,
            event_name: input.event_name.trim().to_owned(),
            event_alias: input.event_alias.trim().to_owned(),
            round_text: input.round_text.trim().to_owned(),
            red_player_name: red_name,
            blue_player_name: blue_name,
            red_set_wins: input.red_set_wins,
            blue_set_wins: input.blue_set_wins,
            font_scale: next_scale,
        });
        guard.event_alias = input.event_alias.trim().to_owned();
        guard.fully_stopped = false;
        guard.preview_font_scale = next_scale;
    } else if let Some(active) = &guard.active_set {
        if !set_id.is_empty() && active.set_id != set_id {
            return Err(format!(
                "配信停止対象のsetが現在の配信setと一致しません。現在: {}",
                active.set_id
            ));
        }
        guard.active_set = None;
        guard.preview_font_scale = next_scale;
    } else {
        guard.preview_font_scale = next_scale;
    }

    drop(guard);
    snapshot_obs_overlay_state()
}

#[tauri::command]
fn toggle_obs_overlay_set(
    app: tauri::AppHandle,
    input: ObsOverlaySetInput,
) -> Result<ObsOverlayState, String> {
    apply_obs_overlay_toggle(&app, input, false)
}

#[tauri::command]
fn force_toggle_obs_overlay_set(
    app: tauri::AppHandle,
    input: ObsOverlaySetInput,
) -> Result<ObsOverlayState, String> {
    apply_obs_overlay_toggle(&app, input, true)
}

fn local_ipv4_score(ip: &std::net::Ipv4Addr) -> i32 {
    if ip.is_private() {
        return 3;
    }
    if ip.is_link_local() {
        return 2;
    }
    if !ip.is_loopback() && !ip.is_unspecified() {
        return 1;
    }
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalNetworkSettingsCandidate {
    bind_ip: String,
    broadcast_subnet_mask: String,
    source: String,
    interface_name: String,
}

fn source_label_for_ipv4(ip: &Ipv4Addr) -> &'static str {
    if ip.is_link_local() {
        "LLA"
    } else if ip.is_private() {
        "DHCP/Private"
    } else {
        "IPv4"
    }
}

fn detect_local_network_settings_candidates() -> Result<Vec<LocalNetworkSettingsCandidate>, String>
{
    let interfaces =
        get_if_addrs().map_err(|e| format!("ネットワークIFの取得に失敗しました: {e}"))?;

    let mut candidates = interfaces
        .into_iter()
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(addr) if !addr.ip.is_loopback() && !addr.ip.is_unspecified() => {
                Some(LocalNetworkSettingsCandidate {
                    bind_ip: addr.ip.to_string(),
                    broadcast_subnet_mask: addr.netmask.to_string(),
                    source: source_label_for_ipv4(&addr.ip).to_owned(),
                    interface_name: iface.name,
                })
            }
            _ => None,
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        let left_ip = left.bind_ip.parse::<Ipv4Addr>().ok();
        let right_ip = right.bind_ip.parse::<Ipv4Addr>().ok();
        let left_score = left_ip.as_ref().map(local_ipv4_score).unwrap_or(0);
        let right_score = right_ip.as_ref().map(local_ipv4_score).unwrap_or(0);

        right_score
            .cmp(&left_score)
            .then_with(|| left.bind_ip.cmp(&right.bind_ip))
    });

    Ok(candidates)
}

fn detect_local_network_settings_candidate() -> Result<Option<LocalNetworkSettingsCandidate>, String>
{
    Ok(detect_local_network_settings_candidates()?
        .into_iter()
        .next())
}

#[tauri::command]
fn detect_local_ipv4() -> Result<Option<String>, String> {
    Ok(detect_local_network_settings_candidate()?.map(|item| item.bind_ip))
}

#[tauri::command]
fn detect_local_network_settings() -> Result<Option<LocalNetworkSettingsCandidate>, String> {
    detect_local_network_settings_candidate()
}

#[tauri::command]
fn list_local_network_settings() -> Result<Vec<LocalNetworkSettingsCandidate>, String> {
    detect_local_network_settings_candidates()
}

#[tauri::command]
fn get_mobile_input_portal_info(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<MobileInputPortalInfo, String> {
    if slug.trim().is_empty() || event_id.trim().is_empty() {
        return Err("slug と eventId は必須です。".to_owned());
    }

    let _ = storage::load_workspace(&app, &slug, &event_id)?;
    start_mobile_input_server_if_needed(app.clone())?;
    let token = rotate_mobile_input_token()?;

    let build_url = |host: &str| {
        format!(
            "http://{}:{}/mobile?slug={}&eventId={}&token={}",
            host, MOBILE_INPUT_PORT, slug, event_id, token
        )
    };

    let mut access_urls = Vec::new();

    if let Ok(candidates) = detect_local_network_settings_candidates() {
        for candidate in candidates {
            let host = candidate.bind_ip.trim();
            if host.is_empty() {
                continue;
            }
            access_urls.push(build_url(host));
        }
    }

    // localhostは同一PC専用のため、スマートフォン利用向けには最後にフォールバックとして追加する。
    access_urls.push(build_url("127.0.0.1"));

    access_urls.dedup();

    Ok(MobileInputPortalInfo {
        url: access_urls
            .first()
            .cloned()
            .unwrap_or_else(|| build_url("127.0.0.1")),
        access_urls,
        token,
    })
}

#[tauri::command]
fn load_mobile_result_requests_for_event(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<Vec<MobileResultRequestItem>, String> {
    let mut items = storage::load_mobile_result_requests(&app)?;
    items.retain(|item| item.slug == slug && item.event_id == event_id);
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(items)
}

#[tauri::command]
fn test_sender_network(profile: SenderProfile) -> Result<String, String> {
    validate_sender_profile(&profile)?;

    let sender_bind_addr = format!("{}:0", profile.bind_ip.trim());
    let socket = UdpSocket::bind(&sender_bind_addr)
        .map_err(|e| format!("送信元IPへバインドできませんでした ({sender_bind_addr}): {e}"))?;

    socket
        .set_broadcast(true)
        .map_err(|e| format!("ブロードキャスト設定に失敗しました: {e}"))?;

    let broadcast_ip = compute_broadcast_ip(&profile.bind_ip, &profile.broadcast_subnet_mask)?;
    let target_addr = format!("{}:{}", broadcast_ip, UDP_MAILBOX_PORT);

    socket
        .send_to(b"network-check", &target_addr)
        .map_err(|e| format!("簡易ネットワークテストに失敗しました ({target_addr}): {e}"))?;

    Ok(format!(
        "ネットワークテスト成功: {} -> {}",
        profile.bind_ip.trim(),
        target_addr
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UdpMailboxPacket {
    protocol: String,
    delivery_target_mode: String,
    delivery_target_ip: Option<String>,
    message: FeatureMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMailboxMessageInput {
    destination: Option<String>,
    profile: SenderProfile,
    method: String,
    subject: String,
    body: String,
    delivery_target_mode: String,
    delivery_target_ip: Option<String>,
    message_type: Option<String>,
    message_meta: Option<serde_json::Value>,
    thread_id: Option<String>,
    parent_message_id: Option<String>,
}

fn validate_sender_profile(profile: &SenderProfile) -> Result<(), String> {
    if profile.sender_name.trim().is_empty() {
        return Err("送信者名を入力してください。".to_owned());
    }
    if profile.sender_user_id.trim().len() != 8
        || !profile
            .sender_user_id
            .trim()
            .chars()
            .all(|ch| ch.is_ascii_digit())
    {
        return Err("ユーザーIDは8桁の数字で入力してください。".to_owned());
    }
    if profile
        .bind_ip
        .trim()
        .parse::<std::net::Ipv4Addr>()
        .is_err()
    {
        return Err("自分のIPはIPv4形式で入力してください。例: 192.168.1.10".to_owned());
    }
    if profile
        .broadcast_subnet_mask
        .trim()
        .parse::<std::net::Ipv4Addr>()
        .is_err()
    {
        return Err(
            "ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0"
                .to_owned(),
        );
    }
    Ok(())
}

fn normalize_delivery_target_mode(mode: &str) -> String {
    mode.trim().to_ascii_lowercase()
}

fn split_delivery_target_ips(target_ip: Option<&str>) -> Vec<String> {
    let Some(raw) = target_ip
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Vec::new();
    };

    raw.split([' ', ',', ';', '\n', '\r', '\t'])
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_owned())
        .collect()
}

fn compute_broadcast_ip(bind_ip: &str, subnet_mask: &str) -> Result<String, String> {
    let bind = bind_ip
        .trim()
        .parse::<Ipv4Addr>()
        .map_err(|_| "自分のIPはIPv4形式で入力してください。例: 192.168.1.10".to_owned())?;
    let mask = subnet_mask.trim().parse::<Ipv4Addr>().map_err(|_| {
        "ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0"
            .to_owned()
    })?;

    let bind_u32 = u32::from(bind);
    let mask_u32 = u32::from(mask);
    let broadcast_u32 = (bind_u32 & mask_u32) | (!mask_u32);

    Ok(Ipv4Addr::from(broadcast_u32).to_string())
}

fn resolve_delivery_target_ips(
    profile: &SenderProfile,
    mode: &str,
    target_ip: Option<&str>,
) -> Result<Vec<String>, String> {
    let normalized_mode = normalize_delivery_target_mode(mode);
    match normalized_mode.as_str() {
        "broadcast" => Ok(vec![compute_broadcast_ip(
            &profile.bind_ip,
            &profile.broadcast_subnet_mask,
        )?]),
        "direct" => {
            let ips = split_delivery_target_ips(target_ip);
            if ips.is_empty() {
                return Err("送信先IPを入力してください。".to_owned());
            }

            for ip in &ips {
                if ip.parse::<std::net::Ipv4Addr>().is_err() {
                    return Err("送信先IPはIPv4形式で入力してください。例: 192.168.1.20".to_owned());
                }
            }

            Ok(ips)
        }
        _ => Err("deliveryTargetMode は broadcast または direct を指定してください。".to_owned()),
    }
}

fn validate_delivery_target(
    mode: &str,
    target_ip: Option<&str>,
    profile: &SenderProfile,
) -> Result<(), String> {
    let _ = resolve_delivery_target_ips(profile, mode, target_ip)?;
    Ok(())
}

fn create_message_id(profile: &SenderProfile, method: &str, body: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let sequence = message_id_sequence().fetch_add(1, Ordering::Relaxed);

    format!(
        "{}-{:x}-{:x}-{:x}-{:x}",
        profile.sender_user_id.trim(),
        now,
        sequence,
        method.len(),
        body.len(),
    )
}

fn build_message_from_input(input: &SendMailboxMessageInput) -> Result<FeatureMessage, String> {
    validate_sender_profile(&input.profile)?;
    validate_delivery_target(
        &input.delivery_target_mode,
        input.delivery_target_ip.as_deref(),
        &input.profile,
    )?;

    let method = input.method.trim().to_ascii_lowercase();
    if method.is_empty() {
        return Err("メソッド名を入力してください。".to_owned());
    }

    let subject = input.subject.trim();
    if subject.is_empty() {
        return Err("件名を入力してください。".to_owned());
    }

    let body = input.body.trim();
    if body.is_empty() {
        return Err("本文を入力してください。".to_owned());
    }

    let message_type = input
        .message_type
        .as_ref()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "normal".to_owned());

    if message_type != "normal" && message_type != "resolve" && message_type != "dq_request" {
        return Err("messageType は normal / resolve / dq_request を指定してください。".to_owned());
    }

    let message_id = create_message_id(&input.profile, &method, body);
    let parent_message_id = input
        .parent_message_id
        .as_ref()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());

    let thread_id = input
        .thread_id
        .as_ref()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| message_id.clone());

    Ok(FeatureMessage {
        destination: Some(
            input.destination.as_deref().map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| {
                    if parent_message_id.is_some() && method == MAILBOX_METHOD_CALL_PLAYER {
                        if message_type == "dq_request" { "bracket" } else { "message" }
                    } else {
                        call_list::destination_for_method(&method)
                    }
                }).to_owned(),
        ),
        message_id,
        thread_id,
        parent_message_id,
        message_type,
        message_meta: input.message_meta.clone(),
        method,
        subject: subject.to_owned(),
        sender_name: input.profile.sender_name.trim().to_owned(),
        sender_user_id: input.profile.sender_user_id.trim().to_owned(),
        sender_ip: input.profile.bind_ip.trim().to_owned(),
        body: body.to_owned(),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn is_call_sync_method(method: &str) -> bool {
    method.trim().eq_ignore_ascii_case(MAILBOX_METHOD_CALL_SYNC)
        || method
            .trim()
            .eq_ignore_ascii_case(MAILBOX_METHOD_CALL_SYNC_REQUEST)
}

fn send_udp_mailbox_packet(
    profile: &SenderProfile,
    mode: &str,
    target_ip: Option<&str>,
    message: &FeatureMessage,
) -> Result<(), String> {
    let normalized_target_mode = normalize_delivery_target_mode(mode);
    let target_ips = resolve_delivery_target_ips(profile, &normalized_target_mode, target_ip)?;

    let packet = UdpMailboxPacket {
        protocol: MAILBOX_PROTOCOL.to_owned(),
        delivery_target_mode: normalized_target_mode.clone(),
        delivery_target_ip: match normalized_target_mode.as_str() {
            "broadcast" => None,
            "direct" => Some(target_ips.join(",")),
            _ => None,
        },
        message: message.clone(),
    };

    let sender_bind_addr = format!("{}:0", profile.bind_ip.trim());
    let socket = UdpSocket::bind(&sender_bind_addr)
        .map_err(|e| format!("UDP送信ソケットを起動できませんでした ({sender_bind_addr}): {e}"))?;

    if normalized_target_mode == "broadcast" {
        socket
            .set_broadcast(true)
            .map_err(|e| format!("UDPブロードキャスト設定に失敗しました: {e}"))?;
    }

    let payload = serde_json::to_vec(&packet)
        .map_err(|e| format!("送信データのJSON変換に失敗しました: {e}"))?;

    for ip in target_ips {
        let target_addr = format!("{}:{}", ip.trim(), UDP_MAILBOX_PORT);
        socket
            .send_to(&payload, &target_addr)
            .map_err(|e| format!("UDP送信に失敗しました ({target_addr}): {e}"))?;
    }

    Ok(())
}

fn meta_string(meta: Option<&serde_json::Value>, key: &str) -> Option<String> {
    let value = meta?.as_object()?.get(key)?.as_str()?.trim().to_owned();

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn report_mailbox_error(app: &tauri::AppHandle, error: &str) {
    eprintln!("[mailbox] {error}");
    if let Err(emit_error) = app.emit(call_list::ERROR_EVENT, error) {
        eprintln!("[mailbox] {emit_error}");
    }
}

fn start_udp_listener_thread(app: tauri::AppHandle, bind_ip: &str) -> Result<(), String> {
    let bind_addr = format!("{}:{}", bind_ip.trim(), UDP_MAILBOX_PORT);
    let socket = UdpSocket::bind(&bind_addr)
        .map_err(|e| format!("UDP受信ソケットを起動できませんでした ({bind_addr}): {e}"))?;
    socket
        .set_nonblocking(true)
        .map_err(|e| format!("UDP受信ソケットの非同期設定に失敗しました: {e}"))?;

    let running_flag = udp_listener_running();
    running_flag.store(true, Ordering::SeqCst);

    thread::spawn(move || {
        let mut buf = [0_u8; 65_535];

        loop {
            if !running_flag.load(Ordering::SeqCst) {
                break;
            }

            match socket.recv_from(&mut buf) {
                Ok((size, source_addr)) => {
                    let raw = match std::str::from_utf8(&buf[..size]) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };

                    let packet = match serde_json::from_str::<UdpMailboxPacket>(raw) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };

                    if packet.protocol != MAILBOX_PROTOCOL {
                        continue;
                    }

                    let my_profile = match storage::load_sender_profile(&app) {
                        Ok(profile) => profile,
                        Err(error) => {
                            report_mailbox_error(&app, &error);
                            continue;
                        }
                    };
                    if let Some(my_profile) = my_profile {
                        let sender_ip = source_addr.ip().to_string();
                        let is_sender_users_message =
                            sender_users::is_sender_users_message(&packet.message);
                        if my_profile.sender_user_id.trim() == packet.message.sender_user_id.trim()
                            && (!is_sender_users_message || sender_ip == my_profile.bind_ip.trim())
                        {
                            continue;
                        }

                        let accept_delivery =
                            match normalize_delivery_target_mode(&packet.delivery_target_mode)
                                .as_str()
                            {
                                "broadcast" => true,
                                "direct" => packet
                                    .delivery_target_ip
                                    .as_deref()
                                    .map(|value| {
                                        split_delivery_target_ips(Some(value))
                                            .iter()
                                            .any(|ip| ip.trim() == my_profile.bind_ip.trim())
                                    })
                                    .unwrap_or(false),
                                _ => false,
                            };

                        if !accept_delivery {
                            continue;
                        }

                        if is_sender_users_message {
                            if let Err(error) = sender_users::receive(
                                &app,
                                &my_profile,
                                &packet.message,
                                &sender_ip,
                            ) {
                                report_mailbox_error(&app, &error);
                            }
                            continue;
                        }

                        if call_list::is_call_list_message(&packet.message) {
                            if let Err(error) = call_list::receive(
                                &app,
                                &my_profile,
                                &packet.message,
                                &source_addr.ip().to_string(),
                            ) {
                                report_mailbox_error(&app, &error);
                            }
                            continue;
                        }

                        if bracket_messages::is_bracket_message(&packet.message) {
                            let mut message = packet.message.clone();
                            message.sender_ip = source_addr.ip().to_string();
                            if let Err(error) = bracket_messages::receive(&app, &my_profile.sender_user_id, &message) {
                                report_mailbox_error(&app, &error);
                            }
                            continue;
                        }

                    }

                    report_mailbox_error(&app, "送信者設定がないか、未対応の機能宛先です。汎用メッセージは受信しません。");
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(80));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(200));
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn start_udp_mailbox_service(app: tauri::AppHandle, profile: SenderProfile) -> Result<(), String> {
    validate_sender_profile(&profile)?;

    if udp_listener_running().load(Ordering::SeqCst) {
        return Ok(());
    }

    start_udp_listener_thread(app, &profile.bind_ip)
}

#[tauri::command]
fn stop_udp_mailbox_service() -> Result<(), String> {
    udp_listener_running().store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn send_mailbox_message(
    app: tauri::AppHandle,
    input: SendMailboxMessageInput,
) -> Result<FeatureMessage, String> {
    let message = build_message_from_input(&input)?;

    if sender_users::is_sender_users_message(&message) {
        return sender_users::send(&input, message);
    }

    if call_list::is_call_list_message(&message) {
        return call_list::send(&app, &input, message);
    }

    if bracket_messages::is_bracket_message(&message) {
        return bracket_messages::send(&app, &input, message);
    }

    Err("未対応の機能宛先またはメソッドです。汎用メッセージは廃止されています。".to_owned())
}

async fn refresh_workspace_after_remote_report(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    per_page: u32,
    reset_set_ids: &[String],
) -> Result<TournamentWorkspace, String> {
    let mut snapshot =
        fetch_event_snapshot_with_fallback(app, token, slug, event_id, per_page).await?;
    storage::clear_reset_set_results_from_snapshot(&mut snapshot, event_id, reset_set_ids);

    let existing_alias = storage::load_local_meta(app, slug, event_id)?
        .events
        .into_iter()
        .find(|item| item.event_id == event_id)
        .and_then(|item| item.event_alias);

    let local_meta = storage::save_event_snapshot(app, &snapshot, event_id, existing_alias)?;
    let snapshot = storage::load_snapshot(app, slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

fn normalize_optional_key(value: Option<&String>) -> String {
    value
        .map(|item| item.trim().to_lowercase())
        .unwrap_or_default()
}

async fn refresh_workspace_grand_final_reset_only(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    remote_reset_set_id: &str,
    source_grand_final_set_id: Option<&str>,
) -> Result<TournamentWorkspace, String> {
    let remote_reset_set = startgg::fetch_set_snapshot(token, remote_reset_set_id).await?;
    let mut snapshot = storage::load_snapshot(app, slug)?;

    let event = snapshot
        .events
        .iter_mut()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    let remote_phase = normalize_optional_key(remote_reset_set.phase_name.as_ref());
    let remote_group = normalize_optional_key(remote_reset_set.phase_group_name.as_ref());

    if let Some(source_set_id) = source_grand_final_set_id {
        let source_set = event
            .sets
            .iter()
            .find(|set| set.set_id == source_set_id)
            .cloned();
        let source_phase = source_set
            .as_ref()
            .map(|set| normalize_optional_key(set.phase_name.as_ref()))
            .unwrap_or_default();
        let source_group = source_set
            .as_ref()
            .map(|set| normalize_optional_key(set.phase_group_name.as_ref()))
            .unwrap_or_default();
        let virtual_set_id = format!("virtual_gf_reset_{source_set_id}");

        event.sets.retain(|set| {
            if set.set_id != virtual_set_id {
                return true;
            }

            if source_set.is_none() {
                return false;
            }

            let candidate_phase = normalize_optional_key(set.phase_name.as_ref());
            let candidate_group = normalize_optional_key(set.phase_group_name.as_ref());
            !(candidate_phase == source_phase && candidate_group == source_group)
        });
    }

    if let Some(found) = event
        .sets
        .iter_mut()
        .find(|set| set.set_id == remote_reset_set.set_id)
    {
        *found = remote_reset_set;
    } else {
        let insert_index = event
            .sets
            .iter()
            .position(|set| {
                let phase = normalize_optional_key(set.phase_name.as_ref());
                let group = normalize_optional_key(set.phase_group_name.as_ref());
                phase == remote_phase
                    && group == remote_group
                    && !is_grand_final_reset_text(&set.full_round_text)
            })
            .map(|index| index + 1)
            .unwrap_or(event.sets.len());
        event.sets.insert(insert_index, remote_reset_set);
    }

    storage::save_snapshot(app, &snapshot)?;
    storage::load_workspace(app, slug, event_id)
}

fn find_remote_grand_final_reset_set_for_source(
    event: &models::EventSnapshot,
    source_grand_final_set_id: &str,
) -> Option<SetSnapshot> {
    let source_grand_final_set = event
        .sets
        .iter()
        .find(|set| set.set_id == source_grand_final_set_id)
        .cloned();

    if let Some(source_grand_final_set) = source_grand_final_set {
        return event
            .sets
            .iter()
            .find(|set| {
                is_grand_final_reset_text(&set.full_round_text)
                    && !is_virtual_gf_reset_set_id(&set.set_id)
                    && set.phase_name == source_grand_final_set.phase_name
                    && set.phase_group_name == source_grand_final_set.phase_group_name
            })
            .cloned()
            .or_else(|| {
                event
                    .sets
                    .iter()
                    .find(|set| {
                        is_grand_final_reset_text(&set.full_round_text)
                            && !is_virtual_gf_reset_set_id(&set.set_id)
                    })
                    .cloned()
            });
    }

    event
        .sets
        .iter()
        .find(|set| {
            is_grand_final_reset_text(&set.full_round_text)
                && !is_virtual_gf_reset_set_id(&set.set_id)
        })
        .cloned()
}

async fn refresh_until_gf_reset_set_available(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    per_page: u32,
    source_grand_final_set_id: &str,
) -> Result<(TournamentWorkspace, Option<SetSnapshot>), String> {
    let mut workspace = match refresh_workspace_after_remote_report(
        app,
        token,
        slug,
        event_id,
        per_page,
        &[],
    )
    .await
    {
        Ok(value) => value,
        Err(_) => storage::load_workspace(app, slug, event_id)?,
    };

    for attempt in 0..GF_RESET_LINK_RETRY_ATTEMPTS {
        let remote_reset_set = workspace
            .snapshot
            .events
            .iter()
            .find(|event| event.event_id == event_id)
            .and_then(|event| {
                find_remote_grand_final_reset_set_for_source(event, source_grand_final_set_id)
            });

        if remote_reset_set.is_some() {
            return Ok((workspace, remote_reset_set));
        }

        if attempt + 1 >= GF_RESET_LINK_RETRY_ATTEMPTS {
            break;
        }

        sleep(Duration::from_millis(GF_RESET_LINK_RETRY_DELAY_MS)).await;
        workspace =
            match refresh_workspace_after_remote_report(app, token, slug, event_id, per_page, &[])
                .await
            {
                Ok(value) => value,
                Err(_) => storage::load_workspace(app, slug, event_id)?,
            };
    }

    Ok((workspace, None))
}

async fn fetch_event_snapshot_with_fallback(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    per_page: u32,
) -> Result<TournamentSnapshot, String> {
    emit_event_snapshot_progress(
        app,
        startgg::EventSnapshotFetchProgress {
            phase: "requestingTournamentPreview",
            completed_sets: 0,
            total_sets: None,
            current_page: None,
            current_set_id: None,
        },
    );
    let (event_slug, preview_error) = match startgg::fetch_tournament_preview(token, slug).await {
        Ok(preview) => (
            preview
                .events
                .iter()
                .find(|item| item.event_id == event_id)
                .and_then(|item| item.event_slug.clone()),
            None,
        ),
        Err(err) => (None, Some(err)),
    };

    let mut event_snapshot_error: Option<String> = None;

    if let Some(event_slug) = event_slug {
        match startgg::fetch_event_snapshot_by_slug(token, &event_slug, per_page, |progress| {
            emit_event_snapshot_progress(app, progress)
        })
        .await
        {
            Ok(mut snapshot) => {
                snapshot.slug = slug.to_owned();
                let set_count = snapshot
                    .events
                    .iter()
                    .find(|event| event.event_id == event_id)
                    .map(|event| event.sets.len())
                    .unwrap_or(0);
                if set_count > 0 {
                    return Ok(snapshot);
                }
                event_snapshot_error =
                    Some("event別取得では対象eventのsetが0件でした。".to_owned());
            }
            Err(err) => {
                event_snapshot_error = Some(err);
            }
        }
    }

    emit_event_snapshot_progress(
        app,
        startgg::EventSnapshotFetchProgress {
            phase: "requestingTournamentSnapshot",
            completed_sets: 0,
            total_sets: None,
            current_page: None,
            current_set_id: None,
        },
    );
    let mut snapshot = startgg::fetch_tournament_snapshot(token, slug, per_page).await?;
    snapshot.slug = slug.to_owned();

    let target_event_set_count = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.sets.len())
        .ok_or_else(|| format!("指定eventがtournament内に見つかりません: {event_id}"))?;

    if target_event_set_count == 0 {
        let mut reasons = Vec::new();
        if let Some(err) = preview_error {
            reasons.push(format!("preview取得失敗: {err}"));
        }
        if let Some(err) = event_snapshot_error {
            reasons.push(format!("event別取得失敗: {err}"));
        }

        if reasons.is_empty() {
            return Err("対象eventのsetが0件でした。start.gg側のブラケット生成状態と公開状態を確認してください。".to_owned());
        }

        return Err(format!(
            "対象eventのsetが0件でした。start.gg側のブラケット生成状態と公開状態を確認してください。詳細: {}",
            reasons.join(" / ")
        ));
    }

    Ok(snapshot)
}

async fn fetch_event_snapshot_for_manual_refresh(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    per_page: u32,
) -> Result<TournamentSnapshot, String> {
    emit_event_snapshot_progress(
        app,
        startgg::EventSnapshotFetchProgress {
            phase: "requestingTournamentPreview",
            completed_sets: 0,
            total_sets: None,
            current_page: None,
            current_set_id: None,
        },
    );
    let preview = startgg::fetch_tournament_preview(token, slug)
        .await
        .map_err(|error| {
            format!("イベント情報を取得できず、スナップショット更新を中止しました: {error}")
        })?;
    let event_slug = preview
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .and_then(|event| event.event_slug.clone())
        .ok_or_else(|| {
            format!("対象eventのslugを取得できず、スナップショット更新を中止しました: {event_id}")
        })?;

    let mut snapshot = startgg::fetch_event_snapshot_by_slug_strict(
        token,
        &event_slug,
        per_page,
        |progress| emit_event_snapshot_progress(app, progress),
    )
    .await
    .map_err(|error| {
        format!(
            "Setの取得に失敗したため、スナップショット更新をキャンセルしました。start.ggでブラケットがStart済みか確認してください。詳細: {error}"
        )
    })?;
    snapshot.slug = slug.to_owned();

    let target_event = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定eventが取得結果にありません: {event_id}"))?;
    if target_event.sets.is_empty() {
        return Err(
            "対象eventのSetを取得できなかったため、スナップショット更新をキャンセルしました。start.ggでブラケットがStart済みか確認してください。"
                .to_owned(),
        );
    }

    Ok(snapshot)
}

fn derive_tournament_slug_from_event_slug(event_slug: &str) -> Option<String> {
    let trimmed = event_slug.trim().trim_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    let marker = "/event/";
    let index = trimmed.find(marker)?;
    let prefix = trimmed[..index].trim_matches('/');
    if prefix.is_empty() {
        None
    } else {
        Some(prefix.to_owned())
    }
}

fn round_depth(round: Option<i64>) -> i64 {
    round.map(|value| value.abs()).unwrap_or(i64::MAX / 4)
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

fn derive_score_csv_from_set(set: &SetSnapshot, winner_id: &str) -> Option<String> {
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

fn is_grand_final_reset_text(text: &str) -> bool {
    let lowered = text.trim().to_lowercase();
    let has_grand_final = lowered.contains("grand final")
        || lowered.contains("grand finals")
        || lowered.contains("グランド")
        || lowered
            .split(|ch: char| !ch.is_alphanumeric())
            .any(|token| token.eq_ignore_ascii_case("gf"));
    let has_reset = lowered.contains("reset") || lowered.contains("リセット");
    has_grand_final && has_reset
}

fn is_virtual_gf_reset_set_id(set_id: &str) -> bool {
    set_id.starts_with(VIRTUAL_GF_RESET_SET_ID_PREFIX)
}

fn is_matchup_not_ready_error(err: &str) -> bool {
    err.contains("対戦の組み合わせが確定していないsetは報告できません")
}

async fn report_set_result_with_matchup_retry(
    token: &str,
    set_id: &str,
    winner_id: &str,
    score_csv: &str,
    force_overwrite: bool,
) -> Result<(), String> {
    let mut last_error = None::<String>;

    for attempt in 0..GF_RESET_REPORT_RETRY_ATTEMPTS {
        match startgg::report_set_result(token, set_id, winner_id, score_csv, force_overwrite).await
        {
            Ok(_) => return Ok(()),
            Err(err) => {
                let retryable = is_matchup_not_ready_error(&err)
                    || err.contains("指定setIdのsetが見つかりません")
                    || err.contains("指定setが見つかりません");
                last_error = Some(err.clone());

                if retryable && attempt + 1 < GF_RESET_REPORT_RETRY_ATTEMPTS {
                    sleep(Duration::from_millis(GF_RESET_REPORT_RETRY_DELAY_MS)).await;
                    continue;
                }

                return Err(err);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "GF Reset結果報告に失敗しました。".to_owned()))
}

fn resolve_event_alias(
    input_alias: Option<String>,
    snapshot: &TournamentSnapshot,
    event_id: &str,
) -> Option<String> {
    if let Some(alias) = input_alias {
        let trimmed = alias.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_owned());
        }
    }

    let tournament_name = snapshot.name.trim();
    let event_name = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.name.trim().to_owned())
        .unwrap_or_default();

    if tournament_name.is_empty() && event_name.is_empty() {
        None
    } else if tournament_name.is_empty() {
        Some(event_name)
    } else if event_name.is_empty() {
        Some(tournament_name.to_owned())
    } else {
        Some(format!("{tournament_name} / {event_name}"))
    }
}

#[tauri::command]
fn save_startgg_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    storage::save_token(&app, &token)
}

#[tauri::command]
fn load_saved_startgg_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    storage::load_saved_token(&app)
}

#[tauri::command]
fn save_last_slug(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    storage::save_slug(&app, &slug)
}

#[tauri::command]
fn load_last_slug(app: tauri::AppHandle) -> Result<Option<String>, String> {
    storage::load_slug(&app)
}

#[tauri::command]
fn save_last_snapshot_selection(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    phase_name: Option<String>,
    phase_group_name: Option<String>,
) -> Result<(), String> {
    storage::save_last_snapshot_selection(
        &app,
        &slug,
        &event_id,
        phase_name.as_deref(),
        phase_group_name.as_deref(),
    )
}

#[tauri::command]
fn load_last_snapshot_selection(
    app: tauri::AppHandle,
) -> Result<Option<storage::LastSnapshotSelection>, String> {
    storage::load_last_snapshot_selection(&app)
}

#[tauri::command]
fn save_event_last_phase_pool_selection(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    event_name: String,
    phase_name: Option<String>,
    phase_group_name: Option<String>,
) -> Result<(), String> {
    storage::set_event_last_phase_pool_selection(
        &app,
        &slug,
        &event_id,
        &event_name,
        phase_name.as_deref(),
        phase_group_name.as_deref(),
    )?;
    Ok(())
}

#[tauri::command]
fn load_item_lists(app: tauri::AppHandle) -> Result<Option<Vec<ItemListConfig>>, String> {
    storage::load_item_lists(&app)
}

#[tauri::command]
fn save_item_lists(app: tauri::AppHandle, item_lists: Vec<ItemListConfig>) -> Result<(), String> {
    storage::save_item_lists(&app, &item_lists)
}

#[tauri::command]
fn load_event_mgmt_settings(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    storage::load_event_mgmt_settings(&app)
}

#[tauri::command]
fn save_event_mgmt_settings(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    storage::save_event_mgmt_settings(&app, &settings)
}

#[tauri::command]
fn save_sender_profile(app: tauri::AppHandle, profile: SenderProfile) -> Result<(), String> {
    storage::save_sender_profile(&app, &profile)
}

#[tauri::command]
fn load_sender_profile(app: tauri::AppHandle) -> Result<Option<SenderProfile>, String> {
    storage::load_sender_profile(&app)
}

#[tauri::command]
fn save_event_alias(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    event_alias: Option<String>,
) -> Result<TournamentWorkspace, String> {
    let local_meta = storage::set_event_alias(&app, &slug, &event_id, event_alias)?;
    let snapshot = storage::load_snapshot(&app, &slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
fn save_event_management_meta(
    app: tauri::AppHandle,
    input: SaveEventManagementMetaInput,
) -> Result<TournamentWorkspace, String> {
    let local_meta = storage::save_event_management_meta(&app, input.clone())?;
    let snapshot = storage::load_snapshot(&app, &input.slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
fn load_local_tournament(
    app: tauri::AppHandle,
    slug: String,
) -> Result<TournamentSnapshot, String> {
    storage::load_snapshot(&app, &slug)
}

#[tauri::command]
fn load_local_tournament_workspace(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<TournamentWorkspace, String> {
    storage::load_workspace(&app, &slug, &event_id)
}

#[tauri::command]
async fn preview_tournament(
    app: tauri::AppHandle,
    slug: String,
) -> Result<TournamentPreview, String> {
    let token = storage::load_token(&app)?;
    let preview = startgg::fetch_tournament_preview(&token, &slug).await?;
    storage::reconcile_local_event_snapshot_names(
        &app,
        &slug,
        &preview.tournament_id,
        &preview.name,
        &preview.events,
    )?;
    Ok(preview)
}

fn validate_event_bracket_types(
    snapshot: &TournamentSnapshot,
    event_id: &str,
) -> Result<(), String> {
    let event = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| "対象eventがスナップショットに含まれていません。".to_owned())?;

    if startgg::event_has_only_supported_bracket_types(event) {
        return Ok(());
    }

    let bracket_types = event
        .phase_groups
        .iter()
        .map(|group| group.bracket_type.as_deref().unwrap_or("UNKNOWN"))
        .collect::<Vec<_>>();
    Err(format!(
        "対象eventには未対応のbracketTypeが含まれています。対応形式: SINGLE_ELIMINATION / DOUBLE_ELIMINATION / ROUND_ROBIN。取得値: {}",
        bracket_types.join(", ")
    ))
}

#[tauri::command]
async fn create_event_snapshot(
    app: tauri::AppHandle,
    input: CreateEventSnapshotInput,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let snapshot = fetch_event_snapshot_with_fallback(
        &app,
        &token,
        &input.slug,
        &input.event_id,
        input.per_page.unwrap_or(200),
    )
    .await?;
    validate_event_bracket_types(&snapshot, &input.event_id)?;
    let event_alias = resolve_event_alias(input.event_alias.clone(), &snapshot, &input.event_id);

    let local_meta = storage::save_event_snapshot_and_discard_pending(
        &app,
        &snapshot,
        &input.event_id,
        event_alias,
        &input.slug,
    )?;
    let snapshot = storage::load_snapshot(&app, &snapshot.slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
async fn create_event_snapshot_by_slug(
    app: tauri::AppHandle,
    input: CreateEventSnapshotBySlugInput,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let per_page = input.per_page.unwrap_or(200);
    let fallback_slug = if !input.tournament_slug.trim().is_empty() {
        input.tournament_slug.trim().to_owned()
    } else {
        derive_tournament_slug_from_event_slug(&input.event_slug).unwrap_or_default()
    };

    let mut target_event_id = None::<String>;
    let mut fetch_error_reason = None::<String>;

    let mut snapshot = match startgg::fetch_event_snapshot_by_slug(
        &token,
        &input.event_slug,
        per_page,
        |progress| emit_event_snapshot_progress(&app, progress),
    )
    .await
    {
        Ok(snapshot) => {
            target_event_id = snapshot.events.first().map(|event| event.event_id.clone());
            snapshot
        }
        Err(err) => {
            fetch_error_reason = Some(err);

            if fallback_slug.is_empty() {
                return Err("event slugの取得に失敗し、fallback先tournament slugも特定できませんでした。大会slugを指定して再実行してください。".to_owned());
            }

            emit_event_snapshot_progress(
                &app,
                startgg::EventSnapshotFetchProgress {
                    phase: "requestingTournamentSnapshot",
                    completed_sets: 0,
                    total_sets: None,
                    current_page: None,
                    current_set_id: None,
                },
            );
            let mut fallback_snapshot =
                startgg::fetch_tournament_snapshot(&token, &fallback_slug, per_page).await?;
            fallback_snapshot.slug = fallback_slug.clone();
            fallback_snapshot
        }
    };

    if target_event_id.is_none() && !fallback_slug.is_empty() {
        emit_event_snapshot_progress(
            &app,
            startgg::EventSnapshotFetchProgress {
                phase: "requestingTournamentPreview",
                completed_sets: 0,
                total_sets: None,
                current_page: None,
                current_set_id: None,
            },
        );
        if let Ok(preview) = startgg::fetch_tournament_preview(&token, &fallback_slug).await {
            let input_event_slug = input
                .event_slug
                .trim()
                .trim_matches('/')
                .to_ascii_lowercase();
            let matched_event_id = preview
                .events
                .iter()
                .find(|item| {
                    item.event_slug
                        .as_deref()
                        .map(|slug| {
                            slug.trim()
                                .trim_matches('/')
                                .eq_ignore_ascii_case(&input_event_slug)
                        })
                        .unwrap_or(false)
                })
                .map(|item| item.event_id.clone());

            if matched_event_id.is_some() {
                target_event_id = matched_event_id;
            }
        }
    }

    let event_id = target_event_id.ok_or_else(|| {
        format!(
            "event slugから対象eventを特定できませんでした: {}",
            input.event_slug
        )
    })?;

    validate_event_bracket_types(&snapshot, &event_id)?;

    let target_event_set_count = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.sets.len())
        .unwrap_or(0);

    if target_event_set_count == 0 && !fallback_slug.is_empty() {
        let mut fallback_snapshot =
            startgg::fetch_tournament_snapshot(&token, &fallback_slug, per_page).await?;
        fallback_snapshot.slug = fallback_slug.clone();
        snapshot = fallback_snapshot;
    }

    let target_event_set_count = snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .map(|event| event.sets.len())
        .unwrap_or(0);
    if target_event_set_count == 0 {
        if let Some(reason) = fetch_error_reason {
            return Err(format!(
                "対象eventのsetが0件でした。start.gg側のブラケット生成状態と公開状態を確認してください。event slug直接取得の失敗理由: {reason}"
            ));
        }
        return Err("対象eventのsetが0件でした。start.gg側のブラケット生成状態と公開状態を確認してください。".to_owned());
    }

    if !input.tournament_slug.trim().is_empty() {
        snapshot.slug = input.tournament_slug.clone();
    }

    let event_alias = resolve_event_alias(input.event_alias.clone(), &snapshot, &event_id);

    let local_meta = storage::save_event_snapshot_and_discard_pending(
        &app,
        &snapshot,
        &event_id,
        event_alias,
        &snapshot.slug,
    )?;
    let snapshot = storage::load_snapshot(&app, &snapshot.slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
async fn refresh_local_event_snapshot_from_remote(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    per_page: Option<u32>,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let snapshot = fetch_event_snapshot_for_manual_refresh(
        &app,
        &token,
        &slug,
        &event_id,
        per_page.unwrap_or(200),
    )
    .await?;

    let existing_alias = storage::load_local_meta(&app, &slug, &event_id)?
        .events
        .into_iter()
        .find(|item| item.event_id == event_id)
        .and_then(|item| item.event_alias);

    let local_meta = storage::save_event_snapshot_and_discard_pending(
        &app,
        &snapshot,
        &event_id,
        existing_alias,
        &slug,
    )?;
    let snapshot = storage::load_snapshot(&app, &slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
fn restore_local_event_graph_from_snapshot(
    app: tauri::AppHandle,
    input: RestoreEventGraphInput,
) -> Result<RestoreEventGraphResult, String> {
    storage::restore_event_graph_from_snapshot(&app, input)
}

#[tauri::command]
fn clear_local_set_stream_starts(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<TournamentWorkspace, String> {
    let workspace = storage::clear_set_stream_starts(&app, &slug, &event_id)?;
    emit_workspace_updated(&app, &slug, &event_id);
    Ok(workspace)
}

#[tauri::command]
fn update_local_set_stream_start(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    set_id: String,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<TournamentWorkspace, String> {
    let workspace = storage::update_set_stream_start(&app, &slug, &event_id, &set_id, started_at)?;
    emit_workspace_updated(&app, &slug, &event_id);
    Ok(workspace)
}

#[tauri::command]
async fn clear_local_set_result_drafts(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<TournamentWorkspace, String> {
    let local_meta = storage::clear_pending_set_results(&app, &slug, &event_id)?;
    let snapshot = storage::load_snapshot(&app, &slug)?;
    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
async fn clear_local_set_result_draft_for_set(
    app: tauri::AppHandle,
    input: ClearLocalSetResultDraftInput,
) -> Result<TournamentWorkspace, String> {
    storage::clear_pending_set_result_for_set(&app, &input.slug, &input.event_id, &input.set_id)
}

#[tauri::command]
fn list_local_snapshot_events(
    app: tauri::AppHandle,
) -> Result<Vec<LocalSnapshotEventListItem>, String> {
    storage::list_local_snapshot_events(&app)
}

#[tauri::command]
fn export_tournament_share_archive(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<TournamentShareArchive, String> {
    storage::export_tournament_share_archive(&app, &slug, &event_id)
}

#[tauri::command]
fn write_snapshot_export_file(path: String, contents: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(path);
    if !target
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("保存先はJSONファイルを指定してください。".to_owned());
    }
    std::fs::write(&target, contents)
        .map_err(|error| format!("スナップショットの保存に失敗しました: {error}"))
}

#[tauri::command]
fn import_tournament_share_archive(
    app: tauri::AppHandle,
    archive_json: String,
) -> Result<TournamentWorkspace, String> {
    storage::import_tournament_share_archive(&app, &archive_json)
}

#[tauri::command]
fn delete_local_snapshot_event(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<(), String> {
    storage::delete_local_snapshot_event(&app, &slug, &event_id)
}

#[tauri::command]
fn save_local_player_meta(
    app: tauri::AppHandle,
    input: LocalPlayerMetaInput,
) -> Result<TournamentWorkspace, String> {
    let local_meta = storage::upsert_local_player_meta(&app, input.clone())?;
    let snapshot = storage::load_snapshot(&app, &input.slug)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
fn derive_player_ids(
    tournament_id: String,
    event_id: String,
    entrant_ids: Vec<String>,
) -> Vec<String> {
    entrant_ids
        .iter()
        .map(|entrant_id| derive_player_id(&tournament_id, &event_id, entrant_id))
        .collect()
}

fn derive_player_id(tournament_id: &str, event_id: &str, entrant_id: &str) -> String {
    const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    let mut hasher = Sha256::new();
    hasher.update(tournament_id.as_bytes());
    hasher.update(b":");
    hasher.update(event_id.as_bytes());
    hasher.update(b":");
    hasher.update(entrant_id.as_bytes());
    let digest = hasher.finalize();

    let mut output = String::with_capacity(20);
    let mut buffer = 0_u32;
    let mut bits_left = 0_u32;
    for byte in digest.iter().take(12) {
        buffer = (buffer << 8) | u32::from(*byte);
        bits_left += 8;

        while bits_left >= 5 {
            let index = ((buffer >> (bits_left - 5)) & 31) as usize;
            output.push(BASE32_ALPHABET[index] as char);
            bits_left -= 5;
        }

        buffer &= (1 << bits_left) - 1;
    }

    if bits_left > 0 {
        let index = ((buffer << (5 - bits_left)) & 31) as usize;
        output.push(BASE32_ALPHABET[index] as char);
    }

    format!("PG-{output}")
}

#[cfg(test)]
mod player_id_tests {
    use super::derive_player_id;

    #[test]
    fn preserves_the_existing_player_id_format() {
        assert_eq!(
            derive_player_id("tournament", "event", "entrant"),
            "PG-X27RO6ABKZTEBCPNLJ4A"
        );
    }
}

#[tauri::command]
fn save_local_set_play_side(
    app: tauri::AppHandle,
    input: LocalSetPlaySideInput,
) -> Result<TournamentWorkspace, String> {
    storage::upsert_local_set_play_side(&app, input)
}

#[tauri::command]
fn set_phase_group_score_edit_lock(
    app: tauri::AppHandle,
    input: SetPhaseGroupScoreEditLockInput,
) -> Result<TournamentWorkspace, String> {
    storage::set_phase_group_score_edit_lock(&app, input)
}

#[tauri::command]
fn set_phase_group_external_score_broadcast(
    app: tauri::AppHandle,
    input: SetPhaseGroupExternalScoreBroadcastInput,
) -> Result<TournamentWorkspace, String> {
    storage::set_phase_group_external_score_broadcast(&app, input)
}

#[tauri::command]
fn set_phase_group_external_editor(
    app: tauri::AppHandle,
    input: SetPhaseGroupExternalEditorInput,
) -> Result<TournamentWorkspace, String> {
    storage::set_phase_group_external_editor(&app, input)
}

#[tauri::command]
fn clear_phase_group_external_editor(
    app: tauri::AppHandle,
    input: ClearPhaseGroupExternalEditorInput,
) -> Result<TournamentWorkspace, String> {
    storage::clear_phase_group_external_editor(&app, input)
}

#[tauri::command]
fn save_local_set_result(
    app: tauri::AppHandle,
    input: LocalSetResultInput,
) -> Result<TournamentWorkspace, String> {
    storage::upsert_local_set_result(&app, input)
}

#[tauri::command]
fn apply_external_score_report(
    app: tauri::AppHandle,
    input: ApplyExternalScoreReportInput,
) -> Result<TournamentWorkspace, String> {
    storage::apply_external_score_report(&app, input)
}

#[tauri::command]
fn save_local_set_scores(
    app: tauri::AppHandle,
    input: LocalSetScoreUpdateInput,
) -> Result<TournamentWorkspace, String> {
    storage::upsert_local_set_scores(&app, input)
}

#[tauri::command]
async fn report_confirmed_sets_from_bracket(
    app: tauri::AppHandle,
    input: BracketBatchReportInput,
) -> Result<BracketBatchReportResult, String> {
    reporting::report_confirmed_sets_from_bracket(app, input).await
}

#[tauri::command]
async fn report_initial_phase_seed_shuffle(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<TournamentWorkspace, String> {
    reporting::report_initial_phase_seed_shuffle(app, &slug, &event_id).await
}

#[tauri::command]
fn shuffle_initial_phase_seeds(
    app: tauri::AppHandle,
    input: ShuffleInitialPhaseSeedsInput,
) -> Result<TournamentWorkspace, String> {
    storage::shuffle_initial_phase_seeds(&app, input)
}

#[tauri::command]
async fn has_unreported_initial_phase_seed_shuffle(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<bool, String> {
    let Some((phase_id, _original, desired, _restore_requested)) =
        storage::initial_phase_seed_shuffle_for_report(&app, &slug, &event_id)?
    else {
        return Ok(false);
    };
    let token = storage::load_token(&app)?;
    let remote_mapping = startgg::current_phase_seed_mapping(&token, &phase_id).await?;
    Ok(remote_mapping != desired)
}

#[tauri::command]
fn restore_initial_phase_seeds(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<TournamentWorkspace, String> {
    storage::restore_initial_phase_seeds(&app, &slug, &event_id)
}

#[tauri::command]
fn has_local_initial_phase_seed_shuffle(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<bool, String> {
    storage::has_local_initial_phase_seed_shuffle(&app, &slug, &event_id)
}

#[tauri::command]
fn has_seed_update_awaiting_started_snapshot(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
) -> Result<bool, String> {
    storage::has_seed_update_awaiting_started_snapshot(&app, &slug, &event_id)
}

#[tauri::command]
async fn sync_tournament(
    app: tauri::AppHandle,
    slug: String,
    per_page: Option<u32>,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let mut snapshot = startgg::sync_tournament(&token, &slug, per_page.unwrap_or(200)).await?;
    snapshot.slug = slug.clone();
    storage::save_snapshot(&app, &snapshot)?;
    let event_id = snapshot
        .events
        .first()
        .map(|event| event.event_id.clone())
        .unwrap_or_default();
    let local_meta = storage::sync_local_meta_from_snapshot(&app, &snapshot, &event_id)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
async fn report_set_result(
    app: tauri::AppHandle,
    input: ReportSetResultInput,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;

    startgg::report_set_result(
        &token,
        &input.set_id,
        &input.winner_id,
        &input.score_csv,
        input.force_overwrite.unwrap_or(false),
    )
    .await?;

    // 報告後は必ず再同期して、start.ggとローカルの整合を取る。
    let mut snapshot = startgg::sync_tournament(&token, &input.slug, 200).await?;
    snapshot.slug = input.slug.clone();
    storage::save_snapshot(&app, &snapshot)?;
    let event_id = snapshot
        .events
        .first()
        .map(|event| event.event_id.clone())
        .unwrap_or_default();
    let local_meta = storage::sync_local_meta_from_snapshot(&app, &snapshot, &event_id)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

#[tauri::command]
async fn reset_set_result_cascade(
    app: tauri::AppHandle,
    input: ResetSetResultCascadeInput,
) -> Result<ResetSetResultCascadeResult, String> {
    let affected_set_ids = storage::list_affected_set_ids_for_reset(
        &app,
        &input.slug,
        &input.event_id,
        &input.set_id,
    )?;

    if affected_set_ids.is_empty() {
        return Err("取り消し対象setが見つかりませんでした。".to_owned());
    }
    let reset_remote = input.reset_remote.unwrap_or(false);
    if reset_remote {
        let token = storage::load_token(&app)?;
        let workspace_before = storage::load_workspace(&app, &input.slug, &input.event_id)?;
        if affected_set_ids.iter().any(|set_id| {
            storage::is_set_score_edit_locked(&workspace_before, &input.event_id, set_id)
        }) {
            return Err(
                "編集ロック中のプールが取り消し対象に含まれるため、結果を取り消せません。"
                    .to_owned(),
            );
        }
        let local_event = workspace_before
            .snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .ok_or_else(|| {
                format!(
                    "指定イベントがローカルsnapshotに見つかりません: {}",
                    input.event_id
                )
            })?;

        let mut reset_order = affected_set_ids.clone();
        reset_order.sort_by(|left, right| {
            let left_round = local_event
                .sets
                .iter()
                .find(|set| set.set_id == *left)
                .and_then(|set| set.round);
            let right_round = local_event
                .sets
                .iter()
                .find(|set| set.set_id == *right)
                .and_then(|set| set.round);

            round_depth(right_round)
                .cmp(&round_depth(left_round))
                .then_with(|| left.cmp(right))
        });

        for set_id in &reset_order {
            startgg::reset_set_result(&token, set_id).await?;
        }

        let mut workspace = refresh_workspace_after_remote_report(
            &app,
            &token,
            &input.slug,
            &input.event_id,
            input.per_page.unwrap_or(200),
            &reset_order,
        )
        .await?;
        let local_meta = storage::remove_pending_set_results(
            &app,
            &input.slug,
            &input.event_id,
            &affected_set_ids,
        )?;
        workspace.local_meta = local_meta;

        return Ok(ResetSetResultCascadeResult {
            workspace,
            affected_set_ids,
            remote_reset_applied: true,
        });
    }

    let (workspace, affected_set_ids) = storage::reset_local_set_result_with_dependencies(
        &app,
        &input.slug,
        &input.event_id,
        &input.set_id,
    )?;

    Ok(ResetSetResultCascadeResult {
        workspace,
        affected_set_ids,
        remote_reset_applied: false,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_startgg_token,
            load_saved_startgg_token,
            save_last_slug,
            load_last_slug,
            save_last_snapshot_selection,
            load_last_snapshot_selection,
            save_event_last_phase_pool_selection,
            load_item_lists,
            save_item_lists,
            load_event_mgmt_settings,
            save_event_mgmt_settings,
            detect_local_ipv4,
            detect_local_network_settings,
            list_local_network_settings,
            get_mobile_input_portal_info,
            load_mobile_result_requests_for_event,
            test_sender_network,
            get_obs_overlay_state,
            set_obs_overlay_font_scale,
            set_obs_overlay_name_fit_mode,
            set_obs_overlay_show_set_info,
            set_obs_overlay_show_event_alias,
            set_obs_overlay_fully_stopped,
            toggle_obs_overlay_set,
            force_toggle_obs_overlay_set,
            save_sender_profile,
            load_sender_profile,
            start_udp_mailbox_service,
            stop_udp_mailbox_service,
            send_mailbox_message,
            call_list::load_player_calls,
            bracket_messages::load_bracket_messages,
            bracket_messages::mark_bracket_message_processed,
            save_event_alias,
            save_event_management_meta,
            load_local_tournament,
            load_local_tournament_workspace,
            preview_tournament,
            list_local_snapshot_events,
            export_tournament_share_archive,
            write_snapshot_export_file,
            import_tournament_share_archive,
            delete_local_snapshot_event,
            create_event_snapshot,
            create_event_snapshot_by_slug,
            refresh_local_event_snapshot_from_remote,
            restore_local_event_graph_from_snapshot,
            clear_local_set_result_drafts,
            clear_local_set_stream_starts,
            update_local_set_stream_start,
            clear_local_set_result_draft_for_set,
            save_local_player_meta,
            derive_player_ids,
            save_local_set_play_side,
            set_phase_group_score_edit_lock,
            set_phase_group_external_score_broadcast,
            set_phase_group_external_editor,
            clear_phase_group_external_editor,
            save_local_set_result,
            apply_external_score_report,
            save_local_set_scores,
            report_confirmed_sets_from_bracket,
            report_initial_phase_seed_shuffle,
            shuffle_initial_phase_seeds,
            has_unreported_initial_phase_seed_shuffle,
            restore_initial_phase_seeds,
            has_local_initial_phase_seed_shuffle,
            has_seed_update_awaiting_started_snapshot,
            sync_tournament,
            report_set_result,
            reset_set_result_cascade
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
