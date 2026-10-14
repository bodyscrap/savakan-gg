use std::collections::HashSet;
use std::fs;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::models::FeatureMessage;
use crate::{meta_string, send_udp_mailbox_packet, storage, SendMailboxMessageInput};

const CHANGED_EVENT: &str = "bracket_messages_changed";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BracketInbox {
    messages: Vec<FeatureMessage>,
    processed_message_ids: Vec<String>,
    #[serde(default)]
    sender_contacts: Vec<SenderContact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderContact {
    sender_user_id: String,
    sender_name: String,
    sender_ip: String,
}

fn is_external_method(method: &str) -> bool {
    matches!(
        method,
        "external_edit_request"
            | "external_edit_request_response"
            | "external_score_report"
            | "external_score_report_response"
            | "external_score_sync_request"
            | "player_dq_request"
    )
}

pub fn is_bracket_message(message: &FeatureMessage) -> bool {
    is_external_method(&message.method)
        && message.destination.as_deref().unwrap_or("bracket") == "bracket"
}

fn request_pool(message: &FeatureMessage) -> Result<(String, String, String), String> {
    let meta = message.message_meta.as_ref();
    Ok((
        meta_string(meta, "externalEditTournamentId")
            .ok_or("外部報告申請に大会IDがありません。")?,
        meta_string(meta, "externalEditEventId").ok_or("外部報告申請にイベントIDがありません。")?,
        meta_string(meta, "externalEditPhaseGroupId")
            .ok_or("外部報告申請にプールIDがありません。")?,
    ))
}

fn is_response(message: &FeatureMessage) -> bool {
    matches!(
        message.method.as_str(),
        "external_edit_request_response" | "external_score_report_response"
    ) || message.parent_message_id.is_some()
}

fn response_target(message: &FeatureMessage) -> Result<String, String> {
    meta_string(message.message_meta.as_ref(), "requestMessageId")
        .or_else(|| message.parent_message_id.clone())
        .ok_or_else(|| "応答に対象メッセージIDがありません。".to_owned())
}

fn mark_processed(inbox: &mut BracketInbox, message_id: &str) {
    inbox
        .messages
        .retain(|message| message.message_id != message_id);
    if !inbox
        .processed_message_ids
        .iter()
        .any(|id| id == message_id)
    {
        inbox.processed_message_ids.push(message_id.to_owned());
    }
}

fn remove_stale_dq_requests(
    inbox: &mut BracketInbox,
    active_call_message_ids: &HashSet<String>,
) -> usize {
    let stale_message_ids: Vec<String> = inbox
        .messages
        .iter()
        .filter(|message| message.method == "player_dq_request")
        .filter(|message| {
            meta_string(message.message_meta.as_ref(), "dqCallMessageId")
                .map_or(true, |call_id| !active_call_message_ids.contains(&call_id))
        })
        .map(|message| message.message_id.clone())
        .collect();

    for message_id in &stale_message_ids {
        mark_processed(inbox, message_id);
    }

    stale_message_ids.len()
}

fn apply(
    inbox: &mut BracketInbox,
    message: &FeatureMessage,
    own_sender_user_id: &str,
) -> Result<(), String> {
    if message.sender_user_id != own_sender_user_id {
        let contact = SenderContact {
            sender_user_id: message.sender_user_id.clone(),
            sender_name: message.sender_name.clone(),
            sender_ip: message.sender_ip.clone(),
        };
        if let Some(index) = inbox
            .sender_contacts
            .iter()
            .position(|item| item.sender_user_id == message.sender_user_id)
        {
            inbox.sender_contacts[index] = contact;
        } else {
            inbox.sender_contacts.push(contact);
        }
    }
    if is_response(message) {
        if message.sender_user_id == own_sender_user_id {
            mark_processed(inbox, &response_target(message)?);
        }
        return Ok(());
    }
    if message.sender_user_id == own_sender_user_id
        || inbox.processed_message_ids.contains(&message.message_id)
        || inbox
            .messages
            .iter()
            .any(|item| item.message_id == message.message_id)
    {
        return Ok(());
    }
    if message.method == "external_edit_request" {
        let pool = request_pool(message)?;
        let mut superseded = Vec::new();
        for existing in inbox
            .messages
            .iter()
            .filter(|item| item.method == "external_edit_request")
        {
            if request_pool(existing)? == pool {
                superseded.push(existing.message_id.clone());
            }
        }
        for message_id in superseded {
            mark_processed(inbox, &message_id);
        }
    }
    inbox.messages.push(message.clone());
    Ok(())
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn load(app: &tauri::AppHandle) -> Result<BracketInbox, String> {
    let path = storage::bracket_messages_path(app)?;
    if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|e| format!("ブラケット受信データ読込に失敗しました: {e}"))?;
        let mut inbox: BracketInbox = serde_json::from_str(&raw)
            .map_err(|e| format!("ブラケット受信データのパースに失敗しました: {e}"))?;
        for message in &inbox.messages {
            if !inbox
                .sender_contacts
                .iter()
                .any(|contact| contact.sender_user_id == message.sender_user_id)
            {
                inbox.sender_contacts.push(SenderContact {
                    sender_user_id: message.sender_user_id.clone(),
                    sender_name: message.sender_name.clone(),
                    sender_ip: message.sender_ip.clone(),
                });
            }
        }
        return Ok(inbox);
    }
    let sender = storage::load_sender_profile(app)?
        .map(|profile| profile.sender_user_id)
        .unwrap_or_default();
    let messages = storage::load_generic_messages(app)?.unwrap_or_default();
    let mut inbox = BracketInbox::default();
    for message in messages
        .iter()
        .rev()
        .filter(|message| is_bracket_message(message))
    {
        apply(&mut inbox, message, &sender)?;
    }
    save(app, &inbox)?;
    Ok(inbox)
}

fn save(app: &tauri::AppHandle, inbox: &BracketInbox) -> Result<(), String> {
    let path = storage::bracket_messages_path(app)?;
    let temporary = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(inbox)
        .map_err(|e| format!("ブラケット受信データのJSON変換に失敗しました: {e}"))?;
    fs::write(&temporary, json)
        .map_err(|e| format!("ブラケット受信データ保存に失敗しました: {e}"))?;
    fs::rename(temporary, path)
        .map_err(|e| format!("ブラケット受信データの置換に失敗しました: {e}"))
}

fn notify(app: &tauri::AppHandle) -> Result<(), String> {
    app.emit(CHANGED_EVENT, ())
        .map_err(|e| format!("ブラケット受信通知に失敗しました: {e}"))
}

#[tauri::command]
pub fn load_bracket_messages(app: tauri::AppHandle) -> Result<BracketInbox, String> {
    let _guard = lock()
        .lock()
        .map_err(|e| format!("ブラケット受信データのロックに失敗しました: {e}"))?;
    load(&app)
}

#[tauri::command]
pub fn mark_bracket_message_processed(
    app: tauri::AppHandle,
    message_id: String,
) -> Result<(), String> {
    if message_id.trim().is_empty() {
        return Err("処理済みにするメッセージIDがありません。".to_owned());
    }
    let _guard = lock()
        .lock()
        .map_err(|e| format!("ブラケット受信データのロックに失敗しました: {e}"))?;
    let mut inbox = load(&app)?;
    mark_processed(&mut inbox, &message_id);
    save(&app, &inbox)?;
    notify(&app)
}

pub fn discard_stale_dq_requests(
    app: &tauri::AppHandle,
    active_call_message_ids: &HashSet<String>,
) -> Result<(), String> {
    let _guard = lock()
        .lock()
        .map_err(|e| format!("ブラケット受信データのロックに失敗しました: {e}"))?;
    let mut inbox = load(app)?;
    if remove_stale_dq_requests(&mut inbox, active_call_message_ids) == 0 {
        return Ok(());
    }
    save(app, &inbox)?;
    notify(app)
}

fn validate_delivery(
    input: &SendMailboxMessageInput,
    message: &FeatureMessage,
) -> Result<(), String> {
    let expected_type = if message.method == "player_dq_request" {
        "dq_request"
    } else {
        "normal"
    };
    if message.method == "player_dq_request" && message.parent_message_id.is_some() {
        return Err("DQ申請はスレッドへの返信として送信できません。".to_owned());
    }
    if message.message_type != expected_type {
        return Err(format!(
            "ブラケットへのこのメッセージは {expected_type} を指定してください。"
        ));
    }
    let mode = crate::normalize_delivery_target_mode(&input.delivery_target_mode);
    let expected = if is_response(message)
        || message.method == "external_score_sync_request"
        || message.method == "player_dq_request"
    {
        "direct"
    } else if message.method == "external_score_report"
        && message
            .message_meta
            .as_ref()
            .and_then(|meta| meta.get("externalScoreReportResend"))
            .and_then(|value| value.as_bool())
            == Some(true)
    {
        "direct"
    } else {
        "broadcast"
    };
    if mode != expected {
        return Err(format!(
            "この機能メッセージの送信先は {expected} を指定してください。"
        ));
    }
    if mode == "direct"
        && crate::split_delivery_target_ips(input.delivery_target_ip.as_deref()).len() != 1
    {
        return Err("応答・同期の送信先は要求元の1端末だけを指定してください。".to_owned());
    }
    if message.method == "external_edit_request" && !is_response(message) {
        request_pool(message)?;
    }
    if is_response(message) {
        response_target(message)?;
        let status_key = match message.method.as_str() {
            "external_edit_request_response" => Some("externalEditRequestResponse"),
            "external_score_report_response" => Some("externalScoreReportResponse"),
            _ => None,
        };
        if let Some(status_key) = status_key {
            if !matches!(
                meta_string(message.message_meta.as_ref(), status_key).as_deref(),
                Some("accepted" | "rejected")
            ) {
                return Err("外部報告への応答は受理または拒否を指定してください。".to_owned());
            }
        }
    }
    Ok(())
}

pub fn send(
    app: &tauri::AppHandle,
    input: &SendMailboxMessageInput,
    message: FeatureMessage,
) -> Result<FeatureMessage, String> {
    validate_delivery(input, &message)?;
    if message.method == "player_dq_request" {
        crate::call_list::validate_outgoing_dq(app, input, &message)?;
    }
    let _guard = lock()
        .lock()
        .map_err(|e| format!("ブラケット受信データのロックに失敗しました: {e}"))?;
    let mut inbox = load(app)?;
    send_udp_mailbox_packet(
        &input.profile,
        &input.delivery_target_mode,
        input.delivery_target_ip.as_deref(),
        &message,
    )?;
    apply(&mut inbox, &message, &input.profile.sender_user_id)?;
    save(app, &inbox)?;
    notify(app)?;
    Ok(message)
}

pub fn receive(
    app: &tauri::AppHandle,
    own_sender_user_id: &str,
    message: &FeatureMessage,
) -> Result<(), String> {
    if message.method == "player_dq_request" {
        if message.message_type != "dq_request" || message.parent_message_id.is_some() {
            return Err("DQ申請のメッセージ形式が不正です。".to_owned());
        }
        crate::call_list::validate_incoming_dq(app, own_sender_user_id, message)?;
    }
    let _guard = lock()
        .lock()
        .map_err(|e| format!("ブラケット受信データのロックに失敗しました: {e}"))?;
    let mut inbox = load(app)?;
    apply(&mut inbox, message, own_sender_user_id)?;
    save(app, &inbox)?;
    notify(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(id: &str, pool: &str) -> FeatureMessage {
        FeatureMessage {
            destination: Some("bracket".to_owned()),
            message_id: id.to_owned(),
            thread_id: "unused".to_owned(),
            parent_message_id: None,
            message_type: "normal".to_owned(),
            method: "external_edit_request".to_owned(),
            message_meta: Some(json!({
                "externalEditTournamentId": "tournament", "externalEditEventId": "event",
                "externalEditPhaseGroupId": pool,
            })),
            subject: "Request".to_owned(),
            body: "Request".to_owned(),
            sender_name: "Reporter".to_owned(),
            sender_user_id: "87654321".to_owned(),
            sender_ip: "192.168.1.20".to_owned(),
            created_at: "2026-10-14T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn processed_messages_preserve_latest_peer_contact_after_restart() {
        let mut inbox = BracketInbox::default();
        let first = request("first", "pool");
        apply(&mut inbox, &first, "12345678").unwrap();
        mark_processed(&mut inbox, "first");
        let mut reply = request("reply", "pool");
        reply.method = "external_edit_request_response".to_owned();
        reply.message_meta = Some(json!({"requestMessageId": "own-request"}));
        reply.sender_ip = "192.168.1.30".to_owned();
        apply(&mut inbox, &reply, "12345678").unwrap();
        assert!(inbox.messages.is_empty());
        let restored: BracketInbox =
            serde_json::from_str(&serde_json::to_string(&inbox).unwrap()).unwrap();
        assert_eq!(restored.sender_contacts.len(), 1);
        assert_eq!(restored.sender_contacts[0].sender_ip, "192.168.1.30");
        let legacy: BracketInbox =
            serde_json::from_value(json!({"messages": [], "processedMessageIds": []})).unwrap();
        assert!(legacy.sender_contacts.is_empty());
    }

    #[test]
    fn dq_requests_are_queued_deduplicated_and_processed_without_threads() {
        let mut inbox = BracketInbox::default();
        let mut dq = request("dq", "pool");
        dq.method = "player_dq_request".to_owned();
        dq.message_type = "dq_request".to_owned();
        apply(&mut inbox, &dq, "12345678").unwrap();
        apply(&mut inbox, &dq, "12345678").unwrap();
        assert_eq!(inbox.messages.len(), 1);
        let mut restored: BracketInbox =
            serde_json::from_str(&serde_json::to_string(&inbox).unwrap()).unwrap();
        assert_eq!(restored.messages[0].message_id, "dq");
        mark_processed(&mut restored, "dq");
        apply(&mut restored, &dq, "12345678").unwrap();
        assert!(restored.messages.is_empty());
    }

    #[test]
    fn resend_cleanup_discards_only_dq_requests_without_an_active_own_call() {
        let mut inbox = BracketInbox::default();
        let mut active_dq = request("active-dq", "pool");
        active_dq.method = "player_dq_request".to_owned();
        active_dq.message_type = "dq_request".to_owned();
        active_dq.message_meta = Some(json!({"dqCallMessageId": "active-call"}));
        let mut stale_dq = active_dq.clone();
        stale_dq.message_id = "stale-dq".to_owned();
        stale_dq.message_meta = Some(json!({"dqCallMessageId": "resolved-call"}));
        let mut malformed_dq = active_dq.clone();
        malformed_dq.message_id = "malformed-dq".to_owned();
        malformed_dq.message_meta = None;
        let external_request = request("external", "pool");
        for message in [&active_dq, &stale_dq, &malformed_dq, &external_request] {
            apply(&mut inbox, message, "12345678").unwrap();
        }

        let active_call_ids = HashSet::from(["active-call".to_owned()]);
        assert_eq!(remove_stale_dq_requests(&mut inbox, &active_call_ids), 2);
        assert_eq!(
            inbox
                .messages
                .iter()
                .map(|message| message.message_id.as_str())
                .collect::<Vec<_>>(),
            ["active-dq", "external"]
        );
        assert!(inbox.processed_message_ids.contains(&"stale-dq".to_owned()));
        assert!(inbox
            .processed_message_ids
            .contains(&"malformed-dq".to_owned()));
        apply(&mut inbox, &stale_dq, "12345678").unwrap();
        assert!(!inbox
            .messages
            .iter()
            .any(|message| message.message_id == "stale-dq"));
    }

    #[test]
    fn keeps_only_latest_received_request_per_pool_and_ignores_duplicate_packets() {
        let mut inbox = BracketInbox::default();
        let first = request("first", "pool-a");
        apply(&mut inbox, &first, "12345678").unwrap();
        apply(&mut inbox, &request("other-pool", "pool-b"), "12345678").unwrap();
        let mut latest = request("latest", "pool-a");
        latest.sender_user_id = "11111111".to_owned();
        apply(&mut inbox, &latest, "12345678").unwrap();
        apply(&mut inbox, &first, "12345678").unwrap();
        assert_eq!(inbox.messages.len(), 2);
        assert_eq!(inbox.messages[1].message_id, "latest");
        assert!(inbox.processed_message_ids.contains(&"first".to_owned()));
    }

    #[test]
    fn responses_clear_only_their_request_without_a_thread_and_have_no_requester_reaction() {
        let mut inbox = BracketInbox::default();
        apply(&mut inbox, &request("first", "pool"), "12345678").unwrap();
        let mut response = request("response", "pool");
        response.method = "external_edit_request_response".to_owned();
        response.sender_user_id = "12345678".to_owned();
        response.message_meta =
            Some(json!({"requestMessageId": "first", "externalEditRequestResponse": "accepted"}));
        apply(&mut inbox, &response, "12345678").unwrap();
        assert!(inbox.messages.is_empty());
        assert_eq!(inbox.processed_message_ids, ["first"]);
        let mut requester = BracketInbox::default();
        apply(&mut requester, &response, "87654321").unwrap();
        assert!(requester.messages.is_empty());
        assert!(requester.processed_message_ids.is_empty());
    }

    #[test]
    fn processed_reports_stay_deduplicated_after_serialization() {
        let mut report = request("report", "pool");
        report.method = "external_score_report".to_owned();
        let mut inbox = BracketInbox::default();
        apply(&mut inbox, &report, "12345678").unwrap();
        mark_processed(&mut inbox, "report");
        let mut restored = serde_json::from_str(&serde_json::to_string(&inbox).unwrap()).unwrap();
        apply(&mut restored, &report, "12345678").unwrap();
        assert!(restored.messages.is_empty());
    }

    fn input(method: &str, mode: &str) -> SendMailboxMessageInput {
        SendMailboxMessageInput {
            destination: Some("bracket".to_owned()),
            profile: crate::models::SenderProfile {
                sender_name: "Operator".to_owned(),
                sender_user_id: "12345678".to_owned(),
                bind_ip: "192.168.1.10".to_owned(),
                broadcast_subnet_mask: "255.255.255.0".to_owned(),
            },
            method: method.to_owned(),
            subject: "Subject".to_owned(),
            body: "Body".to_owned(),
            delivery_target_mode: mode.to_owned(),
            delivery_target_ip: if mode == "direct" {
                Some("192.168.1.20".to_owned())
            } else {
                None
            },
            message_type: Some("normal".to_owned()),
            message_meta: Some(json!({
                "externalEditTournamentId": "tournament", "externalEditEventId": "event",
                "externalEditPhaseGroupId": "pool", "requestMessageId": "request",
                "externalEditRequestResponse": "accepted", "externalScoreReportResponse": "rejected",
            })),
            thread_id: None,
            parent_message_id: None,
        }
    }

    #[test]
    fn requests_and_normal_reports_require_broadcast_and_responses_require_one_recipient() {
        for method in ["external_edit_request", "external_score_report"] {
            let broadcast = input(method, "broadcast");
            let message = crate::build_message_from_input(&broadcast).unwrap();
            assert!(validate_delivery(&broadcast, &message).is_ok());
            let direct = input(method, "direct");
            let message = crate::build_message_from_input(&direct).unwrap();
            assert!(validate_delivery(&direct, &message).is_err());
        }
        for method in [
            "external_edit_request_response",
            "external_score_report_response",
        ] {
            let mut direct = input(method, "direct");
            let message = crate::build_message_from_input(&direct).unwrap();
            assert!(validate_delivery(&direct, &message).is_ok());
            direct.delivery_target_ip = Some("192.168.1.20,192.168.1.30".to_owned());
            assert!(validate_delivery(&direct, &message).is_err());
            let broadcast = input(method, "broadcast");
            assert!(validate_delivery(&broadcast, &message).is_err());
        }
    }

    #[test]
    fn dq_requires_direct_delivery_one_recipient_and_no_thread_parent() {
        let mut dq = input("player_dq_request", "direct");
        dq.message_type = Some("dq_request".to_owned());
        let message = crate::build_message_from_input(&dq).unwrap();
        assert!(is_bracket_message(&message));
        assert_eq!(message.sender_user_id, dq.profile.sender_user_id);
        assert_eq!(message.sender_name, dq.profile.sender_name);
        assert_eq!(message.sender_ip, dq.profile.bind_ip);
        validate_delivery(&dq, &message).unwrap();
        dq.delivery_target_mode = "broadcast".to_owned();
        assert!(validate_delivery(&dq, &message).is_err());
        dq.delivery_target_mode = "direct".to_owned();
        dq.delivery_target_ip = Some("192.168.1.20,192.168.1.30".to_owned());
        assert!(validate_delivery(&dq, &message).is_err());
        let mut wrong_type = message.clone();
        wrong_type.message_type = "normal".to_owned();
        assert!(validate_delivery(&dq, &wrong_type).is_err());
        let mut threaded = message;
        threaded.parent_message_id = Some("legacy-thread".to_owned());
        assert!(validate_delivery(&dq, &threaded).is_err());
    }

    #[test]
    fn synchronization_reports_are_direct_and_unknown_response_status_is_rejected() {
        let mut resend = input("external_score_report", "direct");
        resend.message_meta.as_mut().unwrap()["externalScoreReportResend"] = json!(true);
        let message = crate::build_message_from_input(&resend).unwrap();
        assert!(validate_delivery(&resend, &message).is_ok());
        resend.delivery_target_mode = "broadcast".to_owned();
        assert!(validate_delivery(&resend, &message).is_err());

        let mut response = input("external_edit_request_response", "direct");
        response.message_meta.as_mut().unwrap()["externalEditRequestResponse"] = json!("pending");
        let message = crate::build_message_from_input(&response).unwrap();
        assert!(validate_delivery(&response, &message).is_err());
    }
}
