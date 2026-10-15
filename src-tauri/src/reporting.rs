use crate::models::{
    BracketBatchConflict, BracketBatchReportInput, BracketBatchReportResult, EventSnapshot,
    SetSnapshot,
};
use crate::{
    derive_score_csv_from_set, emit_bracket_report_progress, is_matchup_not_ready_error,
    normalize_score_csv, refresh_until_gf_reset_set_available,
    refresh_workspace_after_remote_report, refresh_workspace_grand_final_reset_only,
    report_set_result_with_matchup_retry, sort_pending_set_results_by_phase_order, startgg,
    storage,
};

fn same_set_phase_and_round(local: &SetSnapshot, remote: &SetSnapshot) -> bool {
    let (Some(local_phase_group_id), Some(remote_phase_group_id)) = (
        local.phase_group_id.as_deref(),
        remote.phase_group_id.as_deref(),
    ) else {
        return false;
    };
    local_phase_group_id == remote_phase_group_id && local.round == remote.round
}

fn same_set_identifier(local: &SetSnapshot, remote: &SetSnapshot) -> bool {
    same_set_phase_and_round(local, remote)
        && local
            .identifier
            .as_deref()
            .zip(remote.identifier.as_deref())
            .is_some_and(|(left, right)| {
                !left.trim().is_empty()
                    && !right.trim().is_empty()
                    && left.trim().eq_ignore_ascii_case(right.trim())
            })
}

fn same_set_location_and_label(local: &SetSnapshot, remote: &SetSnapshot) -> bool {
    if !same_set_phase_and_round(local, remote) {
        return false;
    }

    match (
        local
            .identifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        remote
            .identifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ) {
        (Some(_), Some(_)) => return same_set_identifier(local, remote),
        _ => {}
    }

    let local_round_label = local.full_round_text.trim();
    let same_round_label = !local_round_label.is_empty()
        && !local_round_label.eq_ignore_ascii_case("unknown")
        && local_round_label.eq_ignore_ascii_case(remote.full_round_text.trim());

    same_round_label
}

fn same_report_set_identity(local: &SetSnapshot, remote: &SetSnapshot) -> bool {
    if !same_set_location_and_label(local, remote) {
        return false;
    }

    let local_entrant_ids = local
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.as_deref())
        .collect::<std::collections::HashSet<_>>();
    let remote_entrant_ids = remote
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.as_deref())
        .collect::<std::collections::HashSet<_>>();
    if local_entrant_ids.len() != 2
        || remote_entrant_ids.len() != 2
        || local_entrant_ids != remote_entrant_ids
    {
        return false;
    }

    true
}

fn recreated_set_candidates<'a>(
    local_set: &SetSnapshot,
    remote_sets: &'a [SetSnapshot],
) -> Vec<&'a SetSnapshot> {
    remote_sets
        .iter()
        .filter(|remote_set| same_report_set_identity(local_set, remote_set))
        .collect()
}

fn recreated_set_identifier_candidates<'a>(
    local_set: &SetSnapshot,
    remote_sets: &'a [SetSnapshot],
) -> Vec<&'a SetSnapshot> {
    let local_entrant_ids = local_set
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.as_deref())
        .collect::<std::collections::HashSet<_>>();
    if local_entrant_ids.len() != 2 {
        return Vec::new();
    }

    remote_sets
        .iter()
        .filter(|remote_set| {
            if !same_set_identifier(local_set, remote_set) {
                return false;
            }
            let remote_entrant_ids = remote_set
                .slots
                .iter()
                .filter_map(|slot| slot.entrant_id.as_deref())
                .collect::<std::collections::HashSet<_>>();
            remote_entrant_ids.len() <= 2 && remote_entrant_ids.is_subset(&local_entrant_ids)
        })
        .collect()
}

fn recreated_set_match_candidates<'a>(
    local_set: &SetSnapshot,
    remote_sets: &'a [SetSnapshot],
) -> Vec<&'a SetSnapshot> {
    let entrant_matches = recreated_set_candidates(local_set, remote_sets);
    if entrant_matches.is_empty() {
        recreated_set_identifier_candidates(local_set, remote_sets)
    } else {
        entrant_matches
    }
}

fn describe_set_identity(set: &SetSnapshot) -> String {
    let entrant_ids = set
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.as_deref())
        .collect::<Vec<_>>();
    format!(
        "setId={}, phaseGroupId={:?}, identifier={:?}, round={:?}, fullRoundText={:?}, entrantIds=[{}]",
        set.set_id,
        set.phase_group_id,
        set.identifier,
        set.round,
        set.full_round_text,
        entrant_ids.join(", ")
    )
}

async fn resolve_remote_set_for_report(
    app: &tauri::AppHandle,
    token: &str,
    slug: &str,
    event_id: &str,
    per_page: u32,
    local_set: &SetSnapshot,
    remote_event_cache: &mut Option<EventSnapshot>,
) -> Result<(String, SetSnapshot), String> {
    match crate::startgg::fetch_set_snapshot(token, &local_set.set_id).await {
        Ok(remote_set) => return Ok((remote_set.set_id.clone(), remote_set)),
        Err(error) if !error.contains("指定setが見つかりません") => return Err(error),
        Err(_) => {}
    }

    if remote_event_cache.is_none() {
        let snapshot =
            crate::fetch_event_snapshot_with_fallback(app, token, slug, event_id, per_page)
                .await
                .map_err(|error| {
                    format!(
                "Set ID {} がstart.ggに見つからず、現在のSet一覧も取得できませんでした: {error}",
                local_set.set_id
            )
                })?;
        let remote_event = snapshot
            .events
            .into_iter()
            .find(|event| event.event_id == event_id)
            .ok_or_else(|| format!("start.ggの取得結果に対象eventがありません: {event_id}"))?;
        *remote_event_cache = Some(remote_event);
    }

    let remote_event = remote_event_cache
        .as_ref()
        .expect("remote event snapshot is initialized above");
    let candidates = recreated_set_match_candidates(local_set, &remote_event.sets);
    match candidates.as_slice() {
        [remote_set] => Ok((remote_set.set_id.clone(), (*remote_set).clone())),
        [] => {
            let identity_candidates = remote_event
                .sets
                .iter()
                .filter(|remote_set| same_set_location_and_label(local_set, remote_set))
                .collect::<Vec<_>>();
            if let [candidate] = identity_candidates.as_slice() {
                let local_entrant_ids = local_set
                    .slots
                    .iter()
                    .filter_map(|slot| slot.entrant_id.as_deref())
                    .collect::<Vec<_>>();
                let remote_entrant_ids = candidate
                    .slots
                    .iter()
                    .filter_map(|slot| slot.entrant_id.as_deref())
                    .collect::<Vec<_>>();
                return Err(format!(
                    "Set ID {} はstart.ggに見つかりません。同じPhaseGroup・Set表示識別子・ラウンドの候補Set {} は見つかりましたが、Entrant IDが一致しません。ローカル: [{}] / start.gg: [{}]。誤報告防止のため中止しました。復元ダイアログからスナップショットを更新して確認してください。",
                    local_set.set_id,
                    candidate.set_id,
                    local_entrant_ids.join(", "),
                    remote_entrant_ids.join(", ")
                ));
            }
            let local_phase_group_id = local_set.phase_group_id.as_deref();
            let phase_group_sets = remote_event
                .sets
                .iter()
                .filter(|remote_set| {
                    local_phase_group_id.is_some()
                        && remote_set.phase_group_id.as_deref() == local_phase_group_id
                })
                .collect::<Vec<_>>();
            let same_round_sets = phase_group_sets
                .iter()
                .filter(|remote_set| remote_set.round == local_set.round)
                .copied()
                .collect::<Vec<_>>();
            let diagnostic_sets = if same_round_sets.is_empty() {
                &phase_group_sets
            } else {
                &same_round_sets
            };
            let remote_set_diagnostics = diagnostic_sets
                .iter()
                .take(5)
                .map(|set| describe_set_identity(set))
                .collect::<Vec<_>>();
            let remote_set_diagnostics = if remote_set_diagnostics.is_empty() {
                "(none)".to_owned()
            } else {
                remote_set_diagnostics.join("; ")
            };
            Err(format!(
                "Set ID {} がstart.ggに見つからず、Setを一意に照合できませんでした。start.ggでブラケットがStart済みか確認してください。Start済みの場合は、復元ダイアログからスナップショットを更新して再度報告してください。診断: ローカル [{}] / start.gg同一PhaseGroup候補 [{}]",
                local_set.set_id,
                describe_set_identity(local_set),
                remote_set_diagnostics
            ))
        }
        _ => Err(format!(
            "Set ID {} に一致するstart.gg上のSetが複数あり、安全に特定できません。復元ダイアログからスナップショットを更新してください。",
            local_set.set_id
        )),
    }
}

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
    let mut remote_event_cache = None::<EventSnapshot>;

    let mut conflict = None;

    let mut resolved_remote_sets = Vec::with_capacity(pending.len());
    for item in &pending {
        let Some(local_set) = local_event
            .sets
            .iter()
            .find(|set| set.set_id == item.set_id)
        else {
            resolved_remote_sets.push(None);
            continue;
        };

        resolved_remote_sets.push(Some(
            resolve_remote_set_for_report(
                &app,
                &token,
                &input.slug,
                &input.event_id,
                per_page,
                local_set,
                &mut remote_event_cache,
            )
            .await?,
        ));
    }

    for (item, resolved_remote_set) in pending.into_iter().zip(resolved_remote_sets) {
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

        let (remote_set_id, remote_set) = resolved_remote_set.ok_or_else(|| {
            format!(
                "Set ID {} のstart.gg対応付けが事前確認されていません。",
                item.set_id
            )
        })?;

        if is_reset_action {
            let remote_is_already_reset =
                remote_set.winner_id.is_none() && (remote_set.state == 1 || remote_set.state == 2);
            if remote_is_already_reset {
                skipped_count += 1;
                removable_pending_set_ids.push(item.set_id.clone());
                remotely_reset_set_ids.push(remote_set_id.clone());
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

            startgg::reset_set_result(&token, &remote_set_id).await?;
            reported_count += 1;
            removable_pending_set_ids.push(item.set_id.clone());
            remotely_reset_set_ids.push(remote_set_id.clone());
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
                &remote_set_id,
                &item.winner_id,
                &item.score_csv,
                should_force_overwrite,
                &remote_entrant_ids,
            )
            .await
        } else {
            startgg::report_set_result(
                &token,
                &remote_set_id,
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

pub(crate) async fn report_initial_phase_seed_shuffle(
    app: tauri::AppHandle,
    slug: &str,
    event_id: &str,
) -> Result<crate::models::TournamentWorkspace, String> {
    let token = storage::load_token(&app)?;
    if let Some((phase_id, original, desired, restore_requested)) =
        storage::initial_phase_seed_shuffle_for_report(&app, slug, event_id)?
    {
        startgg::update_phase_seeding_if_unchanged(
            &token,
            &phase_id,
            &original,
            &desired,
            restore_requested,
        )
        .await?;
        storage::mark_seed_update_awaiting_started_snapshot(&app, slug, event_id)
    } else {
        storage::load_workspace(&app, slug, event_id)
    }
}

#[cfg(test)]
mod recreated_set_matching_tests {
    use super::*;

    fn make_set(
        set_id: &str,
        phase_group_id: &str,
        identifier: &str,
        round: i64,
        full_round_text: &str,
        entrant_ids: [&str; 2],
    ) -> SetSnapshot {
        serde_json::from_value(serde_json::json!({
            "setId": set_id,
            "phaseGroupId": phase_group_id,
            "identifier": identifier,
            "round": round,
            "fullRoundText": full_round_text,
            "state": 1,
            "slots": [
                { "entrantId": entrant_ids[0], "entrantName": "Entrant 1" },
                { "entrantId": entrant_ids[1], "entrantName": "Entrant 2" }
            ]
        }))
        .expect("set snapshot should deserialize")
    }

    fn make_set_without_entrants(
        set_id: &str,
        phase_group_id: &str,
        identifier: &str,
        round: i64,
        full_round_text: &str,
    ) -> SetSnapshot {
        let mut set = make_set(
            set_id,
            phase_group_id,
            identifier,
            round,
            full_round_text,
            ["", ""],
        );
        for slot in &mut set.slots {
            slot.entrant_id = None;
        }
        set
    }

    #[test]
    fn matches_recreated_set_by_phase_group_display_and_entrants() {
        let local_set = make_set("old-id", "pool-1", "A", 1, "Winners Round 1", ["10", "20"]);
        let remote_sets = vec![
            make_set("new-id", "pool-1", "A", 1, "Winners Round 1", ["20", "10"]),
            make_set(
                "other-pool",
                "pool-2",
                "A",
                1,
                "Winners Round 1",
                ["10", "20"],
            ),
        ];

        let candidates = recreated_set_candidates(&local_set, &remote_sets);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].set_id, "new-id");
    }

    #[test]
    fn matches_recreated_set_by_unique_identifier_when_entrants_are_unresolved() {
        let local_set = make_set(
            "old-id",
            "pool-1",
            "E",
            2,
            "Winners Semi-Final",
            ["10", "20"],
        );
        let remote_sets = vec![
            make_set_without_entrants("new-f-id", "pool-1", "F", 2, "Winners Semi-Final"),
            make_set_without_entrants("new-e-id", "pool-1", "E", 2, "Winners Semi-Final"),
        ];

        let candidates = recreated_set_match_candidates(&local_set, &remote_sets);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].set_id, "new-e-id");
    }

    #[test]
    fn does_not_match_identifier_when_known_entrants_conflict() {
        let local_set = make_set(
            "old-id",
            "pool-1",
            "E",
            2,
            "Winners Semi-Final",
            ["10", "20"],
        );
        let remote_sets = vec![make_set(
            "new-e-id",
            "pool-1",
            "E",
            2,
            "Winners Semi-Final",
            ["10", "30"],
        )];

        assert!(recreated_set_match_candidates(&local_set, &remote_sets).is_empty());
    }

    #[test]
    fn keeps_duplicate_structural_identifiers_ambiguous() {
        let local_set = make_set(
            "old-id",
            "pool-1",
            "E",
            2,
            "Winners Semi-Final",
            ["10", "20"],
        );
        let remote_sets = vec![
            make_set_without_entrants("new-e-1", "pool-1", "E", 2, "Winners Semi-Final"),
            make_set_without_entrants("new-e-2", "pool-1", "E", 2, "Winners Semi-Final"),
        ];

        let candidates = recreated_set_match_candidates(&local_set, &remote_sets);

        assert_eq!(candidates.len(), 2);
    }

    #[test]
    fn does_not_match_recreated_set_with_different_entrants() {
        let local_set = make_set("old-id", "pool-1", "A", 1, "Winners Round 1", ["10", "20"]);
        let remote_sets = vec![make_set(
            "new-id",
            "pool-1",
            "A",
            1,
            "Winners Round 1",
            ["10", "30"],
        )];

        assert!(recreated_set_candidates(&local_set, &remote_sets).is_empty());
    }

    #[test]
    fn distinguishes_entrant_mismatch_from_set_identity_mismatch() {
        let local_set = make_set("old-id", "pool-1", "A", 1, "Winners Round 1", ["10", "20"]);
        let remote_set = make_set("new-id", "pool-1", "A", 1, "Winners Round 1", ["10", "30"]);

        assert!(same_set_location_and_label(&local_set, &remote_set));
        assert!(!same_report_set_identity(&local_set, &remote_set));
    }
}
