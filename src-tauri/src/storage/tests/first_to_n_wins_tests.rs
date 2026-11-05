use super::align_first_to_n_set_sides_with_previous;
use super::append_first_to_n_set_if_needed;
use super::ensure_first_to_n_set_is_next;
use super::reconcile_first_to_n_schedules;
use super::restore_pending_result_to_event;
use crate::models::{
    CreateLocalEventSnapshotInput, EventManagementMeta, LocalEventFirstToNWinsConfig,
    LocalEventParticipantInput, LocalEventPhaseConfig, LocalSetResultMeta, LocalSetScoreMeta,
    PlaySide, SetPlaySideMeta,
};
use chrono::Utc;

fn make_snapshot(
    play_all_matches: bool,
    draw_counts_as_win: bool,
    sudden_death: bool,
) -> crate::models::TournamentSnapshot {
    make_snapshot_with_wins(play_all_matches, draw_counts_as_win, sudden_death, 2)
}

fn make_snapshot_with_wins(
    play_all_matches: bool,
    draw_counts_as_win: bool,
    sudden_death: bool,
    wins_required: usize,
) -> crate::models::TournamentSnapshot {
    let input = CreateLocalEventSnapshotInput {
        tournament_name: "Local".to_owned(),
        event_name: "Event".to_owned(),
        overwrite_event_id: None,
        event_alias: None,
        participants: (1..=2)
            .map(|index| LocalEventParticipantInput {
                entrant_id: format!("entrant-{index}"),
                name: format!("Player {index}"),
                category_selections: vec![Vec::new(); 3],
                skill: None,
            })
            .collect(),
        require_item_selections: true,
        event_management: EventManagementMeta {
            side_decision_method: "upper_1p".to_owned(),
            item_list_snapshots: Vec::new(),
            use_alias_name: false,
            category_min_counts: vec![0; 3],
            category_max_counts: vec![0; 3],
            category_allow_duplicates: vec![false; 3],
            total_min_count: 0,
            total_max_count: 3,
        },
        phases: vec![LocalEventPhaseConfig {
            name: "Final".to_owned(),
            pool_count: 1,
            bracket_type: "FIRST_TO_N_WINS".to_owned(),
            qualifiers_per_pool: 0,
            tiebreak_order: vec![
                "TOTAL_SETS_WON".to_owned(),
                "GAME_RATIO".to_owned(),
                "HEAD_TO_HEAD".to_owned(),
            ],
            enabled_tiebreak_rules: vec![
                "TOTAL_SETS_WON".to_owned(),
                "GAME_RATIO".to_owned(),
                "HEAD_TO_HEAD".to_owned(),
            ],
            third_place_match: false,
            fifth_place_match: false,
            grand_final_reset: true,
            first_to_n_wins: Some(LocalEventFirstToNWinsConfig {
                phase_set_count: wins_required * 2 - 1,
                wins_required,
                player_one_entrant_id: "entrant-1".to_owned(),
                play_all_matches,
                draw_counts_as_win,
                sudden_death,
            }),
        }],
    };

    crate::local_event::generate_local_snapshot(&input, "local-test", "local-test", "event")
        .expect("First to N wins snapshot should generate")
}

fn group_id(snapshot: &crate::models::TournamentSnapshot) -> String {
    snapshot.events[0].phase_groups[0].phase_group_id.clone()
}

#[test]
fn a_draw_that_does_not_count_as_a_win_adds_a_scheduled_set() {
    let mut snapshot = make_snapshot(false, false, false);
    let phase_group_id = group_id(&snapshot);
    let event = &mut snapshot.events[0];
    event.sets[0].state = 3;
    event.sets[0].winner_id = None;
    for slot in &mut event.sets[0].slots {
        slot.score = Some(1.0);
    }

    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("draw should extend the schedule");

    assert_eq!(snapshot.events[0].sets.len(), 4);
    assert_eq!(snapshot.events[0].sets[3].identifier.as_deref(), Some("4"));
    assert_eq!(snapshot.events[0].phase_groups[0].set_ids.len(), 4);

    let event = &mut snapshot.events[0];
    event.sets[3].state = 3;
    event.sets[3].winner_id = None;
    for slot in &mut event.sets[3].slots {
        slot.score = Some(1.0);
    }

    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("each non-counting draw should add another scheduled set");

    assert_eq!(snapshot.events[0].sets.len(), 5);
    assert_eq!(snapshot.events[0].sets[4].identifier.as_deref(), Some("5"));
    assert_eq!(snapshot.events[0].phase_groups[0].set_ids.len(), 5);
}

#[test]
fn a_draw_appended_set_inherits_the_current_player_sides() {
    let mut snapshot = make_snapshot(false, false, false);
    let phase_group_id = group_id(&snapshot);
    let previous_set_id = snapshot.events[0].sets[0].set_id.clone();
    let mut set_play_sides = vec![
        SetPlaySideMeta {
            set_id: previous_set_id.clone(),
            entrant_id: "entrant-1".to_owned(),
            play_side: PlaySide::TwoP,
        },
        SetPlaySideMeta {
            set_id: previous_set_id.clone(),
            entrant_id: "entrant-2".to_owned(),
            play_side: PlaySide::OneP,
        },
    ];
    let event = &mut snapshot.events[0];
    event.sets[0].state = 3;
    event.sets[0].winner_id = None;

    let next_set_id = append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("draw should extend the schedule")
        .expect("a new set should be appended");
    let settings = snapshot.events[0].phase_groups[0]
        .first_to_n_wins
        .as_ref()
        .expect("First to N wins settings should exist");
    align_first_to_n_set_sides_with_previous(
        &snapshot,
        &mut set_play_sides,
        "event",
        &previous_set_id,
        &next_set_id,
        settings,
    )
    .expect("the appended set should inherit current sides");

    assert!(set_play_sides.iter().any(|side| {
        side.set_id == next_set_id
            && side.entrant_id == "entrant-1"
            && side.play_side == PlaySide::TwoP
    }));
    assert!(set_play_sides.iter().any(|side| {
        side.set_id == next_set_id
            && side.entrant_id == "entrant-2"
            && side.play_side == PlaySide::OneP
    }));
}

#[test]
fn restoring_two_ten_win_draws_reconstructs_both_extra_matches() {
    let mut snapshot = make_snapshot_with_wins(false, false, false, 10);
    let event = &mut snapshot.events[0];
    let first_set_id = event.sets[0].set_id.clone();
    let phase_group_id = event.phase_groups[0].phase_group_id.clone();
    let draw_result = |set_id: String| LocalSetResultMeta {
        event_id: "event".to_owned(),
        event_name: "Event".to_owned(),
        set_id,
        winner_id: String::new(),
        score_csv: String::new(),
        direct_win: false,
        confirmed: true,
        slot_scores: vec![],
        reset_source_set_id: None,
        recorded_at: Utc::now(),
    };

    event.sets[0].state = 3;
    event.sets[0].winner_id = None;
    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("first draw should append match 20");
    let appended_set_id = snapshot.events[0]
        .sets
        .last()
        .expect("first extra set should exist")
        .set_id
        .clone();

    let mut raw_snapshot = make_snapshot_with_wins(false, false, false, 10);
    raw_snapshot.events[0].sets[0].state = 3;
    raw_snapshot.events[0].sets[0].winner_id = None;
    let pending_results = vec![draw_result(first_set_id), draw_result(appended_set_id)];

    reconcile_first_to_n_schedules(&mut raw_snapshot, &pending_results)
        .expect("both completed draws should restore their extra matches");

    assert_eq!(raw_snapshot.events[0].sets.len(), 21);
    assert_eq!(
        raw_snapshot.events[0].sets[19].state, 3,
        "the saved draw on the first extra match should be restored"
    );
    assert_eq!(raw_snapshot.events[0].phase_groups[0].set_ids.len(), 21);
}

#[test]
fn sudden_death_repeats_until_a_unique_winner_is_decided() {
    let mut snapshot = make_snapshot(true, true, true);
    let phase_group_id = group_id(&snapshot);
    let event = &mut snapshot.events[0];
    for set in &mut event.sets {
        set.state = 3;
    }
    event.sets[0].winner_id = Some("entrant-1".to_owned());
    event.sets[1].winner_id = Some("entrant-2".to_owned());
    event.sets[2].winner_id = None;

    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("tied completed schedule should start sudden death");
    assert_eq!(snapshot.events[0].sets.len(), 4);

    let event = &mut snapshot.events[0];
    event.sets[3].state = 3;
    event.sets[3].winner_id = None;
    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("a tied sudden-death set should extend the sudden-death schedule");
    assert_eq!(snapshot.events[0].sets.len(), 5);

    let final_set = &mut snapshot.events[0].sets[4];
    final_set.state = 3;
    final_set.winner_id = Some("entrant-1".to_owned());
    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("a sudden-death winner should finish the schedule");
    assert_eq!(snapshot.events[0].sets.len(), 5);
}

#[test]
fn reaching_the_target_stops_adding_matches_unless_all_matches_are_requested() {
    let mut snapshot = make_snapshot(false, false, false);
    let phase_group_id = group_id(&snapshot);
    let event = &mut snapshot.events[0];
    for set in event.sets.iter_mut().take(2) {
        set.state = 3;
        set.winner_id = Some("entrant-1".to_owned());
    }

    append_first_to_n_set_if_needed(&mut snapshot, "event", &phase_group_id)
        .expect("a clinched result should stop a first-to-N schedule");

    assert_eq!(snapshot.events[0].sets.len(), 3);
}

#[test]
fn result_confirmation_rejects_skipped_sets_and_sets_after_a_clinch() {
    let mut snapshot = make_snapshot(false, false, false);
    let phase_group_id = group_id(&snapshot);
    let settings = snapshot.events[0].phase_groups[0]
        .first_to_n_wins
        .clone()
        .expect("First to N wins settings should exist");
    snapshot.events[0].sets[1].state = 3;
    snapshot.events[0].sets[1].winner_id = Some("entrant-2".to_owned());

    assert!(ensure_first_to_n_set_is_next(
        &snapshot,
        "event",
        &phase_group_id,
        &snapshot.events[0].sets[1].set_id,
        &settings,
    )
    .is_err());

    let event = &mut snapshot.events[0];
    event.sets[0].state = 3;
    event.sets[0].winner_id = Some("entrant-1".to_owned());
    event.sets[1].state = 1;
    event.sets[1].winner_id = None;
    event.sets[2].state = 3;
    event.sets[2].winner_id = Some("entrant-1".to_owned());
    assert!(ensure_first_to_n_set_is_next(
        &snapshot,
        "event",
        &phase_group_id,
        &snapshot.events[0].sets[1].set_id,
        &settings,
    )
    .is_err());

    let mut all_matches_settings = settings.clone();
    all_matches_settings.play_all_matches = true;
    assert!(ensure_first_to_n_set_is_next(
        &snapshot,
        "event",
        &phase_group_id,
        &snapshot.events[0].sets[1].set_id,
        &all_matches_settings,
    )
    .is_ok());
}

#[test]
fn restoring_a_confirmed_draw_keeps_the_set_completed_without_a_winner() {
    let mut snapshot = make_snapshot(false, false, false);
    let mut event = snapshot.events.remove(0);
    let set_id = event.sets[0].set_id.clone();
    let pending = LocalSetResultMeta {
        event_id: event.event_id.clone(),
        event_name: event.name.clone(),
        set_id: set_id.clone(),
        winner_id: String::new(),
        score_csv: "2-2".to_owned(),
        direct_win: false,
        confirmed: true,
        slot_scores: vec![
            LocalSetScoreMeta {
                entrant_id: "entrant-1".to_owned(),
                score: 2,
            },
            LocalSetScoreMeta {
                entrant_id: "entrant-2".to_owned(),
                score: 2,
            },
        ],
        reset_source_set_id: None,
        recorded_at: Utc::now(),
    };

    restore_pending_result_to_event(&mut event, &pending);

    assert_eq!(event.sets[0].set_id, set_id);
    assert_eq!(event.sets[0].state, 3);
    assert_eq!(event.sets[0].winner_id, None);
    assert_eq!(event.sets[0].slots[0].score, Some(2.0));
    assert_eq!(event.sets[0].slots[1].score, Some(2.0));
}

#[test]
fn restoring_a_no_score_draw_clears_scores_and_keeps_the_set_completed() {
    let mut snapshot = make_snapshot(false, false, false);
    let mut event = snapshot.events.remove(0);
    let set_id = event.sets[0].set_id.clone();
    for slot in &mut event.sets[0].slots {
        slot.score = Some(3.0);
    }
    let pending = LocalSetResultMeta {
        event_id: event.event_id.clone(),
        event_name: event.name.clone(),
        set_id: set_id.clone(),
        winner_id: String::new(),
        score_csv: String::new(),
        direct_win: false,
        confirmed: true,
        slot_scores: vec![],
        reset_source_set_id: None,
        recorded_at: Utc::now(),
    };

    restore_pending_result_to_event(&mut event, &pending);

    assert_eq!(event.sets[0].set_id, set_id);
    assert_eq!(event.sets[0].state, 3);
    assert_eq!(event.sets[0].winner_id, None);
    assert_eq!(event.sets[0].slots[0].score, None);
    assert_eq!(event.sets[0].slots[1].score, None);
}
