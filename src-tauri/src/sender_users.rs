use serde::Serialize;
use serde_json::json;
use tauri::Emitter;

use crate::models::{FeatureMessage, SenderProfile};
use crate::{create_message_id, send_udp_mailbox_packet, SendMailboxMessageInput};

const DESTINATION: &str = "sender_users";
const REQUEST_METHOD: &str = "sender_user_list_request";
const RESPONSE_METHOD: &str = "sender_user_list_response";
pub const RESPONSE_EVENT: &str = "sender_user_list_response";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SenderUserListResponse {
    request_id: String,
    sender_name: String,
    sender_user_id: String,
    sender_ip: String,
}

fn is_supported_method(method: &str) -> bool {
    matches!(method, REQUEST_METHOD | RESPONSE_METHOD)
}

pub fn is_sender_users_message(message: &FeatureMessage) -> bool {
    if !is_supported_method(&message.method) {
        return false;
    }

    message
        .destination
        .as_deref()
        .map(|destination| destination == DESTINATION)
        .unwrap_or(true)
}

pub fn send(
    input: &SendMailboxMessageInput,
    message: FeatureMessage,
) -> Result<FeatureMessage, String> {
    if message.method != REQUEST_METHOD {
        return Err("ユーザー一覧で未対応のメソッドです。".to_owned());
    }
    if input.delivery_target_mode.trim() != "broadcast" {
        return Err("ユーザー一覧の問い合わせはブロードキャストで送信してください。".to_owned());
    }

    send_udp_mailbox_packet(&input.profile, "broadcast", None, &message)?;
    Ok(message)
}

fn request_id(message: &FeatureMessage) -> Result<String, String> {
    message
        .message_meta
        .as_ref()
        .and_then(|meta| meta.get("requestId"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|request_id| !request_id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "ユーザー一覧メッセージに問い合わせIDがありません。".to_owned())
}

fn send_response(
    profile: &SenderProfile,
    request: &FeatureMessage,
    request_id: &str,
    sender_ip: &str,
) -> Result<(), String> {
    let response = FeatureMessage {
        destination: Some(DESTINATION.to_owned()),
        message_id: create_message_id(profile, RESPONSE_METHOD, request_id),
        thread_id: request_id.to_owned(),
        parent_message_id: Some(request.message_id.clone()),
        message_type: "normal".to_owned(),
        message_meta: Some(json!({ "requestId": request_id })),
        method: RESPONSE_METHOD.to_owned(),
        subject: "ユーザー一覧応答".to_owned(),
        sender_name: profile.sender_name.trim().to_owned(),
        sender_user_id: profile.sender_user_id.trim().to_owned(),
        sender_ip: profile.bind_ip.trim().to_owned(),
        body: "ユーザー一覧応答".to_owned(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    send_udp_mailbox_packet(profile, "direct", Some(sender_ip), &response)
}

pub fn receive(
    app: &tauri::AppHandle,
    profile: &SenderProfile,
    message: &FeatureMessage,
    sender_ip: &str,
) -> Result<(), String> {
    let request_id = request_id(message)?;

    match message.method.as_str() {
        REQUEST_METHOD => send_response(profile, message, &request_id, sender_ip),
        RESPONSE_METHOD => {
            let sender_user_id = message.sender_user_id.trim();
            if sender_user_id.len() != 8
                || !sender_user_id
                    .chars()
                    .all(|character| character.is_ascii_digit())
            {
                return Err("ユーザー一覧応答のユーザーIDが不正です。".to_owned());
            }
            if message.sender_name.trim().is_empty() {
                return Err("ユーザー一覧応答の送信者名が空です。".to_owned());
            }

            app.emit(
                RESPONSE_EVENT,
                SenderUserListResponse {
                    request_id,
                    sender_name: message.sender_name.trim().to_owned(),
                    sender_user_id: sender_user_id.to_owned(),
                    sender_ip: sender_ip.to_owned(),
                },
            )
            .map_err(|error| format!("ユーザー一覧応答の画面通知に失敗しました: {error}"))
        }
        _ => Err("ユーザー一覧で未対応のメソッドです。".to_owned()),
    }
}
