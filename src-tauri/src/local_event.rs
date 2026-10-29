use chrono::Utc;
use std::collections::HashMap;

use crate::models::{
    CreateLocalEventSnapshotInput, EventSnapshot, LocalEventPhaseConfig,
    PhaseGroupProgressionSnapshot, PhaseGroupSeedSnapshot, PhaseGroupSnapshot, PhaseSnapshot,
    SetEntrantSourceSnapshot, SetSlotSnapshot, SetSnapshot, TournamentSnapshot,
};

#[derive(Clone)]
struct SeedEntry {
    seed_id: String,
    seed_num: i64,
    entrant_id: Option<String>,
    entrant_name: Option<String>,
    placeholder_name: Option<String>,
    origin_phase_order: Option<i64>,
    origin_phase_group_id: Option<String>,
    origin_phase_group_display_identifier: Option<String>,
    origin_placement: Option<i64>,
    origin_order: Option<i64>,
}

#[derive(Clone)]
enum SetSource {
    Seed(SeedEntry),
    Set {
        set_id: String,
        condition: &'static str,
    },
}

#[derive(Clone)]
struct SlotSource {
    source: SetSource,
    entrant_id: Option<String>,
    entrant_name: String,
    seed_id: Option<String>,
    seed_num: Option<i64>,
    seed_placeholder_name: Option<String>,
    seed_origin_phase_order: Option<i64>,
    seed_origin_phase_group_id: Option<String>,
    seed_origin_phase_group_display_identifier: Option<String>,
    seed_origin_placement: Option<i64>,
    seed_origin_order: Option<i64>,
}

impl From<&SeedEntry> for SlotSource {
    fn from(seed: &SeedEntry) -> Self {
        Self {
            source: SetSource::Seed(seed.clone()),
            entrant_id: seed.entrant_id.clone(),
            entrant_name: seed
                .entrant_name
                .clone()
                .or_else(|| seed.placeholder_name.clone())
                .unwrap_or_else(|| "TBD".to_owned()),
            seed_id: Some(seed.seed_id.clone()),
            seed_num: Some(seed.seed_num),
            seed_placeholder_name: seed.placeholder_name.clone(),
            seed_origin_phase_order: seed.origin_phase_order,
            seed_origin_phase_group_id: seed.origin_phase_group_id.clone(),
            seed_origin_phase_group_display_identifier: seed
                .origin_phase_group_display_identifier
                .clone(),
            seed_origin_placement: seed.origin_placement,
            seed_origin_order: seed.origin_order,
        }
    }
}

impl SlotSource {
    fn from_set(set_id: &str, condition: &'static str) -> Self {
        Self {
            source: SetSource::Set {
                set_id: set_id.to_owned(),
                condition,
            },
            entrant_id: None,
            entrant_name: if condition == "winner" {
                "Winners".to_owned()
            } else {
                "Losers".to_owned()
            },
            seed_id: None,
            seed_num: None,
            seed_placeholder_name: None,
            seed_origin_phase_order: None,
            seed_origin_phase_group_id: None,
            seed_origin_phase_group_display_identifier: None,
            seed_origin_placement: None,
            seed_origin_order: None,
        }
    }
}

fn possible_set_source(
    builder: &SnapshotBuilder,
    set_id: Option<&String>,
    condition: &'static str,
) -> Option<SlotSource> {
    let set_id = set_id?;
    let outputs = builder.possible_set_outputs.get(set_id)?;
    let can_progress = match condition {
        "winner" => outputs.0,
        "loser" => outputs.1,
        _ => false,
    };
    if can_progress && condition == "winner" && !outputs.1 {
        let bye = builder
            .sets
            .iter()
            .find(|set| set.set_id == *set_id)
            .expect("possible set outputs refer to an existing set");
        if let Some(source) = bye.entrant1_source.as_ref().or(bye.entrant2_source.as_ref()) {
            if source.source_type.as_deref() == Some("set") {
                let relation = match source.condition.as_deref() {
                    Some("loser") => "loser",
                    Some("winner") => "winner",
                    _ => unreachable!("generated set sources have a winner or loser condition"),
                };
                return possible_set_source(builder, source.type_id.as_ref(), relation);
            }
        }
    }
    can_progress.then(|| SlotSource::from_set(set_id, condition))
}

fn format_set_identifier(index: usize) -> String {
    let mut remaining = index + 1;
    let mut identifier = Vec::new();
    while remaining > 0 {
        let digit = (remaining - 1) % 26;
        identifier.push((b'A' + digit as u8) as char);
        remaining = (remaining - 1) / 26;
    }
    identifier.iter().rev().collect()
}

struct SnapshotBuilder {
    phases: Vec<PhaseSnapshot>,
    phase_groups: Vec<PhaseGroupSnapshot>,
    sets: Vec<SetSnapshot>,
    next_group_id: usize,
    next_seed_id: usize,
    next_set_id: usize,
    next_set_identifier_by_group: HashMap<String, usize>,
    possible_set_outputs: HashMap<String, (bool, bool)>,
}

impl SnapshotBuilder {
    fn add_set(
        &mut self,
        phase_order: usize,
        phase_name: &str,
        group_id: &str,
        group_name: &str,
        group_display_identifier: &str,
        round: i64,
        round_text: String,
        _set_index: usize,
        sources: [Option<SlotSource>; 2],
        is_bye: bool,
        winner_placement: Option<i64>,
        loser_placement: Option<i64>,
    ) -> String {
        let set_id = self.next_set_id.to_string();
        self.next_set_id += 1;
        let possible_entrants = sources.iter().flatten().filter(|slot| match &slot.source {
            SetSource::Seed(_) => true,
            SetSource::Set { set_id, condition } => {
                let (winner, loser) = self.possible_set_outputs[set_id];
                if *condition == "loser" { loser } else { winner }
            }
        }).count();
        let is_bye = is_bye || possible_entrants < 2;
        self.possible_set_outputs.insert(set_id.clone(), (possible_entrants > 0, !is_bye));
        let identifier = if is_bye {
            None
        } else {
            let index = self.next_set_identifier_by_group.entry(group_id.to_owned()).or_default();
            let identifier = format_set_identifier(*index);
            *index += 1;
            Some(identifier)
        };
        let slots = sources
            .iter()
            .map(|slot| match slot {
                Some(slot) => SetSlotSnapshot {
                    entrant_id: slot.entrant_id.clone(),
                    entrant_name: slot.entrant_name.clone(),
                    seed_id: slot.seed_id.clone(),
                    seed_num: slot.seed_num,
                    seed_placeholder_name: slot.seed_placeholder_name.clone(),
                    seed_origin_phase_group_id: slot.seed_origin_phase_group_id.clone(),
                    seed_origin_phase_group_display_identifier: slot
                        .seed_origin_phase_group_display_identifier
                        .clone(),
                    seed_origin_phase_order: slot.seed_origin_phase_order,
                    seed_origin_placement: slot.seed_origin_placement,
                    seed_origin_order: slot.seed_origin_order,
                    score: None,
                },
                None => SetSlotSnapshot {
                    entrant_id: None,
                    entrant_name: "BYE".to_owned(),
                    seed_id: None,
                    seed_num: None,
                    seed_placeholder_name: Some("BYE".to_owned()),
                    seed_origin_phase_group_id: None,
                    seed_origin_phase_group_display_identifier: None,
                    seed_origin_phase_order: None,
                    seed_origin_placement: None,
                    seed_origin_order: None,
                    score: None,
                },
            })
            .collect::<Vec<_>>();
        let one_player_bye = is_bye
            && slots
                .iter()
                .filter(|slot| slot.entrant_id.is_some())
                .count()
                == 1;
        let winner_id = one_player_bye
            .then(|| slots.iter().find_map(|slot| slot.entrant_id.clone()))
            .flatten();
        let state = if winner_id.is_some() { 3 } else { 1 };
        let entrant1_source = sources[0]
            .as_ref()
            .map(|slot| source_snapshot(&slot.source));
        let entrant2_source = sources[1]
            .as_ref()
            .map(|slot| source_snapshot(&slot.source));
        self.sets.push(SetSnapshot {
            set_id: set_id.clone(),
            phase_group_id: Some(group_id.to_owned()),
            identifier,
            full_round_text: round_text,
            round: Some(round),
            phase_name: Some(phase_name.to_owned()),
            phase_group_name: Some(group_name.to_owned()),
            phase_order: Some(phase_order as i64),
            phase_group_display_identifier: Some(group_display_identifier.to_owned()),
            phase_group_set_name: None,
            is_intermediate: false,
            is_bye,
            state,
            winner_id,
            winner_placement,
            loser_placement,
            entrant1_source,
            entrant2_source,
            winner_progression_seed_id: None,
            winner_progression_id: None,
            winner_progression_seed_num: None,
            winner_progression_seed_placeholder_name: None,
            winner_progression_origin_phase_group_id: None,
            winner_progression_origin_phase_group_display_identifier: None,
            winner_progression_origin_phase_order: None,
            winner_progression_origin_placement: None,
            winner_progression_origin_order: None,
            loser_progression_seed_id: None,
            loser_progression_id: None,
            loser_progression_seed_num: None,
            loser_progression_seed_placeholder_name: None,
            loser_progression_origin_phase_group_id: None,
            loser_progression_origin_phase_group_display_identifier: None,
            loser_progression_origin_phase_order: None,
            loser_progression_origin_placement: None,
            loser_progression_origin_order: None,
            slots,
        });
        set_id
    }
}

fn source_snapshot(source: &SetSource) -> SetEntrantSourceSnapshot {
    match source {
        SetSource::Seed(seed) => SetEntrantSourceSnapshot {
            source_type: Some("seed".to_owned()),
            type_id: Some(seed.seed_id.clone()),
            resolved_set_id: None,
            condition: None,
            condition_string: seed
                .placeholder_name
                .clone()
                .or_else(|| seed.entrant_name.clone()),
            placeholder_name: seed.placeholder_name.clone(),
            group_seed_num: Some(seed.seed_num),
            seed_num: Some(seed.seed_num),
            placement: seed.origin_placement,
            origin_phase_group_id: seed.origin_phase_group_id.clone(),
            origin_phase_group_display_identifier: seed
                .origin_phase_group_display_identifier
                .clone(),
            origin_phase_order: seed.origin_phase_order,
            origin_placement: seed.origin_placement,
        },
        SetSource::Set { set_id, condition } => SetEntrantSourceSnapshot {
            source_type: Some("set".to_owned()),
            type_id: Some(set_id.clone()),
            resolved_set_id: Some(set_id.clone()),
            condition: Some((*condition).to_owned()),
            condition_string: Some(format!(
                "{} of set {set_id}",
                if *condition == "winner" {
                    "Winner"
                } else {
                    "Loser"
                }
            )),
            placeholder_name: None,
            group_seed_num: None,
            seed_num: None,
            placement: None,
            origin_phase_group_id: None,
            origin_phase_group_display_identifier: None,
            origin_phase_order: None,
            origin_placement: None,
        },
    }
}

fn next_power_of_two(value: usize) -> usize {
    value.next_power_of_two()
}

fn seeded_positions(size: usize) -> Vec<usize> {
    let mut positions = vec![1, 2];
    let mut current_size = 2;
    while current_size < size {
        let next_size = current_size * 2;
        positions = positions
            .into_iter()
            .flat_map(|seed| [seed, next_size + 1 - seed])
            .collect();
        current_size = next_size;
    }
    positions
}

fn round_text(round: usize, round_count: usize, side: &str) -> String {
    let label = if round == round_count {
        "Final".to_owned()
    } else if round_count >= 3 && round == round_count - 1 {
        "Semi-Final".to_owned()
    } else if round_count >= 4 && round == round_count - 2 {
        "Quarter-Final".to_owned()
    } else {
        format!("Round {round}")
    };
    format!("{side} {label}")
}

fn add_single_elimination(
    builder: &mut SnapshotBuilder,
    config: &LocalEventPhaseConfig,
    phase_order: usize,
    phase_name: &str,
    group_id: &str,
    group_name: &str,
    display_identifier: &str,
    seeds: &[SeedEntry],
) {
    let bracket_size = next_power_of_two(seeds.len());
    let positions = seeded_positions(bracket_size);
    let round_count = bracket_size.trailing_zeros() as usize;
    let mut rounds = Vec::<Vec<String>>::new();
    let mut first_round = Vec::new();
    for (index, pair) in positions.chunks_exact(2).enumerate() {
        let left = seeds.get(pair[0] - 1).map(SlotSource::from);
        let right = seeds.get(pair[1] - 1).map(SlotSource::from);
        let is_bye = left.is_none() || right.is_none();
        first_round.push(builder.add_set(
            phase_order,
            phase_name,
            group_id,
            group_name,
            display_identifier,
            1,
            round_text(1, round_count, "Winners"),
            index,
            [left, right],
            is_bye,
            (round_count == 1).then_some(1),
            (round_count == 1).then_some(2),
        ));
    }
    rounds.push(first_round);

    for round in 2..=round_count {
        let previous = rounds.last().cloned().unwrap_or_default();
        let mut current = Vec::new();
        for (index, pair) in previous.chunks_exact(2).enumerate() {
            let is_final = round == round_count;
            current.push(builder.add_set(
                phase_order,
                phase_name,
                group_id,
                group_name,
                display_identifier,
                round as i64,
                round_text(round, round_count, "Winners"),
                index,
                [
                    Some(SlotSource::from_set(&pair[0], "winner")),
                    Some(SlotSource::from_set(&pair[1], "winner")),
                ],
                false,
                is_final.then_some(1),
                is_final.then_some(2),
            ));
        }
        rounds.push(current);
    }

    if config.third_place_match && round_count >= 2 {
        if let Some(semifinals) = rounds.get(round_count.saturating_sub(2)) {
            if semifinals.len() == 2 {
                builder.add_set(
                    phase_order,
                    phase_name,
                    group_id,
                    group_name,
                    display_identifier,
                    (round_count + 1) as i64,
                    "3rd Place Match".to_owned(),
                    0,
                    [
                        Some(SlotSource::from_set(&semifinals[0], "loser")),
                        Some(SlotSource::from_set(&semifinals[1], "loser")),
                    ],
                    false,
                    Some(3),
                    Some(4),
                );
            }
        }
    }
}

fn add_double_elimination(
    builder: &mut SnapshotBuilder,
    config: &LocalEventPhaseConfig,
    phase_order: usize,
    phase_name: &str,
    group_id: &str,
    group_name: &str,
    display_identifier: &str,
    seeds: &[SeedEntry],
) {
    let bracket_size = next_power_of_two(seeds.len());
    let positions = seeded_positions(bracket_size);
    let winner_round_count = bracket_size.trailing_zeros() as usize;
    let mut winner_rounds = Vec::<Vec<String>>::new();
    let mut first_round = Vec::new();
    for (index, pair) in positions.chunks_exact(2).enumerate() {
        let left = seeds.get(pair[0] - 1).map(SlotSource::from);
        let right = seeds.get(pair[1] - 1).map(SlotSource::from);
        let is_bye = left.is_none() || right.is_none();
        let is_final = winner_round_count == 1;
        first_round.push(builder.add_set(
            phase_order,
            phase_name,
            group_id,
            group_name,
            display_identifier,
            1,
            if is_final {
                "Grand Final".to_owned()
            } else {
                round_text(1, winner_round_count, "Winners")
            },
            index,
            [left, right],
            is_bye,
            is_final.then_some(1),
            is_final.then_some(2),
        ));
    }
    winner_rounds.push(first_round);
    for round in 2..=winner_round_count {
        let previous = winner_rounds.last().cloned().unwrap_or_default();
        let mut current = Vec::new();
        for (index, pair) in previous.chunks_exact(2).enumerate() {
            current.push(builder.add_set(
                phase_order,
                phase_name,
                group_id,
                group_name,
                display_identifier,
                round as i64,
                round_text(round, winner_round_count, "Winners"),
                index,
                [
                    Some(SlotSource::from_set(&pair[0], "winner")),
                    Some(SlotSource::from_set(&pair[1], "winner")),
                ],
                false,
                None,
                None,
            ));
        }
        winner_rounds.push(current);
    }

    if winner_round_count == 1 {
        return;
    }

    let winner_round_one_set_count = winner_rounds[0]
        .iter()
        .filter(|set_id| {
            builder
                .possible_set_outputs
                .get(*set_id)
                .is_some_and(|(_, can_lose)| *can_lose)
        })
        .count();
    let winner_round_two_set_count = winner_rounds[1]
        .iter()
        .filter(|set_id| {
            builder
                .possible_set_outputs
                .get(*set_id)
                .is_some_and(|(_, can_lose)| *can_lose)
        })
        .count();
    let mut redirected_winner_round_two_losers = std::collections::HashSet::new();
    let mut bye_winner_round_two_losers =
        if winner_round_two_set_count >= winner_round_one_set_count {
            winner_rounds[1]
                .iter()
                .enumerate()
                .filter_map(|(index, set_id)| {
                    let first_round_pair = &winner_rounds[0][index * 2..index * 2 + 2];
                    first_round_pair
                        .iter()
                        .all(|first_round_set_id| {
                            builder
                                .possible_set_outputs
                                .get(first_round_set_id)
                                .is_some_and(|(can_win, can_lose)| *can_win && !can_lose)
                        })
                        .then(|| set_id.clone())
                })
                .collect::<Vec<_>>()
                .into_iter()
        } else {
            Vec::new().into_iter()
        };

    let loser_round_count = winner_round_count * 2 - 2;
    let mut loser_rounds = Vec::<Vec<Option<String>>>::new();
    let mut skipped_loser_rounds = 0;
    let mut round_two_drop_sources = winner_rounds[1].iter().rev().collect::<Vec<_>>();
    for loser_round in 0..loser_round_count {
        if loser_round > 0 && loser_round % 2 == 0 {
            let previous_round = &loser_rounds[loser_round - 1];
            if previous_round
                .chunks_exact(2)
                .all(|pair| pair.iter().flatten().count() < 2)
            {
                loser_rounds.push(
                    previous_round
                        .chunks_exact(2)
                        .map(|pair| pair.iter().flatten().next().cloned())
                        .collect(),
                );
                skipped_loser_rounds += 1;
                continue;
            }
        }
        let round_number = loser_round + 1 - skipped_loser_rounds;
        if loser_round == 1 {
            let first_round = &loser_rounds[0];
            for index in 0..first_round.len() {
                if first_round[index].is_some()
                    && redirected_winner_round_two_losers.contains(round_two_drop_sources[index])
                {
                    let empty_branch_index = (0..first_round.len())
                        .find(|&candidate| {
                            first_round[candidate].is_none()
                                && !redirected_winner_round_two_losers
                                    .contains(round_two_drop_sources[candidate])
                        })
                        .expect("a redirected losers entrant leaves an empty first-round branch");
                    round_two_drop_sources.swap(index, empty_branch_index);
                }
            }
        }
        let shift = loser_round / 2 + 2;
        let set_count = bracket_size >> shift;
        let mut current = Vec::new();
        for index in 0..set_count {
            let mut sources = if loser_round == 0 {
                [
                    possible_set_source(builder, Some(&winner_rounds[0][index * 2]), "loser"),
                    possible_set_source(builder, Some(&winner_rounds[0][index * 2 + 1]), "loser"),
                ]
            } else if loser_round % 2 == 1 {
                let winners_round = (round_number + 1) / 2;
                let winners_round_index = if winners_round % 2 == 1 {
                    winner_rounds[winners_round].len() - 1 - index
                } else {
                    index
                };
                let winners_round_set_id = if loser_round == 1 {
                    round_two_drop_sources[index]
                } else {
                    &winner_rounds[winners_round][winners_round_index]
                };
                [
                    possible_set_source(
                        builder,
                        loser_rounds[loser_round - 1][index].as_ref(),
                        "winner",
                    ),
                    (!redirected_winner_round_two_losers.contains(winners_round_set_id))
                        .then(|| possible_set_source(builder, Some(winners_round_set_id), "loser"))
                        .flatten(),
                ]
            } else {
                let previous_round = &loser_rounds[loser_round - 1];
                [
                    possible_set_source(builder, previous_round[index * 2].as_ref(), "winner"),
                    possible_set_source(builder, previous_round[index * 2 + 1].as_ref(), "winner"),
                ]
            };
            if loser_round == 0 && sources.iter().filter(|source| source.is_some()).count() == 1 {
                if let Some(winners_round_two_set_id) = bye_winner_round_two_losers.next() {
                    if let Some(empty_slot) = sources.iter_mut().find(|source| source.is_none()) {
                        *empty_slot =
                            possible_set_source(builder, Some(&winners_round_two_set_id), "loser");
                        redirected_winner_round_two_losers.insert(winners_round_two_set_id);
                    }
                }
            }
            if sources.iter().all(Option::is_none) {
                current.push(None);
                continue;
            }
            let is_final_loser_round = loser_round + 1 == loser_round_count;
            let text = if is_final_loser_round {
                "Losers Final".to_owned()
            } else {
                format!("Losers Round {round_number}")
            };
            current.push(Some(builder.add_set(
                phase_order,
                phase_name,
                group_id,
                group_name,
                display_identifier,
                -(round_number as i64),
                text,
                index,
                sources,
                false,
                None,
                None,
            )));
        }
        loser_rounds.push(current);
    }

    let winners_final = winner_rounds
        .last()
        .and_then(|round| round.first())
        .expect("a bracket with at least two players has a winners final");
    let losers_final = loser_rounds
        .last()
        .and_then(|round| round.first())
        .and_then(Option::as_ref)
        .expect("a bracket with at least two players has a losers final");
    builder.add_set(
        phase_order,
        phase_name,
        group_id,
        group_name,
        display_identifier,
        (winner_round_count + 1) as i64,
        "Grand Final".to_owned(),
        0,
        [
            Some(SlotSource::from_set(winners_final, "winner")),
            Some(SlotSource::from_set(losers_final, "winner")),
        ],
        false,
        Some(1),
        Some(2),
    );

    if config.fifth_place_match && winner_round_count >= 3 {
        let fifth_place_loser_round = winner_round_count * 2 - 5;
        if let Some(round) = loser_rounds.get(fifth_place_loser_round) {
            if let [Some(first), Some(second)] = round.as_slice() {
                let sources = [
                    possible_set_source(builder, Some(first), "loser"),
                    possible_set_source(builder, Some(second), "loser"),
                ];
                builder.add_set(
                    phase_order,
                    phase_name,
                    group_id,
                    group_name,
                    display_identifier,
                    -((loser_round_count + 1) as i64),
                    "5th Place Match".to_owned(),
                    0,
                    sources,
                    false,
                    Some(5),
                    Some(6),
                );
            }
        }
    }
}

fn add_round_robin(
    builder: &mut SnapshotBuilder,
    phase_order: usize,
    phase_name: &str,
    group_id: &str,
    group_name: &str,
    display_identifier: &str,
    seeds: &[SeedEntry],
) {
    let mut players = seeds.iter().map(SlotSource::from).collect::<Vec<_>>();
    if players.len() % 2 == 1 {
        players.push(SlotSource {
            source: SetSource::Seed(SeedEntry {
                seed_id: String::new(),
                seed_num: 0,
                entrant_id: None,
                entrant_name: None,
                placeholder_name: Some("BYE".to_owned()),
                origin_phase_order: None,
                origin_phase_group_id: None,
                origin_phase_group_display_identifier: None,
                origin_placement: None,
                origin_order: None,
            }),
            entrant_id: None,
            entrant_name: "BYE".to_owned(),
            seed_id: None,
            seed_num: None,
            seed_placeholder_name: Some("BYE".to_owned()),
            seed_origin_phase_order: None,
            seed_origin_phase_group_id: None,
            seed_origin_phase_group_display_identifier: None,
            seed_origin_placement: None,
            seed_origin_order: None,
        });
    }
    let rounds = players.len().saturating_sub(1);
    for round in 0..rounds {
        for index in 0..players.len() / 2 {
            let left = &players[index];
            let right = &players[players.len() - 1 - index];
            if left.entrant_id.is_none() && left.seed_id.is_none()
                || right.entrant_id.is_none() && right.seed_id.is_none()
            {
                continue;
            }
            let source_pair = [left.clone(), right.clone()];
            builder.add_set(
                phase_order,
                phase_name,
                group_id,
                group_name,
                display_identifier,
                (round + 1) as i64,
                format!("Round {}", round + 1),
                round * (players.len() / 2) + index,
                [Some(source_pair[0].clone()), Some(source_pair[1].clone())],
                false,
                None,
                None,
            );
        }
        if players.len() > 2 {
            let last = players.pop().expect("the circle is nonempty");
            players.insert(1, last);
        }
    }
}

fn validate_input(input: &CreateLocalEventSnapshotInput) -> Result<(), String> {
    if input.tournament_name.trim().is_empty() || input.event_name.trim().is_empty() {
        return Err("大会名とイベント名を入力してください。".to_owned());
    }
    if input.participants.len() < 2 {
        return Err("参加人数は2人以上を指定してください。".to_owned());
    }
    if input.participants.len() > 512 {
        return Err("参加人数は512人以下を指定してください。".to_owned());
    }
    if !(1..=3).contains(&input.phases.len()) {
        return Err("フェーズ数は1〜3で指定してください。".to_owned());
    }
    validate_registration(input)?;
    let mut participant_count = input.participants.len();
    for (index, phase) in input.phases.iter().enumerate() {
        if phase.name.trim().is_empty() {
            return Err(format!("Phase {} の名前が空です。", index + 1));
        }
        if phase.pool_count == 0 || phase.pool_count > participant_count / 2 {
            return Err(format!(
                "Phase {} のプール数は1〜{}で指定してください。",
                index + 1,
                participant_count / 2
            ));
        }
        if !matches!(
            phase.bracket_type.as_str(),
            "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "ROUND_ROBIN"
        ) {
            return Err(format!("Phase {} の形式が不正です。", index + 1));
        }
        let valid_tiebreak_rule =
            |rule: &str| matches!(rule, "TOTAL_SETS_WON" | "GAME_RATIO" | "HEAD_TO_HEAD");
        let mut configured_tiebreak_rules = HashMap::new();
        if phase.tiebreak_order.len() != 3
            || phase.tiebreak_order.iter().any(|rule| {
                !valid_tiebreak_rule(rule)
                    || configured_tiebreak_rules
                        .insert(rule.as_str(), ())
                        .is_some()
            })
        {
            return Err(format!("Phase {} の勝利条件優先度が不正です。", index + 1));
        }
        let mut enabled_tiebreak_rules = HashMap::new();
        if phase.enabled_tiebreak_rules.iter().any(|rule| {
            !valid_tiebreak_rule(rule)
                || enabled_tiebreak_rules.insert(rule.as_str(), ()).is_some()
                || !configured_tiebreak_rules.contains_key(rule.as_str())
        }) {
            return Err(format!("Phase {} の有効な勝利条件が不正です。", index + 1));
        }
        if phase.bracket_type == "ROUND_ROBIN" && phase.enabled_tiebreak_rules.is_empty() {
            return Err(format!(
                "Phase {} の総当たりでは勝利条件を1つ以上有効にしてください。",
                index + 1
            ));
        }
        let smallest_pool = participant_count / phase.pool_count;
        if index + 1 < input.phases.len() {
            if phase.qualifiers_per_pool == 0 || phase.qualifiers_per_pool > smallest_pool {
                return Err(format!(
                    "Phase {} の各プール進出人数は1〜{}で指定してください。",
                    index + 1,
                    smallest_pool
                ));
            }
            participant_count = phase
                .pool_count
                .checked_mul(phase.qualifiers_per_pool)
                .ok_or_else(|| "次フェーズの参加人数が大きすぎます。".to_owned())?;
        } else if phase.qualifiers_per_pool != 0 {
            return Err(format!(
                "最終Phase {} の進出人数は0にしてください。",
                index + 1
            ));
        }
        if phase.third_place_match
            && (index + 1 != input.phases.len() || phase.bracket_type != "SINGLE_ELIMINATION")
        {
            return Err(
                "3位決定戦は最終Phaseのシングルエリミネーションでのみ指定できます。".to_owned(),
            );
        }
        if phase.third_place_match && smallest_pool < 4 {
            return Err("3位決定戦には各プール4人以上が必要です。".to_owned());
        }
        if phase.fifth_place_match
            && (index + 1 != input.phases.len() || phase.bracket_type != "DOUBLE_ELIMINATION")
        {
            return Err(
                "5位決定戦は最終Phaseのダブルエリミネーションでのみ指定できます。".to_owned(),
            );
        }
        if phase.fifth_place_match && smallest_pool < 8 {
            return Err("5位決定戦には各プール8人以上が必要です。".to_owned());
        }
    }
    Ok(())
}

fn validate_registration(input: &CreateLocalEventSnapshotInput) -> Result<(), String> {
    let setting = &input.event_management;
    if setting.item_list_snapshots.len() > 3
        || setting.category_min_counts.len() > 3
        || setting.category_max_counts.len() > 3
        || setting.category_allow_duplicates.len() > 3
        || setting.total_min_count > setting.total_max_count
    {
        return Err("アイテム選択の設定が不正です。".to_owned());
    }
    let mut list_ids = std::collections::HashSet::new();
    for (index, list) in setting.item_list_snapshots.iter().enumerate() {
        if list.id.is_empty() {
            continue;
        }
        let min = setting.category_min_counts.get(index).copied().unwrap_or(0);
        let max = setting.category_max_counts.get(index).copied().unwrap_or(1);
        if (list.id != "__free_text__" && !list_ids.insert(&list.id)) || min > max {
            return Err("カテゴリが重複しているか、件数条件が不正です。".to_owned());
        }
    }
    let mut entrant_ids = std::collections::HashSet::new();
    for participant in &input.participants {
        if participant.name.trim().is_empty()
            || participant.entrant_id.trim().is_empty()
            || !entrant_ids.insert(&participant.entrant_id)
            || participant.category_selections.len() != 3
        {
            return Err("参加者の名前・識別子・アイテム選択が不正です。".to_owned());
        }
        if participant.skill.is_some_and(|skill| skill < 0) {
            return Err(format!(
                "{}: Skill Tierは0以上の整数で入力してください。",
                participant.name
            ));
        }
        let mut total = 0;
        for (index, selections) in participant.category_selections.iter().enumerate() {
            let list = setting.item_list_snapshots.get(index).filter(|list| !list.id.is_empty());
            let Some(list) = list else {
                if !selections.is_empty() {
                    return Err(format!("{}: 未設定カテゴリのアイテムは選択できません。", participant.name));
                }
                continue;
            };
            let min = setting.category_min_counts.get(index).copied().unwrap_or(0) as usize;
            let max = setting.category_max_counts.get(index).copied().unwrap_or(1) as usize;
            let duplicates = setting.category_allow_duplicates.get(index).copied().unwrap_or(false);
            let mut seen = std::collections::HashSet::new();
            if (input.require_item_selections && selections.len() < min) || selections.len() > max
                || selections.iter().any(|item| item.trim().is_empty()
                    || (list.id != "__free_text__" && !list.items.contains(item))
                    || (!duplicates && !seen.insert(item)))
            {
                return Err(format!("{}: カテゴリ{}の選択条件を満たしていません。", participant.name, index + 1));
            }
            total += selections.len();
        }
        if (input.require_item_selections && total < setting.total_min_count as usize) || total > setting.total_max_count as usize {
            return Err(format!("{}: アイテム全体の選択数条件を満たしていません。", participant.name));
        }
    }
    Ok(())
}

fn balanced_indices(length: usize, count: usize) -> Vec<Vec<usize>> {
    let base_size = length / count;
    let extra = length % count;
    let mut start = 0;
    (0..count)
        .map(|group_index| {
            let size = base_size + usize::from(group_index < extra);
            let indices = (start..start + size).collect();
            start += size;
            indices
        })
        .collect()
}

fn snake_indices(length: usize, count: usize) -> Vec<Vec<usize>> {
    let mut groups = vec![Vec::new(); count];
    for index in 0..length {
        let round = index / count;
        let offset = index % count;
        let group = if round % 2 == 0 {
            offset
        } else {
            count - 1 - offset
        };
        groups[group].push(index);
    }
    groups
}

fn qualifier_pool_order(
    placement: usize,
    pool_count: usize,
    snake_bracket_seeds: bool,
) -> Vec<usize> {
    if snake_bracket_seeds {
        let start = if placement % 2 == 0 {
            pool_count / 2
        } else {
            0
        };
        (0..pool_count)
            .map(|offset| (start + offset) % pool_count)
            .collect()
    } else if placement % 2 == 1 {
        (0..pool_count).collect()
    } else {
        (0..pool_count).rev().collect()
    }
}

pub fn generate_local_snapshot(
    input: &CreateLocalEventSnapshotInput,
    tournament_id: &str,
    slug: &str,
    event_id: &str,
) -> Result<TournamentSnapshot, String> {
    validate_input(input)?;
    let mut builder = SnapshotBuilder {
        phases: Vec::new(),
        phase_groups: Vec::new(),
        sets: Vec::new(),
        next_group_id: 1,
        next_seed_id: 1,
        next_set_id: 1,
        next_set_identifier_by_group: HashMap::new(),
        possible_set_outputs: HashMap::new(),
    };

    let has_skill_tiers = input
        .participants
        .iter()
        .any(|participant| participant.skill.is_some());
    let mut ranked_participants = input.participants.iter().enumerate().collect::<Vec<_>>();
    if has_skill_tiers {
        ranked_participants.sort_by(|(left_index, left), (right_index, right)| {
            right
                .skill
                .unwrap_or_default()
                .cmp(&left.skill.unwrap_or_default())
                .then_with(|| left_index.cmp(right_index))
        });
    }
    let mut current_entrants = ranked_participants
        .into_iter()
        .enumerate()
        .map(|(rank, (_, participant))| SeedEntry {
            seed_id: String::new(),
            seed_num: (rank + 1) as i64,
            entrant_id: Some(participant.entrant_id.clone()),
            entrant_name: Some(participant.name.trim().to_owned()),
            placeholder_name: None,
            origin_phase_order: None,
            origin_phase_group_id: None,
            origin_phase_group_display_identifier: None,
            origin_placement: None,
            origin_order: None,
        })
        .collect::<Vec<_>>();

    for (phase_index, config) in input.phases.iter().enumerate() {
        let phase_order = phase_index + 1;
        let phase_id = phase_order.to_string();
        builder.phases.push(PhaseSnapshot {
            phase_id: phase_id.clone(),
            name: Some(config.name.trim().to_owned()),
            phase_order: Some(phase_order as i64),
        });

        let entrant_indices = if phase_index == 0 && has_skill_tiers {
            snake_indices(current_entrants.len(), config.pool_count)
        } else {
            balanced_indices(current_entrants.len(), config.pool_count)
        };
        let mut phase_group_ids = Vec::with_capacity(config.pool_count);
        let mut group_entries = Vec::with_capacity(config.pool_count);
        for (pool_index, indices) in entrant_indices.into_iter().enumerate() {
            let group_id = builder.next_group_id.to_string();
            builder.next_group_id += 1;
            let display_identifier = (pool_index + 1).to_string();
            let group_name = format!("Pool {}", pool_index + 1);
            let mut seeds = Vec::with_capacity(indices.len());
            for (local_index, entrant_index) in indices.into_iter().enumerate() {
                let mut seed = current_entrants[entrant_index].clone();
                seed.seed_id = builder.next_seed_id.to_string();
                builder.next_seed_id += 1;
                seed.seed_num = (local_index + 1) as i64;
                if phase_index > 0 {
                    seed.entrant_id = None;
                    seed.entrant_name = None;
                }
                seeds.push(seed);
            }
            phase_group_ids.push((group_id, display_identifier, group_name));
            group_entries.push(seeds);
        }

        for (pool_index, ((group_id, display_identifier, group_name), seeds)) in
            phase_group_ids.iter().zip(group_entries.iter()).enumerate()
        {
            let progressions_out = if phase_index + 1 < input.phases.len() {
                (1..=config.qualifiers_per_pool)
                    .map(|placement| PhaseGroupProgressionSnapshot {
                        progression_id: format!("{group_id}-place-{placement}"),
                        origin_order: Some(pool_index as i64),
                        origin_phase_id: Some(phase_id.clone()),
                        origin_phase_order: Some(phase_order as i64),
                        origin_phase_group_id: Some(group_id.clone()),
                        origin_phase_group_display_identifier: Some(display_identifier.clone()),
                        origin_placement: Some(placement as i64),
                        placeholder_name: Some(format!("{group_name} #{placement}")),
                    })
                    .collect()
            } else {
                Vec::new()
            };
            builder.phase_groups.push(PhaseGroupSnapshot {
                grand_final_reset: config.grand_final_reset,
                phase_group_id: group_id.clone(),
                set_ids: Vec::new(),
                bracket_type: Some(config.bracket_type.clone()),
                phase_id: Some(phase_id.clone()),
                phase_name: Some(config.name.trim().to_owned()),
                phase_order: Some(phase_order as i64),
                display_identifier: Some(display_identifier.clone()),
                progressions_out,
                seed_map: None,
                seed_order: seeds.iter().map(|seed| seed.seed_id.clone()).collect(),
                seeds: seeds
                    .iter()
                    .map(|seed| PhaseGroupSeedSnapshot {
                        seed_id: seed.seed_id.clone(),
                        progression_id: None,
                        group_seed_num: Some(seed.seed_num),
                        seed_num: Some(seed.seed_num),
                        placement: seed.origin_placement,
                        origin_phase_order: seed.origin_phase_order,
                        origin_phase_group_display_identifier: seed
                            .origin_phase_group_display_identifier
                            .clone(),
                        origin_phase_group_id: seed.origin_phase_group_id.clone(),
                        origin_placement: seed.origin_placement,
                        origin_order: seed.origin_order,
                        entrant_id: seed.entrant_id.clone(),
                        entrant_name: seed.entrant_name.clone(),
                        placeholder_name: seed.placeholder_name.clone(),
                    })
                    .collect(),
                initial_seed_restore_pending: false,
                seed_update_awaiting_started_snapshot: false,
                tiebreak_order: config
                    .tiebreak_order
                    .iter()
                    .filter(|rule| config.enabled_tiebreak_rules.contains(rule))
                    .cloned()
                    .collect(),
            });
        }

        for ((group_id, display_identifier, group_name), seeds) in
            phase_group_ids.iter().zip(group_entries.iter())
        {
            let before = builder.sets.len();
            match config.bracket_type.as_str() {
                "SINGLE_ELIMINATION" => add_single_elimination(
                    &mut builder,
                    config,
                    phase_order,
                    config.name.trim(),
                    group_id,
                    group_name,
                    display_identifier,
                    seeds,
                ),
                "DOUBLE_ELIMINATION" => add_double_elimination(
                    &mut builder,
                    config,
                    phase_order,
                    config.name.trim(),
                    group_id,
                    group_name,
                    display_identifier,
                    seeds,
                ),
                "ROUND_ROBIN" => add_round_robin(
                    &mut builder,
                    phase_order,
                    config.name.trim(),
                    group_id,
                    group_name,
                    display_identifier,
                    seeds,
                ),
                _ => unreachable!("phase formats are validated"),
            }
            let set_ids = builder.sets[before..]
                .iter()
                .map(|set| set.set_id.clone())
                .collect();
            if let Some(phase_group) = builder
                .phase_groups
                .iter_mut()
                .find(|phase_group| phase_group.phase_group_id == *group_id)
            {
                phase_group.set_ids = set_ids;
            }
        }

        if phase_index + 1 < input.phases.len() {
            let mut qualifiers = Vec::<SeedEntry>::new();
            let next_phase = &input.phases[phase_index + 1];
            let snake_bracket_seeds = config.bracket_type == "ROUND_ROBIN"
                && next_phase.pool_count == 1
                && matches!(
                    next_phase.bracket_type.as_str(),
                    "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION"
                );
            for placement in 1..=config.qualifiers_per_pool {
                let pool_order =
                    qualifier_pool_order(placement, config.pool_count, snake_bracket_seeds);
                for pool_index in pool_order {
                    let (group_id, display_identifier, _) = &phase_group_ids[pool_index];
                    qualifiers.push(SeedEntry {
                        seed_id: String::new(),
                        seed_num: 0,
                        entrant_id: None,
                        entrant_name: None,
                        placeholder_name: Some(format!("Pool {} #{}", pool_index + 1, placement)),
                        origin_phase_order: Some(phase_order as i64),
                        origin_phase_group_id: Some(group_id.clone()),
                        origin_phase_group_display_identifier: Some(display_identifier.clone()),
                        origin_placement: Some(placement as i64),
                        origin_order: Some(pool_index as i64),
                    });
                }
            }
            let target_indices =
                balanced_indices(qualifiers.len(), input.phases[phase_index + 1].pool_count);
            let mut generated_seed_num = 1_i64;
            for qualifier in &mut qualifiers {
                qualifier.seed_num = generated_seed_num;
                generated_seed_num += 1;
                qualifier.seed_id = builder.next_seed_id.to_string();
                builder.next_seed_id += 1;
            }
            current_entrants = target_indices
                .into_iter()
                .flat_map(|indices| indices.into_iter().map(|index| qualifiers[index].clone()))
                .collect();
        }
    }

    let event = EventSnapshot {
        entrants: Vec::new(),
        event_id: event_id.to_owned(),
        name: input.event_name.trim().to_owned(),
        phases: builder.phases,
        phase_groups: builder.phase_groups,
        sets: builder.sets,
    };
    Ok(TournamentSnapshot {
        tournament_id: tournament_id.to_owned(),
        slug: slug.to_owned(),
        name: input.tournament_name.trim().to_owned(),
        events: vec![event],
        updated_at: Utc::now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phase(
        bracket_type: &str,
        pool_count: usize,
        qualifiers_per_pool: usize,
    ) -> LocalEventPhaseConfig {
        LocalEventPhaseConfig {
            name: "Phase 1".to_owned(),
            pool_count,
            bracket_type: bracket_type.to_owned(),
            qualifiers_per_pool,
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
        }
    }

    fn input(
        participant_count: usize,
        phases: Vec<LocalEventPhaseConfig>,
    ) -> CreateLocalEventSnapshotInput {
        CreateLocalEventSnapshotInput {
            require_item_selections: true,
            tournament_name: "Local tournament".to_owned(),
            event_name: "Local event".to_owned(),
            overwrite_event_id: None,
            event_alias: None,
            participants: (0..participant_count).map(|index| crate::models::LocalEventParticipantInput {
                entrant_id: format!("entrant-{}", index + 1),
                name: format!("Player {}", index + 1),
                category_selections: vec![Vec::new(); 3],
                skill: None,
            }).collect(),
            event_management: crate::models::EventManagementMeta {
                side_decision_method: "upper_1p".to_owned(),
                item_list_snapshots: Vec::new(), use_alias_name: false,
                category_min_counts: vec![0; 3], category_max_counts: vec![0; 3],
                category_allow_duplicates: vec![false; 3],
                total_min_count: 0, total_max_count: 3,
            },
            phases,
        }
    }

    fn generate(input: &CreateLocalEventSnapshotInput) -> TournamentSnapshot {
        generate_local_snapshot(input, "local-12345678-1", "local-12345678-1", "local-event")
            .expect("valid local event should generate")
    }

    #[test]
    fn alphabetic_set_identifiers_support_multiple_letters() {
        assert_eq!(format_set_identifier(0), "A");
        assert_eq!(format_set_identifier(25), "Z");
        assert_eq!(format_set_identifier(26), "AA");
        assert_eq!(format_set_identifier(701), "ZZ");
        assert_eq!(format_set_identifier(702), "AAA");
    }

    #[test]
    fn grand_final_reset_setting_is_saved_for_each_pool() {
        for enabled in [false, true] {
            let mut config = input(16, vec![phase("DOUBLE_ELIMINATION", 2, 0)]);
            config.phases[0].grand_final_reset = enabled;
            let snapshot = generate(&config);
            assert!(snapshot.events[0].phase_groups.iter().all(|group| group.grand_final_reset == enabled));
        }
        let legacy: LocalEventPhaseConfig = serde_json::from_value(serde_json::json!({
            "name": "Phase 1", "poolCount": 1, "bracketType": "DOUBLE_ELIMINATION"
        })).unwrap();
        assert!(legacy.grand_final_reset);
    }

    #[test]
    fn registered_names_and_ids_are_used_for_seeds_and_slots() {
        for bracket_type in ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"] {
            let mut config = input(5, vec![phase(bracket_type, 1, 0)]);
            config.participants[0].name = "  登録プレイヤー  ".to_owned();
            config.participants[0].entrant_id = "registered-id".to_owned();
            let snapshot = generate(&config);
            let event = &snapshot.events[0];
            let seeds = &event.phase_groups[0].seeds;
            assert_eq!(seeds.len(), 5);
            assert!(seeds.iter().any(|seed| seed.entrant_id.as_deref() == Some("registered-id")
                && seed.entrant_name.as_deref() == Some("登録プレイヤー")));
            assert!(event.sets.iter().flat_map(|set| &set.slots).any(|slot|
                slot.entrant_id.as_deref() == Some("registered-id") && slot.entrant_name == "登録プレイヤー"));
        }
    }

    #[test]
    fn skill_tiers_seed_the_bracket_and_assign_byes_to_the_highest_seeds() {
        let mut config = input(5, vec![phase("SINGLE_ELIMINATION", 1, 0)]);
        for (index, skill) in [1, 5, 4, 3, 2].into_iter().enumerate() {
            config.participants[index].skill = Some(skill);
        }

        let snapshot = generate(&config);
        let event = &snapshot.events[0];
        let seed_by_entrant = event.phase_groups[0]
            .seeds
            .iter()
            .map(|seed| (seed.entrant_id.as_deref().unwrap(), seed.seed_num.unwrap()))
            .collect::<HashMap<_, _>>();
        assert_eq!(seed_by_entrant["entrant-2"], 1);
        assert_eq!(seed_by_entrant["entrant-3"], 2);
        assert_eq!(seed_by_entrant["entrant-4"], 3);
        assert_eq!(seed_by_entrant["entrant-5"], 4);
        assert_eq!(seed_by_entrant["entrant-1"], 5);

        let bye_winners = event.sets.iter()
            .filter(|set| set.round == Some(1) && set.is_bye)
            .filter_map(|set| set.winner_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(bye_winners.len(), 3);
        assert!(bye_winners.iter().all(|entrant_id| {
            matches!(*entrant_id, "entrant-2" | "entrant-3" | "entrant-4")
        }));
    }

    #[test]
    fn five_player_double_elimination_omits_empty_losers_branches() {
        let mut config = input(5, vec![phase("DOUBLE_ELIMINATION", 1, 0)]);
        for (index, participant) in config.participants.iter_mut().enumerate() {
            participant.skill = Some((index + 1) as i64);
        }

        let snapshot = generate(&config);
        let event = &snapshot.events[0];
        assert_eq!(event.sets.len(), 11);
        assert!(event.sets.iter().all(|set| {
            set.entrant1_source.is_some() || set.entrant2_source.is_some()
        }));

        let losers_round_one = event
            .sets
            .iter()
            .filter(|set| set.round == Some(-1))
            .collect::<Vec<_>>();
        let losers_round_two = event
            .sets
            .iter()
            .filter(|set| set.round == Some(-2))
            .collect::<Vec<_>>();
        assert_eq!(losers_round_one.len(), 1);
        assert_eq!(losers_round_two.len(), 1);

        let winners_semifinal_ids = event
            .sets
            .iter()
            .filter(|set| set.round == Some(2))
            .map(|set| set.set_id.as_str())
            .collect::<Vec<_>>();
        let first_losers_match = losers_round_one
            .iter()
            .find(|set| {
                set.entrant1_source.is_some()
                    && set.entrant2_source.is_some()
                    && [set.entrant1_source.as_ref(), set.entrant2_source.as_ref()]
                        .into_iter()
                        .flatten()
                        .all(|source| source.condition.as_deref() == Some("loser"))
            })
            .expect("the losers first round should pair the first-round and bye-match losers");
        let first_round_ids = event
            .sets
            .iter()
            .filter(|set| set.round == Some(1))
            .map(|set| set.set_id.as_str())
            .collect::<Vec<_>>();
        let first_round_loser = [
            first_losers_match.entrant1_source.as_ref(),
            first_losers_match.entrant2_source.as_ref(),
        ]
        .into_iter()
        .flatten()
        .find(|source| {
            source
                .type_id
                .as_deref()
                .is_some_and(|source_id| first_round_ids.contains(&source_id))
        })
        .expect("the losers first round should receive a winners round-one loser");
        assert_eq!(first_round_loser.condition.as_deref(), Some("loser"));
        let dropped_winners_round_two_loser = [
            first_losers_match.entrant1_source.as_ref(),
            first_losers_match.entrant2_source.as_ref(),
        ]
        .into_iter()
        .flatten()
        .find(|source| {
            source
                .type_id
                .as_deref()
                .is_some_and(|source_id| winners_semifinal_ids.contains(&source_id))
        })
        .expect("the losers first round should receive a winners round-two loser");
        assert_eq!(
            dropped_winners_round_two_loser.condition.as_deref(),
            Some("loser")
        );

        let lower_round_two_loser_ids = losers_round_two
            .iter()
            .flat_map(|set| [&set.entrant1_source, &set.entrant2_source])
            .flatten()
            .filter(|source| source.condition.as_deref() == Some("loser"))
            .filter_map(|source| source.type_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(lower_round_two_loser_ids, [winners_semifinal_ids[0]]);
        let round_two_match = losers_round_two
            .iter()
            .find(|set| !set.is_bye)
            .expect("losers round two should retain the merge match");
        let round_two_sources = [
            round_two_match.entrant1_source.as_ref(),
            round_two_match.entrant2_source.as_ref(),
        ];
        assert!(round_two_sources.iter().flatten().any(|source| {
            source.type_id.as_deref() == Some(first_losers_match.set_id.as_str())
                && source.condition.as_deref() == Some("winner")
        }));
        assert!(round_two_sources.iter().flatten().any(|source| {
            source.type_id.as_deref() == Some(winners_semifinal_ids[0])
                && source.condition.as_deref() == Some("loser")
        }));
        let playable_losers_rounds = event
            .sets
            .iter()
            .filter(|set| !set.is_bye && set.round.is_some_and(|round| round < 0))
            .map(|set| set.round.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(playable_losers_rounds, [-1, -2, -3]);
        let losers_final = event
            .sets
            .iter()
            .find(|set| set.full_round_text == "Losers Final")
            .expect("the bracket should have a losers final");
        assert_eq!(losers_final.round, Some(-3));
        let winners_final = event
            .sets
            .iter()
            .find(|set| set.round == Some(3))
            .expect("the bracket should have a winners round-three final");
        let final_sources = [
            losers_final.entrant1_source.as_ref(),
            losers_final.entrant2_source.as_ref(),
        ];
        assert!(final_sources.iter().flatten().any(|source| {
            source.type_id.as_deref() == Some(round_two_match.set_id.as_str())
                && source.condition.as_deref() == Some("winner")
        }));
        assert!(final_sources.iter().flatten().any(|source| {
            source.type_id.as_deref() == Some(winners_final.set_id.as_str())
                && source.condition.as_deref() == Some("loser")
        }));
    }

    #[test]
    fn seven_player_double_elimination_pairs_odd_first_round_loser_with_bye() {
        let snapshot = generate(&input(7, vec![phase("DOUBLE_ELIMINATION", 1, 0)]));
        let losers_round_one = snapshot.events[0]
            .sets
            .iter()
            .filter(|set| set.round == Some(-1))
            .collect::<Vec<_>>();

        assert_eq!(losers_round_one.len(), 2);
        assert_eq!(losers_round_one.iter().filter(|set| set.is_bye).count(), 1);
        assert_eq!(losers_round_one.iter().filter(|set| !set.is_bye).count(), 1);
    }

    #[test]
    fn thirty_one_player_losers_round_four_merges_winners_and_losers_in_forward_order() {
        let snapshot = generate(&input(31, vec![phase("DOUBLE_ELIMINATION", 1, 0)]));
        let event = &snapshot.events[0];
        let sets_for_round = |round| {
            event
                .sets
                .iter()
                .filter(|set| set.round == Some(round))
                .collect::<Vec<_>>()
        };
        let winners_round_three = sets_for_round(3);
        let losers_round_three = sets_for_round(-3);
        let losers_round_four = sets_for_round(-4);

        assert_eq!(
            winners_round_three
                .iter()
                .map(|set| set.identifier.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ["X", "Y", "Z", "AA"],
        );
        assert_eq!(
            losers_round_three
                .iter()
                .map(|set| set.identifier.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ["AT", "AU", "AV", "AW"],
        );
        assert_eq!(losers_round_four.len(), 4);

        for (index, set) in losers_round_four.iter().enumerate() {
            let sources = [&set.entrant1_source, &set.entrant2_source];
            assert!(
                sources.into_iter().flatten().any(|source| {
                    source.type_id.as_deref() == Some(losers_round_three[index].set_id.as_str())
                        && source.condition.as_deref() == Some("winner")
                }),
                "Losers Round 4 should pair with the winner of Losers Round 3 index {index}"
            );
            assert!(
                sources.into_iter().flatten().any(|source| {
                    source.type_id.as_deref() == Some(winners_round_three[index].set_id.as_str())
                        && source.condition.as_deref() == Some("loser")
                }),
                "Losers Round 4 should receive the loser of Winners Round 3 index {index}"
            );
        }
    }

    #[test]
    fn redirected_losers_round_one_winners_merge_with_remaining_winners_round_two_losers() {
        for count in 3..=64 {
            let snapshot = generate(&input(count, vec![phase("DOUBLE_ELIMINATION", 1, 0)]));
            let event = &snapshot.events[0];
            let winners_round_two_ids = event
                .sets
                .iter()
                .filter(|set| set.round == Some(2))
                .map(|set| set.set_id.as_str())
                .collect::<Vec<_>>();
            for first_round in event.sets.iter().filter(|set| set.round == Some(-1)) {
                let has_redirected_loser = [
                    first_round.entrant1_source.as_ref(),
                    first_round.entrant2_source.as_ref(),
                ]
                .into_iter()
                .flatten()
                .any(|source| {
                    source.condition.as_deref() == Some("loser")
                        && source
                            .type_id
                            .as_deref()
                            .is_some_and(|id| winners_round_two_ids.contains(&id))
                });
                if !has_redirected_loser {
                    continue;
                }
                let next_matches = event
                    .sets
                    .iter()
                    .filter(|set| {
                        [set.entrant1_source.as_ref(), set.entrant2_source.as_ref()]
                            .into_iter()
                            .flatten()
                            .any(|source| {
                                source.type_id.as_deref() == Some(first_round.set_id.as_str())
                                    && source.condition.as_deref() == Some("winner")
                            })
                    })
                    .collect::<Vec<_>>();
                assert_eq!(next_matches.len(), 1, "{count} entrants");
                let merge = next_matches[0];
                assert_eq!(merge.round, Some(-2), "{count} entrants");
                assert!(!merge.is_bye, "{count} entrants");
                let remaining_loser = [
                    merge.entrant1_source.as_ref(),
                    merge.entrant2_source.as_ref(),
                ]
                .into_iter()
                .flatten()
                .find(|source| source.condition.as_deref() == Some("loser"))
                .expect("the merge match should receive a winners round-two loser");
                let remaining_source_id = remaining_loser.type_id.as_deref().unwrap();
                assert!(winners_round_two_ids.contains(&remaining_source_id));
                let loser_targets = event
                    .sets
                    .iter()
                    .flat_map(|set| [&set.entrant1_source, &set.entrant2_source])
                    .flatten()
                    .filter(|source| {
                        source.condition.as_deref() == Some("loser")
                            && source.type_id.as_deref() == Some(remaining_source_id)
                    })
                    .count();
                assert_eq!(loser_targets, 1, "{count} entrants");
            }
            assert_eq!(
                event.sets.iter().filter(|set| !set.is_bye).count(),
                count * 2 - 2,
                "{count} entrants"
            );
        }
    }

    #[test]
    fn skill_tiers_are_snake_distributed_across_initial_pools() {
        let mut config = input(8, vec![phase("ROUND_ROBIN", 4, 0)]);
        for (index, participant) in config.participants.iter_mut().enumerate() {
            participant.skill = Some((8 - index) as i64);
        }

        let snapshot = generate(&config);
        let entrant_ids_by_pool = snapshot.events[0].phase_groups.iter()
            .map(|group| group.seeds.iter()
                .filter_map(|seed| seed.entrant_id.as_deref())
                .collect::<Vec<_>>())
            .collect::<Vec<_>>();
        assert_eq!(entrant_ids_by_pool, vec![
            vec!["entrant-1", "entrant-8"],
            vec!["entrant-2", "entrant-7"],
            vec!["entrant-3", "entrant-6"],
            vec!["entrant-4", "entrant-5"],
        ]);
    }

    #[test]
    fn skill_tiers_keep_the_highest_seeds_apart_in_the_opening_round() {
        let mut config = input(8, vec![phase("SINGLE_ELIMINATION", 1, 0)]);
        for (index, participant) in config.participants.iter_mut().enumerate() {
            participant.skill = Some((8 - index) as i64);
        }

        let snapshot = generate(&config);
        let opening_matchups = snapshot.events[0].sets.iter()
            .filter(|set| set.round == Some(1) && !set.is_bye)
            .map(|set| set.slots.iter()
                .filter_map(|slot| slot.entrant_id.as_deref())
                .collect::<Vec<_>>())
            .collect::<Vec<_>>();
        assert_eq!(opening_matchups, vec![
            vec!["entrant-1", "entrant-8"],
            vec!["entrant-4", "entrant-5"],
            vec!["entrant-2", "entrant-7"],
            vec!["entrant-3", "entrant-6"],
        ]);
    }

    #[test]
    fn registration_rejects_empty_names_duplicate_ids_and_invalid_item_choices() {
        let valid = input(2, vec![phase("SINGLE_ELIMINATION", 1, 0)]);
        let mut empty_name = valid.clone();
        empty_name.participants[0].name = " ".to_owned();
        assert!(validate_input(&empty_name).is_err());
        let mut duplicate_id = valid.clone();
        duplicate_id.participants[1].entrant_id = duplicate_id.participants[0].entrant_id.clone();
        assert!(validate_input(&duplicate_id).is_err());
        let mut unknown_item = valid.clone();
        unknown_item.participants[0].category_selections[0].push("Unknown".to_owned());
        assert!(validate_input(&unknown_item).is_err());
        let mut empty = valid;
        empty.participants.clear();
        assert!(validate_input(&empty).is_err());
    }

    #[test]
    fn registration_validates_category_and_total_counts_and_allowed_duplicates() {
        let mut config = input(2, vec![phase("SINGLE_ELIMINATION", 1, 0)]);
        config.event_management.item_list_snapshots = vec![crate::models::ItemListConfig {
            id: "characters".to_owned(), name: "Characters".to_owned(),
            category_name: "Character".to_owned(), items: vec!["A".to_owned(), "B".to_owned()],
        }];
        config.event_management.category_min_counts[0] = 1;
        config.event_management.category_max_counts[0] = 2;
        config.event_management.total_min_count = 1;
        config.event_management.total_max_count = 2;
        assert!(validate_input(&config).is_err());
        for player in &mut config.participants {
            player.category_selections[0] = vec!["A".to_owned()];
        }
        assert!(validate_input(&config).is_ok());
        config.participants[0].category_selections[0].push("A".to_owned());
        assert!(validate_input(&config).is_err());
        config.event_management.category_allow_duplicates[0] = true;
        assert!(validate_input(&config).is_ok());
        config.event_management.total_max_count = 1;
        assert!(validate_input(&config).is_err());
        config.event_management.total_max_count = 3;
        config.participants[0].category_selections[0].push("B".to_owned());
        assert!(validate_input(&config).is_err());
    }

    #[test]
    fn registration_only_requires_minimum_item_counts_when_enabled() {
        let mut config = input(2, vec![phase("SINGLE_ELIMINATION", 1, 0)]);
        config.event_management.item_list_snapshots = vec![crate::models::ItemListConfig {
            id: "characters".to_owned(), name: "Characters".to_owned(),
            category_name: "Character".to_owned(), items: vec!["A".to_owned(), "B".to_owned()],
        }];
        config.event_management.category_min_counts[0] = 2;
        config.event_management.category_max_counts[0] = 2;
        config.event_management.total_min_count = 2;
        config.event_management.total_max_count = 2;
        config.participants[0].category_selections[0] = vec!["A".to_owned()];
        assert!(validate_input(&config).is_err());
        config.require_item_selections = false;
        let snapshot = generate(&config);
        assert_eq!(snapshot.events[0].phase_groups[0].seeds.len(), 2);
        config.participants[0].category_selections[0] = vec!["A".to_owned(), "A".to_owned()];
        assert!(validate_input(&config).is_err());
        config.participants[0].category_selections[0] = vec!["unknown".to_owned()];
        assert!(validate_input(&config).is_err());
        config.participants[0].category_selections[0] = vec!["A".to_owned(), "B".to_owned()];
        config.event_management.total_max_count = 1;
        config.event_management.total_min_count = 0;
        assert!(validate_input(&config).is_err());
    }

    #[test]
    fn registration_accepts_multiple_free_text_categories_without_list_items() {
        let mut config = input(2, vec![phase("SINGLE_ELIMINATION", 1, 0)]);
        config.event_management.item_list_snapshots = (0..3).map(|index| crate::models::ItemListConfig {
            id: "__free_text__".to_owned(), name: "Free text".to_owned(),
            category_name: format!("Category {}", index + 1), items: Vec::new(),
        }).collect();
        config.event_management.category_max_counts = vec![1, 1, 1];
        config.event_management.total_max_count = 3;
        config.participants[0].category_selections = vec![vec!["Alpha / Beta".to_owned()], Vec::new(), vec!["Gamma".to_owned()]];
        assert!(validate_input(&config).is_ok());
        config.participants[0].category_selections[0].push("Excess".to_owned());
        assert!(validate_input(&config).is_err());
        config.participants[0].category_selections[0] = vec![" ".to_owned()];
        assert!(validate_input(&config).is_err());
    }

    #[test]
    fn set_identifiers_are_sequential_within_each_phase_group() {
        let snapshot = generate(&input(
            124,
            vec![
                phase("DOUBLE_ELIMINATION", 4, 2),
                phase("DOUBLE_ELIMINATION", 1, 0),
            ],
        ));
        let event = &snapshot.events[0];
        for group in &event.phase_groups {
            let identifiers = event
                .sets
                .iter()
                .filter(|set| set.phase_group_id.as_deref() == Some(&group.phase_group_id))
                .filter(|set| !set.is_bye)
                .map(|set| set.identifier.as_deref().unwrap())
                .collect::<Vec<_>>();
            let expected = (0..identifiers.len())
                .map(format_set_identifier)
                .collect::<Vec<_>>();
            assert_eq!(
                identifiers,
                expected.iter().map(String::as_str).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn only_potentially_playable_sets_receive_identifiers() {
        for bracket_type in ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"] {
            for count in [3, 5, 6, 7, 8, 9, 12, 16, 31] {
                let snapshot = generate(&input(count, vec![phase(bracket_type, 1, 0)]));
                let event = &snapshot.events[0];
                let playable = event.sets.iter().filter(|set| !set.is_bye).collect::<Vec<_>>();
                let expected_count = match bracket_type {
                    "SINGLE_ELIMINATION" => count - 1,
                    "DOUBLE_ELIMINATION" => count * 2 - 2,
                    _ => count * (count - 1) / 2,
                };
                assert_eq!(playable.len(), expected_count, "{bracket_type}, {count}");
                assert!(event.sets.iter().filter(|set| set.is_bye).all(|set| set.identifier.is_none()));
                for (index, set) in playable.iter().enumerate() {
                    assert_eq!(set.identifier.as_deref(), Some(format_set_identifier(index).as_str()));
                }
            }
        }
    }

    #[test]
    fn distributes_odd_player_counts_evenly_between_pools() {
        let snapshot = generate(&input(
            124,
            vec![
                phase("DOUBLE_ELIMINATION", 4, 2),
                phase("DOUBLE_ELIMINATION", 1, 0),
            ],
        ));
        let event = &snapshot.events[0];
        let pool_sizes = event
            .phase_groups
            .iter()
            .filter(|group| group.phase_order == Some(1))
            .map(|group| group.seeds.len())
            .collect::<Vec<_>>();

        assert_eq!(pool_sizes, [31, 31, 31, 31]);
        assert_eq!(event.phase_groups.len(), 5);
        for group in event
            .phase_groups
            .iter()
            .filter(|group| group.phase_order == Some(1))
        {
            let seed_numbers = group
                .seeds
                .iter()
                .map(|seed| seed.group_seed_num.unwrap())
                .collect::<Vec<_>>();
            assert_eq!(seed_numbers, (1..=31).collect::<Vec<_>>());
            assert_eq!(
                event
                    .sets
                    .iter()
                    .filter(|set| {
                        set.phase_group_id.as_deref() == Some(group.phase_group_id.as_str())
                            && set.is_bye
                            && set.round == Some(1)
                    })
                    .count(),
                1
            );
            assert_eq!(
                event
                    .sets
                    .iter()
                    .filter(|set| {
                        set.phase_group_id.as_deref() == Some(group.phase_group_id.as_str())
                            && set.is_bye
                            && set.round == Some(-1)
                    })
                    .count(),
                1
            );
        }
    }

    #[test]
    fn round_robin_qualifiers_are_snake_seeded_into_elimination_brackets() {
        for bracket_type in ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION"] {
            let snapshot = generate(&input(
                16,
                vec![phase("ROUND_ROBIN", 4, 2), phase(bracket_type, 1, 0)],
            ));
            let event = &snapshot.events[0];
            let final_group = event
                .phase_groups
                .iter()
                .find(|group| group.phase_order == Some(2))
                .expect("final phase group should exist");
            let seed_names = final_group
                .seeds
                .iter()
                .map(|seed| seed.placeholder_name.as_deref().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                seed_names,
                [
                    "Pool 1 #1",
                    "Pool 2 #1",
                    "Pool 3 #1",
                    "Pool 4 #1",
                    "Pool 3 #2",
                    "Pool 4 #2",
                    "Pool 1 #2",
                    "Pool 2 #2",
                ]
            );

            let first_round_matchups = event
                .sets
                .iter()
                .filter(|set| set.phase_order == Some(2) && set.round == Some(1))
                .map(|set| {
                    (
                        set.entrant1_source
                            .as_ref()
                            .and_then(|source| source.placeholder_name.as_deref())
                            .unwrap(),
                        set.entrant2_source
                            .as_ref()
                            .and_then(|source| source.placeholder_name.as_deref())
                            .unwrap(),
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(
                first_round_matchups,
                [
                    ("Pool 1 #1", "Pool 2 #2"),
                    ("Pool 4 #1", "Pool 3 #2"),
                    ("Pool 2 #1", "Pool 1 #2"),
                    ("Pool 3 #1", "Pool 4 #2"),
                ]
            );
        }
    }

    #[test]
    fn round_robin_qualifiers_preserve_rank_then_snake_pool_order() {
        let snapshot = generate(&input(
            16,
            vec![phase("ROUND_ROBIN", 4, 2), phase("ROUND_ROBIN", 1, 0)],
        ));
        let final_group = snapshot.events[0]
            .phase_groups
            .iter()
            .find(|group| group.phase_order == Some(2))
            .expect("final phase group should exist");
        let qualifier_order = final_group
            .seeds
            .iter()
            .map(|seed| seed.placeholder_name.as_deref().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            qualifier_order,
            [
                "Pool 1 #1",
                "Pool 2 #1",
                "Pool 3 #1",
                "Pool 4 #1",
                "Pool 4 #2",
                "Pool 3 #2",
                "Pool 2 #2",
                "Pool 1 #2",
            ]
        );
    }

    #[test]
    fn creates_bye_advances_without_a_playable_opponent() {
        let snapshot = generate(&input(31, vec![phase("DOUBLE_ELIMINATION", 1, 0)]));
        let event = &snapshot.events[0];
        let winner_byes = event
            .sets
            .iter()
            .filter(|set| set.is_bye && set.winner_id.is_some())
            .collect::<Vec<_>>();

        assert!(!winner_byes.is_empty());
        assert!(winner_byes.iter().all(|set| {
            set.state == 3
                && set
                    .slots
                    .iter()
                    .filter(|slot| slot.entrant_id.is_some())
                    .count()
                    == 1
        }));
        assert_eq!(
            event
                .sets
                .iter()
                .filter(|set| set.is_bye && set.round == Some(-1))
                .count(),
            1
        );
    }

    #[test]
    fn round_robin_never_records_a_bye_as_a_match() {
        let snapshot = generate(&input(7, vec![phase("ROUND_ROBIN", 1, 0)]));
        let event = &snapshot.events[0];

        assert_eq!(event.sets.len(), 21);
        assert!(event.sets.iter().all(|set| !set.is_bye));
        assert!(event
            .sets
            .iter()
            .all(|set| set.slots.iter().all(|slot| slot.entrant_id.is_some())));
    }

    #[test]
    fn round_robin_tiebreak_priority_is_saved_in_pool_metadata() {
        let mut round_robin = phase("ROUND_ROBIN", 1, 0);
        round_robin.tiebreak_order = vec![
            "GAME_RATIO".to_owned(),
            "TOTAL_SETS_WON".to_owned(),
            "HEAD_TO_HEAD".to_owned(),
        ];
        round_robin.enabled_tiebreak_rules =
            vec!["GAME_RATIO".to_owned(), "HEAD_TO_HEAD".to_owned()];
        let snapshot = generate(&input(4, vec![round_robin]));

        assert_eq!(
            snapshot.events[0].phase_groups[0].tiebreak_order,
            ["GAME_RATIO", "HEAD_TO_HEAD"]
        );
    }

    #[test]
    fn round_robin_requires_at_least_one_enabled_tiebreak_rule() {
        let mut round_robin = phase("ROUND_ROBIN", 1, 0);
        round_robin.enabled_tiebreak_rules.clear();

        assert!(generate_local_snapshot(
            &input(4, vec![round_robin]),
            "tournament",
            "slug",
            "event",
        )
        .is_err());
    }

    #[test]
    fn rejects_unsupported_round_robin_tiebreak_priority() {
        let mut round_robin = phase("ROUND_ROBIN", 1, 0);
        round_robin.tiebreak_order = vec!["GAME_WINS".to_owned()];

        assert!(generate_local_snapshot(
            &input(4, vec![round_robin]),
            "tournament",
            "slug",
            "event",
        )
        .is_err());
    }

    #[test]
    fn rejects_pools_that_cannot_have_two_players() {
        assert!(generate_local_snapshot(
            &input(7, vec![phase("ROUND_ROBIN", 4, 0)]),
            "tournament",
            "slug",
            "event",
        )
        .is_err());
    }
}
