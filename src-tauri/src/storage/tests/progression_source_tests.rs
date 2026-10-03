use super::{
    advance_completed_set_by_placement, advance_completed_set_to_next_real_sets,
    apply_indexed_progression_targets, apply_local_progression_incremental,
    apply_seed_sources_to_set_slots, apply_source_based_tbd_labels, build_bracket_graph,
    build_progression_targets_by_source, clear_affected_progression_seeds,
    collect_affected_reset_targets, hydrate_progression_entrant_to_seed_slots,
    rebuild_progression_from_completed_sets, restore_matching_pending_results_for_event,
    restore_missing_slot_entrants, restore_pending_result_to_event, winners_to_losers_round_match,
    ProgressionTarget, WinnersToLosersRoundMap,
};
use crate::models::{
    EventSnapshot, LocalSetResultMeta, LocalSetScoreMeta, PhaseGroupSeedSnapshot, SetSnapshot,
    TournamentSnapshot,
};
use chrono::Utc;

fn progression_targets_for(
    event: &EventSnapshot,
) -> std::collections::HashMap<String, Vec<ProgressionTarget>> {
    let snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event.clone()],
        updated_at: Utc::now(),
    };
    build_progression_targets_by_source(&snapshot, event)
}

#[test]
fn pending_confirmation_is_restored_only_for_the_replayed_roster() {
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "sets": [{
            "setId": "set",
            "fullRoundText": "Final",
            "state": 2,
            "winnerId": null,
            "slots": [
                { "entrantId": "winner", "entrantName": "Winner" },
                { "entrantId": "opponent", "entrantName": "Opponent" }
            ]
        }]
    }))
    .expect("test event should deserialize");
    let pending: LocalSetResultMeta = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "eventName": "Event",
        "setId": "set",
        "winnerId": "winner",
        "scoreCsv": "2-1",
        "confirmed": true,
        "slotScores": [
            { "entrantId": "winner", "score": 2 },
            { "entrantId": "opponent", "score": 1 }
        ],
        "recordedAt": "2026-10-01T00:00:00Z"
    }))
    .expect("pending result should deserialize");

    assert!(restore_matching_pending_results_for_event(
        &mut event,
        std::slice::from_ref(&pending),
    ));
    assert_eq!(event.sets[0].state, 3);
    assert_eq!(event.sets[0].winner_id.as_deref(), Some("winner"));
    assert_eq!(event.sets[0].slots[1].score, Some(1.0));

    event.sets[0].slots[1].entrant_id = Some("different-opponent".to_owned());
    event.sets[0].state = 2;
    event.sets[0].winner_id = None;
    assert!(!restore_matching_pending_results_for_event(
        &mut event,
        std::slice::from_ref(&pending),
    ));
    assert_eq!(event.sets[0].state, 2);
    assert_eq!(event.sets[0].winner_id, None);
}

#[test]
fn reset_dependency_collection_crosses_progression_seed_to_later_phase() {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [
                { "phaseId": "middle", "phaseOrder": 1 },
                { "phaseId": "finals", "phaseOrder": 2 }
            ],
            "phaseGroups": [
                {
                    "phaseGroupId": "middle-pool",
                    "phaseId": "middle",
                    "phaseOrder": 1,
                    "setIds": ["source"]
                },
                {
                    "phaseGroupId": "finals-pool",
                    "phaseId": "finals",
                    "phaseOrder": 2,
                    "bracketType": "ROUND_ROBIN",
                    "setIds": ["finals-match"],
                    "seeds": [
                        {
                            "seedId": "advance-seed",
                            "progressionId": "advance",
                            "entrantId": "advancing-player",
                            "entrantName": "Advancing Player"
                        },
                        { "seedId": "other-seed", "progressionId": "other" }
                    ]
                }
            ],
            "sets": [
                {
                    "setId": "source",
                    "phaseGroupId": "middle-pool",
                    "phaseOrder": 1,
                    "fullRoundText": "Winners Final",
                    "state": 3,
                    "winnerId": "advancing-player",
                    "winnerProgressionSeedId": "advance-seed",
                    "winnerProgressionId": "advance",
                    "slots": [
                        { "entrantId": "advancing-player", "entrantName": "Advancing Player" },
                        { "entrantId": "other-player", "entrantName": "Other Player" }
                    ]
                },
                {
                    "setId": "finals-match",
                    "phaseGroupId": "finals-pool",
                    "phaseOrder": 2,
                    "fullRoundText": "Round 1",
                    "state": 1,
                    "entrant1Source": { "sourceType": "seed", "typeId": "advance-seed" },
                    "entrant2Source": { "sourceType": "seed", "typeId": "other-seed" },
                    "slots": [
                        { "seedId": "advance-seed", "entrantName": "TBD" },
                        { "seedId": "other-seed", "entrantName": "TBD" }
                    ]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");
    let event = &snapshot.events[0];

    let reset_targets = collect_affected_reset_targets(&snapshot, event, "source")
        .expect("source reset dependencies should resolve");

    assert!(reset_targets.set_ids.contains(&"source".to_owned()));
    assert!(reset_targets.set_ids.contains(&"finals-match".to_owned()));
    assert!(reset_targets.seed_ids.contains("advance-seed"));

    let mut event = snapshot.events[0].clone();
    let mut invalid_entrant_ids = std::collections::HashSet::new();
    clear_affected_progression_seeds(
        &mut event,
        &reset_targets.seed_ids,
        &mut invalid_entrant_ids,
    );
    assert_eq!(event.phase_groups[1].seeds[0].entrant_id, None);
    assert_eq!(event.phase_groups[1].seeds[0].entrant_name, None);
    assert!(invalid_entrant_ids.contains("advancing-player"));
}

#[test]
fn reset_dependency_collection_crosses_round_robin_progressions_out() {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [
                { "phaseId": "pool", "phaseOrder": 1 },
                { "phaseId": "finals", "phaseOrder": 2 }
            ],
            "phaseGroups": [
                {
                    "phaseGroupId": "round-robin",
                    "phaseId": "pool",
                    "phaseOrder": 1,
                    "bracketType": "ROUND_ROBIN",
                    "setIds": ["rr-source", "rr-other"],
                    "progressionsOut": [{
                        "progressionId": "top-seed",
                        "originPhaseId": "pool",
                        "originPhaseOrder": 1,
                        "originPhaseGroupId": "round-robin",
                        "originPlacement": 1,
                        "originOrder": 1
                    }]
                },
                {
                    "phaseGroupId": "finals",
                    "phaseId": "finals",
                    "phaseOrder": 2,
                    "setIds": ["final-match"],
                    "seeds": [
                        {
                            "seedId": "qualified-seed",
                            "progressionId": "top-seed",
                            "originPhaseId": "pool",
                            "originPhaseOrder": 1,
                            "originPhaseGroupId": "round-robin",
                            "originPlacement": 1,
                            "originOrder": 1,
                            "entrantId": "qualified-player",
                            "entrantName": "Qualified Player"
                        }
                    ]
                }
            ],
            "sets": [
                {
                    "setId": "rr-source",
                    "phaseGroupId": "round-robin",
                    "phaseOrder": 1,
                    "fullRoundText": "Round 1",
                    "state": 3,
                    "winnerId": "qualified-player",
                    "slots": [
                        { "entrantId": "qualified-player", "entrantName": "Qualified Player", "score": 2 },
                        { "entrantId": "pool-player", "entrantName": "Pool Player", "score": 0 }
                    ]
                },
                {
                    "setId": "rr-other",
                    "phaseGroupId": "round-robin",
                    "phaseOrder": 1,
                    "fullRoundText": "Round 2",
                    "state": 3,
                    "winnerId": "pool-player",
                    "slots": [
                        { "entrantId": "pool-player", "entrantName": "Pool Player", "score": 2 },
                        { "entrantId": "qualified-player", "entrantName": "Qualified Player", "score": 0 }
                    ]
                },
                {
                    "setId": "final-match",
                    "phaseGroupId": "finals",
                    "phaseOrder": 2,
                    "fullRoundText": "Winners Round 1",
                    "state": 1,
                    "entrant1Source": { "sourceType": "seed", "typeId": "qualified-seed" },
                    "slots": [
                        { "seedId": "qualified-seed", "entrantId": "qualified-player", "entrantName": "Qualified Player" },
                        { "entrantId": "finalist", "entrantName": "Finalist" }
                    ]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");
    let event = &snapshot.events[0];

    let reset_targets = collect_affected_reset_targets(&snapshot, event, "rr-source")
        .expect("round robin reset dependencies should resolve");

    assert!(reset_targets.set_ids.contains(&"rr-source".to_owned()));
    assert!(reset_targets.set_ids.contains(&"final-match".to_owned()));
    assert!(reset_targets.seed_ids.contains("qualified-seed"));
}

#[test]
fn next_phase_follows_event_phase_sequence_not_phase_order_number() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phases": [
            { "phaseId": "qualifiers", "phaseOrder": 1 },
            { "phaseId": "middle", "phaseOrder": 3 },
            { "phaseId": "finals", "phaseOrder": 2 }
        ],
        "phaseGroups": [],
        "sets": []
    }))
    .expect("test event should deserialize");

    assert_eq!(
        super::next_phase_id_and_order(&event, Some("middle"), 3),
        Some((Some("finals".to_owned()), 2))
    );
}

#[test]
fn progresses_middle_pool_placements_to_round_robin_seed_slots() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phases": [
            { "phaseId": "qualifiers", "phaseOrder": 1 },
            { "phaseId": "middle", "phaseOrder": 3 },
            { "phaseId": "finals", "phaseOrder": 2 }
        ],
        "phaseGroups": [
            {
                "phaseGroupId": "middle-1",
                "phaseId": "middle",
                "phaseOrder": 3,
                "displayIdentifier": "1",
                "setIds": ["middle-winner-1", "middle-loser-1"]
            },
            {
                "phaseGroupId": "middle-2",
                "phaseId": "middle",
                "phaseOrder": 3,
                "displayIdentifier": "2",
                "setIds": ["middle-winner-2", "middle-loser-2"]
            },
            {
                "phaseGroupId": "finals",
                "phaseId": "finals",
                "phaseOrder": 2,
                "displayIdentifier": "1",
                "bracketType": "ROUND_ROBIN",
                "setIds": ["round-robin-1", "round-robin-2"],
                "seeds": [
                    { "seedId": "winner-seed-1", "progressionId": "winner-progression-1" },
                    { "seedId": "winner-seed-2", "progressionId": "winner-progression-2" },
                    { "seedId": "loser-seed-1", "progressionId": "loser-progression-1" },
                    { "seedId": "loser-seed-2", "progressionId": "loser-progression-2" }
                ]
            }
        ],
        "sets": [
            {
                "setId": "middle-winner-1",
                "phaseGroupId": "middle-1",
                "phaseOrder": 3,
                "phaseName": "Middle",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Winners Final",
                "state": 3,
                "winnerId": "winner-1",
                "winnerProgressionSeedId": "winner-seed-1",
                "winnerProgressionId": "winner-progression-1",
                "slots": [
                    { "entrantId": "winner-1", "entrantName": "Winner 1" },
                    { "entrantId": "other-1", "entrantName": "Other 1" }
                ]
            },
            {
                "setId": "middle-loser-1",
                "phaseGroupId": "middle-1",
                "phaseOrder": 3,
                "phaseName": "Middle",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Losers Final",
                "state": 3,
                "winnerId": "loser-1",
                "winnerProgressionSeedId": "loser-seed-1",
                "winnerProgressionId": "loser-progression-1",
                "slots": [
                    { "entrantId": "loser-1", "entrantName": "Loser 1" },
                    { "entrantId": "other-loser-1", "entrantName": "Other Loser 1" }
                ]
            },
            {
                "setId": "middle-winner-2",
                "phaseGroupId": "middle-2",
                "phaseOrder": 3,
                "phaseName": "Middle",
                "phaseGroupDisplayIdentifier": "2",
                "fullRoundText": "Winners Final",
                "state": 3,
                "winnerId": "winner-2",
                "winnerProgressionSeedId": "winner-seed-2",
                "winnerProgressionId": "winner-progression-2",
                "slots": [
                    { "entrantId": "winner-2", "entrantName": "Winner 2" },
                    { "entrantId": "other-2", "entrantName": "Other 2" }
                ]
            },
            {
                "setId": "middle-loser-2",
                "phaseGroupId": "middle-2",
                "phaseOrder": 3,
                "phaseName": "Middle",
                "phaseGroupDisplayIdentifier": "2",
                "fullRoundText": "Losers Final",
                "state": 3,
                "winnerId": "loser-2",
                "winnerProgressionSeedId": "loser-seed-2",
                "winnerProgressionId": "loser-progression-2",
                "slots": [
                    { "entrantId": "loser-2", "entrantName": "Loser 2" },
                    { "entrantId": "other-loser-2", "entrantName": "Other Loser 2" }
                ]
            },
            {
                "setId": "round-robin-1",
                "phaseGroupId": "finals",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Round 1",
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "winner-seed-1" },
                "entrant2Source": { "sourceType": "seed", "typeId": "winner-seed-2" },
                "slots": [
                    { "seedId": "winner-seed-1", "entrantName": "TBD" },
                    { "seedId": "winner-seed-2", "entrantName": "TBD" }
                ]
            },
            {
                "setId": "round-robin-2",
                "phaseGroupId": "finals",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Round 1",
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "loser-seed-1" },
                "entrant2Source": { "sourceType": "seed", "typeId": "loser-seed-2" },
                "slots": [
                    { "seedId": "loser-seed-1", "entrantName": "TBD" },
                    { "seedId": "loser-seed-2", "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event.clone()],
        updated_at: Utc::now(),
    };

    let graph = build_bracket_graph(&snapshot, &event);
    let mut progression_edges = graph
        .edges
        .iter()
        .filter(|edge| edge.to_set_id.starts_with("round-robin"))
        .map(|edge| (edge.from_set_id.as_str(), edge.to_set_id.as_str()))
        .collect::<Vec<_>>();
    progression_edges.sort_unstable();
    assert_eq!(
        progression_edges,
        vec![
            ("middle-loser-1", "round-robin-2"),
            ("middle-loser-2", "round-robin-2"),
            ("middle-winner-1", "round-robin-1"),
            ("middle-winner-2", "round-robin-1")
        ]
    );

    let targets = progression_targets_for(&event);
    for (source_set_id, winner_id) in [
        ("middle-winner-1", "winner-1"),
        ("middle-winner-2", "winner-2"),
        ("middle-loser-1", "loser-1"),
        ("middle-loser-2", "loser-2"),
    ] {
        apply_local_progression_incremental(
            &mut snapshot,
            "event",
            source_set_id,
            winner_id,
            &targets,
        );
    }

    let event = &snapshot.events[0];
    assert_eq!(
        event.sets[4].slots[0].entrant_id.as_deref(),
        Some("winner-1")
    );
    assert_eq!(
        event.sets[4].slots[1].entrant_id.as_deref(),
        Some("winner-2")
    );
    assert_eq!(
        event.sets[5].slots[0].entrant_id.as_deref(),
        Some("loser-1")
    );
    assert_eq!(
        event.sets[5].slots[1].entrant_id.as_deref(),
        Some("loser-2")
    );
    assert_eq!(
        event.phase_groups[2].seeds[0].entrant_id.as_deref(),
        Some("winner-1")
    );
    assert_eq!(
        event.phase_groups[2].seeds[3].entrant_id.as_deref(),
        Some("loser-2")
    );
}

#[test]
fn rebuilds_round_robin_to_elimination_to_round_robin_in_phase_order() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [
                { "phaseId": "pool", "phaseOrder": 1 },
                { "phaseId": "elimination", "phaseOrder": 2 },
                { "phaseId": "finals", "phaseOrder": 3 }
            ],
            "phaseGroups": [
                {
                    "phaseGroupId": "pool-1",
                    "phaseId": "pool",
                    "phaseOrder": 1,
                    "bracketType": "ROUND_ROBIN",
                    "setIds": ["pool-match"],
                    "progressionsOut": [
                        {
                            "progressionId": "pool-first",
                            "originPhaseId": "pool",
                            "originPhaseOrder": 1,
                            "originPhaseGroupId": "pool-1",
                            "originPlacement": 1
                        },
                        {
                            "progressionId": "pool-second",
                            "originPhaseId": "pool",
                            "originPhaseOrder": 1,
                            "originPhaseGroupId": "pool-1",
                            "originPlacement": 2
                        }
                    ],
                    "seeds": [
                        { "seedId": "pool-seed-a", "seedNum": 1, "entrantId": "entrant-a", "entrantName": "Entrant A" },
                        { "seedId": "pool-seed-b", "seedNum": 2, "entrantId": "entrant-b", "entrantName": "Entrant B" }
                    ]
                },
                {
                    "phaseGroupId": "elimination-1",
                    "phaseId": "elimination",
                    "phaseOrder": 2,
                    "bracketType": "SINGLE_ELIMINATION",
                    "setIds": ["elimination-match"],
                    "seeds": [
                        { "seedId": "elimination-seed-a", "progressionId": "pool-first" },
                        { "seedId": "elimination-seed-b", "progressionId": "pool-second" }
                    ]
                },
                {
                    "phaseGroupId": "finals-1",
                    "phaseId": "finals",
                    "phaseOrder": 3,
                    "bracketType": "ROUND_ROBIN",
                    "setIds": ["finals-match"],
                    "seeds": [
                        { "seedId": "finals-seed", "progressionId": "elimination-winner" }
                    ]
                }
            ],
            "sets": [
                {
                    "setId": "pool-match",
                    "phaseGroupId": "pool-1",
                    "phaseOrder": 1,
                    "fullRoundText": "Round 1",
                    "state": 3,
                    "winnerId": "entrant-a",
                    "slots": [
                        { "entrantId": "entrant-a", "entrantName": "Entrant A" },
                        { "entrantId": "entrant-b", "entrantName": "Entrant B" }
                    ]
                },
                {
                    "setId": "elimination-match",
                    "phaseGroupId": "elimination-1",
                    "phaseOrder": 2,
                    "fullRoundText": "Winners Final",
                    "state": 3,
                    "winnerId": "stale-winner",
                    "winnerProgressionSeedId": "finals-seed",
                    "winnerProgressionId": "elimination-winner",
                    "entrant1Source": { "sourceType": "seed", "typeId": "elimination-seed-a" },
                    "entrant2Source": { "sourceType": "seed", "typeId": "elimination-seed-b" },
                    "slots": [
                        { "entrantId": "stale-winner", "entrantName": "Stale Winner", "seedId": "elimination-seed-a" },
                        { "entrantId": "stale-opponent", "entrantName": "Stale Opponent", "seedId": "elimination-seed-b" }
                    ]
                },
                {
                    "setId": "finals-match",
                    "phaseGroupId": "finals-1",
                    "phaseOrder": 3,
                    "fullRoundText": "Round 1",
                    "state": 1,
                    "entrant1Source": { "sourceType": "seed", "typeId": "finals-seed" },
                    "slots": [
                        { "seedId": "finals-seed", "entrantName": "TBD" },
                        { "entrantName": "TBD" }
                    ]
                }
            ]
        }],
        "updatedAt": "2026-10-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");

    rebuild_progression_from_completed_sets(&mut snapshot);

    let event = &snapshot.events[0];
    let elimination_set = event
        .sets
        .iter()
        .find(|set| set.set_id == "elimination-match")
        .expect("elimination set should exist");
    assert_eq!(
        elimination_set.slots[0].entrant_id.as_deref(),
        Some("entrant-a")
    );
    assert_eq!(
        elimination_set.slots[1].entrant_id.as_deref(),
        Some("entrant-b")
    );
    assert_eq!(elimination_set.winner_id, None);
    assert_ne!(elimination_set.state, 3);

    let finals_set = event
        .sets
        .iter()
        .find(|set| set.set_id == "finals-match")
        .expect("finals set should exist");
    assert_eq!(finals_set.slots[0].entrant_id, None);
}

#[test]
fn single_elimination_advances_only_winners_without_a_losers_lane() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [{
                "phaseGroupId": "single-elimination",
                "phaseOrder": 1,
                "bracketType": "SINGLE_ELIMINATION",
                "setIds": ["round-a", "round-b", "final"]
            }],
            "sets": [
                {
                    "setId": "round-a",
                    "phaseGroupId": "single-elimination",
                    "phaseOrder": 1,
                    "fullRoundText": "Winners Round 1",
                    "round": 1,
                    "state": 3,
                    "winnerId": "entrant-a",
                    "slots": [
                        { "entrantId": "entrant-a", "entrantName": "Entrant A" },
                        { "entrantId": "entrant-b", "entrantName": "Entrant B" }
                    ]
                },
                {
                    "setId": "round-b",
                    "phaseGroupId": "single-elimination",
                    "phaseOrder": 1,
                    "fullRoundText": "Winners Round 1",
                    "round": 1,
                    "state": 3,
                    "winnerId": "entrant-c",
                    "slots": [
                        { "entrantId": "entrant-c", "entrantName": "Entrant C" },
                        { "entrantId": "entrant-d", "entrantName": "Entrant D" }
                    ]
                },
                {
                    "setId": "final",
                    "phaseGroupId": "single-elimination",
                    "phaseOrder": 1,
                    "fullRoundText": "Winners Final",
                    "round": 2,
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "set",
                        "typeId": "round-a",
                        "condition": "winner"
                    },
                    "entrant2Source": {
                        "sourceType": "set",
                        "typeId": "round-b",
                        "condition": "winner"
                    },
                    "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
                }
            ]
        }],
        "updatedAt": "2026-10-01T00:00:00Z"
    }))
    .expect("single-elimination snapshot should deserialize");
    let event = &snapshot.events[0];
    let graph = build_bracket_graph(&snapshot, event);

    assert_eq!(graph.edges.len(), 2);
    assert!(graph.edges.iter().all(|edge| edge.relation == "winner"));

    let targets = progression_targets_for(event);
    for (source_set_id, winner_id) in [("round-a", "entrant-a"), ("round-b", "entrant-c")] {
        apply_local_progression_incremental(
            &mut snapshot,
            "event",
            source_set_id,
            winner_id,
            &targets,
        );
    }

    let final_set = snapshot.events[0]
        .sets
        .iter()
        .find(|set| set.set_id == "final")
        .expect("final set should exist");
    assert_eq!(final_set.slots[0].entrant_id.as_deref(), Some("entrant-a"));
    assert_eq!(final_set.slots[1].entrant_id.as_deref(), Some("entrant-c"));
    assert!(!final_set
        .slots
        .iter()
        .filter_map(|slot| slot.entrant_id.as_deref())
        .any(|entrant_id| entrant_id == "entrant-b" || entrant_id == "entrant-d"));
}

#[test]
fn progression_candidates_use_the_previous_same_side_round() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phaseGroups": [{
            "phaseGroupId": "bracket",
            "phaseOrder": 1,
            "setIds": [
                "w-round-1", "w-round-2", "w-target", "w-gap-target",
                "w-direct-gap-target",
                "l-round-1", "l-round-2", "l-round-2-seed-target", "l-target",
                "gf-reset", "third-place", "fifth-place"
            ]
        }],
        "sets": [
            {
                "setId": "w-round-1",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Winners Round 1",
                "round": 1,
                "state": 1,
                "winnerProgressionSeedId": "w-seed",
                "loserProgressionSeedId": "w-drop-seed",
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "w-round-2",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Winners Round 2",
                "round": 2,
                "state": 1,
                "winnerProgressionSeedId": "w-seed",
                "loserProgressionSeedId": "w-drop-seed",
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "w-target",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Winners Final",
                "round": 3,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "w-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "w-gap-target",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Winners Semi-Final",
                "round": 4,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "w-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "w-direct-gap-target",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Winners Semi-Final",
                "round": 4,
                "state": 1,
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "w-round-1",
                    "condition": "winner"
                },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "gf-reset",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Grand Final Reset",
                "round": 5,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "w-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "third-place",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "3rd Place Match",
                "round": 4,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "w-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "l-round-1",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Losers Round 1",
                "round": -1,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "w-drop-seed" },
                "winnerProgressionSeedId": "l-seed",
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "l-round-2",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Losers Round 2",
                "round": -2,
                "state": 1,
                "winnerProgressionSeedId": "l-seed",
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "w-round-2",
                    "condition": "loser"
                },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "l-round-2-seed-target",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Losers Round 2",
                "round": -2,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "w-drop-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "l-target",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Losers Round 3",
                "round": -3,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "l-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "fifth-place",
                "phaseGroupId": "bracket",
                "phaseOrder": 1,
                "phaseName": "Finals",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "5th Place Match",
                "round": -5,
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "l-seed" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            }
        ]
    }))
    .expect("round progression test event should deserialize");
    let snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event.clone()],
        updated_at: Utc::now(),
    };

    let graph = build_bracket_graph(&snapshot, &event);
    for (target_set_id, expected_source_set_id, expected_relation) in [
        ("w-target", "w-round-2", "winner"),
        ("l-target", "l-round-2", "winner"),
        ("l-round-1", "w-round-1", "loser"),
        ("l-round-2", "w-round-2", "loser"),
        ("l-round-2-seed-target", "w-round-2", "loser"),
        ("gf-reset", "w-round-1", "winner"),
        ("third-place", "w-round-1", "winner"),
        ("fifth-place", "l-round-1", "winner"),
    ] {
        assert!(
            graph.edges.iter().any(|edge| {
                edge.to_set_id == target_set_id
                    && edge.from_set_id == expected_source_set_id
                    && edge.relation == expected_relation
            }),
            "missing edge {expected_source_set_id} -> {target_set_id} ({expected_relation})"
        );
    }
    assert!(!graph.edges.iter().any(|edge| {
        edge.to_set_id == "w-gap-target" || edge.to_set_id == "w-direct-gap-target"
    }));
}

#[test]
fn winners_to_losers_rounds_follow_monotonic_progression() {
    let source: SetSnapshot = serde_json::from_value(serde_json::json!({
        "setId": "w-round-2",
        "phaseOrder": 1,
        "phaseGroupDisplayIdentifier": "1",
        "fullRoundText": "Winners Round 2",
        "round": 2,
        "state": 1,
        "slots": []
    }))
    .expect("source set should deserialize");
    let round_map: WinnersToLosersRoundMap = [(
        "1::1".to_owned(),
        [
            (1, std::collections::HashSet::from([-1])),
            (4, std::collections::HashSet::from([-4])),
        ]
        .into_iter()
        .collect(),
    )]
    .into_iter()
    .collect();

    for (round, expected) in [
        (-1_i64, false),
        (-2_i64, true),
        (-3_i64, true),
        (-4_i64, false),
    ] {
        let target: SetSnapshot = serde_json::from_value(serde_json::json!({
            "setId": format!("l-round-{}", round.abs()),
            "phaseOrder": 1,
            "phaseGroupDisplayIdentifier": "1",
            "fullRoundText": format!("Losers Round {}", round.abs()),
            "round": round,
            "state": 1,
            "slots": []
        }))
        .expect("target set should deserialize");
        assert_eq!(
            winners_to_losers_round_match(&source, &target, "loser", &round_map),
            Some(expected),
            "unexpected mapping for Losers round {round}"
        );
    }
}

#[test]
fn progression_source_seed_overrides_mismatched_target_slot_seed() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phases": [
            { "phaseId": "qualifiers", "phaseOrder": 1 },
            { "phaseId": "middle", "phaseOrder": 2 }
        ],
        "phaseGroups": [
            {
                "phaseGroupId": "qualifiers-pool-3",
                "phaseId": "qualifiers",
                "phaseOrder": 1,
                "displayIdentifier": "3"
            },
            {
                "phaseGroupId": "middle-pool-2",
                "phaseId": "middle",
                "phaseOrder": 2,
                "displayIdentifier": "2",
                "seeds": [
                    { "seedId": "advance-a", "progressionId": "progression-a" },
                    { "seedId": "advance-b", "progressionId": "progression-b" },
                    { "seedId": "shared-seed", "progressionId": "progression-shared" }
                ]
            }
        ],
        "sets": [
            {
                "setId": "shared-source",
                "phaseGroupId": "qualifiers-pool-3",
                "phaseOrder": 1,
                "phaseName": "Qualifiers",
                "phaseGroupDisplayIdentifier": "3",
                "fullRoundText": "Other Pool Final",
                "state": 3,
                "winnerId": "entrant-c",
                "winnerProgressionSeedId": "shared-seed",
                "winnerProgressionId": "progression-shared",
                "slots": [
                    { "entrantId": "entrant-c", "entrantName": "Entrant C" },
                    { "entrantId": "opponent-c", "entrantName": "Opponent C" }
                ]
            },
            {
                "setId": "pool-3-set-a",
                "phaseGroupId": "qualifiers-pool-3",
                "phaseOrder": 1,
                "phaseName": "Qualifiers",
                "phaseGroupDisplayIdentifier": "3",
                "fullRoundText": "Semi-Final",
                "state": 3,
                "winnerId": "entrant-a",
                "winnerProgressionSeedId": "advance-a",
                "winnerProgressionId": "progression-a",
                "slots": [
                    { "entrantId": "entrant-a", "entrantName": "Entrant A" },
                    { "entrantId": "opponent-a", "entrantName": "Opponent A" }
                ]
            },
            {
                "setId": "pool-3-set-b",
                "phaseGroupId": "qualifiers-pool-3",
                "phaseOrder": 1,
                "phaseName": "Qualifiers",
                "phaseGroupDisplayIdentifier": "3",
                "fullRoundText": "Semi-Final",
                "state": 3,
                "winnerId": "entrant-b",
                "winnerProgressionSeedId": "advance-b",
                "winnerProgressionId": "progression-b",
                "slots": [
                    { "entrantId": "entrant-b", "entrantName": "Entrant B" },
                    { "entrantId": "opponent-b", "entrantName": "Opponent B" }
                ]
            },
            {
                "setId": "middle-set-a",
                "phaseGroupId": "middle-pool-2",
                "phaseOrder": 2,
                "phaseName": "Middle",
                "phaseGroupDisplayIdentifier": "2",
                "fullRoundText": "Winners Semi-Final",
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "shared-seed" },
                "slots": [
                    { "seedId": "shared-seed", "entrantName": "TBD" },
                    { "entrantName": "TBD" }
                ]
            },
            {
                "setId": "middle-set-b",
                "phaseGroupId": "middle-pool-2",
                "phaseOrder": 2,
                "phaseName": "Middle",
                "phaseGroupDisplayIdentifier": "2",
                "fullRoundText": "Winners Semi-Final",
                "state": 1,
                "entrant1Source": { "sourceType": "seed", "typeId": "advance-a" },
                "entrant2Source": { "sourceType": "seed", "typeId": "advance-b" },
                "slots": [
                    { "seedId": "shared-seed", "entrantName": "TBD" },
                    { "seedId": "shared-seed", "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event.clone()],
        updated_at: Utc::now(),
    };
    let targets = progression_targets_for(&event);

    for (source_set_id, winner_id) in [
        ("shared-source", "entrant-c"),
        ("pool-3-set-b", "entrant-b"),
        ("pool-3-set-a", "entrant-a"),
    ] {
        apply_local_progression_incremental(
            &mut snapshot,
            "event",
            source_set_id,
            winner_id,
            &targets,
        );
    }

    let event = &snapshot.events[0];
    let middle_set_a = event
        .sets
        .iter()
        .find(|set| set.set_id == "middle-set-a")
        .unwrap();
    let middle_set_b = event
        .sets
        .iter()
        .find(|set| set.set_id == "middle-set-b")
        .unwrap();
    assert_eq!(
        middle_set_a.slots[0].entrant_id.as_deref(),
        Some("entrant-c")
    );
    assert_eq!(
        middle_set_b.slots[0].entrant_id.as_deref(),
        Some("entrant-a")
    );
    assert_eq!(
        middle_set_b.slots[1].entrant_id.as_deref(),
        Some("entrant-b")
    );
    assert_eq!(
        event.phase_groups[1].seeds[2].entrant_id.as_deref(),
        Some("entrant-c")
    );
}

#[test]
fn progression_source_does_not_resolve_to_a_sibling_phase_group() {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [{ "phaseId": "middle", "phaseOrder": 2 }],
            "phaseGroups": [
                {
                    "phaseGroupId": "middle-pool-1",
                    "phaseId": "middle",
                    "phaseOrder": 2,
                    "displayIdentifier": "1",
                    "setIds": ["pool-1-source"]
                },
                {
                    "phaseGroupId": "middle-pool-2",
                    "phaseId": "middle",
                    "phaseOrder": 2,
                    "displayIdentifier": "2",
                    "setIds": ["pool-2-target"]
                }
            ],
            "sets": [
                {
                    "setId": "pool-1-source",
                    "phaseGroupId": "middle-pool-1",
                    "phaseOrder": 2,
                    "phaseGroupDisplayIdentifier": "1",
                    "fullRoundText": "Winners Final",
                    "state": 3,
                    "winnerProgressionSeedId": "shared-seed",
                    "slots": [
                        { "entrantId": "winner", "entrantName": "Winner" },
                        { "entrantId": "opponent", "entrantName": "Opponent" }
                    ]
                },
                {
                    "setId": "pool-2-target",
                    "phaseGroupId": "middle-pool-2",
                    "phaseOrder": 2,
                    "phaseGroupDisplayIdentifier": "2",
                    "fullRoundText": "Winners Semi-Final",
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "seed",
                        "typeId": "shared-seed"
                    },
                    "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");
    let event = &snapshot.events[0];

    let graph = build_bracket_graph(&snapshot, event);

    assert!(!graph
        .edges
        .iter()
        .any(|edge| { edge.from_set_id == "pool-1-source" && edge.to_set_id == "pool-2-target" }));
}

#[test]
fn advances_middle_winner_to_final_phase_group_seed() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phases": [
            { "phaseId": "qualifiers", "phaseOrder": 1 },
            { "phaseId": "middle", "phaseOrder": 3 },
            { "phaseId": "finals", "phaseOrder": 2 }
        ],
        "phaseGroups": [
            {
                "phaseGroupId": "3470753",
                "phaseId": "middle",
                "phaseOrder": 3,
                "displayIdentifier": "1"
            },
            {
                "phaseGroupId": "3470701",
                "phaseId": "finals",
                "phaseOrder": 2,
                "displayIdentifier": "1",
                "seeds": [
                    {
                        "seedId": "41953885",
                        "progressionId": "progression-winner",
                        "originPhaseOrder": 3,
                        "originPhaseGroupDisplayIdentifier": "1",
                        "originPhaseGroupId": "3470753",
                        "originPlacement": 2,
                        "originOrder": 1,
                        "placeholderName": "Middle 1: Losers"
                    },
                    {
                        "seedId": "other-seed",
                        "progressionId": "progression-winner",
                        "placeholderName": "Other progression seed"
                    }
                ]
            }
        ],
        "sets": [
            {
                "setId": "middle-losers-final",
                "phaseGroupId": "3470753",
                "phaseOrder": 3,
                "phaseName": "Middle",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Losers Final",
                "state": 3,
                "winnerId": "losers-winner",
                "winnerPlacement": 2,
                "winnerProgressionSeedId": "41953885",
                "winnerProgressionId": "progression-winner",
                "winnerProgressionOriginOrder": 1,
                "slots": [
                    { "entrantId": "losers-winner", "entrantName": "Losers Winner" },
                    { "entrantId": "other-entrant", "entrantName": "Other Entrant" }
                ]
            },
            {
                "setId": "finals-round-one",
                "phaseGroupId": "3470701",
                "phaseOrder": 2,
                "phaseName": "Middle",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Finals Round 1",
                "state": 1,
                "entrant1Source": {
                    "sourceType": "seed",
                    "typeId": "41953885",
                    "resolvedSetId": "middle-losers-final",
                    "condition": "winner"
                },
                "slots": [
                    { "seedId": "41953885", "entrantName": "Middle 1: Losers" },
                    { "entrantName": "TBD" }
                ]
            },
            {
                "setId": "finals-seed-dependent",
                "phaseGroupId": "3470701",
                "phaseOrder": 2,
                "phaseName": "Middle",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "fullRoundText": "Finals Round 2",
                "state": 1,
                "entrant1Source": {
                    "sourceType": "seed",
                    "typeId": "41953885"
                },
                "slots": [
                    { "entrantName": "Middle 1: Losers" },
                    { "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");

    let mut legacy_event = event.clone();
    let legacy_source_set = legacy_event.sets[0].clone();
    advance_completed_set_by_placement(
        &mut legacy_event,
        &legacy_source_set,
        "losers-winner",
        "Losers Winner",
        None,
    );
    assert_eq!(
        legacy_event.phase_groups[1].seeds[0].entrant_id.as_deref(),
        Some("losers-winner")
    );

    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event],
        updated_at: Utc::now(),
    };
    snapshot.events[0].sets[1].slots[0].seed_id = None;
    let targets = build_progression_targets_by_source(&snapshot, &snapshot.events[0]);
    apply_local_progression_incremental(
        &mut snapshot,
        "event",
        "middle-losers-final",
        "losers-winner",
        &targets,
    );
    assert_eq!(
        snapshot.events[0].phase_groups[1].seeds[0]
            .entrant_id
            .as_deref(),
        Some("losers-winner")
    );
    assert_eq!(snapshot.events[0].phase_groups[1].seeds[1].entrant_id, None);
    assert_eq!(
        snapshot.events[0].sets[1].slots[0].entrant_id.as_deref(),
        Some("losers-winner")
    );
    assert_eq!(
        snapshot.events[0].sets[2].slots[0].entrant_id.as_deref(),
        Some("losers-winner")
    );
}

#[test]
fn advances_middle_loser_to_exact_finals_losers_seed() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phases": [
            { "phaseId": "middle", "phaseOrder": 1 },
            { "phaseId": "finals", "phaseOrder": 2 }
        ],
        "phaseGroups": [
            { "phaseGroupId": "middle-group", "phaseId": "middle", "phaseOrder": 1 },
            {
                "phaseGroupId": "finals-group",
                "phaseId": "finals",
                "phaseOrder": 2,
                "seeds": [
                    {
                        "seedId": "finals-losers-seed",
                        "progressionId": "shared-loser-progression",
                        "placeholderName": "Middle: Loser"
                    },
                    {
                        "seedId": "unrelated-seed",
                        "progressionId": "shared-loser-progression",
                        "placeholderName": "Unrelated seed"
                    }
                ]
            }
        ],
        "sets": [
            {
                "setId": "middle-source",
                "phaseGroupId": "middle-group",
                "phaseOrder": 1,
                "fullRoundText": "Winners Round 1",
                "state": 3,
                "winnerId": "middle-winner",
                "loserProgressionSeedId": "finals-losers-seed",
                "loserProgressionId": "shared-loser-progression",
                "slots": [
                    { "entrantId": "middle-winner", "entrantName": "Middle Winner" },
                    { "entrantId": "middle-loser", "entrantName": "Middle Loser" }
                ]
            },
            {
                "setId": "finals-losers-r1",
                "phaseGroupId": "finals-group",
                "phaseOrder": 2,
                "fullRoundText": "Finals Losers Round 1",
                "round": -1,
                "state": 1,
                "entrant1Source": {
                    "sourceType": "seed",
                    "typeId": "finals-losers-seed",
                    "resolvedSetId": "middle-source",
                    "condition": "loser"
                },
                "slots": [
                    { "seedId": "finals-losers-seed", "entrantName": "Middle: Loser" },
                    { "entrantName": "TBD" }
                ]
            },
            {
                "setId": "finals-losers-r2",
                "phaseGroupId": "finals-group",
                "phaseOrder": 2,
                "fullRoundText": "Finals Losers Round 2",
                "round": -2,
                "state": 1,
                "entrant1Source": {
                    "sourceType": "seed",
                    "typeId": "finals-losers-seed"
                },
                "slots": [
                    { "entrantName": "Middle: Loser" },
                    { "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event],
        updated_at: Utc::now(),
    };

    let targets = build_progression_targets_by_source(&snapshot, &snapshot.events[0]);
    apply_local_progression_incremental(
        &mut snapshot,
        "event",
        "middle-source",
        "middle-winner",
        &targets,
    );

    let event = &snapshot.events[0];
    assert_eq!(
        event.phase_groups[1].seeds[0].entrant_id.as_deref(),
        Some("middle-loser")
    );
    assert_eq!(event.phase_groups[1].seeds[1].entrant_id, None);
    assert_eq!(
        event.sets[1].slots[0].entrant_id.as_deref(),
        Some("middle-loser")
    );
    assert_eq!(event.sets[1].slots[0].entrant_name, "Middle Loser");
    assert_eq!(
        event.sets[2].slots[0].entrant_id.as_deref(),
        Some("middle-loser")
    );
}

#[test]
fn advances_first_finals_winners_losers_to_their_source_slots() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phaseGroups": [{
            "phaseGroupId": "finals",
            "phaseOrder": 2,
            "setIds": ["A", "B", "H", "I"]
        }],
        "sets": [
            {
                "setId": "A",
                "identifier": "A",
                "phaseGroupId": "finals",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "fullRoundText": "Winners Semi-Final",
                "round": 1,
                "state": 3,
                "winnerId": "a-winner",
                "slots": [
                    { "entrantName": "TBD" },
                    { "entrantName": "TBD" }
                ]
            },
            {
                "setId": "B",
                "identifier": "B",
                "phaseGroupId": "finals",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "fullRoundText": "Winners Semi-Final",
                "round": 1,
                "state": 3,
                "winnerId": "b-winner",
                "slots": [
                    { "entrantId": "b-winner", "entrantName": "B Winner" },
                    { "entrantId": "b-loser", "entrantName": "B Loser" }
                ]
            },
            {
                "setId": "H",
                "identifier": "H",
                "phaseGroupId": "finals",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "fullRoundText": "Losers Quarter-Final",
                "round": -4,
                "state": 1,
                "entrant1Source": { "sourceType": "set", "typeId": "B", "condition": "loser" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            },
            {
                "setId": "I",
                "identifier": "I",
                "phaseGroupId": "finals",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "fullRoundText": "Losers Quarter-Final",
                "round": -4,
                "state": 1,
                "entrant1Source": { "sourceType": "set", "typeId": "A", "condition": "loser" },
                "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
            }
        ]
    }))
    .expect("test event should deserialize");
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event.clone()],
        updated_at: Utc::now(),
    };
    let graph = build_bracket_graph(&snapshot, &event);
    let mut loser_edges = graph
        .edges
        .iter()
        .filter(|edge| edge.relation == "loser")
        .map(|edge| (edge.from_set_id.as_str(), edge.to_set_id.as_str()))
        .collect::<Vec<_>>();
    loser_edges.sort_unstable();
    assert_eq!(loser_edges, vec![("A", "I"), ("B", "H")]);
    let targets = build_progression_targets_by_source(&snapshot, &event);
    let known_names = std::collections::HashMap::from([
        ("a-winner".to_owned(), "A Winner".to_owned()),
        ("a-loser".to_owned(), "A Loser".to_owned()),
    ]);
    restore_missing_slot_entrants(
        &mut snapshot.events[0].sets[0],
        ["a-winner", "a-loser", "a-winner", "a-loser"]
            .into_iter()
            .map(str::to_owned),
        &known_names,
    );

    for (source_set_id, winner_id) in [("A", "a-winner"), ("B", "b-winner")] {
        apply_local_progression_incremental(
            &mut snapshot,
            "event",
            source_set_id,
            winner_id,
            &targets,
        );
    }

    let event = &snapshot.events[0];
    assert_eq!(
        event.sets[2].slots[0].entrant_id.as_deref(),
        Some("b-loser")
    );
    assert_eq!(
        event.sets[3].slots[0].entrant_id.as_deref(),
        Some("a-loser")
    );
    assert_eq!(event.sets[3].slots[0].entrant_name, "A Loser");
}

#[test]
fn resolves_loser_relation_through_intermediate_sources_without_condition() {
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "event",
        "phaseGroups": [
            { "phaseGroupId": "main-pool", "setIds": ["winners-r1", "losers-r1"] }
        ],
        "sets": [
            {
                "setId": "winners-r1",
                "phaseGroupId": "main-pool",
                "fullRoundText": "Winners Round 1",
                "state": 2,
                "slots": [
                    { "entrantId": "winner-id", "entrantName": "Winner" },
                    { "entrantId": "loser-id", "entrantName": "Loser" }
                ]
            },
            {
                "setId": "intermediate",
                "fullRoundText": "Intermediate",
                "state": 1,
                "isIntermediate": true,
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "winners-r1",
                    "conditionString": "Loser of Winners Round 1"
                },
                "slots": []
            },
            {
                "setId": "losers-r1",
                "phaseGroupId": "main-pool",
                "fullRoundText": "Losers Round 1",
                "state": 1,
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "intermediate",
                    "conditionString": "Loser of Intermediate"
                },
                "slots": [
                    { "entrantName": "TBD" },
                    { "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");

    let mut legacy_event = event.clone();
    let legacy_source_set = legacy_event.sets[0].clone();
    advance_completed_set_to_next_real_sets(
        &mut legacy_event,
        &legacy_source_set,
        "winner-id",
        "Winner",
        Some(("loser-id", "Loser")),
    );
    assert_eq!(
        legacy_event.sets[2].slots[0].entrant_id.as_deref(),
        Some("loser-id")
    );

    let targets = progression_targets_for(&event);
    apply_indexed_progression_targets(
        &mut event,
        "winners-r1",
        "winner-id",
        "Winner",
        Some(("loser-id", "Loser")),
        &targets,
    );

    assert_eq!(
        event.sets[2].slots[0].entrant_id.as_deref(),
        Some("loser-id")
    );
}

#[test]
fn restores_pending_slot_ids_before_rebuilding_loser_progression() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "event",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [{
                "phaseGroupId": "pool",
                "phaseOrder": 3,
                "setIds": ["set-a", "set-f"],
                "seeds": [
                    { "seedId": "seed-winner" },
                    { "seedId": "seed-loser" }
                ]
            }],
            "sets": [
                {
                    "setId": "roster",
                    "phaseOrder": 1,
                    "fullRoundText": "Pool Match",
                    "state": 1,
                    "slots": [
                        { "entrantId": "winner", "entrantName": "Winner" },
                        { "entrantId": "loser", "entrantName": "Loser" }
                    ]
                },
                {
                    "setId": "set-a",
                    "phaseGroupId": "pool",
                    "phaseOrder": 3,
                    "fullRoundText": "Winners Semi-Final",
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "seed",
                        "typeId": "seed-winner"
                    },
                    "entrant2Source": {
                        "sourceType": "seed",
                        "typeId": "seed-loser"
                    },
                    "slots": [
                        { "entrantName": "TBD" },
                        { "entrantName": "TBD" }
                    ]
                },
                {
                    "setId": "set-j",
                    "phaseGroupId": "pool",
                    "phaseOrder": 3,
                    "fullRoundText": "Losers Quarter-Final",
                    "isIntermediate": true,
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "set",
                        "typeId": "set-a",
                        "condition": "loser"
                    },
                    "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
                },
                {
                    "setId": "set-f",
                    "phaseGroupId": "pool",
                    "phaseOrder": 3,
                    "fullRoundText": "Losers Semi-Final",
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "set",
                        "typeId": "set-j",
                        "condition": "winner"
                    },
                    "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");
    let pending = LocalSetResultMeta {
        event_id: "event".to_owned(),
        event_name: "Event".to_owned(),
        set_id: "set-a".to_owned(),
        winner_id: "winner".to_owned(),
        score_csv: "1-0".to_owned(),
        direct_win: false,
        confirmed: true,
        slot_scores: vec![
            LocalSetScoreMeta {
                entrant_id: "winner".to_owned(),
                score: 2,
            },
            LocalSetScoreMeta {
                entrant_id: "winner".to_owned(),
                score: 0,
            },
            LocalSetScoreMeta {
                entrant_id: "winner".to_owned(),
                score: 0,
            },
            LocalSetScoreMeta {
                entrant_id: "loser".to_owned(),
                score: 1,
            },
            LocalSetScoreMeta {
                entrant_id: "loser".to_owned(),
                score: 0,
            },
            LocalSetScoreMeta {
                entrant_id: "loser".to_owned(),
                score: 0,
            },
        ],
        reset_source_set_id: None,
        recorded_at: Utc::now(),
    };

    restore_pending_result_to_event(&mut snapshot.events[0], &pending);
    rebuild_progression_from_completed_sets(&mut snapshot);

    let event = &snapshot.events[0];
    assert_eq!(event.sets[1].slots[0].entrant_id.as_deref(), Some("winner"));
    assert_eq!(event.sets[1].slots[1].entrant_id.as_deref(), Some("loser"));
    assert_eq!(event.sets[3].slots[0].entrant_id.as_deref(), Some("loser"));
    assert_eq!(event.sets[3].slots[0].entrant_name, "Loser");
}

#[test]
fn rebuilds_middle_losers_set_from_winners_a_and_b() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "event",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [{
                "phaseGroupId": "middle-pool",
                "phaseOrder": 3,
                "displayIdentifier": "1",
                "setIds": ["set-a", "set-b", "set-f"]
            }],
            "sets": [
                {
                    "setId": "set-a",
                    "phaseGroupId": "middle-pool",
                    "phaseOrder": 3,
                    "phaseName": "Middle",
                    "phaseGroupName": "Pool 1",
                    "phaseGroupDisplayIdentifier": "1",
                    "phaseGroupSetName": "A",
                    "fullRoundText": "Winners Semi-Final",
                    "round": 3,
                    "state": 3,
                    "winnerId": "winner-a",
                    "slots": [
                        { "entrantId": "winner-a", "entrantName": "Winner A" },
                        { "entrantId": "loser-a", "entrantName": "Loser A" }
                    ]
                },
                {
                    "setId": "set-b",
                    "phaseGroupId": "middle-pool",
                    "phaseOrder": 3,
                    "phaseName": "Middle",
                    "phaseGroupName": "Pool 1",
                    "phaseGroupDisplayIdentifier": "1",
                    "phaseGroupSetName": "B",
                    "fullRoundText": "Winners Semi-Final",
                    "round": 3,
                    "state": 3,
                    "winnerId": "winner-b",
                    "slots": [
                        { "entrantId": "winner-b", "entrantName": "Winner B" },
                        { "entrantId": "loser-b", "entrantName": "Loser B" }
                    ]
                },
                {
                    "setId": "set-f",
                    "phaseGroupId": "middle-pool",
                    "phaseOrder": 3,
                    "phaseName": "Middle",
                    "phaseGroupName": "Pool 1",
                    "phaseGroupDisplayIdentifier": "1",
                    "phaseGroupSetName": "F",
                    "fullRoundText": "Losers Semi-Final",
                    "round": -3,
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "seed",
                        "typeId": "seed-a",
                        "resolvedSetId": "set-a",
                        "condition": "loser"
                    },
                    "entrant2Source": {
                        "sourceType": "seed",
                        "typeId": "seed-b",
                        "resolvedSetId": "set-b",
                        "condition": "loser"
                    },
                    "slots": [
                        { "entrantName": "TBD" },
                        { "entrantName": "TBD" }
                    ]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");

    rebuild_progression_from_completed_sets(&mut snapshot);

    let losers_set = &snapshot.events[0].sets[2];
    assert_eq!(losers_set.slots[0].entrant_id.as_deref(), Some("loser-a"));
    assert_eq!(losers_set.slots[1].entrant_id.as_deref(), Some("loser-b"));
}

#[test]
fn incremental_elimination_progression_updates_only_direct_targets() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [{ "phaseGroupId": "pool" }],
            "sets": [
                {
                    "setId": "source",
                    "phaseGroupId": "pool",
                    "fullRoundText": "Winners Round 1",
                    "state": 3,
                    "winnerId": "winner",
                    "slots": [
                        { "entrantId": "winner", "entrantName": "Winner" },
                        { "entrantId": "loser", "entrantName": "Loser" }
                    ]
                },
                {
                    "setId": "winner-target",
                    "phaseGroupId": "pool",
                    "fullRoundText": "Winners Round 2",
                    "state": 1,
                    "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
                },
                {
                    "setId": "loser-target",
                    "phaseGroupId": "pool",
                    "fullRoundText": "Losers Round 1",
                    "state": 1,
                    "slots": [{ "entrantName": "TBD" }, { "entrantName": "TBD" }]
                },
                {
                    "setId": "unrelated",
                    "phaseGroupId": "pool",
                    "fullRoundText": "Winners Round 3",
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "set",
                        "typeId": "set-b",
                        "condition": "loser",
                        "placeholderName": "予選 2: Winners"
                    },
                    "entrant2Source": {
                        "sourceType": "set",
                        "typeId": "set-f",
                        "condition": "winner",
                        "placeholderName": "予選 2: Winners"
                    },
                    "slots": [
                        { "entrantName": "loser of B" },
                        { "entrantName": "winner of F" }
                    ]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");
    let mut rebuilt_snapshot = snapshot.clone();
    rebuild_progression_from_completed_sets(&mut rebuilt_snapshot);
    assert_eq!(
        rebuilt_snapshot.events[0].sets[3].slots[0].entrant_name,
        "loser of B"
    );
    assert_eq!(
        rebuilt_snapshot.events[0].sets[3].slots[1].entrant_name,
        "winner of F"
    );

    let targets = std::collections::HashMap::from([(
        "source".to_owned(),
        vec![
            ProgressionTarget {
                set_index: 1,
                slot_index: 0,
                relation: "winner".to_owned(),
                is_progression: false,
                seed_targets: Vec::new(),
            },
            ProgressionTarget {
                set_index: 2,
                slot_index: 0,
                relation: "loser".to_owned(),
                is_progression: false,
                seed_targets: Vec::new(),
            },
        ],
    )]);

    apply_local_progression_incremental(&mut snapshot, "event", "source", "winner", &targets);

    let event = &snapshot.events[0];
    assert_eq!(event.sets[1].slots[0].entrant_id.as_deref(), Some("winner"));
    assert_eq!(event.sets[2].slots[0].entrant_id.as_deref(), Some("loser"));
    assert_eq!(event.sets[3].slots[0].entrant_id, None);
    assert_eq!(event.sets[3].slots[1].entrant_id, None);
    assert_eq!(event.sets[3].slots[0].entrant_name, "loser of B");
    assert_eq!(event.sets[3].slots[1].entrant_name, "winner of F");
}

#[test]
fn changing_a_progressed_entrant_invalidates_target_result() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "sets": [
                {
                    "setId": "source",
                    "fullRoundText": "Winners Round 1",
                    "state": 3,
                    "winnerId": "new-winner",
                    "slots": [
                        { "entrantId": "new-winner", "entrantName": "New Winner" },
                        { "entrantId": "source-loser", "entrantName": "Source Loser" }
                    ]
                },
                {
                    "setId": "target",
                    "fullRoundText": "Winners Final",
                    "state": 3,
                    "winnerId": "old-entrant",
                    "slots": [
                        { "entrantId": "old-entrant", "entrantName": "Old Entrant", "score": 2 },
                        { "entrantId": "opponent", "entrantName": "Opponent", "score": 0 }
                    ]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");
    let targets = std::collections::HashMap::from([(
        "source".to_owned(),
        vec![ProgressionTarget {
            set_index: 1,
            slot_index: 0,
            relation: "winner".to_owned(),
            is_progression: false,
            seed_targets: Vec::new(),
        }],
    )]);

    let invalidated_set_ids = apply_local_progression_incremental(
        &mut snapshot,
        "event",
        "source",
        "new-winner",
        &targets,
    );

    let target = &snapshot.events[0].sets[1];
    assert!(invalidated_set_ids.contains("target"));
    assert_eq!(target.slots[0].entrant_id.as_deref(), Some("new-winner"));
    assert_eq!(target.winner_id, None);
    assert_eq!(target.slots[0].score, None);
    assert_eq!(target.slots[1].score, None);
    assert_eq!(target.state, 2);
}

#[test]
fn source_set_label_takes_priority_over_progression_seed_placeholder() {
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "sets": [
            {
                "setId": "winners-b",
                "identifier": "B",
                "fullRoundText": "Winners Round 1",
                "state": 3,
                "slots": [
                    { "entrantId": "one", "entrantName": "One" },
                    { "entrantId": "two", "entrantName": "Two" }
                ]
            },
            {
                "setId": "finals-losers",
                "fullRoundText": "Finals Losers Round 1",
                "round": -1,
                "state": 1,
                "entrant1Source": {
                    "sourceType": "seed",
                    "typeId": "progression-seed",
                    "condition": "loser",
                    "conditionString": "Loser of B",
                    "placeholderName": "予選 2: Winners"
                },
                "slots": [
                    { "entrantName": "予選 2: Winners" },
                    { "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");

    apply_source_based_tbd_labels(&mut event);

    assert_eq!(event.sets[1].slots[0].entrant_name, "loser of B");
}

#[test]
fn seed_source_reapplication_preserves_advanced_entrant_name() {
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phaseGroups": [{
            "phaseGroupId": "pool",
            "seeds": [{
                "seedId": "seed-winner",
                "placeholderName": "Winners Seed 1"
            }]
        }],
        "sets": [{
            "setId": "set-b",
            "phaseGroupId": "pool",
            "fullRoundText": "Winners Final",
            "state": 1,
            "entrant1Source": {
                "sourceType": "seed",
                "typeId": "seed-winner",
                "placeholderName": "Winners Seed 1"
            },
            "slots": [
                {
                    "entrantId": "winner",
                    "entrantName": "Player One",
                    "seedPlaceholderName": "Winners Seed 1"
                },
                { "entrantName": "TBD" }
            ]
        }]
    }))
    .expect("test event should deserialize");

    apply_seed_sources_to_set_slots(&mut event);

    assert_eq!(event.sets[0].slots[0].entrant_id.as_deref(), Some("winner"));
    assert_eq!(event.sets[0].slots[0].entrant_name, "Player One");
}

#[test]
fn seed_source_reapplication_preserves_scores_for_unchanged_entrants() {
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phaseGroups": [{
            "phaseGroupId": "pool",
            "seeds": [
                { "seedId": "seed-a", "entrantId": "a", "entrantName": "A" },
                { "seedId": "seed-b", "entrantId": "b", "entrantName": "B" }
            ]
        }],
        "sets": [{
            "setId": "rr-set",
            "phaseGroupId": "pool",
            "fullRoundText": "Round 1",
            "state": 3,
            "winnerId": "a",
            "entrant1Source": { "sourceType": "seed", "typeId": "seed-a" },
            "entrant2Source": { "sourceType": "seed", "typeId": "seed-b" },
            "slots": [
                { "entrantId": "a", "entrantName": "A", "seedId": "seed-a", "score": 2 },
                { "entrantId": "b", "entrantName": "B", "seedId": "seed-b", "score": 1 }
            ]
        }]
    }))
    .expect("test event should deserialize");

    let invalidated_set_ids = apply_seed_sources_to_set_slots(&mut event);

    assert!(invalidated_set_ids.is_empty());
    assert_eq!(event.sets[0].slots[0].score, Some(2.0));
    assert_eq!(event.sets[0].slots[1].score, Some(1.0));
    assert_eq!(event.sets[0].winner_id.as_deref(), Some("a"));
}

#[test]
fn changed_unfinished_seed_source_invalidates_set_metadata() {
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phaseGroups": [{
            "phaseGroupId": "pool",
            "seeds": [{
                "seedId": "seed-winner",
                "entrantId": "new-entrant",
                "entrantName": "New Entrant"
            }]
        }],
        "sets": [{
            "setId": "target",
            "fullRoundText": "Winners Final",
            "phaseGroupId": "pool",
            "state": 2,
            "entrant1Source": {
                "sourceType": "seed",
                "typeId": "seed-winner"
            },
            "slots": [
                { "entrantId": "old-entrant", "entrantName": "Old Entrant" },
                { "entrantId": "opponent", "entrantName": "Opponent" }
            ]
        }]
    }))
    .expect("test event should deserialize");

    let invalidated_set_ids = apply_seed_sources_to_set_slots(&mut event);

    assert!(invalidated_set_ids.contains("target"));
    assert_eq!(
        event.sets[0].slots[0].entrant_id.as_deref(),
        Some("new-entrant")
    );
    assert_eq!(event.sets[0].state, 2);
}

#[test]
fn changed_unfinished_progression_seed_invalidates_set_metadata() {
    let target_seed: PhaseGroupSeedSnapshot = serde_json::from_value(serde_json::json!({
        "seedId": "seed-winner",
        "entrantId": "new-entrant",
        "entrantName": "New Entrant"
    }))
    .expect("test seed should deserialize");
    let mut event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "sets": [{
            "setId": "target",
            "fullRoundText": "Winners Final",
            "state": 2,
            "entrant1Source": {
                "sourceType": "seed",
                "typeId": "seed-winner"
            },
            "slots": [
                { "entrantId": "old-entrant", "entrantName": "Old Entrant" },
                { "entrantId": "opponent", "entrantName": "Opponent" }
            ]
        }]
    }))
    .expect("test event should deserialize");

    let invalidated_set_ids = hydrate_progression_entrant_to_seed_slots(
        &mut event,
        &target_seed,
        "new-entrant",
        "New Entrant",
    );

    assert!(invalidated_set_ids.contains("target"));
    assert_eq!(
        event.sets[0].slots[0].entrant_id.as_deref(),
        Some("new-entrant")
    );
    assert_eq!(event.sets[0].state, 2);
}

#[test]
fn rebuilding_clears_result_when_seed_corrects_slot_entrant() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [{ "phaseId": "finals", "phaseOrder": 2 }],
            "phaseGroups": [{
                "phaseGroupId": "finals-group",
                "phaseId": "finals",
                "phaseOrder": 2,
                "setIds": ["target", "downstream"],
                "seeds": [{
                    "seedId": "correct-seed",
                    "entrantId": "new-entrant",
                    "entrantName": "New Entrant"
                }]
            }],
            "sets": [
                {
                    "setId": "target",
                    "fullRoundText": "Winners Final",
                    "phaseGroupId": "finals-group",
                    "phaseOrder": 2,
                    "state": 3,
                    "winnerId": "old-entrant",
                    "entrant1Source": {
                        "sourceType": "seed",
                        "typeId": "correct-seed",
                        "condition": "winner"
                    },
                    "slots": [
                        { "entrantId": "old-entrant", "entrantName": "Old Entrant", "score": 2 },
                        { "entrantId": "opponent", "entrantName": "Opponent", "score": 0 }
                    ]
                },
                {
                    "setId": "downstream",
                    "fullRoundText": "Grand Final",
                    "phaseGroupId": "finals-group",
                    "phaseOrder": 2,
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "set",
                        "typeId": "target",
                        "condition": "winner",
                        "placeholderName": "winner of target"
                    },
                    "slots": [{ "entrantName": "winner of target" }, { "entrantName": "TBD" }]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");

    rebuild_progression_from_completed_sets(&mut snapshot);

    let event = &snapshot.events[0];
    let target = &event.sets[0];
    assert_eq!(target.slots[0].entrant_id.as_deref(), Some("new-entrant"));
    assert_eq!(target.winner_id, None);
    assert_eq!(target.state, 2);
    assert_eq!(target.slots[0].score, None);
    assert_eq!(target.slots[1].score, None);
    assert_eq!(event.sets[1].slots[0].entrant_id, None);
}

#[test]
fn rebuilding_discards_winner_not_present_in_set_slots() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "sets": [
                {
                    "setId": "source",
                    "fullRoundText": "Winners Round 1",
                    "phaseOrder": 1,
                    "state": 3,
                    "winnerId": "not-in-slots",
                    "slots": [
                        { "entrantId": "player-a", "entrantName": "Player A", "score": 0 },
                        { "entrantId": "player-b", "entrantName": "Player B", "score": -1 }
                    ]
                },
                {
                    "setId": "downstream",
                    "fullRoundText": "Winners Round 2",
                    "phaseOrder": 2,
                    "state": 1,
                    "entrant1Source": {
                        "sourceType": "set",
                        "typeId": "source",
                        "condition": "winner",
                        "placeholderName": "winner of source"
                    },
                    "slots": [{ "entrantName": "winner of source" }, { "entrantName": "TBD" }]
                }
            ]
        }],
        "updatedAt": "2026-01-01T00:00:00Z"
    }))
    .expect("test snapshot should deserialize");

    rebuild_progression_from_completed_sets(&mut snapshot);

    let event = &snapshot.events[0];
    assert_eq!(event.sets[0].winner_id, None);
    assert_eq!(event.sets[0].state, 2);
    assert_eq!(event.sets[0].slots[0].score, None);
    assert_eq!(event.sets[0].slots[1].score, None);
    assert_eq!(event.sets[1].slots[0].entrant_id, None);
}

#[test]
fn bracket_graph_preserves_losers_round_one_sources_through_intermediate_sets() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "event",
        "phases": [
            { "phaseId": "qualifiers", "phaseOrder": 1 },
            { "phaseId": "middle", "phaseOrder": 3 },
            { "phaseId": "finals", "phaseOrder": 2 }
        ],
        "phaseGroups": [
            {
                "phaseGroupId": "finals-pool-1",
                "phaseId": "finals",
                "setIds": ["winner-z-a", "winner-a-b", "losers-f"],
                "phaseOrder": 2,
                "displayIdentifier": "1"
            }
        ],
        "sets": [
            {
                "setId": "winner-z-a",
                "phaseGroupId": "finals-pool-1",
                "isIntermediate": true,
                "fullRoundText": "Winners Round 1",
                "round": 1,
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "state": 3,
                "winnerId": "winner-a",
                "slots": [
                    { "entrantId": "winner-a", "entrantName": "Winner A" },
                    { "entrantId": "loser-a", "entrantName": "Loser A" }
                ]
            },
            {
                "setId": "winner-a-b",
                "phaseGroupId": "finals-pool-1",
                "isIntermediate": true,
                "fullRoundText": "Winners Round 1",
                "round": 1,
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "state": 3,
                "winnerId": "winner-b",
                "slots": [
                    { "entrantId": "winner-b", "entrantName": "Winner B" },
                    { "entrantId": "loser-b", "entrantName": "Loser B" }
                ]
            },
            {
                "setId": "pipe-a",
                "fullRoundText": "Intermediate",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "isIntermediate": false,
                "state": 1,
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "winner-z-a",
                    "conditionString": "Loser of Winners Round 1"
                },
                "entrant2Source": {
                    "sourceType": "bye",
                    "typeId": "bye-a"
                },
                "slots": []
            },
            {
                "setId": "pipe-b",
                "fullRoundText": "Intermediate",
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "isIntermediate": false,
                "state": 1,
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "winner-a-b",
                    "conditionString": "Loser of Winners Round 1"
                },
                "entrant2Source": {
                    "sourceType": "bye",
                    "typeId": "bye-b"
                },
                "slots": []
            },
            {
                "setId": "losers-f",
                "phaseGroupId": "finals-pool-1",
                "isIntermediate": true,
                "fullRoundText": "Losers Round 1",
                "round": -1,
                "phaseOrder": 2,
                "phaseName": "Finals",
                "phaseGroupName": "Pool 1",
                "phaseGroupDisplayIdentifier": "1",
                "state": 1,
                "entrant1Source": {
                    "sourceType": "set",
                    "typeId": "pipe-a",
                    "condition": "winner",
                    "conditionString": "Winner of Intermediate"
                },
                "entrant2Source": {
                    "sourceType": "set",
                    "typeId": "pipe-b",
                    "condition": "winner",
                    "conditionString": "Winner of Intermediate"
                },
                "slots": [
                    { "entrantName": "TBD" },
                    { "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("test event should deserialize");
    let snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "tournament".to_owned(),
        events: vec![event.clone()],
        updated_at: Utc::now(),
    };

    let graph = build_bracket_graph(&snapshot, &event);
    assert_eq!(
        graph
            .event
            .sets
            .iter()
            .map(|set| set.set_id.as_str())
            .collect::<Vec<_>>(),
        vec!["winner-z-a", "winner-a-b", "losers-f"]
    );
    assert!(graph.event.sets.iter().all(|set| !set.is_intermediate));

    let mut losers_f_sources = graph
        .edges
        .iter()
        .filter(|edge| edge.to_set_id == "losers-f")
        .map(|edge| {
            (
                edge.target_slot_index,
                edge.from_set_id.as_str(),
                edge.relation.as_str(),
            )
        })
        .collect::<Vec<_>>();
    losers_f_sources.sort_by_key(|edge| edge.0);

    assert_eq!(
        losers_f_sources,
        vec![(0, "winner-z-a", "loser"), (1, "winner-a-b", "loser")]
    );

    let targets = progression_targets_for(&event);
    let mut snapshot = snapshot;
    for (source_index, winner_id) in [(0, "winner-a"), (1, "winner-b")] {
        let source_set_id = snapshot.events[0].sets[source_index].set_id.clone();
        apply_local_progression_incremental(
            &mut snapshot,
            "event",
            &source_set_id,
            winner_id,
            &targets,
        );
    }

    let event = &snapshot.events[0];
    assert_eq!(
        event.sets[4].slots[0].entrant_id.as_deref(),
        Some("loser-a")
    );
    assert_eq!(
        event.sets[4].slots[1].entrant_id.as_deref(),
        Some("loser-b")
    );
}
