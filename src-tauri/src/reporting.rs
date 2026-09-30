use crate::models::{BracketBatchConflict, BracketBatchReportInput, BracketBatchReportResult};
use crate::{
    derive_score_csv_from_set, emit_bracket_report_progress, is_matchup_not_ready_error,
    normalize_score_csv, refresh_until_gf_reset_set_available,
    refresh_workspace_after_remote_report, refresh_workspace_grand_final_reset_only,
    report_set_result_with_matchup_retry, sort_pending_set_results_by_phase_order, startgg,
    storage,
};

pub(crate) async fn report_confirmed_sets_from_bracket(
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
        .ok_or_else(|| {
            format!(
                "指定イベントがローカルsnapshotに見つかりません: {}",
                input.event_id
            )
        })?;

    let mut pending = workspace
        .local_meta
        .pending_set_results
        .iter()
        .filter(|item| item.confirmed && item.event_id == input.event_id)
        .cloned()
        .collect::<Vec<_>>();

    let mut pending_virtual_gf_reset = workspace
        .local_meta
        .pending_grand_final_reset_results
        .iter()
        .filter(|item| item.confirmed && item.event_id == input.event_id)
        .cloned()
        .collect::<Vec<_>>();

    let mut removable_pending_set_ids = pending
        .iter()
        .filter(|item| item.set_id.starts_with("preview_"))
        .map(|item| item.set_id.clone())
        .collect::<Vec<_>>();
    let mut remotely_reset_set_ids = Vec::new();
    let mut removable_pending_gf_reset_source_set_ids = Vec::<String>::new();
    pending.retain(|item| !item.set_id.starts_with("preview_"));
    sort_pending_set_results_by_phase_order(&mut pending, local_event);

    let total_count = pending.len() + pending_virtual_gf_reset.len();
    emit_bracket_report_progress(&app, "starting", total_count, 0, 0, 0, None);

    let per_page = input.per_page.unwrap_or(200);
    let mut force_overwrite_current_conflict =
        input.force_overwrite_current_conflict.unwrap_or(false);
    let force_overwrite_remaining_conflicts =
        input.force_overwrite_remaining_conflicts.unwrap_or(false);
    let mut reported_count = 0_usize;
    let mut normal_reported_count = 0_usize;
    let mut skipped_count = 0_usize;
    let mut resolved_remote_gf_reset_set_id = None::<String>;
    let mut resolved_remote_gf_reset_source_set_id = None::<String>;

    let mut conflict = None;

    for item in pending {
        let is_reset_action = item.winner_id.trim().is_empty() && item.slot_scores.is_empty();

        let local_set = match local_event
            .sets
            .iter()
            .find(|set| set.set_id == item.set_id)
        {
            Some(set) => set,
            None => {
                skipped_count += 1;
                removable_pending_set_ids.push(item.set_id.clone());
                emit_bracket_report_progress(
                    &app,
                    "processing",
                    total_count,
                    reported_count + skipped_count,
                    reported_count,
                    skipped_count,
                    Some(item.set_id.as_str()),
                );
                continue;
            }
        };

        let remote_set = match startgg::fetch_set_snapshot(&token, &item.set_id).await {
            Ok(set) => set,
            Err(err) => {
                if err.contains("指定setが見つかりません") {
                    if reported_count == 0 {
                        return Err(err);
                    }

                    conflict = Some(BracketBatchConflict {
                        set_id: item.set_id.clone(),
                        full_round_text: local_set.full_round_text.clone(),
                        local_winner_id: item.winner_id.clone(),
                        remote_winner_id: None,
                        remote_state: 0,
                        entrant_names: local_set
                            .slots
                            .iter()
                            .map(|slot| slot.entrant_name.clone())
                            .collect(),
                    });
                    emit_bracket_report_progress(
                        &app,
                        "conflict",
                        total_count,
                        reported_count + skipped_count,
                        reported_count,
                        skipped_count,
                        Some(item.set_id.as_str()),
                    );
                    break;
                }
                if reported_count == 0 {
                    return Err(err);
                }

                conflict = Some(BracketBatchConflict {
                    set_id: item.set_id.clone(),
                    full_round_text: local_set.full_round_text.clone(),
                    local_winner_id: item.winner_id.clone(),
                    remote_winner_id: None,
                    remote_state: 0,
                    entrant_names: local_set
                        .slots
                        .iter()
                        .map(|slot| slot.entrant_name.clone())
                        .collect(),
                });
                emit_bracket_report_progress(
                    &app,
                    "conflict",
                    total_count,
                    reported_count + skipped_count,
                    reported_count,
                    skipped_count,
                    Some(item.set_id.as_str()),
                );
                break;
            }
        };

        if is_reset_action {
            let remote_is_already_reset =
                remote_set.winner_id.is_none() && (remote_set.state == 1 || remote_set.state == 2);
            if remote_is_already_reset {
                skipped_count += 1;
                removable_pending_set_ids.push(item.set_id.clone());
                remotely_reset_set_ids.push(item.set_id.clone());
                emit_bracket_report_progress(
                    &app,
                    "processing",
                    total_count,
                    reported_count + skipped_count,
                    reported_count,
                    skipped_count,
                    Some(item.set_id.as_str()),
                );
                continue;
            }

            startgg::reset_set_result(&token, &item.set_id).await?;
            reported_count += 1;
            removable_pending_set_ids.push(item.set_id.clone());
            remotely_reset_set_ids.push(item.set_id.clone());
            emit_bracket_report_progress(
                &app,
                "processing",
                total_count,
                reported_count + skipped_count,
                reported_count,
                skipped_count,
                Some(item.set_id.as_str()),
            );
            continue;
        }

        let is_already_synced = remote_set.winner_id.as_ref() == Some(&item.winner_id)
            && derive_score_csv_from_set(&remote_set, &item.winner_id)
                .map(|remote_score_csv| {
                    normalize_score_csv(&remote_score_csv) == normalize_score_csv(&item.score_csv)
                })
                .unwrap_or(false);
        if is_already_synced {
            skipped_count += 1;
            removable_pending_set_ids.push(item.set_id.clone());
            emit_bracket_report_progress(
                &app,
                "processing",
                total_count,
                reported_count + skipped_count,
                reported_count,
                skipped_count,
                Some(item.set_id.as_str()),
            );
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
                emit_bracket_report_progress(
                    &app,
                    "conflict",
                    total_count,
                    reported_count + skipped_count,
                    reported_count,
                    skipped_count,
                    Some(item.set_id.as_str()),
                );
                break;
            }
        } else {
            false
        };

        let can_report_by_state =
            remote_set.state == 1 || remote_set.state == 2 || should_force_overwrite;
        if !can_report_by_state {
            skipped_count += 1;
            emit_bracket_report_progress(
                &app,
                "processing",
                total_count,
                reported_count + skipped_count,
                reported_count,
                skipped_count,
                Some(item.set_id.as_str()),
            );
            continue;
        }

        let remote_entrant_ids = remote_set
            .slots
            .iter()
            .filter_map(|slot| slot.entrant_id.clone())
            .collect::<Vec<_>>();
        let report_result = if remote_entrant_ids.len() >= 2 {
            startgg::report_set_result_with_entrant_ids(
                &token,
                &item.set_id,
                &item.winner_id,
                &item.score_csv,
                should_force_overwrite,
                &remote_entrant_ids,
            )
            .await
        } else {
            startgg::report_set_result(
                &token,
                &item.set_id,
                &item.winner_id,
                &item.score_csv,
                should_force_overwrite,
            )
            .await
        };
        if let Err(err) = report_result {
            if reported_count == 0 {
                return Err(err);
            }

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
            emit_bracket_report_progress(
                &app,
                "conflict",
                total_count,
                reported_count + skipped_count,
                reported_count,
                skipped_count,
                Some(item.set_id.as_str()),
            );
            break;
        }

        reported_count += 1;
        normal_reported_count += 1;
        removable_pending_set_ids.push(item.set_id.clone());
        emit_bracket_report_progress(
            &app,
            "processing",
            total_count,
            reported_count + skipped_count,
            reported_count,
            skipped_count,
            Some(item.set_id.as_str()),
        );
    }

    if conflict.is_none() && !pending_virtual_gf_reset.is_empty() {
        pending_virtual_gf_reset.sort_by(|left, right| left.recorded_at.cmp(&right.recorded_at));
        let virtual_item = pending_virtual_gf_reset
            .last()
            .cloned()
            .ok_or_else(|| "GF Reset保留結果の解決に失敗しました。".to_owned())?;

        emit_bracket_report_progress(
            &app,
            "refreshingSnapshot",
            total_count,
            reported_count + skipped_count,
            reported_count,
            skipped_count,
            Some(virtual_item.source_grand_final_set_id.as_str()),
        );

        let (_refreshed_workspace, remote_reset_set) = refresh_until_gf_reset_set_available(
            &app,
            &token,
            &input.slug,
            &input.event_id,
            per_page,
            &virtual_item.source_grand_final_set_id,
        )
        .await?;

        if let Some(remote_reset_set) = remote_reset_set {
            resolved_remote_gf_reset_set_id = Some(remote_reset_set.set_id.clone());
            resolved_remote_gf_reset_source_set_id =
                Some(virtual_item.source_grand_final_set_id.clone());
            let remote_set = startgg::fetch_set_snapshot(&token, &remote_reset_set.set_id).await?;
            let is_reset_action =
                virtual_item.winner_id.trim().is_empty() && virtual_item.slot_scores.is_empty();

            if is_reset_action {
                let remote_is_already_reset = remote_set.winner_id.is_none()
                    && (remote_set.state == 1 || remote_set.state == 2);
                if remote_is_already_reset {
                    skipped_count += 1;
                    for item in &pending_virtual_gf_reset {
                        removable_pending_gf_reset_source_set_ids
                            .push(item.source_grand_final_set_id.clone());
                    }
                } else {
                    startgg::reset_set_result(&token, &remote_reset_set.set_id).await?;
                    reported_count += 1;
                    for item in &pending_virtual_gf_reset {
                        removable_pending_gf_reset_source_set_ids
                            .push(item.source_grand_final_set_id.clone());
                    }
                }
                emit_bracket_report_progress(
                    &app,
                    "processing",
                    total_count,
                    reported_count + skipped_count,
                    reported_count,
                    skipped_count,
                    Some(remote_reset_set.set_id.as_str()),
                );
            } else {
                let is_already_synced = remote_set.winner_id.as_ref()
                    == Some(&virtual_item.winner_id)
                    && derive_score_csv_from_set(&remote_set, &virtual_item.winner_id)
                        .map(|remote_score_csv| {
                            normalize_score_csv(&remote_score_csv)
                                == normalize_score_csv(&virtual_item.score_csv)
                        })
                        .unwrap_or(false);

                if is_already_synced {
                    skipped_count += 1;
                    for item in &pending_virtual_gf_reset {
                        removable_pending_gf_reset_source_set_ids
                            .push(item.source_grand_final_set_id.clone());
                    }
                    emit_bracket_report_progress(
                        &app,
                        "processing",
                        total_count,
                        reported_count + skipped_count,
                        reported_count,
                        skipped_count,
                        Some(remote_reset_set.set_id.as_str()),
                    );
                } else {
                    let requires_force_overwrite = remote_set.state != 1 && remote_set.state != 2;
                    let should_force_overwrite = if requires_force_overwrite {
                        if force_overwrite_current_conflict {
                            true
                        } else if force_overwrite_remaining_conflicts {
                            true
                        } else {
                            conflict = Some(BracketBatchConflict {
                                set_id: remote_reset_set.set_id.clone(),
                                full_round_text: remote_reset_set.full_round_text.clone(),
                                local_winner_id: virtual_item.winner_id.clone(),
                                remote_winner_id: remote_set.winner_id.clone(),
                                remote_state: remote_set.state,
                                entrant_names: remote_reset_set
                                    .slots
                                    .iter()
                                    .map(|slot| slot.entrant_name.clone())
                                    .collect(),
                            });
                            false
                        }
                    } else {
                        false
                    };

                    if conflict.is_none() {
                        if let Err(err) = report_set_result_with_matchup_retry(
                            &token,
                            &remote_reset_set.set_id,
                            &virtual_item.winner_id,
                            &virtual_item.score_csv,
                            should_force_overwrite,
                        )
                        .await
                        {
                            conflict = Some(BracketBatchConflict {
                                set_id: remote_reset_set.set_id.clone(),
                                full_round_text: remote_reset_set.full_round_text.clone(),
                                local_winner_id: virtual_item.winner_id.clone(),
                                remote_winner_id: remote_set.winner_id.clone(),
                                remote_state: remote_set.state,
                                entrant_names: remote_reset_set
                                    .slots
                                    .iter()
                                    .map(|slot| slot.entrant_name.clone())
                                    .collect(),
                            });
                            if is_matchup_not_ready_error(&err) {
                                emit_bracket_report_progress(
                                    &app,
                                    "paused",
                                    total_count,
                                    reported_count + skipped_count,
                                    reported_count,
                                    skipped_count,
                                    Some(remote_reset_set.set_id.as_str()),
                                );
                            }
                        } else {
                            reported_count += 1;
                            for item in &pending_virtual_gf_reset {
                                removable_pending_gf_reset_source_set_ids
                                    .push(item.source_grand_final_set_id.clone());
                            }
                            emit_bracket_report_progress(
                                &app,
                                "processing",
                                total_count,
                                reported_count + skipped_count,
                                reported_count,
                                skipped_count,
                                Some(remote_reset_set.set_id.as_str()),
                            );
                        }
                    }
                }
            }
        } else {
            conflict = Some(BracketBatchConflict {
                set_id: virtual_item.source_grand_final_set_id.clone(),
                full_round_text: "Grand Final Reset".to_owned(),
                local_winner_id: virtual_item.winner_id.clone(),
                remote_winner_id: None,
                remote_state: 0,
                entrant_names: vec!["TBD".to_owned(), "TBD".to_owned()],
            });
            emit_bracket_report_progress(
                &app,
                "conflict",
                total_count,
                reported_count + skipped_count,
                reported_count,
                skipped_count,
                Some(virtual_item.source_grand_final_set_id.as_str()),
            );
        }
    }

    if !removable_pending_set_ids.is_empty() {
        storage::remove_pending_set_results(
            &app,
            &input.slug,
            &input.event_id,
            &removable_pending_set_ids,
        )?;
    }
    if !removable_pending_gf_reset_source_set_ids.is_empty() {
        storage::remove_pending_grand_final_reset_results(
            &app,
            &input.slug,
            &input.event_id,
            &removable_pending_gf_reset_source_set_ids,
        )?;
    }

    let should_refresh_after_batch = reported_count > 0
        || !remotely_reset_set_ids.is_empty()
        || !removable_pending_gf_reset_source_set_ids.is_empty();
    let can_refresh_gf_reset_only = conflict.is_none()
        && normal_reported_count == 0
        && remotely_reset_set_ids.is_empty()
        && resolved_remote_gf_reset_set_id.is_some();

    let workspace = if should_refresh_after_batch {
        emit_bracket_report_progress(
            &app,
            "refreshingSnapshot",
            total_count,
            reported_count + skipped_count,
            reported_count,
            skipped_count,
            conflict.as_ref().map(|item| item.set_id.as_str()),
        );
        if can_refresh_gf_reset_only {
            let remote_set_id = resolved_remote_gf_reset_set_id
                .as_deref()
                .unwrap_or_default();
            match refresh_workspace_grand_final_reset_only(
                &app,
                &token,
                &input.slug,
                &input.event_id,
                remote_set_id,
                resolved_remote_gf_reset_source_set_id.as_deref(),
            )
            .await
            {
                Ok(workspace) => workspace,
                Err(_) => {
                    match refresh_workspace_after_remote_report(
                        &app,
                        &token,
                        &input.slug,
                        &input.event_id,
                        per_page,
                        &remotely_reset_set_ids,
                    )
                    .await
                    {
                        Ok(workspace) => workspace,
                        Err(_) => storage::load_workspace(&app, &input.slug, &input.event_id)?,
                    }
                }
            }
        } else {
            match refresh_workspace_after_remote_report(
                &app,
                &token,
                &input.slug,
                &input.event_id,
                per_page,
                &remotely_reset_set_ids,
            )
            .await
            {
                Ok(workspace) => workspace,
                Err(_) => storage::load_workspace(&app, &input.slug, &input.event_id)?,
            }
        }
    } else if !removable_pending_set_ids.is_empty()
        || !removable_pending_gf_reset_source_set_ids.is_empty()
    {
        storage::load_workspace(&app, &input.slug, &input.event_id)?
    } else {
        workspace
    };

    let final_phase = if conflict.is_none() {
        "completed"
    } else {
        "paused"
    };
    emit_bracket_report_progress(
        &app,
        final_phase,
        total_count,
        reported_count + skipped_count,
        reported_count,
        skipped_count,
        conflict.as_ref().map(|item| item.set_id.as_str()),
    );

    Ok(BracketBatchReportResult {
        workspace,
        processed_count: reported_count + skipped_count,
        reported_count,
        skipped_count,
        completed: conflict.is_none(),
        conflict,
    })
}
