use super::*;

#[test]
fn replaces_only_the_requested_event_from_pristine_snapshot() {
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "event".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![
            EventSnapshot {
                event_id: "event-a".to_owned(),
                name: "Locally changed A".to_owned(),
                phases: Vec::new(),
                phase_groups: Vec::new(),
                sets: Vec::new(),
            },
            EventSnapshot {
                event_id: "event-b".to_owned(),
                name: "Local B".to_owned(),
                phases: Vec::new(),
                phase_groups: Vec::new(),
                sets: Vec::new(),
            },
        ],
        updated_at: Utc::now(),
    };
    let pristine_snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "event".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![EventSnapshot {
            event_id: "event-a".to_owned(),
            name: "Downloaded A".to_owned(),
            phases: Vec::new(),
            phase_groups: Vec::new(),
            sets: Vec::new(),
        }],
        updated_at: Utc::now(),
    };

    replace_event_with_pristine_snapshot(&mut snapshot, &pristine_snapshot, "event-a").unwrap();

    assert_eq!(snapshot.events[0].name, "Downloaded A");
    assert_eq!(snapshot.events[1].name, "Local B");
}

fn make_slot(entrant_id: &str) -> crate::models::SetSlotSnapshot {
    crate::models::SetSlotSnapshot {
        entrant_id: Some(entrant_id.to_owned()),
        entrant_name: entrant_id.to_owned(),
        seed_id: None,
        seed_num: None,
        seed_placeholder_name: None,
        seed_origin_phase_group_id: None,
        seed_origin_phase_group_display_identifier: None,
        seed_origin_phase_order: None,
        seed_origin_placement: None,
        seed_origin_order: None,
        score: None,
    }
}

fn make_set(
    set_id: &str,
    full_round_text: &str,
    winner_id: Option<&str>,
    slots: &[&str],
) -> crate::models::SetSnapshot {
    serde_json::from_value(serde_json::json!({
        "setId": set_id,
        "fullRoundText": full_round_text,
        "state": 2,
        "winnerId": winner_id,
        "slots": slots.iter().map(|entrant_id| {
            serde_json::json!({
                "entrantId": entrant_id,
                "entrantName": entrant_id,
            })
        }).collect::<Vec<_>>(),
    }))
    .unwrap()
}

#[test]
fn clear_reset_set_results_preserves_confirmed_matchup_and_clears_scores() {
    let mut reset_set = make_set(
        "reset-set",
        "Round 1",
        Some("entrant-1"),
        &["entrant-1", "entrant-2"],
    );
    reset_set.slots[0].score = Some(2.0);
    reset_set.slots[1].score = Some(1.0);
    let mut unaffected_set = make_set(
        "unaffected-set",
        "Round 1",
        Some("entrant-3"),
        &["entrant-3", "entrant-4"],
    );
    unaffected_set.slots[0].score = Some(2.0);
    unaffected_set.slots[1].score = Some(0.0);
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament/example".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![EventSnapshot {
            event_id: "event".to_owned(),
            name: "Event".to_owned(),
            phases: Vec::new(),
            phase_groups: Vec::new(),
            sets: vec![reset_set, unaffected_set],
        }],
        updated_at: Utc::now(),
    };

    clear_reset_set_results_from_snapshot(&mut snapshot, "event", &["reset-set".to_owned()]);

    let event = &snapshot.events[0];
    let reset_set = &event.sets[0];
    assert_eq!(reset_set.winner_id, None);
    assert_eq!(reset_set.state, 2);
    assert_eq!(reset_set.slots[0].entrant_id.as_deref(), Some("entrant-1"));
    assert_eq!(reset_set.slots[1].entrant_id.as_deref(), Some("entrant-2"));
    assert_eq!(reset_set.slots[0].score, None);
    assert_eq!(reset_set.slots[1].score, None);

    let unaffected_set = &event.sets[1];
    assert_eq!(unaffected_set.winner_id.as_deref(), Some("entrant-3"));
    assert_eq!(unaffected_set.slots[0].score, Some(2.0));
    assert_eq!(unaffected_set.slots[1].score, Some(0.0));
}

#[test]
fn score_only_pending_is_not_treated_as_a_reset() {
    let mut set = make_set("set-1", "Round 1", None, &["entrant-1", "entrant-2"]);
    set.slots[0].score = Some(2.0);
    set.slots[1].score = Some(1.0);
    let pending = LocalSetResultMeta {
        event_id: "event".to_owned(),
        event_name: "Event".to_owned(),
        set_id: "set-1".to_owned(),
        winner_id: String::new(),
        score_csv: String::new(),
        direct_win: false,
        confirmed: false,
        slot_scores: vec![
            LocalSetScoreMeta {
                entrant_id: "entrant-1".to_owned(),
                score: 2,
            },
            LocalSetScoreMeta {
                entrant_id: "entrant-2".to_owned(),
                score: 1,
            },
        ],
        reset_source_set_id: None,
        recorded_at: Utc::now(),
    };

    assert!(is_pending_result_matched_with_set(&pending, &set));
    set.slots[1].score = Some(0.0);
    assert!(!is_pending_result_matched_with_set(&pending, &set));

    let mut reset = pending;
    reset.slot_scores.clear();
    assert!(is_pending_result_matched_with_set(&reset, &set));
}

#[test]
fn restoring_cascade_reset_preserves_root_entrants_and_clears_dependents() {
    let root_set = make_set(
        "root-set",
        "Winners Round 1",
        Some("entrant-1"),
        &["entrant-1", "entrant-2"],
    );
    let mut dependent_set = make_set(
        "dependent-set",
        "Winners Round 2",
        Some("entrant-1"),
        &["entrant-1", "entrant-3"],
    );
    dependent_set.entrant1_source = Some(
        serde_json::from_value(serde_json::json!({
            "sourceType": "set",
            "typeId": "root-set",
            "condition": "winner"
        }))
        .unwrap(),
    );
    dependent_set.slots[0].score = Some(2.0);
    dependent_set.slots[1].score = Some(1.0);
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament/example".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![EventSnapshot {
            event_id: "event".to_owned(),
            name: "Event".to_owned(),
            phases: Vec::new(),
            phase_groups: Vec::new(),
            sets: vec![root_set, dependent_set],
        }],
        updated_at: Utc::now(),
    };

    for set_id in ["root-set", "dependent-set"] {
        let reset = LocalSetResultMeta {
            event_id: "event".to_owned(),
            event_name: "Event".to_owned(),
            set_id: set_id.to_owned(),
            winner_id: String::new(),
            score_csv: String::new(),
            direct_win: false,
            confirmed: true,
            slot_scores: Vec::new(),
            reset_source_set_id: Some("root-set".to_owned()),
            recorded_at: Utc::now(),
        };
        restore_pending_result_to_event(&mut snapshot.events[0], &reset);
    }
    apply_source_based_tbd_labels(&mut snapshot.events[0]);
    rebuild_progression_from_completed_sets(&mut snapshot);

    let root_set = &snapshot.events[0].sets[0];
    assert_eq!(root_set.winner_id, None);
    assert_eq!(root_set.state, 2);
    assert_eq!(root_set.slots[0].entrant_id.as_deref(), Some("entrant-1"));
    assert_eq!(root_set.slots[1].entrant_id.as_deref(), Some("entrant-2"));
    assert!(root_set.slots.iter().all(|slot| slot.score.is_none()));

    let dependent_set = &snapshot.events[0].sets[1];
    assert_eq!(dependent_set.winner_id, None);
    assert_eq!(dependent_set.state, 1);
    assert!(dependent_set
        .slots
        .iter()
        .all(|slot| slot.entrant_id.is_none() && slot.score.is_none()));
}

#[test]
fn reset_order_starts_with_grand_final_winner() {
    let mut slots = vec![make_slot("loser"), make_slot("winner")];

    assert!(move_entrant_slot_first(&mut slots, "winner"));
    assert_eq!(slots[0].entrant_id.as_deref(), Some("winner"));
    assert_eq!(slots[1].entrant_id.as_deref(), Some("loser"));
    assert!(!move_entrant_slot_first(&mut slots, "winner"));
}

#[test]
fn prior_phase_losers_history_does_not_create_grand_final_reset() {
    let mut historical_losers = make_set(
        "phase-one-losers",
        "Losers Round 2",
        Some("other-player"),
        &["other-player", "gf-winner"],
    );
    historical_losers.phase_order = Some(1);
    historical_losers.phase_group_id = Some("phase-one".to_owned());
    let mut winners_final = make_set(
        "phase-two-winners-final",
        "Winners Final",
        Some("gf-winner"),
        &["gf-winner", "gf-loser"],
    );
    winners_final.phase_order = Some(2);
    winners_final.phase_group_id = Some("phase-two".to_owned());
    let mut grand_final = make_set(
        "phase-two-grand-final",
        "Grand Final",
        Some("gf-winner"),
        &["gf-winner", "gf-loser"],
    );
    grand_final.phase_order = Some(2);
    grand_final.phase_group_id = Some("phase-two".to_owned());
    grand_final.entrant1_source = Some(
        serde_json::from_value(serde_json::json!({
            "sourceType": "set",
            "typeId": "phase-two-winners-final",
            "resolvedSetId": "phase-two-winners-final",
            "condition": "winner"
        }))
        .unwrap(),
    );

    let event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "Event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![historical_losers, winners_final, grand_final.clone()],
    };

    assert!(!winner_is_from_losers_side(
        &event,
        &grand_final,
        "gf-winner"
    ));
}

#[test]
fn same_phase_group_losers_history_identifies_grand_final_side() {
    let mut losers_final = make_set(
        "phase-two-losers-final",
        "Losers Final",
        Some("gf-loser"),
        &["gf-loser", "other-player"],
    );
    losers_final.phase_order = Some(2);
    losers_final.phase_group_id = Some("phase-two".to_owned());
    let mut grand_final = make_set(
        "phase-two-grand-final",
        "Grand Final",
        Some("gf-loser"),
        &["gf-loser", "gf-winner"],
    );
    grand_final.phase_order = Some(2);
    grand_final.phase_group_id = Some("phase-two".to_owned());

    let event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "Event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![losers_final, grand_final.clone()],
    };

    assert!(winner_is_from_losers_side(&event, &grand_final, "gf-loser"));
}

#[test]
fn winners_side_grand_final_makes_existing_reset_inactive() {
    let mut winners_final = make_set(
        "winners-final",
        "Winners Final",
        Some("gf-winner"),
        &["gf-winner", "gf-loser"],
    );
    winners_final.phase_order = Some(2);
    winners_final.phase_group_id = Some("phase-two".to_owned());
    let mut grand_final = make_set(
        "grand-final",
        "Grand Final",
        Some("gf-winner"),
        &["gf-winner", "gf-loser"],
    );
    grand_final.phase_order = Some(2);
    grand_final.phase_group_id = Some("phase-two".to_owned());
    grand_final.entrant1_source = Some(
        serde_json::from_value(serde_json::json!({
            "sourceType": "set",
            "typeId": "winners-final",
            "resolvedSetId": "winners-final",
            "condition": "winner"
        }))
        .unwrap(),
    );
    let mut reset = make_set(
        "grand-final-reset",
        "Grand Final Reset",
        None,
        &["gf-winner", "gf-loser"],
    );
    reset.phase_order = Some(2);
    reset.phase_group_id = Some("phase-two".to_owned());
    let event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "Event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![winners_final, grand_final, reset.clone()],
    };

    assert!(is_inactive_grand_final_reset_set(&event, &reset));
}

#[test]
fn losers_side_grand_final_keeps_reset_active() {
    let mut losers_final = make_set(
        "losers-final",
        "Losers Final",
        Some("gf-winner"),
        &["gf-winner", "other-player"],
    );
    losers_final.phase_order = Some(2);
    losers_final.phase_group_id = Some("phase-two".to_owned());
    let mut grand_final = make_set(
        "grand-final",
        "Grand Final",
        Some("gf-winner"),
        &["gf-winner", "other-player"],
    );
    grand_final.phase_order = Some(2);
    grand_final.phase_group_id = Some("phase-two".to_owned());
    let mut reset = make_set(
        "grand-final-reset",
        "Grand Final Reset",
        None,
        &["gf-winner", "other-player"],
    );
    reset.phase_order = Some(2);
    reset.phase_group_id = Some("phase-two".to_owned());
    let event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "Event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![losers_final, grand_final, reset.clone()],
    };

    assert!(!is_inactive_grand_final_reset_set(&event, &reset));
}

#[test]
fn intermediate_grand_final_does_not_create_virtual_reset() {
    let mut losers_final = make_set(
        "middle-losers-final",
        "Losers Final",
        Some("player-3"),
        &["player-3", "player-7"],
    );
    losers_final.phase_group_id = Some("middle-pool-2".to_owned());
    losers_final.phase_order = Some(2);
    let mut grand_final = make_set(
        "middle-grand-final",
        "Grand Final",
        Some("player-3"),
        &["player-3", "player-6"],
    );
    grand_final.phase_group_id = Some("middle-pool-2".to_owned());
    grand_final.phase_order = Some(2);
    let phase_group = serde_json::from_value(serde_json::json!({
        "phaseGroupId": "middle-pool-2",
        "setIds": ["middle-losers-final"]
    }))
    .unwrap();
    let event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "Event".to_owned(),
        phases: Vec::new(),
        phase_groups: vec![phase_group],
        sets: vec![losers_final, grand_final],
    };
    let mut snapshot = TournamentSnapshot {
        tournament_id: "tournament".to_owned(),
        slug: "tournament".to_owned(),
        name: "Tournament".to_owned(),
        events: vec![event],
        updated_at: Utc::now(),
    };

    apply_local_progression_incremental(
        &mut snapshot,
        "event",
        "middle-grand-final",
        "player-3",
        &HashMap::new(),
    );

    assert_eq!(snapshot.events[0].sets.len(), 2);
}

#[test]
fn existing_remote_reset_order_is_preserved() {
    let grand_final = make_set("gf", "Grand Final", Some("winner"), &["loser", "winner"]);
    let reset = make_set("gf-reset", "Grand Final Reset", None, &["loser", "winner"]);
    let mut event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![reset],
    };

    assert!(hydrate_existing_grand_final_reset_sets(
        &mut event,
        &grand_final
    ));
    assert_eq!(
        event.sets[0]
            .slots
            .iter()
            .map(|slot| slot.entrant_id.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("loser"), Some("winner")]
    );
}

#[test]
fn normalization_preserves_remote_reset_order() {
    let grand_final = make_set("gf", "Grand Final", Some("loser"), &["winner", "loser"]);
    let reset = make_set(
        "remote-reset",
        "Grand Final Reset",
        None,
        &["loser", "winner"],
    );
    let mut event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![grand_final, reset],
    };

    normalize_completed_source_slots(&mut event);
    assert_eq!(
        event.sets[1]
            .slots
            .iter()
            .map(|slot| slot.entrant_id.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("loser"), Some("winner")]
    );
}

#[test]
fn normalization_keeps_local_reset_winner_first() {
    let grand_final = make_set("gf", "Grand Final", Some("winner"), &["loser", "winner"]);
    let reset = make_set(
        "virtual_gf_reset_gf",
        "Grand Final Reset",
        None,
        &["loser", "winner"],
    );
    let mut event = EventSnapshot {
        event_id: "event".to_owned(),
        name: "event".to_owned(),
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: vec![grand_final, reset],
    };

    normalize_completed_source_slots(&mut event);
    assert_eq!(
        event.sets[1]
            .slots
            .iter()
            .map(|slot| slot.entrant_id.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("winner"), Some("loser")]
    );
}
