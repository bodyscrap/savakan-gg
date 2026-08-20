mod models;
mod startgg;
mod startgg_scalars;
mod storage;

use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use if_addrs::get_if_addrs;
use models::{
    BracketBatchConflict, BracketBatchReportInput, BracketBatchReportResult,
    CreateEventSnapshotBySlugInput, CreateEventSnapshotInput, GenericMessage, ItemListConfig,
    LocalPlayerMetaInput, LocalSetPlaySideInput, LocalSetResultInput, LocalSnapshotEventListItem,
    ReportSetResultInput, SaveEventManagementMetaInput, SenderProfile, TournamentPreview,
    TournamentSnapshot, TournamentWorkspace,
};
use serde::{Deserialize, Serialize};

const UDP_MAILBOX_PORT: u16 = 42690;

static UDP_LISTENER_RUNNING: OnceLock<AtomicBool> = OnceLock::new();
static MESSAGE_ID_SEQUENCE: OnceLock<AtomicU64> = OnceLock::new();

fn udp_listener_running() -> &'static AtomicBool {
    UDP_LISTENER_RUNNING.get_or_init(|| AtomicBool::new(false))
}

fn message_id_sequence() -> &'static AtomicU64 {
    MESSAGE_ID_SEQUENCE.get_or_init(|| AtomicU64::new(1))
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

#[tauri::command]
fn detect_local_ipv4() -> Result<Option<String>, String> {
    let interfaces = get_if_addrs().map_err(|e| format!("ネットワークIFの取得に失敗しました: {e}"))?;

    let mut candidates = interfaces
        .into_iter()
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(addr) => Some(addr.ip),
            if_addrs::IfAddr::V6(_) => None,
        })
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        local_ipv4_score(right)
            .cmp(&local_ipv4_score(left))
            .then_with(|| left.octets().cmp(&right.octets()))
    });

    Ok(candidates.first().map(|ip| ip.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UdpMailboxPacket {
    protocol: String,
    delivery_target_mode: String,
    delivery_target_ip: Option<String>,
    message: GenericMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMailboxMessageInput {
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
        || !profile.sender_user_id.trim().chars().all(|ch| ch.is_ascii_digit())
    {
        return Err("ユーザーIDは8桁の数字で入力してください。".to_owned());
    }
    if profile.bind_ip.trim().parse::<std::net::Ipv4Addr>().is_err() {
        return Err("自分のIPはIPv4形式で入力してください。例: 192.168.1.10".to_owned());
    }
    if profile.broadcast_subnet_mask.trim().parse::<std::net::Ipv4Addr>().is_err() {
        return Err("ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0".to_owned());
    }
    Ok(())
}

fn normalize_delivery_target_mode(mode: &str) -> String {
    mode.trim().to_ascii_lowercase()
}

fn split_delivery_target_ips(target_ip: Option<&str>) -> Vec<String> {
    let Some(raw) = target_ip.map(|value| value.trim()).filter(|value| !value.is_empty()) else {
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
    let mask = subnet_mask
        .trim()
        .parse::<Ipv4Addr>()
        .map_err(|_| "ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0".to_owned())?;

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
        "broadcast" => Ok(vec![compute_broadcast_ip(&profile.bind_ip, &profile.broadcast_subnet_mask)?]),
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

fn validate_delivery_target(mode: &str, target_ip: Option<&str>, profile: &SenderProfile) -> Result<(), String> {
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

fn build_message_from_input(input: &SendMailboxMessageInput) -> Result<GenericMessage, String> {
    validate_sender_profile(&input.profile)?;
    validate_delivery_target(&input.delivery_target_mode, input.delivery_target_ip.as_deref(), &input.profile)?;

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

    Ok(GenericMessage {
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

fn meta_string(meta: Option<&serde_json::Value>, key: &str) -> Option<String> {
    let value = meta?
        .as_object()?
        .get(key)?
        .as_str()?
        .trim()
        .to_owned();

    if value.is_empty() {
        None
    } else {
        Some(value)
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
            match socket.recv_from(&mut buf) {
                Ok((size, _)) => {
                    let raw = match std::str::from_utf8(&buf[..size]) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };

                    let packet = match serde_json::from_str::<UdpMailboxPacket>(raw) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };

                    if packet.protocol != "savakan-mailbox-v1" {
                        continue;
                    }

                    let my_profile = storage::load_sender_profile(&app).ok().flatten();
                    if let Some(my_profile) = my_profile {
                        if my_profile.sender_user_id.trim() == packet.message.sender_user_id.trim() {
                            continue;
                        }

                        let accept_delivery = match normalize_delivery_target_mode(&packet.delivery_target_mode).as_str() {
                            "broadcast" => true,
                            "direct" => packet
                                .delivery_target_ip
                                .as_deref()
                                .map(|value| split_delivery_target_ips(Some(value)).iter().any(|ip| ip.trim() == my_profile.bind_ip.trim()))
                                .unwrap_or(false),
                            _ => false,
                        };

                        if !accept_delivery {
                            continue;
                        }
                    }

                    let _ = storage::append_generic_message(&app, &packet.message);
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

fn validate_resolve_permission(
    app: &tauri::AppHandle,
    sender_user_id: &str,
    thread_id: &str,
) -> Result<(), String> {
    let messages = storage::load_generic_messages(app)?.unwrap_or_default();
    let root = messages
        .iter()
        .find(|item| item.thread_id == thread_id && item.parent_message_id.is_none())
        .ok_or_else(|| "対象スレッドが見つかりません。".to_owned())?;

    if root.sender_user_id.trim() != sender_user_id.trim() {
        return Err("スレッド作成者のみが解決メッセージを送信できます。".to_owned());
    }

    let already_resolved = messages
        .iter()
        .any(|item| item.thread_id == thread_id && item.message_type == "resolve");
    if already_resolved {
        return Err("このスレッドはすでに解決済みです。".to_owned());
    }

    Ok(())
}

fn validate_dq_request_permission(
    app: &tauri::AppHandle,
    thread_id: &str,
    request_meta: Option<&serde_json::Value>,
) -> Result<(), String> {
    let messages = storage::load_generic_messages(app)?.unwrap_or_default();
    let root = messages
        .iter()
        .find(|item| item.thread_id == thread_id && item.parent_message_id.is_none())
        .ok_or_else(|| "対象スレッドが見つかりません。".to_owned())?;

    if root.method.trim().to_ascii_lowercase() != "call_player" {
        return Err("DQ申請はプレイヤー呼び出しスレッドでのみ送信できます。".to_owned());
    }

    let expected_player_id = meta_string(root.message_meta.as_ref(), "playerId")
        .map(|value| value.to_ascii_uppercase())
        .ok_or_else(|| "呼び出しスレッドにプレイヤー認証情報がありません。".to_owned())?;

    let supplied_player_id = meta_string(request_meta, "dqPlayerId")
        .map(|value| value.to_ascii_uppercase())
        .ok_or_else(|| "DQ申請には認証済みPLAYER IDが必要です。".to_owned())?;

    if expected_player_id != supplied_player_id {
        return Err("入力したPLAYER IDが呼び出し対象と一致しないため、DQ申請できません。".to_owned());
    }

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
fn send_mailbox_message(
    app: tauri::AppHandle,
    input: SendMailboxMessageInput,
) -> Result<GenericMessage, String> {
    let message = build_message_from_input(&input)?;

    if message.message_type == "resolve" {
        validate_resolve_permission(&app, &input.profile.sender_user_id, &message.thread_id)?;
    } else if message.message_type == "dq_request" {
        validate_dq_request_permission(&app, &message.thread_id, input.message_meta.as_ref())?;
    }

    let normalized_target_mode = normalize_delivery_target_mode(&input.delivery_target_mode);
    let target_ips = resolve_delivery_target_ips(&input.profile, &normalized_target_mode, input.delivery_target_ip.as_deref())?;
    let packet = UdpMailboxPacket {
        protocol: "savakan-mailbox-v1".to_owned(),
        delivery_target_mode: normalized_target_mode.clone(),
        delivery_target_ip: match normalized_target_mode.as_str() {
            "broadcast" => None,
            "direct" => Some(target_ips.join(",")),
            _ => None,
        },
        message: message.clone(),
    };

    let sender_bind_addr = format!("{}:0", input.profile.bind_ip.trim());
    let socket = UdpSocket::bind(&sender_bind_addr)
        .map_err(|e| format!("UDP送信ソケットを起動できませんでした ({sender_bind_addr}): {e}"))?;

    if normalized_target_mode == "broadcast" {
        socket
            .set_broadcast(true)
            .map_err(|e| format!("UDPブロードキャスト設定に失敗しました: {e}"))?;
    }

    let payload = serde_json::to_vec(&packet)
        .map_err(|e| format!("送信データのJSON変換に失敗しました: {e}"))?;

    for target_ip in &target_ips {
        let target_addr = format!("{}:{}", target_ip.trim(), UDP_MAILBOX_PORT);
        socket
            .send_to(&payload, &target_addr)
            .map_err(|e| format!("UDP送信に失敗しました ({target_addr}): {e}"))?;
    }

    storage::append_generic_message(&app, &message)?;

    Ok(message)
}

async fn refresh_workspace_after_remote_report(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    per_page: u32,
) -> Result<TournamentWorkspace, String> {
    let snapshot = startgg::fetch_tournament_snapshot(token, slug, per_page).await?;
    storage::save_snapshot(app, &snapshot)?;
    let local_meta = storage::sync_local_meta_from_snapshot(app, &snapshot, event_id)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
    })
}

fn round_depth(round: Option<i64>) -> i64 {
    round.map(|value| value.abs()).unwrap_or(i64::MAX / 4)
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
) -> Result<(), String> {
    storage::save_last_snapshot_selection(&app, &slug, &event_id)
}

#[tauri::command]
fn load_last_snapshot_selection(
    app: tauri::AppHandle,
) -> Result<Option<storage::LastSnapshotSelection>, String> {
    storage::load_last_snapshot_selection(&app)
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
fn save_generic_messages(
    app: tauri::AppHandle,
    messages: Vec<GenericMessage>,
) -> Result<(), String> {
    storage::save_generic_messages(&app, &messages)
}

#[tauri::command]
fn load_generic_messages(app: tauri::AppHandle) -> Result<Option<Vec<GenericMessage>>, String> {
    storage::load_generic_messages(&app)
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
fn load_local_tournament(app: tauri::AppHandle, slug: String) -> Result<TournamentSnapshot, String> {
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
    startgg::fetch_tournament_preview(&token, &slug).await
}

#[tauri::command]
async fn create_event_snapshot(
    app: tauri::AppHandle,
    input: CreateEventSnapshotInput,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let event_slug = input
        .event_slug
        .clone()
        .ok_or_else(|| "event slugが未指定です。イベント一覧を再取得してください。".to_owned())?;
    let mut snapshot = startgg::fetch_event_snapshot_by_slug(
        &token,
        &event_slug,
        input.per_page.unwrap_or(200),
    )
    .await?;
    snapshot.slug = input.slug.clone();
    let event_alias = resolve_event_alias(input.event_alias.clone(), &snapshot, &input.event_id);

    let local_meta = storage::save_event_snapshot(&app, &snapshot, &input.event_id, event_alias)?;
    let snapshot = storage::load_snapshot(&app, &snapshot.slug)?;

    Ok(TournamentWorkspace { snapshot, local_meta })
}

#[tauri::command]
async fn create_event_snapshot_by_slug(
    app: tauri::AppHandle,
    input: CreateEventSnapshotBySlugInput,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let mut snapshot = startgg::fetch_event_snapshot_by_slug(
        &token,
        &input.event_slug,
        input.per_page.unwrap_or(200),
    )
    .await?;

    if !input.tournament_slug.trim().is_empty() {
        snapshot.slug = input.tournament_slug.clone();
    }

    let event_id = snapshot
        .events
        .first()
        .map(|event| event.event_id.clone())
        .ok_or_else(|| "eventスナップショットにイベントが含まれていません。".to_owned())?;

    let event_alias = resolve_event_alias(input.event_alias.clone(), &snapshot, &event_id);

    let local_meta = storage::save_event_snapshot(&app, &snapshot, &event_id, event_alias)?;
    let snapshot = storage::load_snapshot(&app, &snapshot.slug)?;

    Ok(TournamentWorkspace { snapshot, local_meta })
}

#[tauri::command]
async fn refresh_local_event_snapshot_from_remote(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    per_page: Option<u32>,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let preview = startgg::fetch_tournament_preview(&token, &slug).await?;
    let event = preview
        .events
        .iter()
        .find(|item| item.event_id == event_id)
        .ok_or_else(|| format!("指定eventがtournament内に見つかりません: {event_id}"))?;
    let event_slug = event
        .event_slug
        .clone()
        .ok_or_else(|| "event slugが取得できませんでした。event一覧を再取得してください。".to_owned())?;

    let mut snapshot = startgg::fetch_event_snapshot_by_slug(
        &token,
        &event_slug,
        per_page.unwrap_or(200),
    )
    .await?;
    snapshot.slug = slug.clone();

    let existing_alias = storage::load_local_meta(&app, &slug, &event_id)?
        .events
        .into_iter()
        .find(|item| item.event_id == event_id)
        .and_then(|item| item.event_alias);

    storage::save_event_snapshot(&app, &snapshot, &event_id, existing_alias)?;
    let local_meta = storage::prune_pending_set_results_by_snapshot_match(&app, &slug, &event_id)?;
    let snapshot = storage::load_snapshot(&app, &slug)?;

    Ok(TournamentWorkspace { snapshot, local_meta })
}

#[tauri::command]
fn list_local_snapshot_events(app: tauri::AppHandle) -> Result<Vec<LocalSnapshotEventListItem>, String> {
    storage::list_local_snapshot_events(&app)
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
fn save_local_set_play_side(
    app: tauri::AppHandle,
    input: LocalSetPlaySideInput,
) -> Result<TournamentWorkspace, String> {
    storage::upsert_local_set_play_side(&app, input)
}

#[tauri::command]
fn save_local_set_result(
    app: tauri::AppHandle,
    input: LocalSetResultInput,
) -> Result<TournamentWorkspace, String> {
    storage::upsert_local_set_result(&app, input)
}

#[tauri::command]
async fn report_confirmed_sets_from_bracket(
    app: tauri::AppHandle,
    input: BracketBatchReportInput,
) -> Result<BracketBatchReportResult, String> {
    let token = storage::load_token(&app)?;
    let workspace = storage::load_workspace(&app, &input.slug, &input.event_id)?;
    let local_event = workspace
        .snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {}", input.event_id))?;

    let mut pending = workspace
        .local_meta
        .pending_set_results
        .iter()
        .filter(|item| item.confirmed && item.event_id == input.event_id)
        .cloned()
        .collect::<Vec<_>>();

    pending.sort_by(|left, right| {
        let left_round = local_event
            .sets
            .iter()
            .find(|set| set.set_id == left.set_id)
            .map(|set| set.round)
            .unwrap_or(None);
        let right_round = local_event
            .sets
            .iter()
            .find(|set| set.set_id == right.set_id)
            .map(|set| set.round)
            .unwrap_or(None);

        round_depth(left_round)
            .cmp(&round_depth(right_round))
            .then_with(|| left.set_id.cmp(&right.set_id))
    });

    let per_page = input.per_page.unwrap_or(200);
    let mut force_overwrite_current_conflict = input.force_overwrite_current_conflict.unwrap_or(false);
    let force_overwrite_remaining_conflicts = input.force_overwrite_remaining_conflicts.unwrap_or(false);
    let mut reported_count = 0_usize;
    let mut skipped_count = 0_usize;
    let mut processed_set_ids = Vec::new();
    let mut conflict = None;

    for item in pending {
        let local_set = match local_event.sets.iter().find(|set| set.set_id == item.set_id) {
            Some(set) => set,
            None => {
                skipped_count += 1;
                processed_set_ids.push(item.set_id.clone());
                continue;
            }
        };

        if local_set.slots.len() < 2 {
            skipped_count += 1;
            processed_set_ids.push(item.set_id.clone());
            continue;
        }

        let remote_set = match startgg::fetch_set_snapshot(&token, &item.set_id).await {
            Ok(set) => set,
            Err(err) => {
                if err.contains("指定setが見つかりません") {
                    skipped_count += 1;
                    processed_set_ids.push(item.set_id.clone());
                    continue;
                }
                return Err(err);
            }
        };

        let is_already_synced = remote_set.winner_id.as_ref() == Some(&item.winner_id);
        if is_already_synced {
            skipped_count += 1;
            processed_set_ids.push(item.set_id.clone());
            continue;
        }

        let requires_force_overwrite = remote_set.state != 1 && remote_set.state != 2;
        let should_force_overwrite = if requires_force_overwrite {
            if force_overwrite_current_conflict {
                force_overwrite_current_conflict = false;
                true
            } else if force_overwrite_remaining_conflicts {
                true
            } else {
                conflict = Some(BracketBatchConflict {
                    set_id: item.set_id.clone(),
                    full_round_text: local_set.full_round_text.clone(),
                    local_winner_id: item.winner_id.clone(),
                    remote_winner_id: remote_set.winner_id.clone(),
                    remote_state: remote_set.state,
                    entrant_names: local_set
                        .slots
                        .iter()
                        .map(|slot| slot.entrant_name.clone())
                        .collect(),
                });
                break;
            }
        } else {
            false
        };

        let can_report_by_state = remote_set.state == 1 || remote_set.state == 2 || should_force_overwrite;
        if !can_report_by_state {
            skipped_count += 1;
            processed_set_ids.push(item.set_id.clone());
            continue;
        }

        let entrant_ids = remote_set
            .slots
            .iter()
            .filter_map(|slot| slot.entrant_id.as_ref().cloned())
            .collect::<Vec<String>>();

        let is_matchup_ready = entrant_ids.len() >= 2 && entrant_ids.iter().any(|entrant_id| entrant_id == &item.winner_id);
        if !is_matchup_ready {
            skipped_count += 1;
            continue;
        }

        startgg::report_set_result(
            &token,
            &item.set_id,
            &item.winner_id,
            &item.score_csv,
            should_force_overwrite,
        )
        .await?;

        reported_count += 1;
        processed_set_ids.push(item.set_id.clone());
    }

    if !processed_set_ids.is_empty() {
        storage::remove_pending_set_results(&app, &input.slug, &input.event_id, &processed_set_ids)?;
    }

    let workspace = if reported_count > 0 {
        refresh_workspace_after_remote_report(&app, &token, &input.slug, &input.event_id, per_page).await?
    } else if !processed_set_ids.is_empty() {
        storage::load_workspace(&app, &input.slug, &input.event_id)?
    } else {
        workspace
    };

    Ok(BracketBatchReportResult {
        workspace,
        processed_count: reported_count + skipped_count,
        reported_count,
        skipped_count,
        completed: conflict.is_none(),
        conflict,
    })
}

#[tauri::command]
async fn sync_tournament(
    app: tauri::AppHandle,
    slug: String,
    per_page: Option<u32>,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let snapshot = startgg::sync_tournament(&token, &slug, per_page.unwrap_or(200)).await?;
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
    let snapshot = startgg::sync_tournament(&token, &input.slug, 200).await?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_startgg_token,
            load_saved_startgg_token,
            save_last_slug,
            load_last_slug,
            save_last_snapshot_selection,
            load_last_snapshot_selection,
            load_item_lists,
            save_item_lists,
            load_event_mgmt_settings,
            save_event_mgmt_settings,
            detect_local_ipv4,
            save_sender_profile,
            load_sender_profile,
            save_generic_messages,
            load_generic_messages,
            start_udp_mailbox_service,
            send_mailbox_message,
            save_event_management_meta,
            load_local_tournament,
            load_local_tournament_workspace,
            preview_tournament,
            list_local_snapshot_events,
            delete_local_snapshot_event,
            create_event_snapshot,
            create_event_snapshot_by_slug,
            refresh_local_event_snapshot_from_remote,
            save_local_player_meta,
            save_local_set_play_side,
            save_local_set_result,
            report_confirmed_sets_from_bracket,
            sync_tournament,
            report_set_result
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
