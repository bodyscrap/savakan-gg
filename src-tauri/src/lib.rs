mod models;
mod startgg;
mod startgg_scalars;
mod storage;

use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use if_addrs::get_if_addrs;
use models::{
    BracketBatchConflict, BracketBatchReportInput, BracketBatchReportResult,
    CreateEventSnapshotBySlugInput, CreateEventSnapshotInput, GenericMessage, ItemListConfig,
    LocalPlayerMetaInput, LocalSetPlaySideInput, LocalSetResultInput, LocalSnapshotEventListItem,
    ReportSetResultInput, ResetSetResultCascadeInput, ResetSetResultCascadeResult,
    SaveEventManagementMetaInput, SenderProfile, TournamentPreview, TournamentSnapshot,
    TournamentWorkspace,
};
use serde::{Deserialize, Serialize};
use tiny_http::{Header, Response, Server};

const UDP_MAILBOX_PORT: u16 = 42690;
const OBS_OVERLAY_PORT: u16 = 42691;

static UDP_LISTENER_RUNNING: OnceLock<AtomicBool> = OnceLock::new();
static MESSAGE_ID_SEQUENCE: OnceLock<AtomicU64> = OnceLock::new();
static OBS_OVERLAY_SERVER_RUNNING: OnceLock<AtomicBool> = OnceLock::new();
static OBS_OVERLAY_STATE: OnceLock<Mutex<ObsOverlayRuntimeState>> = OnceLock::new();

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
            preview_font_scale: 1.0,
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsOverlaySetInput {
    enabled: bool,
    set_id: String,
    event_name: String,
    round_text: String,
    red_player_name: String,
    blue_player_name: String,
    red_set_wins: u32,
    blue_set_wins: u32,
    font_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObsOverlayState {
    active: bool,
    current_set_id: Option<String>,
    event_name: Option<String>,
    round_text: Option<String>,
    red_player_name: String,
    blue_player_name: String,
    red_set_wins: u32,
    blue_set_wins: u32,
    font_scale: f64,
    overlay_url: String,
}

#[derive(Debug, Clone)]
struct ObsOverlayActiveSet {
    set_id: String,
    event_name: String,
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
    preview_font_scale: f64,
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
            current_set_id: Some(active.set_id.clone()),
            event_name: Some(active.event_name.clone()),
            round_text: Some(active.round_text.clone()),
            red_player_name: active.red_player_name.clone(),
            blue_player_name: active.blue_player_name.clone(),
            red_set_wins: active.red_set_wins,
            blue_set_wins: active.blue_set_wins,
            font_scale: active.font_scale,
            overlay_url: overlay_url(),
        });
    }

    let preview_font_scale = clamp_font_scale(guard.preview_font_scale);

    Ok(ObsOverlayState {
        active: false,
        current_set_id: None,
        event_name: None,
        round_text: None,
        red_player_name: "(Dummy Player1)".to_owned(),
        blue_player_name: "(Dummy Player2)".to_owned(),
        red_set_wins: 0,
        blue_set_wins: 0,
        font_scale: preview_font_scale,
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
        :root {
            --container-scale: 1;
            --scale: 1;
            --name-size: calc(64px * var(--scale) * var(--container-scale));
            --count-size: calc(46px * var(--scale) * var(--container-scale));
        }
        html, body {
            margin: 0;
            width: 1920px;
            height: 1080px;
            overflow: hidden;
            background: transparent;
            font-family: "Noto Sans JP", "Yu Gothic UI", sans-serif;
        }
        .stage {
            width: calc(1920px * var(--container-scale));
            height: calc(1080px * var(--container-scale));
            position: relative;
            background: transparent;
        }
        .hud {
            position: absolute;
            top: calc(24px * var(--container-scale));
            left: 50%;
            transform: translateX(-50%);
            width: min(calc(1260px * var(--container-scale)), calc(100% - calc(96px * var(--container-scale))));
            display: grid;
            grid-template-columns: 1fr 1fr;
            align-items: start;
            gap: calc(110px * var(--container-scale));
            pointer-events: none;
        }
        .player {
            background: transparent;
            color: #fff;
            text-shadow:
                -2px -2px 0 rgba(0, 0, 0, 0.82),
                2px -2px 0 rgba(0, 0, 0, 0.82),
                -2px 2px 0 rgba(0, 0, 0, 0.82),
                2px 2px 0 rgba(0, 0, 0, 0.82),
                0 0 16px rgba(0, 0, 0, 0.55);
        }
        .player.p1 {
            text-align: right;
        }
        .player.p2 {
            text-align: left;
        }
        .name {
            font-weight: 900;
            font-size: var(--name-size);
            line-height: 1;
            letter-spacing: 0.02em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .count {
            margin-top: 6px;
            font-weight: 800;
            font-size: var(--count-size);
            line-height: 1;
            white-space: nowrap;
        }
    </style>
</head>
<body>
  <div class="stage">
    <div class="hud">
      <section class="player p1">
        <div id="redName" class="name">(Dummy Player1)</div>
        <div id="redCount" class="count">SETS 0</div>
      </section>
      <section class="player p2">
        <div id="blueName" class="name">(Dummy Player2)</div>
        <div id="blueCount" class="count">SETS 0</div>
      </section>
    </div>
  </div>
  <script>
    const DUMMY_1 = '(Dummy Player1)';
    const DUMMY_2 = '(Dummy Player2)';
    function toSafeWins(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return 0;
      }
      return Math.max(0, Math.trunc(n));
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
        const redName = isActive ? (state.redPlayerName || DUMMY_1) : DUMMY_1;
        const blueName = isActive ? (state.bluePlayerName || DUMMY_2) : DUMMY_2;
        const redWins = isActive ? toSafeWins(state.redSetWins) : 0;
        const blueWins = isActive ? toSafeWins(state.blueSetWins) : 0;
        document.getElementById('redName').textContent = redName;
        document.getElementById('blueName').textContent = blueName;
        document.getElementById('redCount').textContent = 'SETS ' + String(redWins);
        document.getElementById('blueCount').textContent = 'SETS ' + String(blueWins);
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
                if let Ok(header) = Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8") {
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
                if let Ok(header) = Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8") {
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
fn toggle_obs_overlay_set(input: ObsOverlaySetInput) -> Result<ObsOverlayState, String> {
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
                return Err(format!("すでに別のsetが配信中です: {}", active.set_id));
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
            round_text: input.round_text.trim().to_owned(),
            red_player_name: red_name,
            blue_player_name: blue_name,
            red_set_wins: input.red_set_wins,
            blue_set_wins: input.blue_set_wins,
            font_scale: next_scale,
        });
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

fn validate_thread_open_for_reply(app: &tauri::AppHandle, thread_id: &str) -> Result<(), String> {
    let messages = storage::load_generic_messages(app)?.unwrap_or_default();
    let _root = messages
        .iter()
        .find(|item| item.thread_id == thread_id && item.parent_message_id.is_none())
        .ok_or_else(|| "対象スレッドが見つかりません。".to_owned())?;

    let already_resolved = messages
        .iter()
        .any(|item| item.thread_id == thread_id && item.message_type == "resolve");
    if already_resolved {
        return Err("解決済みスレッドには返信できません。必要な連絡は汎用メッセージで送信してください。".to_owned());
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

    if message.parent_message_id.is_some() {
        validate_thread_open_for_reply(&app, &message.thread_id)?;
    }

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
    let mut snapshot = startgg::fetch_tournament_snapshot(token, slug, per_page).await?;
    snapshot.slug = slug.to_owned();
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
        let is_reset_action = item.winner_id.trim().is_empty();

        let local_set = match local_event.sets.iter().find(|set| set.set_id == item.set_id) {
            Some(set) => set,
            None => {
                skipped_count += 1;
                processed_set_ids.push(item.set_id.clone());
                continue;
            }
        };

        if !is_reset_action && local_set.slots.len() < 2 {
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

        if is_reset_action {
            let remote_is_already_reset = remote_set.winner_id.is_none() && (remote_set.state == 1 || remote_set.state == 2);
            if remote_is_already_reset {
                skipped_count += 1;
                processed_set_ids.push(item.set_id.clone());
                continue;
            }

            startgg::reset_set_result(&token, &item.set_id).await?;
            reported_count += 1;
            processed_set_ids.push(item.set_id.clone());
            continue;
        }

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
            processed_set_ids.push(item.set_id.clone());
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
        let local_event = workspace_before
            .snapshot
            .events
            .iter()
            .find(|event| event.event_id == input.event_id)
            .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {}", input.event_id))?;

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
            get_obs_overlay_state,
            set_obs_overlay_font_scale,
            toggle_obs_overlay_set,
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
            report_set_result,
            reset_set_result_cascade
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
