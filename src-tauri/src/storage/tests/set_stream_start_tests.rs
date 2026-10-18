use super::{build_empty_meta, record_set_stream_start};
use crate::models::{SetSnapshot, TournamentLocalMeta, TournamentSnapshot, TournamentWorkspace};
use chrono::{TimeZone, Utc};

#[test]
fn set_stream_start_clear_removes_only_target_event_records_and_preserves_other_metadata() {
    let mut workspace = workspace();
    let target = set(&workspace);
    let started_at = Utc.timestamp_opt(1_792_281_600, 0).unwrap();
    record_set_stream_start(&mut workspace, "event", &target, started_at);
    let mut second = target.clone();
    second.set_id = "set-b".to_owned();
    record_set_stream_start(&mut workspace, "event", &second, started_at);
    record_set_stream_start(&mut workspace, "other-event", &target, started_at);
    let before = serde_json::to_value(&workspace.local_meta).unwrap();

    super::clear_set_stream_start_records(&mut workspace.local_meta, "event");
    let after = serde_json::to_value(&workspace.local_meta).unwrap();
    assert_eq!(workspace.local_meta.set_stream_starts.len(), 1);
    assert_eq!(workspace.local_meta.set_stream_starts[0].event_id, "other-event");
    for (key, value) in before.as_object().unwrap() {
        if key != "setStreamStarts" && key != "updatedAt" {
            assert_eq!(&after[key], value, "metadata field {key} should be preserved");
        }
    }
    let reloaded: TournamentLocalMeta = serde_json::from_value(after).unwrap();
    assert_eq!(reloaded.set_stream_starts.len(), 1);
    assert_eq!(reloaded.set_stream_starts[0].event_id, "other-event");
}

fn workspace() -> TournamentWorkspace {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament/slug",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [{ "phaseGroupId": "pool-a" }],
            "sets": [{
                "setId": "set-a",
                "phaseGroupId": "pool-a",
                "fullRoundText": "Round 1",
                "state": 1,
                "slots": [
                    { "entrantId": "player-a", "entrantName": "Player A" },
                    { "entrantId": "player-b", "entrantName": "Player B" }
                ]
            }]
        }],
        "updatedAt": "2026-10-18T00:00:00Z"
    }))
    .expect("snapshot should deserialize");
    let mut local_meta = build_empty_meta("tournament/slug", "event");
    local_meta.events[0]
        .score_edit_enabled_phase_group_ids
        .push("pool-a".to_owned());
    TournamentWorkspace {
        snapshot,
        local_meta,
    }
}

fn set(workspace: &TournamentWorkspace) -> SetSnapshot {
    workspace.snapshot.events[0].sets[0].clone()
}

#[test]
fn set_stream_start_saves_latest_timestamp_per_event_and_set() {
    let mut workspace = workspace();
    let target = set(&workspace);
    let first = Utc.timestamp_opt(1_792_281_600, 0).unwrap();
    let latest = first + chrono::Duration::seconds(30);
    assert!(record_set_stream_start(
        &mut workspace,
        "event",
        &target,
        first
    ));
    assert!(record_set_stream_start(
        &mut workspace,
        "event",
        &target,
        latest
    ));

    let mut other_set = target.clone();
    other_set.set_id = "set-b".to_owned();
    workspace.snapshot.events[0].sets.push(other_set.clone());
    assert!(record_set_stream_start(
        &mut workspace,
        "event",
        &other_set,
        first
    ));

    let mut other_event = workspace.snapshot.events[0].clone();
    other_event.event_id = "other-event".to_owned();
    workspace.snapshot.events.push(other_event);
    let mut other_meta = workspace.local_meta.events[0].clone();
    other_meta.event_id = "other-event".to_owned();
    workspace.local_meta.events.push(other_meta);
    assert!(record_set_stream_start(
        &mut workspace,
        "other-event",
        &target,
        first
    ));

    let json = serde_json::to_value(&workspace.local_meta).unwrap();
    assert_eq!(json["setStreamStarts"].as_array().unwrap().len(), 3);
    assert_eq!(
        json["setStreamStarts"][0]["lastStartedAt"],
        latest.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    );
    let loaded: TournamentLocalMeta = serde_json::from_value(json).unwrap();
    assert_eq!(loaded.set_stream_starts[0].last_started_at, latest);
    assert_eq!(loaded.set_stream_starts[1].last_started_at, first);
    assert_eq!(loaded.set_stream_starts[2].event_id, "other-event");
}

#[test]
fn set_stream_start_skips_ineligible_sets_and_preserves_previous_timestamp() {
    let mut workspace = workspace();
    let target = set(&workspace);
    let first = Utc.timestamp_opt(1_792_281_600, 0).unwrap();
    let later = first + chrono::Duration::seconds(30);
    assert!(record_set_stream_start(
        &mut workspace,
        "event",
        &target,
        first
    ));

    let mut completed = target.clone();
    completed.state = 3;
    assert!(!record_set_stream_start(
        &mut workspace,
        "event",
        &completed,
        later
    ));

    let mut unresolved = target.clone();
    unresolved.slots[1].entrant_id = None;
    assert!(!record_set_stream_start(
        &mut workspace,
        "event",
        &unresolved,
        later
    ));
    unresolved.slots[1].entrant_id = Some("player-b".to_owned());
    unresolved.slots[1].entrant_name = "TBD".to_owned();
    assert!(!record_set_stream_start(
        &mut workspace,
        "event",
        &unresolved,
        later
    ));

    assert_eq!(workspace.local_meta.set_stream_starts.len(), 1);
    assert_eq!(
        workspace.local_meta.set_stream_starts[0].last_started_at,
        first
    );
    assert_eq!(workspace.local_meta.updated_at, first);
}

#[test]
fn set_stream_start_records_standby_sets_without_scores_regardless_of_pool_lock() {
    for locked in [true, false] {
        let mut workspace = workspace();
        if locked {
            workspace.local_meta.events[0]
                .score_edit_enabled_phase_group_ids
                .clear();
        }
        let target = set(&workspace);
        assert_eq!(target.state, 1);
        assert!(target.winner_id.is_none());
        assert!(target.slots.iter().all(|slot| slot.score.is_none()));
        assert_eq!(
            super::is_set_score_edit_locked(&workspace, "event", &target.set_id),
            locked
        );

        let started_at = Utc.timestamp_opt(1_792_281_600, 0).unwrap();
        assert!(record_set_stream_start(
            &mut workspace,
            "event",
            &target,
            started_at
        ));
        assert_eq!(workspace.local_meta.set_stream_starts.len(), 1);
        assert_eq!(
            workspace.local_meta.set_stream_starts[0].last_started_at,
            started_at
        );
        assert_eq!(
            super::is_set_score_edit_locked(&workspace, "event", &target.set_id),
            locked
        );
    }
}

#[test]
fn set_stream_start_allows_in_progress_score_updates_and_loads_legacy_metadata() {
    let mut workspace = workspace();
    let mut target = set(&workspace);
    target.state = 2;
    target.slots[0].score = Some(1.0);
    assert!(record_set_stream_start(
        &mut workspace,
        "event",
        &target,
        Utc::now()
    ));

    let mut json = serde_json::to_value(workspace.local_meta).unwrap();
    json.as_object_mut().unwrap().remove("setStreamStarts");
    let legacy: TournamentLocalMeta = serde_json::from_value(json).unwrap();
    assert!(legacy.set_stream_starts.is_empty());
}
