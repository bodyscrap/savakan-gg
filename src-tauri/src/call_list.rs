use std::fs;
use std::sync::{Mutex, OnceLock};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::models::FeatureMessage;
use crate::{meta_string, send_udp_mailbox_packet, storage, SendMailboxMessageInput};

pub const DESTINATION: &str = "call_list";
pub const CHANGED_EVENT: &str = "player_calls_changed";
pub const ERROR_EVENT: &str = "message_delivery_error";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCall {
    pub message: FeatureMessage,
    pub received_at: String,
}

#[derive(Debug, PartialEq, Eq)]
struct CallKey {
    event: String,
    phase: String,
    phase_group: String,
    phase_id: Option<String>,
    phase_group_id: Option<String>,
    set: String,
    player: String,
}

fn key(message: &FeatureMessage) -> Result<CallKey, String> {
    let meta = message.message_meta.as_ref();
    let read = |scope: &str, fallback: &str| {
        meta_string(meta, scope).or_else(|| meta_string(meta, fallback))
    };
    Ok(CallKey {
        event: read("scopeEventId", "eventId").ok_or("呼び出しにイベントIDがありません。")?,
        phase: read("scopePhaseName", "phaseName").unwrap_or_else(|| "Phase 未設定".to_owned()),
        phase_group: read("scopePhaseGroupName", "phaseGroupName")
            .unwrap_or_else(|| "Pool 未設定".to_owned()),
        phase_id: meta_string(meta, "phaseId"),
        phase_group_id: meta_string(meta, "phaseGroupId"),
        set: meta_string(meta, "setId").ok_or("呼び出しにセットIDがありません。")?,
        player: meta_string(meta, "playerId")
            .ok_or("呼び出しにプレイヤーIDがありません。")?
            .to_ascii_uppercase(),
    })
}

pub fn destination_for_method(method: &str) -> &str {
    match method {
        "call_player" | "call_player_sync" | "call_player_sync_request" => DESTINATION,
        "external_edit_request"
        | "external_edit_request_response"
        | "external_score_report"
        | "external_score_report_response"
        | "external_score_sync_request"
        | "player_dq_request" => "bracket",
        _ => "message",
    }
}

pub fn is_call_list_message(message: &FeatureMessage) -> bool {
    if message.destination.is_none() && message.parent_message_id.is_some() {
        return false;
    }
    message
        .destination
        .as_deref()
        .unwrap_or_else(|| destination_for_method(&message.method))
        == DESTINATION
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn load(app: &tauri::AppHandle) -> Result<Vec<PlayerCall>, String> {
    load_from_path(&storage::call_list_path(app)?)
}

fn load_from_path(path: &std::path::Path) -> Result<Vec<PlayerCall>, String> {
    if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|e| format!("呼び出しリスト読込に失敗しました: {e}"))?;
        let calls: Vec<PlayerCall> = serde_json::from_str(&raw)
            .map_err(|e| format!("呼び出しリストのパースに失敗しました: {e}"))?;
        for call in &calls {
            key(&call.message)?;
        }
        return Ok(calls);
    }

    Ok(Vec::new())
}

fn save(app: &tauri::AppHandle, calls: &[PlayerCall]) -> Result<(), String> {
    save_to_path(&storage::call_list_path(app)?, calls)
}

fn save_to_path(path: &std::path::Path, calls: &[PlayerCall]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(calls)
        .map_err(|e| format!("呼び出しリストのJSON変換に失敗しました: {e}"))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, json).map_err(|e| format!("呼び出しリスト保存に失敗しました: {e}"))?;
    fs::rename(temporary, path).map_err(|e| format!("呼び出しリストの置換に失敗しました: {e}"))
}

fn same_call(
    call: &PlayerCall,
    message: &FeatureMessage,
    target: &CallKey,
    own_sender_user_id: &str,
) -> bool {
    (call.message.sender_user_id == own_sender_user_id)
        == (message.sender_user_id == own_sender_user_id)
        && key(&call.message)
            .map(|other| same_target(&other, target))
            .unwrap_or(false)
}

fn same_phase(
    left_id: &Option<String>,
    left_name: &str,
    right_id: &Option<String>,
    right_name: &str,
) -> bool {
    match (left_id, right_id) {
        (Some(left), Some(right)) => left == right,
        // Legacy calls contain phase/pool names but no IDs.
        _ => left_name == right_name,
    }
}

fn same_target(left: &CallKey, right: &CallKey) -> bool {
    left.event == right.event
        && left.set == right.set
        && left.player == right.player
        && same_phase(&left.phase_id, &left.phase, &right.phase_id, &right.phase)
        && same_phase(
            &left.phase_group_id,
            &left.phase_group,
            &right.phase_group_id,
            &right.phase_group,
        )
}

fn validate_dq_identity(call: &PlayerCall, request: &FeatureMessage) -> Result<(), String> {
    let target = key(&call.message)?;
    let meta = request.message_meta.as_ref();
    let entrant_id = meta_string(call.message.message_meta.as_ref(), "callEntrantId")
        .ok_or("呼び出しにDQ対象の参加者IDがありません。")?;
    if !same_target(&target, &key(request)?)
        || meta_string(meta, "dqPlayerId")
            .map(|id| id.to_ascii_uppercase())
            .as_deref()
            != Some(target.player.as_str())
        || meta_string(meta, "dqCallerSenderUserId").as_deref()
            != Some(call.message.sender_user_id.as_str())
        || meta_string(meta, "dqSetId").as_deref() != Some(target.set.as_str())
        || meta_string(meta, "dqCallEntrantId").as_deref() != Some(entrant_id.as_str())
        || request.sender_user_id == call.message.sender_user_id
    {
        return Err("DQ申請のPLAYER IDまたは呼び出し対象が一致しません。".to_owned());
    }
    Ok(())
}

pub fn validate_outgoing_dq(
    app: &tauri::AppHandle,
    input: &SendMailboxMessageInput,
    message: &FeatureMessage,
) -> Result<(), String> {
    validate_outgoing_dq_calls(&load_player_calls(app.clone())?, input, message)
}

fn validate_outgoing_dq_calls(
    calls: &[PlayerCall],
    input: &SendMailboxMessageInput,
    message: &FeatureMessage,
) -> Result<(), String> {
    let call_id = meta_string(message.message_meta.as_ref(), "dqCallMessageId")
        .ok_or("DQ申請に呼び出し元メッセージIDがありません。")?;
    let call = calls
        .iter()
        .find(|call| {
            call.message.message_id == call_id
                && call.message.sender_user_id != input.profile.sender_user_id
        })
        .ok_or("他端末の未解決の呼び出しが見つかりません。")?;
    validate_dq_identity(call, message)?;
    if input.delivery_target_ip.as_deref().map(str::trim) != Some(call.message.sender_ip.trim()) {
        return Err("DQ申請は呼び出し元の端末にだけ送信してください。".to_owned());
    }
    Ok(())
}

pub fn validate_incoming_dq(
    app: &tauri::AppHandle,
    own_sender_user_id: &str,
    message: &FeatureMessage,
) -> Result<(), String> {
    validate_incoming_dq_calls(
        &load_player_calls(app.clone())?,
        own_sender_user_id,
        message,
    )
}

fn validate_incoming_dq_calls(
    calls: &[PlayerCall],
    own_sender_user_id: &str,
    message: &FeatureMessage,
) -> Result<(), String> {
    let target = key(message)?;
    let call = calls
        .iter()
        .find(|call| {
            call.message.sender_user_id == own_sender_user_id
                && key(&call.message)
                    .map(|other| same_target(&other, &target))
                    .unwrap_or(false)
        })
        .ok_or("DQ申請に対応する自分の未解決の呼び出しがありません。")?;
    validate_dq_identity(call, message)
}

fn apply(
    calls: &mut Vec<PlayerCall>,
    message: &FeatureMessage,
    received_at: &str,
    own_sender_user_id: &str,
) -> Result<(), String> {
    let target = key(message)?;
    if message.message_type == "resolve" {
        calls.retain(|call| !same_call(call, message, &target, own_sender_user_id));
    } else if message.message_type == "normal" && message.parent_message_id.is_none() {
        let next = PlayerCall {
            message: message.clone(),
            received_at: received_at.to_owned(),
        };
        if let Some(index) = calls
            .iter()
            .position(|call| same_call(call, message, &target, own_sender_user_id))
        {
            calls[index] = next;
        } else {
            calls.push(next);
        }
    } else {
        return Err("呼び出しリストで未対応のメッセージです。".to_owned());
    }
    Ok(())
}

fn notify(app: &tauri::AppHandle) -> Result<(), String> {
    app.emit(CHANGED_EVENT, ())
        .map_err(|e| format!("呼び出しリスト更新通知に失敗しました: {e}"))
}

fn own_calls<'a>(
    calls: &'a [PlayerCall],
    sender_user_id: &'a str,
) -> impl Iterator<Item = &'a PlayerCall> {
    calls
        .iter()
        .filter(move |call| call.message.sender_user_id == sender_user_id)
}

fn resend_message(call: &PlayerCall, profile: &crate::models::SenderProfile) -> FeatureMessage {
    let mut reply = call.message.clone();
    reply.destination = Some(DESTINATION.to_owned());
    reply.sender_ip = profile.bind_ip.clone();
    reply
}

#[tauri::command]
pub fn load_player_calls(app: tauri::AppHandle) -> Result<Vec<PlayerCall>, String> {
    let _guard = lock()
        .lock()
        .map_err(|e| format!("呼び出しリストのロックに失敗しました: {e}"))?;
    load(&app)
}

pub fn send(
    app: &tauri::AppHandle,
    input: &SendMailboxMessageInput,
    message: FeatureMessage,
) -> Result<FeatureMessage, String> {
    let _guard = lock()
        .lock()
        .map_err(|e| format!("呼び出しリストのロックに失敗しました: {e}"))?;
    let mut calls = load(app)?;
    if crate::is_call_sync_method(&message.method) {
        if input.delivery_target_mode != "broadcast" {
            return Err("呼び出しの再送要求はブロードキャストで送信してください。".to_owned());
        }
        calls = own_calls(&calls, &input.profile.sender_user_id)
            .cloned()
            .collect();
        save(app, &calls)?;
        notify(app)?;
        send_udp_mailbox_packet(&input.profile, "broadcast", None, &message)?;
        return Ok(message);
    }
    if message.method != "call_player" {
        return Err("呼び出しリストで未対応のメソッドです。".to_owned());
    }
    if input.delivery_target_mode != "broadcast" {
        return Err("プレイヤー呼び出しと解決はブロードキャストで送信してください。".to_owned());
    }
    let target = key(&message)?;
    if message.message_type == "resolve"
        && !calls
            .iter()
            .any(|call| same_call(call, &message, &target, &input.profile.sender_user_id))
    {
        return Err("自分が発行した未解決の呼び出しのみ解決できます。".to_owned());
    }
    let now = Utc::now().to_rfc3339();
    apply(&mut calls, &message, &now, &input.profile.sender_user_id)?;
    send_udp_mailbox_packet(&input.profile, "broadcast", None, &message)?;
    save(app, &calls)?;
    notify(app)?;
    Ok(message)
}

pub fn receive(
    app: &tauri::AppHandle,
    profile: &crate::models::SenderProfile,
    message: &FeatureMessage,
    sender_ip: &str,
) -> Result<(), String> {
    let _guard = lock()
        .lock()
        .map_err(|e| format!("呼び出しリストのロックに失敗しました: {e}"))?;
    let mut calls = load(app)?;
    if crate::is_call_sync_method(&message.method) {
        for call in own_calls(&calls, &profile.sender_user_id) {
            // Preserve the original issue time, but use the current reply address.
            let reply = resend_message(call, profile);
            send_udp_mailbox_packet(profile, "direct", Some(sender_ip), &reply)?;
        }
        return Ok(());
    }
    if message.method != "call_player" {
        return Err("呼び出しリストで未対応のメソッドです。".to_owned());
    }
    apply(
        &mut calls,
        message,
        &Utc::now().to_rfc3339(),
        &profile.sender_user_id,
    )?;
    save(app, &calls)?;
    notify(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(sender: &str, kind: &str) -> FeatureMessage {
        FeatureMessage {
            destination: Some(DESTINATION.to_owned()),
            message_id: "call-1".to_owned(),
            thread_id: "unused".to_owned(),
            parent_message_id: None,
            message_type: kind.to_owned(),
            message_meta: Some(json!({
                "eventId": "event", "phaseId": "phase", "phaseGroupId": "pool",
                "setId": "set", "playerId": "pg-player"
            })),
            method: "call_player".to_owned(),
            subject: "Call".to_owned(),
            sender_name: "Operator".to_owned(),
            sender_user_id: sender.to_owned(),
            sender_ip: "192.168.1.10".to_owned(),
            body: "Call".to_owned(),
            created_at: "2026-10-14T00:00:00Z".to_owned(),
        }
    }

    fn dq_fixture() -> (Vec<PlayerCall>, FeatureMessage, SendMailboxMessageInput) {
        let mut root = message("12345678", "normal");
        root.message_meta.as_mut().unwrap()["callEntrantId"] = json!("entrant");
        let mut request = root.clone();
        request.message_id = "dq-request".to_owned();
        request.method = "player_dq_request".to_owned();
        request.message_type = "dq_request".to_owned();
        request.destination = Some("bracket".to_owned());
        request.sender_user_id = "87654321".to_owned();
        let meta = request.message_meta.as_mut().unwrap();
        meta["dqCallMessageId"] = json!(root.message_id);
        meta["dqCallerSenderUserId"] = json!(root.sender_user_id);
        meta["dqPlayerId"] = json!("pg-player");
        meta["dqCallEntrantId"] = json!("entrant");
        meta["dqSetId"] = json!("set");
        let input = SendMailboxMessageInput {
            destination: Some("bracket".to_owned()),
            profile: crate::models::SenderProfile {
                sender_name: "Requester".to_owned(),
                sender_user_id: request.sender_user_id.clone(),
                bind_ip: "192.168.1.20".to_owned(),
                broadcast_subnet_mask: "255.255.255.0".to_owned(),
            },
            method: request.method.clone(),
            subject: request.subject.clone(),
            body: request.body.clone(),
            delivery_target_mode: "direct".to_owned(),
            delivery_target_ip: Some(root.sender_ip.clone()),
            message_type: Some(request.message_type.clone()),
            message_meta: request.message_meta.clone(),
            thread_id: None,
            parent_message_id: None,
        };
        (
            vec![PlayerCall {
                message: root,
                received_at: "now".to_owned(),
            }],
            request,
            input,
        )
    }

    #[test]
    fn dq_authenticates_active_call_and_all_target_fields_on_both_sides() {
        let (calls, request, input) = dq_fixture();
        validate_outgoing_dq_calls(&calls, &input, &request).unwrap();
        validate_incoming_dq_calls(&calls, "12345678", &request).unwrap();
        for field in [
            "eventId",
            "phaseId",
            "phaseGroupId",
            "setId",
            "playerId",
            "dqPlayerId",
            "dqCallEntrantId",
            "dqCallerSenderUserId",
            "dqSetId",
        ] {
            let mut wrong = request.clone();
            wrong.message_meta.as_mut().unwrap()[field] = json!("wrong");
            assert!(
                validate_outgoing_dq_calls(&calls, &input, &wrong).is_err(),
                "{field}"
            );
            assert!(
                validate_incoming_dq_calls(&calls, "12345678", &wrong).is_err(),
                "{field}"
            );
        }
        assert!(validate_outgoing_dq_calls(&[], &input, &request).is_err());
        assert!(validate_incoming_dq_calls(&[], "12345678", &request).is_err());
        assert!(validate_incoming_dq_calls(&calls, "99999999", &request).is_err());
    }

    #[test]
    fn dq_rejects_own_call_wrong_recipient_and_stale_sender_card_but_receiver_matches_target() {
        let (mut calls, request, mut input) = dq_fixture();
        input.delivery_target_ip = Some("192.168.1.99".to_owned());
        assert!(validate_outgoing_dq_calls(&calls, &input, &request).is_err());
        input.delivery_target_ip = Some(calls[0].message.sender_ip.clone());
        input.profile.sender_user_id = calls[0].message.sender_user_id.clone();
        assert!(validate_outgoing_dq_calls(&calls, &input, &request).is_err());
        input.profile.sender_user_id = request.sender_user_id.clone();
        calls[0].message.message_id = "recalled".to_owned();
        assert!(validate_outgoing_dq_calls(&calls, &input, &request).is_err());
        validate_incoming_dq_calls(&calls, "12345678", &request).unwrap();
    }

    #[test]
    fn repeat_updates_receipt_without_history_and_preserves_issue_time() {
        let mut calls = Vec::new();
        let original = message("12345678", "normal");
        apply(&mut calls, &original, "2026-10-14T00:00:01Z", "12345678").unwrap();
        apply(&mut calls, &original, "2026-10-14T00:00:02Z", "12345678").unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].received_at, "2026-10-14T00:00:02Z");
        assert_eq!(calls[0].message.created_at, original.created_at);
    }

    #[test]
    fn own_and_remote_calls_are_independent_and_resolution_needs_no_thread() {
        let mut calls = Vec::new();
        apply(
            &mut calls,
            &message("12345678", "normal"),
            "now",
            "12345678",
        )
        .unwrap();
        apply(
            &mut calls,
            &message("87654321", "normal"),
            "now",
            "12345678",
        )
        .unwrap();
        let mut resolved = message("87654321", "resolve");
        resolved.thread_id = "different".to_owned();
        apply(&mut calls, &resolved, "now", "12345678").unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].message.sender_user_id, "12345678");
        apply(&mut calls, &resolved, "now", "12345678").unwrap();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn all_five_target_components_distinguish_calls() {
        for field in ["eventId", "phaseId", "phaseGroupId", "setId", "playerId"] {
            let mut calls = Vec::new();
            let original = message("12345678", "normal");
            let mut different = original.clone();
            different.message_meta.as_mut().unwrap()[field] = json!("different");
            apply(&mut calls, &original, "now", "12345678").unwrap();
            apply(&mut calls, &different, "now", "12345678").unwrap();
            assert_eq!(calls.len(), 2, "{field}");
        }
    }

    #[test]
    fn resend_clears_only_remote_calls_and_replies_with_original_issue_time() {
        let mut calls = Vec::new();
        apply(
            &mut calls,
            &message("12345678", "normal"),
            "received-own",
            "12345678",
        )
        .unwrap();
        apply(
            &mut calls,
            &message("87654321", "normal"),
            "received-remote",
            "12345678",
        )
        .unwrap();
        let profile = crate::models::SenderProfile {
            sender_name: "Operator".to_owned(),
            sender_user_id: "12345678".to_owned(),
            bind_ip: "192.168.1.20".to_owned(),
            broadcast_subnet_mask: "255.255.255.0".to_owned(),
        };
        let remaining: Vec<_> = own_calls(&calls, &profile.sender_user_id)
            .cloned()
            .collect();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].received_at, "received-own");
        let reply = resend_message(&remaining[0], &profile);
        assert_eq!(reply.created_at, "2026-10-14T00:00:00Z");
        assert_eq!(reply.sender_ip, profile.bind_ip);
        assert_eq!(reply.message_id, remaining[0].message.message_id);
        assert_eq!(reply.destination.as_deref(), Some(DESTINATION));

        let mut receiver = Vec::new();
        apply(&mut receiver, &reply, "received-again", "87654321").unwrap();
        assert_eq!(receiver.len(), 1);
        assert_eq!(receiver[0].received_at, "received-again");
        assert_eq!(receiver[0].message.created_at, reply.created_at);
    }

    #[test]
    fn legacy_replies_are_not_dispatched_as_calls() {
        let mut reply = message("12345678", "dq_request");
        reply.destination = None;
        reply.parent_message_id = Some("original".to_owned());
        assert!(!is_call_list_message(&reply));
        reply.parent_message_id = None;
        reply.message_type = "normal".to_owned();
        assert!(is_call_list_message(&reply));
    }

    #[test]
    fn persistent_state_can_replace_an_existing_file_without_a_thread_history() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "savakan-call-list-test-{}-{unique}.json",
            std::process::id(),
        ));
        let mut calls = Vec::new();
        apply(
            &mut calls,
            &message("12345678", "normal"),
            "first",
            "12345678",
        )
        .unwrap();
        save_to_path(&path, &calls).unwrap();
        apply(
            &mut calls,
            &message("12345678", "normal"),
            "second",
            "12345678",
        )
        .unwrap();
        save_to_path(&path, &calls).unwrap();
        let saved: Vec<PlayerCall> =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].received_at, "second");
        assert_eq!(saved[0].message.created_at, "2026-10-14T00:00:00Z");
        assert!(!path.with_extension("tmp").exists());
    }

    #[test]
    fn remote_senders_share_one_target_entry_and_either_can_resolve_it() {
        let mut calls = Vec::new();
        apply(
            &mut calls,
            &message("12345678", "normal"),
            "own",
            "12345678",
        )
        .unwrap();
        apply(
            &mut calls,
            &message("87654321", "normal"),
            "first",
            "12345678",
        )
        .unwrap();
        apply(
            &mut calls,
            &message("11111111", "normal"),
            "second",
            "12345678",
        )
        .unwrap();
        assert_eq!(calls.len(), 2);
        let remote = calls
            .iter()
            .find(|call| call.message.sender_user_id != "12345678")
            .unwrap();
        assert_eq!(remote.received_at, "second");
        assert_eq!(remote.message.sender_user_id, "11111111");
        apply(
            &mut calls,
            &message("87654321", "resolve"),
            "resolved",
            "12345678",
        )
        .unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].message.sender_user_id, "12345678");
    }

    #[test]
    fn recalled_legacy_name_only_call_is_updated_when_ids_are_added() {
        let mut calls = Vec::new();
        let mut legacy = message("12345678", "normal");
        legacy.message_meta = Some(json!({
            "eventId": "event", "scopePhaseName": "Main", "scopePhaseGroupName": "A",
            "setId": "set", "playerId": "PG-PLAYER",
        }));
        let mut current = message("12345678", "normal");
        current.message_meta.as_mut().unwrap()["phaseName"] = json!("Main");
        current.message_meta.as_mut().unwrap()["phaseGroupName"] = json!("A");
        apply(&mut calls, &legacy, "first", "12345678").unwrap();
        apply(&mut calls, &current, "second", "12345678").unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].received_at, "second");
        assert_eq!(
            calls[0].message.message_meta.as_ref().unwrap()["phaseId"],
            "phase"
        );
    }

    #[test]
    fn missing_dedicated_store_does_not_restore_calls_from_legacy_messages() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "savakan-call-list-no-restore-{}-{unique}",
            std::process::id(),
        ));
        fs::create_dir(&directory).unwrap();
        let legacy_path = directory.join("generic-messages.json");
        fs::write(
            &legacy_path,
            serde_json::to_string(&vec![message("12345678", "normal")]).unwrap(),
        )
        .unwrap();
        let call_list_path = directory.join("call-list.json");
        let calls = load_from_path(&call_list_path).unwrap();
        let dedicated_store_created = call_list_path.exists();
        fs::remove_file(legacy_path).unwrap();
        fs::remove_dir(directory).unwrap();
        assert!(calls.is_empty());
        assert!(!dedicated_store_created);
    }
}
