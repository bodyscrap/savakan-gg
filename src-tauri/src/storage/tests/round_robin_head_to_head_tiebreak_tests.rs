use super::round_robin_tiebreak_head_to_head_points;
use std::collections::HashMap;

#[test]
fn head_to_head_only_counts_entrants_tied_by_preceding_rules() {
    let entrants = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
    let wins = HashMap::from([
        ("a".to_owned(), 2),
        ("b".to_owned(), 2),
        ("c".to_owned(), 3),
    ]);
    let head_to_head = HashMap::from([
        (("a".to_owned(), "c".to_owned()), 10),
        (("b".to_owned(), "a".to_owned()), 1),
    ]);
    let points = round_robin_tiebreak_head_to_head_points(
        &entrants,
        &["SET_WINS".to_owned(), "HEAD_TO_HEAD".to_owned()],
        &wins,
        &HashMap::new(),
        &HashMap::new(),
        &head_to_head,
    );

    assert_eq!(points.get("a"), Some(&0));
    assert_eq!(points.get("b"), Some(&1));
    assert_eq!(points.get("c"), Some(&0));
}
