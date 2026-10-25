use super::*;

fn event_fixture() -> EventSnapshot {
    serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phases": [{ "phaseId": "phase-1", "phaseOrder": 1 }],
        "phaseGroups": [{
            "phaseGroupId": "group-1",
            "phaseId": "phase-1",
            "phaseOrder": 1,
            "seeds": [
                { "seedId": "seed-a", "seedNum": 1, "entrantId": "entrant-a", "entrantName": "A" },
                { "seedId": "seed-b", "seedNum": 2, "entrantId": "entrant-b", "entrantName": "B" }
            ],
            "seedOrder": ["seed-a", "seed-b"]
        }],
        "sets": [{
            "setId": "set-1",
            "phaseGroupId": "group-1",
            "phaseOrder": 1,
            "fullRoundText": "Round 1",
            "state": 1,
            "winnerId": null,
            "slots": [
                { "entrantId": "entrant-a", "entrantName": "A", "seedId": "seed-a", "seedNum": 1, "score": null },
                { "entrantId": "entrant-b", "entrantName": "B", "seedId": "seed-b", "seedNum": 2, "score": null }
            ]
        }]
    }))
    .expect("event fixture should deserialize")
}

#[test]
fn applies_shared_seed_mapping_to_phase_groups_and_set_slots() {
    let mut event = event_fixture();
    let mapping = vec![
        InitialPhaseSeedMappingEntry {
            seed_id: "seed-a".to_owned(),
            seed_num: 2,
            phase_group_id: None,
        },
        InitialPhaseSeedMappingEntry {
            seed_id: "seed-b".to_owned(),
            seed_num: 1,
            phase_group_id: None,
        },
    ];

    apply_initial_phase_seed_mapping(&mut event, &mapping, false)
        .expect("valid seed mapping should apply");

    let group = &event.phase_groups[0];
    assert_eq!(group.seed_order, ["seed-b", "seed-a"]);
    assert_eq!(
        group
            .seeds
            .iter()
            .map(|seed| (seed.seed_id.as_str(), seed.seed_num))
            .collect::<HashMap<_, _>>(),
        HashMap::from([("seed-a", Some(2)), ("seed-b", Some(1))])
    );
    assert_eq!(
        event.sets[0].slots[0].entrant_id.as_deref(),
        Some("entrant-b")
    );
    assert_eq!(event.sets[0].slots[0].seed_id.as_deref(), Some("seed-b"));
    assert_eq!(
        event.sets[0].slots[1].entrant_id.as_deref(),
        Some("entrant-a")
    );
    assert_eq!(event.sets[0].slots[1].seed_id.as_deref(), Some("seed-a"));
}

#[test]
fn rejects_shared_seed_mapping_without_mutating_event() {
    let mut event = event_fixture();
    let mapping = vec![
        InitialPhaseSeedMappingEntry {
            seed_id: "seed-a".to_owned(),
            seed_num: 1,
            phase_group_id: None,
        },
        InitialPhaseSeedMappingEntry {
            seed_id: "seed-b".to_owned(),
            seed_num: 1,
            phase_group_id: None,
        },
    ];
    let original = serde_json::to_value(&event).expect("event should serialize");

    assert!(apply_initial_phase_seed_mapping(&mut event, &mapping, false).is_err());
    assert_eq!(
        serde_json::to_value(&event).expect("event should serialize"),
        original
    );
}

#[test]
fn share_archive_supports_legacy_and_seed_mapping_versions() {
    let mut legacy_archive = serde_json::json!({
        "format": "savakan-gg-event-share",
        "schemaVersion": 2,
        "snapshot": {
            "tournamentId": "tournament",
            "slug": "event",
            "name": "Tournament",
            "events": [],
            "updatedAt": "2026-01-01T00:00:00Z"
        },
        "eventSettings": {}
    });
    let legacy: TournamentShareArchive =
        serde_json::from_value(legacy_archive.clone()).expect("legacy archive should deserialize");
    assert!(legacy.local_initial_phase_seed_mapping.is_none());

    legacy_archive["schemaVersion"] = serde_json::json!(3);
    legacy_archive["localInitialPhaseSeedMapping"] = serde_json::json!([
        { "seedId": "seed-a", "seedNum": 2 }
    ]);
    let current: TournamentShareArchive =
        serde_json::from_value(legacy_archive).expect("current archive should deserialize");
    assert_eq!(
        current.local_initial_phase_seed_mapping,
        Some(vec![InitialPhaseSeedMappingEntry {
            seed_id: "seed-a".to_owned(),
            seed_num: 2,
            phase_group_id: None,
        }])
    );
}
