use super::round_robin_game_score_for_tiebreak;

#[test]
fn counts_disqualification_score_as_zero_games() {
    assert_eq!(round_robin_game_score_for_tiebreak(-1.0), 0.0);
    assert_eq!(round_robin_game_score_for_tiebreak(0.0), 0.0);
    assert_eq!(round_robin_game_score_for_tiebreak(2.0), 2.0);
}
