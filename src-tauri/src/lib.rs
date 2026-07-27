mod models;
mod startgg;
mod startgg_scalars;
mod storage;

use models::{
    BatchReportInput, BatchReportPlan, BatchReportPlanItem, BatchReportResolution,
    CreateEventSnapshotBySlugInput, CreateEventSnapshotInput, LocalPlayerMetaInput,
    LocalSetResultInput, LocalSnapshotEventListItem, OwnedTournamentListItem,
    ReportSetResultInput, TournamentPreview, TournamentSnapshot, TournamentWorkspace,
};

fn find_set_snapshot<'a>(
    snapshot: &'a TournamentSnapshot,
    set_id: &str,
) -> Option<(&'a str, &'a models::SetSnapshot)> {
    for event in &snapshot.events {
        if let Some(set) = event.sets.iter().find(|set| set.set_id == set_id) {
            return Some((event.event_id.as_str(), set));
        }
    }

    None
}

fn sort_report_plan_items(items: &mut [BatchReportPlanItem]) {
    items.sort_by(|left, right| {
        let left_round = left.round.unwrap_or(i64::MIN);
        let right_round = right.round.unwrap_or(i64::MIN);

        right_round
            .cmp(&left_round)
            .then_with(|| left.event_name.cmp(&right.event_name))
            .then_with(|| left.full_round_text.cmp(&right.full_round_text))
    });
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
    let event_alias = input.event_alias.clone();

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

    let local_meta = storage::save_event_snapshot(&app, &snapshot, &event_id, input.event_alias.clone())?;
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

    let local_meta = storage::save_event_snapshot(&app, &snapshot, &event_id, existing_alias)?;
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
async fn list_owned_tournaments(
    app: tauri::AppHandle,
    per_page: Option<u32>,
) -> Result<Vec<OwnedTournamentListItem>, String> {
    let token = storage::load_token(&app)?;
    startgg::fetch_owned_tournaments(&token, per_page.unwrap_or(50)).await
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
fn save_local_set_result(
    app: tauri::AppHandle,
    input: LocalSetResultInput,
) -> Result<TournamentWorkspace, String> {
    storage::upsert_local_set_result(&app, input)
}

#[tauri::command]
async fn build_batch_report_plan(
    app: tauri::AppHandle,
    slug: String,
    event_id: String,
    per_page: Option<u32>,
) -> Result<BatchReportPlan, String> {
    let token = storage::load_token(&app)?;
    let workspace = storage::load_workspace(&app, &slug, &event_id)?;
    let remote_snapshot = startgg::fetch_tournament_snapshot(&token, &slug, per_page.unwrap_or(200)).await?;

    let remote_event = remote_snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがリモートsnapshotに見つかりません: {event_id}"))?;

    let local_event = workspace
        .snapshot
        .events
        .iter()
        .find(|event| event.event_id == event_id)
        .ok_or_else(|| format!("指定イベントがローカルsnapshotに見つかりません: {event_id}"))?;

    let local_event_snapshot = TournamentSnapshot {
        tournament_id: workspace.snapshot.tournament_id.clone(),
        slug: workspace.snapshot.slug.clone(),
        name: workspace.snapshot.name.clone(),
        events: vec![local_event.clone()],
        updated_at: workspace.snapshot.updated_at.clone(),
    };

    let remote_event_snapshot = TournamentSnapshot {
        tournament_id: remote_snapshot.tournament_id.clone(),
        slug: remote_snapshot.slug.clone(),
        name: remote_snapshot.name.clone(),
        events: vec![remote_event.clone()],
        updated_at: remote_snapshot.updated_at.clone(),
    };

    let mut items = Vec::new();
    for pending in &workspace.local_meta.pending_set_results {
        let (_, local_set) = find_set_snapshot(&local_event_snapshot, &pending.set_id)
        .ok_or_else(|| format!("ローカルsnapshotにsetが見つかりません: {}", pending.set_id))?;

        let (_, remote_set) = find_set_snapshot(&remote_event_snapshot, &pending.set_id)
        .ok_or_else(|| format!("リモートsnapshotにsetが見つかりません: {}", pending.set_id))?;

        let conflict_reason = if remote_set.winner_id.as_ref() == Some(&pending.winner_id) {
            None
        } else if remote_set.winner_id.is_none() {
            None
        } else {
            Some("remote_result_differs".to_owned())
        };

        items.push(BatchReportPlanItem {
            event_id: pending.event_id.clone(),
            event_name: pending.event_name.clone(),
            set_id: pending.set_id.clone(),
            full_round_text: local_set.full_round_text.clone(),
            round: local_set.round,
            local_winner_id: pending.winner_id.clone(),
            local_score_csv: pending.score_csv.clone(),
            local_force_overwrite: pending.force_overwrite,
            local_state: local_set.state,
            local_snapshot_winner_id: local_set.winner_id.clone(),
            remote_state: Some(remote_set.state),
            remote_winner_id: remote_set.winner_id.clone(),
            conflict_reason,
        });
    }

    sort_report_plan_items(&mut items);

    Ok(BatchReportPlan {
        snapshot: workspace.snapshot,
        local_meta: workspace.local_meta,
        items,
    })
}

#[tauri::command]
async fn apply_batch_report_plan(
    app: tauri::AppHandle,
    input: BatchReportInput,
) -> Result<TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    let remote_snapshot = startgg::fetch_tournament_snapshot(&token, &input.slug, input.per_page.unwrap_or(200)).await?;
    let remote_event = remote_snapshot
        .events
        .iter()
        .find(|event| event.event_id == input.event_id)
        .ok_or_else(|| format!("指定イベントがリモートsnapshotに見つかりません: {}", input.event_id))?;

    let remote_event_snapshot = TournamentSnapshot {
        tournament_id: remote_snapshot.tournament_id.clone(),
        slug: remote_snapshot.slug.clone(),
        name: remote_snapshot.name.clone(),
        events: vec![remote_event.clone()],
        updated_at: remote_snapshot.updated_at.clone(),
    };

    let mut decisions = input.decisions;
    decisions.sort_by(|left, right| {
        let left_round = find_set_snapshot(
            &remote_event_snapshot,
            &left.set_id,
        )
            .map(|(_, set)| set.round.unwrap_or(i64::MIN))
            .unwrap_or(i64::MIN);
        let right_round = find_set_snapshot(
            &remote_event_snapshot,
            &right.set_id,
        )
            .map(|(_, set)| set.round.unwrap_or(i64::MIN))
            .unwrap_or(i64::MIN);
        right_round.cmp(&left_round)
    });

    let mut processed_set_ids = Vec::new();

    for decision in decisions {
        let pending = storage::load_local_meta(&app, &input.slug, &input.event_id)?
            .pending_set_results
            .iter()
            .find(|item| item.set_id == decision.set_id)
            .cloned()
            .ok_or_else(|| format!("未処理のローカル結果が見つかりません: {}", decision.set_id))?;

        match decision.resolution {
            BatchReportResolution::Local => {
                startgg::report_set_result(
                    &token,
                    &pending.set_id,
                    &pending.winner_id,
                    &pending.score_csv,
                    pending.force_overwrite,
                )
                .await?;
            }
            BatchReportResolution::Remote => {}
        }

        processed_set_ids.push(pending.set_id);
    }

    storage::remove_pending_set_results(&app, &input.slug, &input.event_id, &processed_set_ids)?;
    let snapshot = startgg::fetch_tournament_snapshot(&token, &input.slug, input.per_page.unwrap_or(200)).await?;
    storage::save_snapshot(&app, &snapshot)?;
    let local_meta = storage::sync_local_meta_from_snapshot(&app, &snapshot, &input.event_id)?;

    Ok(TournamentWorkspace {
        snapshot,
        local_meta,
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
            load_local_tournament,
            load_local_tournament_workspace,
            preview_tournament,
            list_local_snapshot_events,
            delete_local_snapshot_event,
            create_event_snapshot,
            create_event_snapshot_by_slug,
            refresh_local_event_snapshot_from_remote,
            list_owned_tournaments,
            save_local_player_meta,
            save_local_set_result,
            build_batch_report_plan,
            apply_batch_report_plan,
            sync_tournament,
            report_set_result
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
