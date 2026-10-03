use super::{
    build_empty_meta, has_result_or_pending_for_set_ids, is_completed_round_robin_group,
    known_resolved_entrant_names_for_round_robin_set,
    rebuild_event_progression_from_completed_sets, rebuild_progression_from_completed_sets,
};
use crate::models::{EventSnapshot, TournamentSnapshot};
use std::collections::HashSet;

#[test]
fn game_ratio_progression_preserves_pool_rank_in_seed_map_entry_order() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "updatedAt": "2026-10-01T00:00:00Z",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [
                { "phaseId": "pool-phase", "phaseOrder": 1 },
                { "phaseId": "elimination-phase", "phaseOrder": 2 }
            ],
            "phaseGroups": [
                {
                    "phaseGroupId": "pool",
                    "phaseId": "pool-phase",
                    "phaseOrder": 1,
                    "displayIdentifier": "1",
                    "bracketType": "ROUND_ROBIN",
                    "setIds": ["rr-a", "rr-b", "rr-c", "rr-d", "rr-e", "rr-f"],
                    "tiebreakOrder": ["wins", "game_ratio", "head_to_head"],
                    "progressionsOut": [
                        { "progressionId": "pool-first", "originPhaseId": "pool-phase", "originPlacement": 1 },
                        { "progressionId": "pool-second", "originPhaseId": "pool-phase", "originPlacement": 2 }
                    ],
                    "seeds": [
                        { "seedId": "p1-seed", "seedNum": 1, "entrantId": "p1", "entrantName": "player1" },
                        { "seedId": "p9-seed", "seedNum": 2, "entrantId": "p9", "entrantName": "Player9" },
                        { "seedId": "p8-seed", "seedNum": 3, "entrantId": "p8", "entrantName": "player8" },
                        { "seedId": "p16-seed", "seedNum": 4, "entrantId": "p16", "entrantName": "Player16" }
                    ]
                },
                {
                    "phaseGroupId": "middle",
                    "phaseId": "elimination-phase",
                    "phaseOrder": 2,
                    "displayIdentifier": "1",
                    "bracketType": "SINGLE_ELIMINATION",
                    "setIds": ["middle-a", "middle-b"],
                    "seedMap": { "1": [1, 3, 2, 4] },
                    "seeds": [
                        { "seedId": "entry-1", "progressionId": "pool-first", "groupSeedNum": 1 },
                        { "seedId": "entry-2", "entrantId": "other-1", "entrantName": "Player12", "groupSeedNum": 2 },
                        { "seedId": "entry-3", "entrantId": "other-2", "entrantName": "player13", "groupSeedNum": 3 },
                        { "seedId": "entry-4", "progressionId": "pool-second", "groupSeedNum": 4 }
                    ]
                }
            ],
            "sets": [
                { "setId": "rr-a", "phaseGroupId": "pool", "phaseOrder": 1, "fullRoundText": "Round 1", "state": 3, "winnerId": "p1", "slots": [{ "entrantId": "p1", "entrantName": "player1", "score": 2 }, { "entrantId": "p9", "entrantName": "Player9", "score": 0 }] },
                { "setId": "rr-b", "phaseGroupId": "pool", "phaseOrder": 1, "fullRoundText": "Round 1", "state": 3, "winnerId": "p8", "slots": [{ "entrantId": "p16", "entrantName": "Player16", "score": 0 }, { "entrantId": "p8", "entrantName": "player8", "score": 2 }] },
                { "setId": "rr-c", "phaseGroupId": "pool", "phaseOrder": 1, "fullRoundText": "Round 2", "state": 3, "winnerId": "p1", "slots": [{ "entrantId": "p8", "entrantName": "player8", "score": 1 }, { "entrantId": "p1", "entrantName": "player1", "score": 2 }] },
                { "setId": "rr-d", "phaseGroupId": "pool", "phaseOrder": 1, "fullRoundText": "Round 2", "state": 3, "winnerId": "p9", "slots": [{ "entrantId": "p16", "entrantName": "Player16", "score": 1 }, { "entrantId": "p9", "entrantName": "Player9", "score": 2 }] },
                { "setId": "rr-e", "phaseGroupId": "pool", "phaseOrder": 1, "fullRoundText": "Round 3", "state": 3, "winnerId": "p9", "slots": [{ "entrantId": "p9", "entrantName": "Player9", "score": 2 }, { "entrantId": "p8", "entrantName": "player8", "score": 0 }] },
                { "setId": "rr-f", "phaseGroupId": "pool", "phaseOrder": 1, "fullRoundText": "Round 3", "state": 3, "winnerId": "p16", "slots": [{ "entrantId": "p16", "entrantName": "Player16", "score": 2 }, { "entrantId": "p1", "entrantName": "player1", "score": 1 }] },
                { "setId": "middle-a", "phaseGroupId": "middle", "phaseOrder": 2, "fullRoundText": "Round 1", "state": 1, "entrant1Source": { "sourceType": "seed", "typeId": "entry-1" }, "entrant2Source": { "sourceType": "seed", "typeId": "entry-3" }, "slots": [{ "entrantName": "TBD", "seedId": "entry-1" }, { "entrantName": "TBD", "seedId": "entry-3" }] },
                { "setId": "middle-b", "phaseGroupId": "middle", "phaseOrder": 2, "fullRoundText": "Round 1", "state": 1, "entrant1Source": { "sourceType": "seed", "typeId": "entry-2" }, "entrant2Source": { "sourceType": "seed", "typeId": "entry-4" }, "slots": [{ "entrantId": "other-1", "entrantName": "Player12", "seedId": "entry-2" }, { "entrantName": "TBD", "seedId": "entry-4" }] }
            ]
        }]
    }))
    .expect("test snapshot should deserialize");

    rebuild_progression_from_completed_sets(&mut snapshot);

    let event = &snapshot.events[0];
    let middle = event
        .phase_groups
        .iter()
        .find(|group| group.phase_group_id == "middle")
        .unwrap();
    assert_eq!(middle.seeds[0].entrant_id.as_deref(), Some("p1"));
    assert_eq!(middle.seeds[3].entrant_id.as_deref(), Some("p9"));
    let mapped_entries = event
        .sets
        .iter()
        .filter(|set| set.phase_group_id.as_deref() == Some("middle"))
        .flat_map(|set| set.slots.iter().map(|slot| slot.entrant_id.as_deref()))
        .collect::<Vec<_>>();
    assert_eq!(
        mapped_entries,
        vec![Some("p1"), Some("other-2"), Some("other-1"), Some("p9")]
    );
}

#[test]
fn round_robin_group_progression_waits_until_every_set_is_confirmed() {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "updatedAt": "2026-10-01T00:00:00Z",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phaseGroups": [{
                "phaseGroupId": "round-robin",
                "bracketType": "ROUND_ROBIN",
                "setIds": ["set-a", "set-b"]
            }],
            "sets": [
                {
                    "setId": "set-a",
                    "phaseGroupId": "round-robin",
                    "fullRoundText": "Round 1",
                    "state": 3,
                    "winnerId": "player-a",
                    "slots": [
                        { "entrantId": "player-a", "entrantName": "A", "score": 2 },
                        { "entrantId": "player-b", "entrantName": "B", "score": 1 }
                    ]
                },
                {
                    "setId": "set-b",
                    "phaseGroupId": "round-robin",
                    "fullRoundText": "Round 1",
                    "state": 2,
                    "winnerId": null,
                    "slots": [
                        { "entrantId": "player-a", "entrantName": "A", "score": 1 },
                        { "entrantId": "player-c", "entrantName": "C", "score": 0 }
                    ]
                }
            ]
        }]
    }))
    .expect("round robin snapshot should deserialize");

    assert!(!is_completed_round_robin_group(&snapshot, "event", "set-a"));

    let mut completed_snapshot = snapshot.clone();
    let set = completed_snapshot.events[0]
        .sets
        .iter_mut()
        .find(|set| set.set_id == "set-b")
        .expect("second round robin set should exist");
    set.state = 3;
    set.winner_id = Some("player-a".to_owned());

    assert!(is_completed_round_robin_group(
        &completed_snapshot,
        "event",
        "set-b",
    ));
}

#[test]
fn rebuilds_round_robin_standings_before_one_round_elimination_sets() {
    let mut snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "updatedAt": "2026-10-01T00:00:00Z",
        "events": [{
            "eventId": "event",
            "name": "Event",
            "phases": [
                { "phaseId": "pool", "phaseOrder": 1 },
                { "phaseId": "elimination", "phaseOrder": 2 }
            ],
            "phaseGroups": [
                {
                    "phaseGroupId": "pool",
                    "phaseId": "pool",
                    "phaseOrder": 1,
                    "bracketType": "ROUND_ROBIN",
                    "setIds": ["rr-a", "rr-b", "rr-c"],
                    "progressionsOut": [
                        {
                            "progressionId": "pool-first",
                            "originPhaseId": "pool",
                            "originPhaseOrder": 1,
                            "originPhaseGroupId": "pool",
                            "originPlacement": 1
                        },
                        {
                            "progressionId": "pool-second",
                            "originPhaseId": "pool",
                            "originPhaseOrder": 1,
                            "originPhaseGroupId": "pool",
                            "originPlacement": 2
                        }
                    ],
                    "seeds": [
                        { "seedId": "rr-p15", "seedNum": 1, "entrantId": "player-15", "entrantName": "Player15" },
                        { "seedId": "rr-p6", "seedNum": 2, "entrantId": "player-6", "entrantName": "Player6" },
                        { "seedId": "rr-p10", "seedNum": 3, "entrantId": "player-10", "entrantName": "Player10" }
                    ]
                },
                {
                    "phaseGroupId": "elimination",
                    "phaseId": "elimination",
                    "phaseOrder": 2,
                    "bracketType": "SINGLE_ELIMINATION",
                    "setIds": ["semi-a", "semi-b"],
                    "seeds": [
                        { "seedId": "first-seed", "progressionId": "pool-first", "entrantId": "player-6", "entrantName": "Player6" },
                        { "seedId": "second-seed", "progressionId": "pool-second", "entrantId": "player-15", "entrantName": "Player15" }
                    ]
                }
            ],
            "sets": [
                {
                    "setId": "rr-a",
                    "phaseGroupId": "pool",
                    "phaseOrder": 1,
                    "fullRoundText": "Round 1",
                    "state": 3,
                    "winnerId": "player-15",
                    "slots": [
                        { "entrantId": "player-15", "entrantName": "Player15", "score": 2 },
                        { "entrantId": "player-6", "entrantName": "Player6", "score": 1 }
                    ]
                },
                {
                    "setId": "rr-b",
                    "phaseGroupId": "pool",
                    "phaseOrder": 1,
                    "fullRoundText": "Round 2",
                    "state": 3,
                    "winnerId": "player-15",
                    "slots": [
                        { "entrantId": "player-15", "entrantName": "Player15", "score": 2 },
                        { "entrantId": "player-10", "entrantName": "Player10", "score": 0 }
                    ]
                },
                {
                    "setId": "rr-c",
                    "phaseGroupId": "pool",
                    "phaseOrder": 1,
                    "fullRoundText": "Round 3",
                    "state": 3,
                    "winnerId": "player-6",
                    "slots": [
                        { "entrantId": "player-6", "entrantName": "Player6", "score": 2 },
                        { "entrantId": "player-10", "entrantName": "Player10", "score": 0 }
                    ]
                },
                {
                    "setId": "semi-a",
                    "phaseGroupId": "elimination",
                    "phaseOrder": 2,
                    "fullRoundText": "Semi-Final",
                    "round": 1,
                    "state": 3,
                    "winnerId": "player-6",
                    "entrant1Source": { "sourceType": "seed", "typeId": "first-seed" },
                    "slots": [
                        { "entrantId": "player-6", "entrantName": "Player6", "seedId": "first-seed", "score": 2 },
                        { "entrantId": "opponent-a", "entrantName": "Opponent A", "score": 0 }
                    ]
                },
                {
                    "setId": "semi-b",
                    "phaseGroupId": "elimination",
                    "phaseOrder": 2,
                    "fullRoundText": "Semi-Final",
                    "round": 1,
                    "state": 2,
                    "entrant1Source": { "sourceType": "seed", "typeId": "second-seed" },
                    "slots": [
                        { "entrantId": "player-15", "entrantName": "Player15", "seedId": "second-seed" },
                        { "entrantId": "opponent-b", "entrantName": "Opponent B" }
                    ]
                }
            ]
        }]
    }))
    .expect("test snapshot should deserialize");

    let invalidated_set_ids = rebuild_progression_from_completed_sets(&mut snapshot);
    let event = &snapshot.events[0];
    let semi_a = event
        .sets
        .iter()
        .find(|set| set.set_id == "semi-a")
        .unwrap();
    let semi_b = event
        .sets
        .iter()
        .find(|set| set.set_id == "semi-b")
        .unwrap();

    assert_eq!(semi_a.slots[0].entrant_id.as_deref(), Some("player-15"));
    assert_eq!(semi_a.winner_id, None);
    assert_ne!(semi_a.state, 3);
    assert_eq!(semi_b.slots[0].entrant_id.as_deref(), Some("player-6"));
    assert!(invalidated_set_ids.contains(&("event".to_owned(), "semi-a".to_owned())));
}

#[test]
fn round_robin_name_resolution_stays_within_the_target_phase_group() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "phaseGroups": [
            {
                "phaseGroupId": "rr-group",
                "bracketType": "ROUND_ROBIN",
                "setIds": ["rr-set"],
                "seeds": [{
                    "seedId": "rr-seed",
                    "entrantId": "rr-seed-player",
                    "entrantName": "RR Seed"
                }]
            },
            {
                "phaseGroupId": "other-group",
                "setIds": ["other-set"],
                "seeds": [{
                    "seedId": "other-seed",
                    "entrantId": "other-seed-player",
                    "entrantName": "Other Seed"
                }]
            }
        ],
        "sets": [
            {
                "setId": "rr-set",
                "phaseGroupId": "rr-group",
                "fullRoundText": "Pool",
                "state": 2,
                "winnerId": null,
                "slots": [
                    { "entrantId": "rr-player", "entrantName": "RR Player" },
                    { "entrantId": null, "entrantName": "TBD" }
                ]
            },
            {
                "setId": "other-set",
                "phaseGroupId": "other-group",
                "fullRoundText": "Other Phase",
                "state": 2,
                "winnerId": null,
                "slots": [
                    { "entrantId": "other-player", "entrantName": "Other Player" },
                    { "entrantId": null, "entrantName": "TBD" }
                ]
            }
        ]
    }))
    .expect("event with two phase groups should deserialize");

    let names = known_resolved_entrant_names_for_round_robin_set(&event, "rr-set");

    assert_eq!(
        names.get("rr-player").map(String::as_str),
        Some("RR Player")
    );
    assert_eq!(
        names.get("rr-seed-player").map(String::as_str),
        Some("RR Seed")
    );
    assert!(!names.contains_key("other-player"));
    assert!(!names.contains_key("other-seed-player"));
}

#[test]
fn unrelated_group_results_do_not_start_a_reset_cascade() {
    let event: EventSnapshot = serde_json::from_value(serde_json::json!({
        "eventId": "event",
        "name": "Event",
        "sets": [
            {
                "setId": "target",
                "fullRoundText": "Round 1",
                "state": 2,
                "winnerId": null,
                "slots": [
                    { "entrantId": "a", "entrantName": "A" },
                    { "entrantId": "b", "entrantName": "B" }
                ]
            },
            {
                "setId": "unrelated",
                "fullRoundText": "Other Phase",
                "state": 3,
                "winnerId": "c",
                "slots": [
                    { "entrantId": "c", "entrantName": "C", "score": 2 },
                    { "entrantId": "d", "entrantName": "D", "score": 1 }
                ]
            }
        ]
    }))
    .expect("event with independent sets should deserialize");
    let local_meta = build_empty_meta("tournament", "event");
    let changed_targets = HashSet::from(["target".to_owned()]);

    assert!(!has_result_or_pending_for_set_ids(
        &event,
        &local_meta,
        &changed_targets
    ));
}

#[test]
fn event_scoped_rebuild_matches_global_rebuild_without_mutating_other_events() {
    let snapshot: TournamentSnapshot = serde_json::from_value(serde_json::json!({
        "tournamentId": "tournament",
        "slug": "tournament",
        "name": "Tournament",
        "updatedAt": "2026-10-01T00:00:00Z",
        "events": [
            {
                "eventId": "rr-event",
                "name": "Round Robin Event",
                "phases": [
                    { "phaseId": "pool", "phaseOrder": 1 },
                    { "phaseId": "finals", "phaseOrder": 2 }
                ],
                "phaseGroups": [
                    {
                        "phaseGroupId": "rr-group",
                        "phaseId": "pool",
                        "phaseOrder": 1,
                        "displayIdentifier": "1",
                        "bracketType": "ROUND_ROBIN",
                        "setIds": ["rr-set"],
                        "progressionsOut": [{
                            "progressionId": "top-progression",
                            "originPhaseId": "pool",
                            "originPhaseOrder": 1,
                            "originPhaseGroupId": "rr-group",
                            "originPlacement": 1
                        }],
                        "seeds": [
                            { "seedId": "rr-seed-a", "seedNum": 1, "entrantId": "a", "entrantName": "A" },
                            { "seedId": "rr-seed-b", "seedNum": 2, "entrantId": "b", "entrantName": "B" }
                        ]
                    },
                    {
                        "phaseGroupId": "finals-group",
                        "phaseId": "finals",
                        "phaseOrder": 2,
                        "displayIdentifier": "1",
                        "setIds": ["final-set"],
                        "seeds": [
                            { "seedId": "final-seed", "progressionId": "top-progression" }
                        ]
                    }
                ],
                "sets": [
                    {
                        "setId": "rr-set",
                        "phaseGroupId": "rr-group",
                        "phaseOrder": 1,
                        "fullRoundText": "Round 1",
                        "state": 3,
                        "winnerId": "a",
                        "slots": [
                            { "entrantId": "a", "entrantName": "A", "score": 2 },
                            { "entrantId": "b", "entrantName": "B", "score": 1 }
                        ]
                    },
                    {
                        "setId": "final-set",
                        "phaseGroupId": "finals-group",
                        "phaseOrder": 2,
                        "fullRoundText": "Round 1",
                        "state": 1,
                        "winnerId": null,
                        "entrant1Source": { "sourceType": "seed", "typeId": "final-seed" },
                        "slots": [
                            { "seedId": "final-seed", "entrantName": "TBD", "entrantId": null, "score": null },
                            { "entrantName": "TBD", "entrantId": null, "score": null }
                        ]
                    }
                ]
            },
            {
                "eventId": "untouched-event",
                "name": "Untouched Event",
                "phases": [],
                "phaseGroups": [],
                "sets": [{
                    "setId": "invalid-result",
                    "fullRoundText": "Round 1",
                    "state": 3,
                    "winnerId": "not-in-slots",
                    "slots": [
                        { "entrantId": "x", "entrantName": "X", "score": 1 },
                        { "entrantId": "y", "entrantName": "Y", "score": 0 }
                    ]
                }]
            }
        ]
    }))
    .expect("multi-event snapshot should deserialize");

    let mut globally_rebuilt = snapshot.clone();
    rebuild_progression_from_completed_sets(&mut globally_rebuilt);

    let untouched_event_before =
        serde_json::to_value(&snapshot.events[1]).expect("untouched event should serialize");
    let mut event_rebuilt = snapshot;
    rebuild_event_progression_from_completed_sets(&mut event_rebuilt, "rr-event");

    assert_eq!(
        serde_json::to_value(&event_rebuilt.events[0]).expect("rebuilt event should serialize"),
        serde_json::to_value(&globally_rebuilt.events[0]).expect("global event should serialize"),
    );
    assert_eq!(
        serde_json::to_value(&event_rebuilt.events[1]).expect("other event should serialize"),
        untouched_event_before,
    );
}
