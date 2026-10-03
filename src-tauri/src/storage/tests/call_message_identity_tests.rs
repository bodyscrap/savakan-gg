use super::{collect_duplicate_unresolved_call_roots, CallMessageIdentity};
use crate::models::GenericMessage;
use serde_json::json;

fn call_root(
    message_id: &str,
    thread_id: &str,
    event_id: &str,
    set_id: &str,
    player_id: &str,
) -> GenericMessage {
    GenericMessage {
        message_id: message_id.to_owned(),
        thread_id: thread_id.to_owned(),
        parent_message_id: None,
        message_type: "normal".to_owned(),
        message_meta: Some(json!({
            "eventId": event_id,
            "setId": set_id,
            "playerId": player_id,
        })),
        method: "call_player".to_owned(),
        subject: "Call".to_owned(),
        sender_name: "Sender".to_owned(),
        sender_user_id: "12345678".to_owned(),
        sender_ip: "192.168.1.10".to_owned(),
        body: "Call".to_owned(),
        created_at: "2026-10-03T00:00:00Z".to_owned(),
    }
}

#[test]
fn duplicate_recall_closes_only_unresolved_roots_with_the_same_event_set_and_player() {
    let roots = vec![
        call_root("same-1", "same-thread-1", "event-1", "set-1", "PG-PLAYER"),
        call_root("same-2", "same-thread-2", "event-1", "set-1", "pg-player"),
        call_root(
            "other-event",
            "event-thread",
            "event-2",
            "set-1",
            "PG-PLAYER",
        ),
        call_root("other-set", "set-thread", "event-1", "set-2", "PG-PLAYER"),
        call_root(
            "other-player",
            "player-thread",
            "event-1",
            "set-1",
            "PG-OTHER",
        ),
        call_root(
            "already-resolved",
            "resolved-thread",
            "event-1",
            "set-1",
            "PG-PLAYER",
        ),
    ];
    let mut messages = roots;
    messages.push(GenericMessage {
        message_id: "resolved".to_owned(),
        thread_id: "resolved-thread".to_owned(),
        parent_message_id: Some("already-resolved".to_owned()),
        message_type: "resolve".to_owned(),
        message_meta: None,
        method: "call_player".to_owned(),
        subject: "Resolved".to_owned(),
        sender_name: "Sender".to_owned(),
        sender_user_id: "12345678".to_owned(),
        sender_ip: "192.168.1.10".to_owned(),
        body: "Resolved".to_owned(),
        created_at: "2026-10-03T00:00:01Z".to_owned(),
    });

    let duplicate_roots = collect_duplicate_unresolved_call_roots(
        &messages,
        &CallMessageIdentity {
            event_id: "event-1".to_owned(),
            set_id: "set-1".to_owned(),
            player_id: "PG-PLAYER".to_owned(),
        },
    );

    assert_eq!(
        duplicate_roots
            .iter()
            .map(|root| root.message_id.as_str())
            .collect::<Vec<_>>(),
        vec!["same-1", "same-2"],
    );
}
