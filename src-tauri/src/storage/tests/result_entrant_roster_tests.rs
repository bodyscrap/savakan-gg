use super::{build_empty_meta, merge_snapshot_into_meta, result_entrant_ids_match_set_roster};
use crate::models::{LocalSetResultMeta, LocalSetScoreMeta, SetSnapshot, TournamentSnapshot};
use chrono::Utc;

#[test]
fn rejects_result_entrants_from_a_previous_matchup() {
    let set: SetSnapshot = serde_json::from_value(serde_json::json!({
        "setId": "set-a",
        "fullRoundText": "Semi-Final",
        "state": 2,
        "slots": [
            { "entrantId": "player-11", "entrantName": "Player11" },
            { "entrantId": "player-15", "entrantName": "Player15" }
        ]
    }))
    .expect("test set should deserialize");

    assert!(!result_entrant_ids_match_set_roster(
        &set,
        "player-6",
        &["player-11".to_owned(), "player-6".to_owned()],
    ));
}

#[test]
fn drops_pending_results_that_reference_previous_set_entrants() {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament/example",
        "name": "Tournament",
        "updatedAt": "2026-10-01T00:00:00Z",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "sets": [{
                "setId": "set-a",
                "fullRoundText": "Semi-Final",
                "state": 2,
                "slots": [
                    { "entrantId": "player-11", "entrantName": "Player11" },
                    { "entrantId": "player-15", "entrantName": "Player15" }
                ]
            }]
        }]
    }))
    .expect("test snapshot should deserialize");
    let mut meta = build_empty_meta("tournament/example", "event");
    meta.pending_set_results.push(LocalSetResultMeta {
        event_id: "event".to_owned(),
        event_name: "Event".to_owned(),
        set_id: "set-a".to_owned(),
        winner_id: "player-6".to_owned(),
        score_csv: "2-0".to_owned(),
        direct_win: false,
        confirmed: true,
        slot_scores: vec![
            LocalSetScoreMeta {
                entrant_id: "player-11".to_owned(),
                score: 0,
            },
            LocalSetScoreMeta {
                entrant_id: "player-6".to_owned(),
                score: 2,
            },
        ],
        reset_source_set_id: None,
        recorded_at: Utc::now(),
    });

    let merged = merge_snapshot_into_meta(&snapshot, "event", meta);

    assert!(merged.pending_set_results.is_empty());
}
