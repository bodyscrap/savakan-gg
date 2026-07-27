mod models;
mod startgg;
mod startgg_scalars;
mod storage;

use models::{
    BracketBatchConflict, BracketBatchReportInput, BracketBatchReportResult,
    CreateEventSnapshotBySlugInput, CreateEventSnapshotInput, LocalPlayerMetaInput,
    LocalSetPlaySideInput, LocalSetResultInput, LocalSnapshotEventListItem, OwnedTournamentListItem,
    ReportSetResultInput, TournamentPreview, TournamentSnapshot, TournamentWorkspace,
};

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
            save_local_set_play_side,
            save_local_set_result,
            report_confirmed_sets_from_bracket,
            sync_tournament,
            report_set_result
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
