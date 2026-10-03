use super::{append_set_confirmation_record, build_empty_meta, event_snapshot_file_matches};
use chrono::{TimeZone, Utc};

#[test]
fn assigns_confirmation_sequences_per_event_and_preserves_slot_order() {
    let mut meta = build_empty_meta("tournament", "event-a");
    let confirmed_at = Utc.timestamp_opt(1_798_718_400, 0).unwrap();

    append_set_confirmation_record(
        &mut meta,
        "event-a",
        "set-a",
        "entrant-1",
        vec!["entrant-1".to_owned(), "entrant-2".to_owned()],
        confirmed_at,
    );
    append_set_confirmation_record(
        &mut meta,
        "event-a",
        "set-b",
        "entrant-4",
        vec!["entrant-3".to_owned(), "entrant-4".to_owned()],
        confirmed_at,
    );
    append_set_confirmation_record(
        &mut meta,
        "event-b",
        "set-c",
        "entrant-5",
        vec!["entrant-5".to_owned(), "entrant-6".to_owned()],
        confirmed_at,
    );

    assert_eq!(meta.set_confirmation_history[0].sequence, 1);
    assert_eq!(meta.set_confirmation_history[1].sequence, 2);
    assert_eq!(meta.set_confirmation_history[2].sequence, 1);
    assert_eq!(
        meta.set_confirmation_history[0].slot_entrant_ids,
        vec!["entrant-1", "entrant-2"]
    );
    assert_eq!(meta.set_confirmation_history[0].confirmed_at, confirmed_at);
}
#[test]
fn loads_metadata_without_confirmation_history() {
    let meta = serde_json::from_value::<crate::models::TournamentLocalMeta>(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "events": [{
            "eventId": "event-a",
            "eventName": "Event",
            "entrants": []
        }],
        "setPlaySides": [],
        "pendingSetResults": [],
        "pendingGrandFinalResetResults": [],
        "updatedAt": "2026-09-30T00:00:00Z"
    }))
    .expect("older metadata without confirmation history should load");

    assert!(meta.set_confirmation_history.is_empty());
    assert!(meta.tournament_name.is_empty());
}

#[test]
fn event_snapshot_file_filter_matches_only_the_requested_slug_and_event() {
    let file_name = "123-tournament-slug-event-456-weekly-snapshot.json";

    assert!(event_snapshot_file_matches(
        file_name,
        "tournament/slug",
        "event-456",
        "-snapshot.json"
    ));
    assert!(!event_snapshot_file_matches(
        file_name,
        "tournament/slug",
        "event-789",
        "-snapshot.json"
    ));
    assert!(!event_snapshot_file_matches(
        file_name,
        "another-tournament",
        "event-456",
        "-snapshot.json"
    ));
}
