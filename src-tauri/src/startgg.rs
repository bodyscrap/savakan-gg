use chrono::Utc;
use graphql_client::{GraphQLQuery, Response};
use reqwest::Client;
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use tokio::time::sleep;

use crate::models::{
    EventSnapshot, PhaseGroupProgressionSnapshot, PhaseGroupSeedSnapshot, PhaseGroupSnapshot,
    PhaseSnapshot, SetEntrantSourceSnapshot, SetSlotSnapshot, SetSnapshot,
    TournamentEventPreviewItem, TournamentPreview, TournamentSnapshot,
};

const START_GG_GQL_ENDPOINT: &str = "https://api.start.gg/gql/alpha";
const START_GG_RETRY_ATTEMPTS: usize = 8;
const START_GG_RETRY_BASE_DELAY_MS: u64 = 500;
const START_GG_RETRY_MAX_DELAY_MS: u64 = 10_000;
const START_GG_REQUEST_INTERVAL_MS: u64 = 120;
const START_GG_SET_ENTRANT_RETRY_ATTEMPTS: usize = 6;
const START_GG_SET_ENTRANT_RETRY_DELAY_MS: u64 = 350;

pub const SUPPORTED_BRACKET_TYPES: &[&str] =
    &["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"];

fn bracket_type_name<T: std::fmt::Debug>(bracket_type: T) -> String {
    format!("{bracket_type:?}").to_ascii_uppercase()
}

fn parse_tiebreak_order(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|rule| rule.get("type").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

pub fn is_supported_bracket_type(bracket_type: &str) -> bool {
    SUPPORTED_BRACKET_TYPES
        .iter()
        .any(|supported| *supported == bracket_type)
}

pub fn event_has_only_supported_bracket_types(event: &EventSnapshot) -> bool {
    !event.phase_groups.is_empty()
        && event.phase_groups.iter().all(|group| {
            group
                .bracket_type
                .as_deref()
                .is_some_and(is_supported_bracket_type)
        })
}

#[derive(Debug, Clone)]
pub struct EventSnapshotFetchProgress {
    pub phase: &'static str,
    pub completed_requests: usize,
    pub total_requests: Option<usize>,
    pub current_page: Option<i64>,
    pub current_set_id: Option<String>,
    pub total_planned_set_requests: Option<usize>,
}

fn should_include_event_snapshot_set(
    is_visible_set: bool,
    phase_group_id: Option<&str>,
    event_phase_group_ids: &HashSet<String>,
) -> bool {
    is_visible_set
        || phase_group_id
            .is_some_and(|phase_group_id| event_phase_group_ids.contains(phase_group_id))
}

#[cfg(test)]
mod event_snapshot_scope_tests {
    use super::*;

    #[test]
    fn excludes_indirect_sets_from_other_events() {
        let event_phase_group_ids = HashSet::from(["target-group".to_owned()]);

        assert!(should_include_event_snapshot_set(
            true,
            Some("other-group"),
            &event_phase_group_ids
        ));
        assert!(should_include_event_snapshot_set(
            false,
            Some("target-group"),
            &event_phase_group_ids
        ));
        assert!(!should_include_event_snapshot_set(
            false,
            Some("other-group"),
            &event_phase_group_ids
        ));
        assert!(!should_include_event_snapshot_set(
            false,
            None,
            &event_phase_group_ids
        ));
    }
}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/tournament_sync.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct TournamentSync;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/report_set_result.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct ReportSetResult;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/set_for_report.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct SetForReport;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/set_snapshot_detail.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct SetSnapshotDetail;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/seed_snapshot.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct SeedSnapshot;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/reset_set.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct ResetSet;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/event_sync.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct EventSync;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/graphql/schema.graphql",
    query_path = "src/graphql/tournament_preview.graphql",
    response_derives = "Debug, Clone",
    custom_scalars_module = "crate::startgg_scalars"
)]
pub struct TournamentPreviewQuery;

fn join_graphql_errors(errors: &[graphql_client::Error]) -> String {
    errors
        .iter()
        .map(|e| e.message.clone())
        .collect::<Vec<String>>()
        .join(" | ")
}

fn is_complexity_too_high(errors: &[graphql_client::Error]) -> bool {
    errors.iter().any(|error| {
        let message = error.message.to_ascii_lowercase();
        message.contains("complexity") && message.contains("maximum of 1000")
    })
}

fn summarize_response_body(raw: &str) -> String {
    const LIMIT: usize = 600;
    let normalized = raw.replace('\n', " ").replace('\r', " ");
    if normalized.len() <= LIMIT {
        normalized
    } else {
        format!("{}...", &normalized[..LIMIT])
    }
}

fn is_preview_set_id(set_id: &str) -> bool {
    set_id.starts_with("preview_")
}

fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    ) || status.as_u16() == 520
}

fn parse_retry_after_seconds(response: &reqwest::Response) -> Option<u64> {
    let value = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();

    value.parse::<u64>().ok()
}

fn retry_delay_for_attempt(attempt: usize, retry_after_seconds: Option<u64>) -> Duration {
    let shift = (attempt as u32).min(6);
    let exponential = START_GG_RETRY_BASE_DELAY_MS.saturating_mul(1_u64 << shift);
    let mut wait_ms = exponential.min(START_GG_RETRY_MAX_DELAY_MS);

    if let Some(seconds) = retry_after_seconds {
        let retry_after_ms = seconds.saturating_mul(1_000);
        wait_ms = wait_ms.max(retry_after_ms.min(START_GG_RETRY_MAX_DELAY_MS));
    }

    let jitter_ms = ((attempt as u64 + 1) * 137) % 250;
    Duration::from_millis(wait_ms.saturating_add(jitter_ms))
}

async fn post_graphql_with_retry<T: Serialize + ?Sized>(
    client: &Client,
    token: &str,
    body: &T,
    operation_name: &str,
) -> Result<reqwest::Response, String> {
    for attempt in 0..START_GG_RETRY_ATTEMPTS {
        match client
            .post(START_GG_GQL_ENDPOINT)
            .bearer_auth(token)
            .header("Client-Version", "20")
            .json(body)
            .send()
            .await
        {
            Ok(response) => {
                if is_retryable_status(response.status()) && attempt + 1 < START_GG_RETRY_ATTEMPTS {
                    let retry_after_seconds = parse_retry_after_seconds(&response);
                    let wait = retry_delay_for_attempt(attempt, retry_after_seconds);
                    sleep(wait).await;
                    continue;
                }
                return Ok(response);
            }
            Err(err) => {
                let retryable_error = err.is_timeout() || err.is_connect() || err.is_request();
                if retryable_error && attempt + 1 < START_GG_RETRY_ATTEMPTS {
                    let wait = retry_delay_for_attempt(attempt, None);
                    sleep(wait).await;
                    continue;
                }

                return Err(format!("{operation_name}リクエストに失敗しました: {err}"));
            }
        }
    }

    Err(format!(
        "{operation_name}リクエストがリトライ上限に達しました。"
    ))
}

async fn fetch_set_snapshot_detail(token: &str, set_id: &str) -> Result<SetSnapshot, String> {
    let client = Client::new();
    fetch_set_snapshot_detail_with_client(&client, token, set_id).await
}

#[derive(Debug, Clone)]
struct SeedSourceInfo {
    placeholder_name: Option<String>,
    group_seed_num: Option<i64>,
    seed_num: Option<i64>,
    placement: Option<i64>,
    origin_phase_group_id: Option<String>,
    origin_phase_group_display_identifier: Option<String>,
    origin_phase_order: Option<i64>,
    origin_placement: Option<i64>,
}

async fn fetch_seed_snapshot_with_client(
    client: &Client,
    token: &str,
    seed_id: &str,
) -> Result<Option<SeedSourceInfo>, String> {
    let variables = seed_snapshot::Variables {
        seed_id: Some(seed_id.to_owned()),
    };
    let body = SeedSnapshot::build_query(variables);
    let response = post_graphql_with_retry(client, token, &body, "seed取得").await?;
    let status = response.status();
    let raw_body = response
        .text()
        .await
        .map_err(|e| format!("seed取得レスポンス本文の読込に失敗しました: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "start.ggがseed取得でエラーを返しました: HTTP {status} / body={} ",
            summarize_response_body(&raw_body)
        ));
    }

    let payload: Response<seed_snapshot::ResponseData> = serde_json::from_str(&raw_body)
        .map_err(|e| format!("seed取得レスポンスのJSONパースに失敗しました: {e}"))?;
    if let Some(errors) = payload.errors {
        return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
    }

    Ok(payload.data.and_then(|data| data.seed).map(|seed| {
        let progression_source = seed.progression_source.as_ref();
        SeedSourceInfo {
            placeholder_name: seed.placeholder_name.or_else(|| {
                progression_source.and_then(|progression| progression.placeholder_name.clone())
            }),
            group_seed_num: seed.group_seed_num.map(i64::from),
            seed_num: seed.seed_num.map(i64::from),
            placement: seed.placement.map(i64::from),
            origin_phase_group_id: progression_source
                .and_then(|progression| progression.origin_phase_group.as_ref())
                .map(|group| group.id.to_string()),
            origin_phase_group_display_identifier: progression_source
                .and_then(|progression| progression.origin_phase_group.as_ref())
                .and_then(|group| group.display_identifier.clone()),
            origin_phase_order: progression_source
                .and_then(|progression| progression.origin_phase_group.as_ref())
                .and_then(|group| group.phase.as_ref())
                .and_then(|phase| phase.phase_order),
            origin_placement: progression_source
                .and_then(|progression| progression.origin_placement),
        }
    }))
}

async fn enrich_seed_source_with_client(
    client: &Client,
    token: &str,
    source: &mut SetEntrantSourceSnapshot,
) -> Result<(), String> {
    if source
        .source_type
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("seed")
    {
        return Ok(());
    }
    let Some(seed_id) = source.type_id.as_deref() else {
        return Ok(());
    };
    let Some(seed) = fetch_seed_snapshot_with_client(client, token, seed_id).await? else {
        return Ok(());
    };
    source.placeholder_name = seed.placeholder_name;
    source.group_seed_num = seed.group_seed_num;
    source.seed_num = seed.seed_num;
    source.placement = seed.placement;
    source.origin_phase_group_id = seed.origin_phase_group_id;
    source.origin_phase_group_display_identifier = seed.origin_phase_group_display_identifier;
    source.origin_phase_order = seed.origin_phase_order;
    source.origin_placement = seed.origin_placement;
    Ok(())
}

async fn fetch_set_snapshot_detail_with_client(
    client: &Client,
    token: &str,
    set_id: &str,
) -> Result<SetSnapshot, String> {
    let variables = set_snapshot_detail::Variables {
        set_id: set_id.to_owned(),
    };
    let body = SetSnapshotDetail::build_query(variables);

    let response = post_graphql_with_retry(client, token, &body, "set詳細取得").await?;

    let status = response.status();
    let raw_body = response
        .text()
        .await
        .map_err(|e| format!("set詳細取得レスポンス本文の読込に失敗しました: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "start.ggがエラーを返しました: HTTP {status} / body={} ",
            summarize_response_body(&raw_body)
        ));
    }

    let payload: Response<set_snapshot_detail::ResponseData> = serde_json::from_str(&raw_body)
        .map_err(|e| format!("set詳細取得レスポンスのJSONパースに失敗しました: {e}"))?;

    if let Some(errors) = payload.errors {
        return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
    }

    let data = payload
        .data
        .ok_or_else(|| "set詳細取得レスポンスにdataがありません。".to_owned())?;
    let set = data
        .set
        .ok_or_else(|| format!("指定setが見つかりません: {set_id}"))?;

    let slots = set
        .slots
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .map(|slot| {
            let entrant_id = slot.entrant.as_ref().map(|e| e.id.to_string());
            let entrant_name = slot
                .entrant
                .as_ref()
                .and_then(|e| e.name.clone())
                .unwrap_or_else(|| "TBD".to_owned());
            let seed = slot.seed.as_ref();
            let progression_source = seed.and_then(|seed| seed.progression_source.as_ref());
            let seed_id = seed.map(|seed| seed.id.to_string());
            let seed_num = seed.and_then(|seed| seed.seed_num.map(i64::from));
            let score = slot
                .standing
                .and_then(|standing| standing.stats)
                .and_then(|stats| stats.score)
                .and_then(|score| score.value);

            SetSlotSnapshot {
                entrant_id,
                entrant_name,
                seed_id,
                seed_num,
                seed_placeholder_name: seed.and_then(|seed| {
                    seed.placeholder_name.clone().or_else(|| {
                        seed.progression_source
                            .as_ref()
                            .and_then(|source| source.placeholder_name.clone())
                    })
                }),
                seed_origin_phase_group_id: progression_source
                    .and_then(|source| source.origin_phase_group.as_ref())
                    .map(|group| group.id.to_string()),
                seed_origin_phase_group_display_identifier: progression_source
                    .and_then(|source| source.origin_phase_group.as_ref())
                    .and_then(|group| group.display_identifier.clone()),
                seed_origin_phase_order: progression_source
                    .and_then(|source| source.origin_phase_group.as_ref())
                    .and_then(|group| group.phase.as_ref())
                    .and_then(|phase| phase.phase_order),
                seed_origin_placement: progression_source
                    .and_then(|source| source.origin_placement),
                seed_origin_order: progression_source.and_then(|source| source.origin_order),
                score,
            }
        })
        .collect::<Vec<SetSlotSnapshot>>();

    let source_placeholder_name = |source_type_id: Option<String>| {
        source_type_id.as_deref().and_then(|source_id| {
            slots
                .iter()
                .find(|slot| slot.seed_id.as_deref() == Some(source_id))
                .and_then(|slot| slot.seed_placeholder_name.clone())
                .or_else(|| {
                    set.winner_progression_seed
                        .as_ref()
                        .filter(|seed| seed.id.to_string() == source_id)
                        .and_then(|seed| seed.placeholder_name.clone())
                })
                .or_else(|| {
                    set.loser_progression_seed
                        .as_ref()
                        .filter(|seed| seed.id.to_string() == source_id)
                        .and_then(|seed| seed.placeholder_name.clone())
                })
        })
    };
    let source_origin = |source_type_id: Option<String>| {
        source_type_id.as_deref().and_then(|source_id| {
            slots
                .iter()
                .find(|slot| slot.seed_id.as_deref() == Some(source_id))
                .map(|slot| {
                    (
                        slot.seed_origin_phase_group_id.clone(),
                        slot.seed_origin_phase_group_display_identifier.clone(),
                        slot.seed_origin_phase_order,
                        slot.seed_origin_placement,
                    )
                })
                .or_else(|| {
                    set.winner_progression_seed
                        .as_ref()
                        .filter(|seed| seed.id.to_string() == source_id)
                        .map(|seed| {
                            let source = seed.progression_source.as_ref();
                            (
                                source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .map(|group| group.id.to_string()),
                                source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .and_then(|group| group.display_identifier.clone()),
                                source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .and_then(|group| group.phase.as_ref())
                                    .and_then(|phase| phase.phase_order),
                                source.and_then(|source| source.origin_placement),
                            )
                        })
                })
                .or_else(|| {
                    set.loser_progression_seed
                        .as_ref()
                        .filter(|seed| seed.id.to_string() == source_id)
                        .map(|seed| {
                            let source = seed.progression_source.as_ref();
                            (
                                source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .map(|group| group.id.to_string()),
                                source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .and_then(|group| group.display_identifier.clone()),
                                source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .and_then(|group| group.phase.as_ref())
                                    .and_then(|phase| phase.phase_order),
                                source.and_then(|source| source.origin_placement),
                            )
                        })
                })
        })
    };

    Ok(SetSnapshot {
        set_id: set.id.to_string(),
        phase_group_id: set.phase_group.as_ref().map(|group| group.id.to_string()),
        identifier: set.identifier.clone(),
        full_round_text: set.full_round_text.unwrap_or_else(|| "Unknown".to_owned()),
        round: set.round,
        phase_name: set
            .phase_group
            .as_ref()
            .and_then(|group| group.phase.as_ref())
            .and_then(|phase| phase.name.clone()),
        phase_group_name: set
            .phase_group
            .as_ref()
            .and_then(|group| group.display_identifier.clone()),
        phase_order: set
            .phase_group
            .as_ref()
            .and_then(|group| group.phase.as_ref())
            .and_then(|phase| phase.phase_order),
        phase_group_display_identifier: set
            .phase_group
            .as_ref()
            .and_then(|group| group.display_identifier.clone()),
        phase_group_set_name: None,
        is_intermediate: false,
        state: set.state.unwrap_or_default(),
        winner_id: set.winner_id.as_ref().map(|id| id.to_string()),
        winner_placement: set.w_placement.map(i64::from),
        loser_placement: set.l_placement.map(i64::from),
        entrant1_source: set.entrant1_source.as_ref().map(|source| {
            let origin = source_origin(source.type_id.as_ref().map(|id| id.to_string()));
            SetEntrantSourceSnapshot {
                source_type: Some(source.type_.clone()),
                type_id: source.type_id.as_ref().map(|id| id.to_string()),
                resolved_set_id: None,
                condition: source.condition.clone(),
                condition_string: source.condition_string.clone(),
                placeholder_name: source_placeholder_name(
                    source.type_id.as_ref().map(|id| id.to_string()),
                ),
                group_seed_num: None,
                seed_num: None,
                placement: None,
                origin_phase_group_id: origin.as_ref().and_then(|origin| origin.0.clone()),
                origin_phase_group_display_identifier: origin
                    .as_ref()
                    .and_then(|origin| origin.1.clone()),
                origin_phase_order: origin.as_ref().and_then(|origin| origin.2),
                origin_placement: origin.as_ref().and_then(|origin| origin.3),
            }
        }),
        entrant2_source: set.entrant2_source.as_ref().map(|source| {
            let origin = source_origin(source.type_id.as_ref().map(|id| id.to_string()));
            SetEntrantSourceSnapshot {
                source_type: Some(source.type_.clone()),
                type_id: source.type_id.as_ref().map(|id| id.to_string()),
                resolved_set_id: None,
                condition: source.condition.clone(),
                condition_string: source.condition_string.clone(),
                placeholder_name: source_placeholder_name(
                    source.type_id.as_ref().map(|id| id.to_string()),
                ),
                group_seed_num: None,
                seed_num: None,
                placement: None,
                origin_phase_group_id: origin.as_ref().and_then(|origin| origin.0.clone()),
                origin_phase_group_display_identifier: origin
                    .as_ref()
                    .and_then(|origin| origin.1.clone()),
                origin_phase_order: origin.as_ref().and_then(|origin| origin.2),
                origin_placement: origin.as_ref().and_then(|origin| origin.3),
            }
        }),
        winner_progression_seed_id: set
            .winner_progression_seed
            .as_ref()
            .map(|seed| seed.id.to_string()),
        winner_progression_id: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .map(|source| source.id.to_string()),
        winner_progression_seed_num: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.seed_num.map(i64::from)),
        winner_progression_seed_placeholder_name: set.winner_progression_seed.as_ref().and_then(
            |seed| {
                seed.placeholder_name.clone().or_else(|| {
                    seed.progression_source
                        .as_ref()
                        .and_then(|source| source.placeholder_name.clone())
                })
            },
        ),
        winner_progression_origin_phase_group_id: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_phase_group.as_ref())
            .map(|group| group.id.to_string()),
        winner_progression_origin_phase_group_display_identifier: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_phase_group.as_ref())
            .and_then(|group| group.display_identifier.clone()),
        winner_progression_origin_phase_order: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_phase_group.as_ref())
            .and_then(|group| group.phase.as_ref())
            .and_then(|phase| phase.phase_order),
        winner_progression_origin_placement: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_placement),
        winner_progression_origin_order: set
            .winner_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_order),
        loser_progression_seed_id: set
            .loser_progression_seed
            .as_ref()
            .map(|seed| seed.id.to_string()),
        loser_progression_id: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .map(|source| source.id.to_string()),
        loser_progression_seed_num: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.seed_num.map(i64::from)),
        loser_progression_seed_placeholder_name: set.loser_progression_seed.as_ref().and_then(
            |seed| {
                seed.placeholder_name.clone().or_else(|| {
                    seed.progression_source
                        .as_ref()
                        .and_then(|source| source.placeholder_name.clone())
                })
            },
        ),
        loser_progression_origin_phase_group_id: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_phase_group.as_ref())
            .map(|group| group.id.to_string()),
        loser_progression_origin_phase_group_display_identifier: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_phase_group.as_ref())
            .and_then(|group| group.display_identifier.clone()),
        loser_progression_origin_phase_order: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_phase_group.as_ref())
            .and_then(|group| group.phase.as_ref())
            .and_then(|phase| phase.phase_order),
        loser_progression_origin_placement: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_placement),
        loser_progression_origin_order: set
            .loser_progression_seed
            .as_ref()
            .and_then(|seed| seed.progression_source.as_ref())
            .and_then(|source| source.origin_order),
        slots,
    })
}
async fn reset_set_if_needed(token: &str, set_id: &str) -> Result<(), String> {
    let variables = reset_set::Variables {
        set_id: set_id.to_owned(),
        reset_dependent_sets: true,
    };
    let body = ResetSet::build_query(variables);

    let client = Client::new();
    let response = post_graphql_with_retry(&client, token, &body, "強制上書き用resetSet").await?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned();
    let raw_body = response
        .text()
        .await
        .map_err(|e| format!("強制上書き用resetSetレスポンス本文の読込に失敗しました: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "start.ggがエラーを返しました: HTTP {status} / content-type={content_type} / body={} ",
            summarize_response_body(&raw_body)
        ));
    }

    let payload: Response<reset_set::ResponseData> = serde_json::from_str(&raw_body).map_err(|e| {
        format!(
            "強制上書き用resetSetレスポンスのJSONパースに失敗しました: {e} / content-type={content_type} / body={} ",
            summarize_response_body(&raw_body)
        )
    })?;

    if let Some(errors) = payload.errors {
        return Err(format!(
            "強制上書き用resetSetでGraphQLエラー: {}",
            join_graphql_errors(&errors)
        ));
    }

    let data = payload
        .data
        .ok_or_else(|| "強制上書き用resetSetレスポンスにdataがありません。".to_owned())?;

    if data.reset_set.is_none() {
        return Err("強制上書き用resetSetの結果が返されませんでした。".to_owned());
    }

    Ok(())
}

fn parse_score_csv(score_csv: &str) -> Result<Option<(u32, u32)>, String> {
    let trimmed = score_csv.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let normalized = trimmed.to_ascii_lowercase().replace(' ', "");
    if normalized == "dq" || normalized.ends_with("-dq") {
        return Ok(None);
    }

    let parts = trimmed.split('-').map(str::trim).collect::<Vec<&str>>();
    if parts.len() != 2 {
        return Err("scoreCsvの形式が不正です。例: 2-1".to_owned());
    }

    let winner_wins = parts[0].parse::<u32>().map_err(|_| {
        format!(
            "scoreCsvの勝者側スコアを数値として解釈できません: {}",
            parts[0]
        )
    })?;
    let loser_wins = parts[1].parse::<u32>().map_err(|_| {
        format!(
            "scoreCsvの敗者側スコアを数値として解釈できません: {}",
            parts[1]
        )
    })?;

    if winner_wins == 0 && loser_wins == 0 {
        return Err("scoreCsvは 0-0 以外を指定してください。".to_owned());
    }

    Ok(Some((winner_wins, loser_wins)))
}

async fn fetch_set_entrant_ids(token: &str, set_id: &str) -> Result<Vec<String>, String> {
    let variables = set_for_report::Variables {
        set_id: set_id.to_owned(),
    };
    let body = SetForReport::build_query(variables);

    let client = Client::new();
    let response = post_graphql_with_retry(&client, token, &body, "set情報取得").await?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned();
    let raw_body = response
        .text()
        .await
        .map_err(|e| format!("set情報レスポンス本文の読込に失敗しました: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "start.ggがエラーを返しました: HTTP {status} / content-type={content_type} / body={} ",
            summarize_response_body(&raw_body)
        ));
    }

    let payload: Response<set_for_report::ResponseData> = serde_json::from_str(&raw_body).map_err(|e| {
        format!(
            "set情報レスポンスのJSONパースに失敗しました: {e} / content-type={content_type} / body={} ",
            summarize_response_body(&raw_body)
        )
    })?;

    if let Some(errors) = payload.errors {
        return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
    }

    let data = payload
        .data
        .ok_or_else(|| "set情報レスポンスにdataがありません。".to_owned())?;
    let set = data
        .set
        .ok_or_else(|| "指定setIdのsetが見つかりません。".to_owned())?;

    let entrant_ids = set
        .slots
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter_map(|slot| slot.entrant.map(|entrant| entrant.id.to_string()))
        .collect::<Vec<String>>();

    Ok(entrant_ids)
}

async fn fetch_set_entrant_ids_until_ready(
    token: &str,
    set_id: &str,
) -> Result<Vec<String>, String> {
    for attempt in 0..START_GG_SET_ENTRANT_RETRY_ATTEMPTS {
        let entrant_ids = fetch_set_entrant_ids(token, set_id).await?;
        if entrant_ids.len() >= 2 {
            return Ok(entrant_ids);
        }

        if attempt + 1 < START_GG_SET_ENTRANT_RETRY_ATTEMPTS {
            sleep(Duration::from_millis(START_GG_SET_ENTRANT_RETRY_DELAY_MS)).await;
        }
    }

    Err("対戦の組み合わせが確定していないsetは報告できません。直前の結果反映待ちの可能性があるため、数秒後に再実行してください。".to_owned())
}

fn build_game_data(
    entrant_ids: &[String],
    winner_id: &str,
    winner_wins: u32,
    loser_wins: u32,
) -> Result<Vec<report_set_result::BracketSetGameDataInput>, String> {
    let loser_id = entrant_ids
        .iter()
        .find(|id| id.as_str() != winner_id)
        .ok_or_else(|| "scoreCsv適用に必要な敗者entrantIdを特定できませんでした。".to_owned())?;

    let mut game_data = Vec::with_capacity((winner_wins + loser_wins) as usize);
    let mut game_num = 1;

    for _ in 0..winner_wins {
        game_data.push(report_set_result::BracketSetGameDataInput {
            winner_id: Some(winner_id.to_owned()),
            game_num: Some(game_num as i64),
        });
        game_num += 1;
    }

    for _ in 0..loser_wins {
        game_data.push(report_set_result::BracketSetGameDataInput {
            winner_id: Some(loser_id.clone()),
            game_num: Some(game_num as i64),
        });
        game_num += 1;
    }

    Ok(game_data)
}

async fn query_tournament_snapshot(
    token: &str,
    slug: &str,
    per_page: u32,
) -> Result<TournamentSnapshot, String> {
    let min_chunk_per_page: i64 = 1;
    let mut chunk_per_page = per_page.clamp(1, 200) as i64;

    let client = Client::new();
    let (data, slug) = loop {
        let variables = tournament_sync::Variables {
            slug: slug.to_owned(),
            per_page: chunk_per_page,
        };
        let body = TournamentSync::build_query(variables);

        let response =
            post_graphql_with_retry(&client, token, &body, "start.gg tournament取得").await?;

        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_owned();
        let raw_body = response
            .text()
            .await
            .map_err(|e| format!("start.ggレスポンス本文の読込に失敗しました: {e}"))?;

        if !status.is_success() {
            return Err(format!(
                "start.ggがエラーを返しました: HTTP {status} / content-type={content_type} / body={} ",
                summarize_response_body(&raw_body)
            ));
        }

        let payload: Response<tournament_sync::ResponseData> = serde_json::from_str(&raw_body)
            .map_err(|e| {
                format!(
                    "start.ggレスポンスのJSONパースに失敗しました: {e} / content-type={content_type} / body={} ",
                    summarize_response_body(&raw_body)
                )
            })?;

        if let Some(errors) = payload.errors {
            if is_complexity_too_high(&errors) && chunk_per_page > min_chunk_per_page {
                chunk_per_page = (chunk_per_page / 2).max(min_chunk_per_page);
                continue;
            }
            return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
        }

        let data = payload
            .data
            .ok_or_else(|| "GraphQLレスポンスにdataがありません。".to_owned())?;
        break (data, slug.to_owned());
    };
    let tournament = data
        .tournament
        .ok_or_else(|| "指定slugのtournamentが見つかりません。".to_owned())?;

    let events = tournament
        .events
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .map(|event| {
            let phase_groups = event
                .phase_groups
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .map(|group| PhaseGroupSnapshot {
                    phase_group_id: group.id.to_string(),
                    bracket_type: group.bracket_type.map(bracket_type_name),
                    tiebreak_order: parse_tiebreak_order(group.tiebreak_order.as_ref()),
                    phase_id: group.phase.as_ref().map(|phase| phase.id.to_string()),
                    phase_name: group.phase.as_ref().and_then(|phase| phase.name.clone()),
                    phase_order: group.phase.as_ref().and_then(|phase| phase.phase_order),
                    display_identifier: group.display_identifier,
                    progressions_out: group
                        .progressions_out
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|progression| PhaseGroupProgressionSnapshot {
                            progression_id: progression.id.to_string(),
                            origin_order: progression.origin_order,
                            origin_phase_id: progression
                                .origin_phase
                                .as_ref()
                                .map(|phase| phase.id.to_string()),
                            origin_phase_order: progression
                                .origin_phase
                                .as_ref()
                                .and_then(|phase| phase.phase_order),
                            origin_phase_group_id: progression
                                .origin_phase_group
                                .as_ref()
                                .map(|group| group.id.to_string()),
                            origin_phase_group_display_identifier: progression
                                .origin_phase_group
                                .as_ref()
                                .and_then(|group| group.display_identifier.clone()),
                            origin_placement: progression.origin_placement,
                            placeholder_name: progression.placeholder_name,
                        })
                        .collect(),
                    seed_map: group.seed_map,
                    seed_order: group
                        .seeds
                        .clone()
                        .and_then(|seeds| seeds.nodes)
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|seed| seed.id.to_string())
                        .collect(),
                    seeds: group
                        .seeds
                        .and_then(|seeds| seeds.nodes)
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|seed| PhaseGroupSeedSnapshot {
                            seed_id: seed.id.to_string(),
                            progression_id: seed
                                .progression_source
                                .as_ref()
                                .map(|source| source.id.to_string()),
                            seed_num: seed.seed_num.map(i64::from),
                            placement: seed.placement.map(i64::from),
                            origin_phase_order: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_phase.as_ref())
                                .and_then(|phase| phase.phase_order),
                            origin_phase_group_display_identifier: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_phase_group.as_ref())
                                .and_then(|group| group.display_identifier.clone()),
                            origin_placement: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_placement),
                            origin_order: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_order),
                            entrant_id: seed.entrant.as_ref().map(|entrant| entrant.id.to_string()),
                            entrant_name: seed.entrant.and_then(|entrant| entrant.name),
                            placeholder_name: seed.placeholder_name,
                        })
                        .collect(),
                })
                .collect::<Vec<PhaseGroupSnapshot>>();
            let sets = event
                .sets
                .and_then(|conn| conn.nodes)
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .filter_map(|set| {
                    let set_id = set.id.to_string();
                    if is_preview_set_id(&set_id) {
                        return None;
                    }

                    let slots = set
                        .slots
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|slot| {
                            let entrant_id = slot.entrant.as_ref().map(|e| e.id.to_string());
                            let entrant_name = slot
                                .entrant
                                .as_ref()
                                .and_then(|e| e.name.clone())
                                .unwrap_or_else(|| "TBD".to_owned());
                            let seed_id = slot.seed.as_ref().map(|seed| seed.id.to_string());
                            let seed_num = slot
                                .seed
                                .as_ref()
                                .and_then(|seed| seed.seed_num.map(i64::from));
                            let seed_placeholder_name = slot.seed.as_ref().and_then(|seed| {
                                seed.placeholder_name.clone().or_else(|| {
                                    seed.progression_source
                                        .as_ref()
                                        .and_then(|source| source.placeholder_name.clone())
                                })
                            });
                            let progression_source = slot
                                .seed
                                .as_ref()
                                .and_then(|seed| seed.progression_source.as_ref());
                            let score = slot
                                .standing
                                .and_then(|s| s.stats)
                                .and_then(|stats| stats.score)
                                .and_then(|score| score.value);

                            SetSlotSnapshot {
                                entrant_id,
                                entrant_name,
                                seed_id,
                                seed_num,
                                seed_placeholder_name,
                                seed_origin_phase_group_id: progression_source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .map(|group| group.id.to_string()),
                                seed_origin_phase_group_display_identifier: progression_source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .and_then(|group| group.display_identifier.clone()),
                                seed_origin_phase_order: progression_source
                                    .and_then(|source| source.origin_phase_group.as_ref())
                                    .and_then(|group| group.phase.as_ref())
                                    .and_then(|phase| phase.phase_order),
                                seed_origin_placement: progression_source
                                    .and_then(|source| source.origin_placement),
                                seed_origin_order: progression_source
                                    .and_then(|source| source.origin_order),
                                score,
                            }
                        })
                        .collect::<Vec<SetSlotSnapshot>>();
                    let winner_seed = set.winner_progression_seed.as_ref();
                    let loser_seed = set.loser_progression_seed.as_ref();
                    let source_placeholder_name = |source_type_id: Option<String>| {
                        source_type_id.as_deref().and_then(|source_id| {
                            slots
                                .iter()
                                .find(|slot| slot.seed_id.as_deref() == Some(source_id))
                                .and_then(|slot| slot.seed_placeholder_name.clone())
                                .or_else(|| {
                                    winner_seed
                                        .filter(|seed| seed.id.to_string() == source_id)
                                        .and_then(|seed| seed.placeholder_name.clone())
                                })
                                .or_else(|| {
                                    loser_seed
                                        .filter(|seed| seed.id.to_string() == source_id)
                                        .and_then(|seed| seed.placeholder_name.clone())
                                })
                        })
                    };
                    let source_origin = |source_type_id: Option<String>| {
                        source_type_id.as_deref().and_then(|source_id| {
                            slots
                                .iter()
                                .find(|slot| slot.seed_id.as_deref() == Some(source_id))
                                .map(|slot| {
                                    (
                                        slot.seed_origin_phase_group_id.clone(),
                                        slot.seed_origin_phase_group_display_identifier.clone(),
                                        slot.seed_origin_phase_order,
                                        slot.seed_origin_placement,
                                    )
                                })
                                .or_else(|| {
                                    winner_seed
                                        .filter(|seed| seed.id.to_string() == source_id)
                                        .map(|seed| {
                                            let source = seed.progression_source.as_ref();
                                            (
                                                source
                                                    .and_then(|source| {
                                                        source.origin_phase_group.as_ref()
                                                    })
                                                    .map(|group| group.id.to_string()),
                                                source
                                                    .and_then(|source| {
                                                        source.origin_phase_group.as_ref()
                                                    })
                                                    .and_then(|group| {
                                                        group.display_identifier.clone()
                                                    }),
                                                source
                                                    .and_then(|source| {
                                                        source.origin_phase_group.as_ref()
                                                    })
                                                    .and_then(|group| group.phase.as_ref())
                                                    .and_then(|phase| phase.phase_order),
                                                source.and_then(|source| source.origin_placement),
                                            )
                                        })
                                })
                                .or_else(|| {
                                    loser_seed
                                        .filter(|seed| seed.id.to_string() == source_id)
                                        .map(|seed| {
                                            let source = seed.progression_source.as_ref();
                                            (
                                                source
                                                    .and_then(|source| {
                                                        source.origin_phase_group.as_ref()
                                                    })
                                                    .map(|group| group.id.to_string()),
                                                source
                                                    .and_then(|source| {
                                                        source.origin_phase_group.as_ref()
                                                    })
                                                    .and_then(|group| {
                                                        group.display_identifier.clone()
                                                    }),
                                                source
                                                    .and_then(|source| {
                                                        source.origin_phase_group.as_ref()
                                                    })
                                                    .and_then(|group| group.phase.as_ref())
                                                    .and_then(|phase| phase.phase_order),
                                                source.and_then(|source| source.origin_placement),
                                            )
                                        })
                                })
                        })
                    };

                    Some(SetSnapshot {
                        set_id,
                        phase_group_id: set.phase_group.as_ref().map(|group| group.id.to_string()),
                        identifier: set.identifier.clone(),
                        full_round_text: set
                            .full_round_text
                            .unwrap_or_else(|| "Unknown".to_owned()),
                        round: set.round,
                        phase_name: set
                            .phase_group
                            .as_ref()
                            .and_then(|group| group.phase.as_ref())
                            .and_then(|phase| phase.name.clone()),
                        phase_group_name: set
                            .phase_group
                            .as_ref()
                            .and_then(|group| group.display_identifier.clone()),
                        phase_order: set
                            .phase_group
                            .as_ref()
                            .and_then(|group| group.phase.as_ref())
                            .and_then(|phase| phase.phase_order),
                        phase_group_display_identifier: set
                            .phase_group
                            .as_ref()
                            .and_then(|group| group.display_identifier.clone()),
                        phase_group_set_name: None,
                        is_intermediate: false,
                        state: set.state.unwrap_or_default(),
                        winner_id: set.winner_id.map(|id| id.to_string()),
                        winner_placement: set.w_placement.map(i64::from),
                        loser_placement: set.l_placement.map(i64::from),
                        entrant1_source: set.entrant1_source.map(|source| {
                            SetEntrantSourceSnapshot {
                                source_type: Some(source.type_.clone()),
                                type_id: source.type_id.as_ref().map(|type_id| type_id.to_string()),
                                resolved_set_id: None,
                                condition: source.condition,
                                condition_string: source.condition_string,
                                placeholder_name: source_placeholder_name(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                ),
                                group_seed_num: None,
                                seed_num: None,
                                placement: None,
                                origin_phase_group_id: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .as_ref()
                                .and_then(|origin| origin.0.clone()),
                                origin_phase_group_display_identifier: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .as_ref()
                                .and_then(|origin| origin.1.clone()),
                                origin_phase_order: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .and_then(|origin| origin.2),
                                origin_placement: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .and_then(|origin| origin.3),
                            }
                        }),
                        entrant2_source: set.entrant2_source.map(|source| {
                            SetEntrantSourceSnapshot {
                                source_type: Some(source.type_.clone()),
                                type_id: source.type_id.as_ref().map(|type_id| type_id.to_string()),
                                resolved_set_id: None,
                                condition: source.condition,
                                condition_string: source.condition_string,
                                placeholder_name: source_placeholder_name(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                ),
                                group_seed_num: None,
                                seed_num: None,
                                placement: None,
                                origin_phase_group_id: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .as_ref()
                                .and_then(|origin| origin.0.clone()),
                                origin_phase_group_display_identifier: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .as_ref()
                                .and_then(|origin| origin.1.clone()),
                                origin_phase_order: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .and_then(|origin| origin.2),
                                origin_placement: source_origin(
                                    source.type_id.as_ref().map(|id| id.to_string()),
                                )
                                .and_then(|origin| origin.3),
                            }
                        }),
                        winner_progression_seed_id: set
                            .winner_progression_seed
                            .as_ref()
                            .map(|seed| seed.id.to_string()),
                        winner_progression_id: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .map(|source| source.id.to_string()),
                        winner_progression_seed_num: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.seed_num.map(i64::from)),
                        winner_progression_seed_placeholder_name: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| {
                                seed.placeholder_name.clone().or_else(|| {
                                    seed.progression_source
                                        .as_ref()
                                        .and_then(|source| source.placeholder_name.clone())
                                })
                            }),
                        winner_progression_origin_phase_group_id: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_phase_group.as_ref())
                            .map(|group| group.id.to_string()),
                        winner_progression_origin_phase_group_display_identifier: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_phase_group.as_ref())
                            .and_then(|group| group.display_identifier.clone()),
                        winner_progression_origin_phase_order: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_phase_group.as_ref())
                            .and_then(|group| group.phase.as_ref())
                            .and_then(|phase| phase.phase_order),
                        winner_progression_origin_placement: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_placement),
                        winner_progression_origin_order: set
                            .winner_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_order),
                        loser_progression_seed_id: set
                            .loser_progression_seed
                            .as_ref()
                            .map(|seed| seed.id.to_string()),
                        loser_progression_id: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .map(|source| source.id.to_string()),
                        loser_progression_seed_num: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.seed_num.map(i64::from)),
                        loser_progression_seed_placeholder_name: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| {
                                seed.placeholder_name.clone().or_else(|| {
                                    seed.progression_source
                                        .as_ref()
                                        .and_then(|source| source.placeholder_name.clone())
                                })
                            }),
                        loser_progression_origin_phase_group_id: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_phase_group.as_ref())
                            .map(|group| group.id.to_string()),
                        loser_progression_origin_phase_group_display_identifier: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_phase_group.as_ref())
                            .and_then(|group| group.display_identifier.clone()),
                        loser_progression_origin_phase_order: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_phase_group.as_ref())
                            .and_then(|group| group.phase.as_ref())
                            .and_then(|phase| phase.phase_order),
                        loser_progression_origin_placement: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_placement),
                        loser_progression_origin_order: set
                            .loser_progression_seed
                            .as_ref()
                            .and_then(|seed| seed.progression_source.as_ref())
                            .and_then(|source| source.origin_order),
                        slots,
                    })
                })
                .collect::<Vec<SetSnapshot>>();

            EventSnapshot {
                event_id: event.id.to_string(),
                name: event.name.unwrap_or_else(|| "Unnamed event".to_owned()),
                phases: event
                    .phases
                    .unwrap_or_default()
                    .into_iter()
                    .flatten()
                    .map(|phase| PhaseSnapshot {
                        phase_id: phase.id.to_string(),
                        name: phase.name,
                        phase_order: phase.phase_order,
                    })
                    .collect(),
                phase_groups,
                sets,
            }
        })
        .collect::<Vec<EventSnapshot>>();

    Ok(TournamentSnapshot {
        tournament_id: tournament.id.to_string(),
        slug: tournament.slug.unwrap_or_else(|| slug.to_owned()),
        name: tournament
            .name
            .unwrap_or_else(|| "Unnamed tournament".to_owned()),
        events,
        updated_at: Utc::now(),
    })
}

pub async fn fetch_tournament_snapshot(
    token: &str,
    slug: &str,
    per_page: u32,
) -> Result<TournamentSnapshot, String> {
    query_tournament_snapshot(token, slug, per_page).await
}

pub async fn fetch_set_snapshot(token: &str, set_id: &str) -> Result<SetSnapshot, String> {
    fetch_set_snapshot_detail(token, set_id).await
}

pub async fn sync_tournament(
    token: &str,
    slug: &str,
    per_page: u32,
) -> Result<TournamentSnapshot, String> {
    query_tournament_snapshot(token, slug, per_page).await
}

pub async fn fetch_event_snapshot_by_slug(
    token: &str,
    event_slug: &str,
    per_page: u32,
    mut progress_cb: impl FnMut(EventSnapshotFetchProgress),
) -> Result<TournamentSnapshot, String> {
    let client = Client::new();
    let min_chunk_per_page: i64 = 1;
    let mut chunk_per_page = per_page.clamp(1, 200) as i64;
    let mut page: i64;
    let mut discovered_set_ids: Vec<String> = Vec::new();

    let mut tournament_id = String::new();
    let mut tournament_name = String::new();
    let mut tournament_slug = String::new();
    let mut event_id = String::new();
    let mut event_name = String::new();
    let mut phases: Vec<PhaseSnapshot> = Vec::new();
    let mut phase_groups;
    let mut completed_requests = 0_usize;

    progress_cb(EventSnapshotFetchProgress {
        phase: "discovering",
        completed_requests,
        total_requests: None,
        current_page: Some(1),
        current_set_id: None,
        total_planned_set_requests: None,
    });

    'retry: loop {
        page = 1;
        discovered_set_ids.clear();

        loop {
            if page > 1 {
                sleep(Duration::from_millis(START_GG_REQUEST_INTERVAL_MS)).await;
            }

            let variables = event_sync::Variables {
                slug: event_slug.to_owned(),
                page,
                per_page: chunk_per_page,
            };
            let body = EventSync::build_query(variables);

            let response = post_graphql_with_retry(&client, token, &body, "event取得").await?;
            completed_requests += 1;
            progress_cb(EventSnapshotFetchProgress {
                phase: "discovering",
                completed_requests,
                total_requests: None,
                current_page: Some(page),
                current_set_id: None,
                total_planned_set_requests: None,
            });

            let status = response.status();
            let raw_body = response
                .text()
                .await
                .map_err(|e| format!("event取得レスポンス本文の読込に失敗しました: {e}"))?;

            if !status.is_success() {
                return Err(format!(
                    "start.ggがエラーを返しました: HTTP {status} / body={} ",
                    summarize_response_body(&raw_body)
                ));
            }

            let payload: Response<event_sync::ResponseData> = serde_json::from_str(&raw_body)
                .map_err(|e| format!("event取得レスポンスのJSONパースに失敗しました: {e}"))?;

            if let Some(errors) = payload.errors {
                if is_complexity_too_high(&errors) && chunk_per_page > min_chunk_per_page {
                    chunk_per_page = (chunk_per_page / 2).max(min_chunk_per_page);
                    continue 'retry;
                }
                return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
            }

            let data = payload
                .data
                .ok_or_else(|| "event取得レスポンスにdataがありません。".to_owned())?;
            let event = data.event.ok_or_else(|| {
                "指定eventが見つかりません。event slugを確認してください。".to_owned()
            })?;
            phases = event
                .phases
                .clone()
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .map(|phase| PhaseSnapshot {
                    phase_id: phase.id.to_string(),
                    name: phase.name,
                    phase_order: phase.phase_order,
                })
                .collect::<Vec<PhaseSnapshot>>();
            phase_groups = event
                .phase_groups
                .clone()
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .map(|group| PhaseGroupSnapshot {
                    phase_group_id: group.id.to_string(),
                    bracket_type: group.bracket_type.map(bracket_type_name),
                    tiebreak_order: parse_tiebreak_order(group.tiebreak_order.as_ref()),
                    phase_id: group.phase.as_ref().map(|phase| phase.id.to_string()),
                    phase_name: group.phase.as_ref().and_then(|phase| phase.name.clone()),
                    phase_order: group.phase.as_ref().and_then(|phase| phase.phase_order),
                    display_identifier: group.display_identifier,
                    progressions_out: group
                        .progressions_out
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|progression| PhaseGroupProgressionSnapshot {
                            progression_id: progression.id.to_string(),
                            origin_order: progression.origin_order,
                            origin_phase_id: progression
                                .origin_phase
                                .as_ref()
                                .map(|phase| phase.id.to_string()),
                            origin_phase_order: progression
                                .origin_phase
                                .as_ref()
                                .and_then(|phase| phase.phase_order),
                            origin_phase_group_id: progression
                                .origin_phase_group
                                .as_ref()
                                .map(|group| group.id.to_string()),
                            origin_phase_group_display_identifier: progression
                                .origin_phase_group
                                .as_ref()
                                .and_then(|group| group.display_identifier.clone()),
                            origin_placement: progression.origin_placement,
                            placeholder_name: progression.placeholder_name,
                        })
                        .collect(),
                    seed_map: group.seed_map,
                    seed_order: group
                        .seeds
                        .clone()
                        .and_then(|seeds| seeds.nodes)
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|seed| seed.id.to_string())
                        .collect(),
                    seeds: group
                        .seeds
                        .and_then(|seeds| seeds.nodes)
                        .unwrap_or_default()
                        .into_iter()
                        .flatten()
                        .map(|seed| PhaseGroupSeedSnapshot {
                            seed_id: seed.id.to_string(),
                            progression_id: seed
                                .progression_source
                                .as_ref()
                                .map(|source| source.id.to_string()),
                            seed_num: seed.seed_num.map(i64::from),
                            placement: seed.placement.map(i64::from),
                            origin_phase_order: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_phase.as_ref())
                                .and_then(|phase| phase.phase_order),
                            origin_phase_group_display_identifier: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_phase_group.as_ref())
                                .and_then(|group| group.display_identifier.clone()),
                            origin_placement: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_placement),
                            origin_order: seed
                                .progression_source
                                .as_ref()
                                .and_then(|source| source.origin_order),
                            entrant_id: seed.entrant.as_ref().map(|entrant| entrant.id.to_string()),
                            entrant_name: seed.entrant.and_then(|entrant| entrant.name),
                            placeholder_name: seed.placeholder_name,
                        })
                        .collect(),
                })
                .collect::<Vec<PhaseGroupSnapshot>>();

            let tournament = event
                .tournament
                .ok_or_else(|| "eventに紐づくtournament情報が取得できませんでした。".to_owned())?;

            if tournament_id.is_empty() {
                tournament_id = tournament.id.to_string();
                tournament_name = tournament
                    .name
                    .unwrap_or_else(|| "Unnamed tournament".to_owned());
                tournament_slug = tournament.slug.unwrap_or_else(|| {
                    event_slug
                        .split("/event/")
                        .next()
                        .unwrap_or(event_slug)
                        .to_owned()
                });
                event_id = event.id.to_string();
                event_name = event.name.unwrap_or_else(|| "Unnamed event".to_owned());
            }

            let page_set_nodes = event
                .sets
                .and_then(|conn| conn.nodes)
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .collect::<Vec<_>>();

            for set in &page_set_nodes {
                let set_id = set.id.to_string();
                if is_preview_set_id(&set_id) {
                    continue;
                }
                discovered_set_ids.push(set_id);
            }

            let count = page_set_nodes.len();

            if count < chunk_per_page as usize {
                break;
            }

            page += 1;
        }

        break;
    }

    let visible_set_ids = discovered_set_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let event_phase_group_ids = phase_groups
        .iter()
        .map(|group| group.phase_group_id.clone())
        .collect::<HashSet<_>>();
    let mut pending_set_ids = discovered_set_ids;
    let mut queued_set_ids = pending_set_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    completed_requests = 0;
    progress_cb(EventSnapshotFetchProgress {
        phase: "fetchingSetDetails",
        completed_requests,
        total_requests: Some(pending_set_ids.len()),
        current_page: None,
        current_set_id: None,
        total_planned_set_requests: Some(pending_set_ids.len()),
    });

    let mut all_sets: Vec<SetSnapshot> = Vec::with_capacity(pending_set_ids.len());
    while let Some(set_id) = pending_set_ids.pop() {
        sleep(Duration::from_millis(START_GG_REQUEST_INTERVAL_MS)).await;
        let mut set = match fetch_set_snapshot_detail_with_client(&client, token, &set_id).await {
            Ok(set) => set,
            Err(_) if !visible_set_ids.contains(&set_id) => continue,
            Err(error) => return Err(error),
        };
        let is_visible_set = visible_set_ids.contains(&set_id);
        if !should_include_event_snapshot_set(
            is_visible_set,
            set.phase_group_id.as_deref(),
            &event_phase_group_ids,
        ) {
            continue;
        }
        set.is_intermediate = !is_visible_set;

        for source in [&mut set.entrant1_source, &mut set.entrant2_source]
            .into_iter()
            .flatten()
        {
            let is_seed_source = source
                .source_type
                .as_deref()
                .is_some_and(|source_type| source_type.eq_ignore_ascii_case("seed"));
            let Some(source_seed_id) = source.type_id.clone() else {
                continue;
            };
            if is_seed_source {
                enrich_seed_source_with_client(&client, token, source).await?;
            }
        }

        for source in [&set.entrant1_source, &set.entrant2_source]
            .into_iter()
            .flatten()
        {
            let Some(source_set_id) = source.type_id.as_deref() else {
                continue;
            };
            if source.condition.is_none()
                || queued_set_ids.contains(source_set_id)
                || is_preview_set_id(source_set_id)
            {
                continue;
            }
            queued_set_ids.insert(source_set_id.to_owned());
            pending_set_ids.push(source_set_id.to_owned());
        }

        completed_requests += 1;
        progress_cb(EventSnapshotFetchProgress {
            phase: "fetchingSetDetails",
            completed_requests,
            total_requests: Some(queued_set_ids.len()),
            current_page: None,
            current_set_id: Some(set_id),
            total_planned_set_requests: Some(queued_set_ids.len()),
        });
        all_sets.push(set);
    }

    progress_cb(EventSnapshotFetchProgress {
        phase: "completed",
        completed_requests,
        total_requests: Some(completed_requests),
        current_page: None,
        current_set_id: None,
        total_planned_set_requests: Some(all_sets.len()),
    });

    Ok(TournamentSnapshot {
        tournament_id,
        slug: tournament_slug,
        name: tournament_name,
        events: vec![EventSnapshot {
            event_id,
            name: event_name,
            phases,
            phase_groups,
            sets: all_sets,
        }],
        updated_at: Utc::now(),
    })
}

pub async fn fetch_tournament_preview(
    token: &str,
    slug: &str,
) -> Result<TournamentPreview, String> {
    let variables = tournament_preview_query::Variables {
        slug: slug.to_owned(),
    };
    let body = TournamentPreviewQuery::build_query(variables);

    let client = Client::new();
    let response =
        post_graphql_with_retry(&client, token, &body, "tournamentプレビュー取得").await?;

    let status = response.status();
    let raw_body = response
        .text()
        .await
        .map_err(|e| format!("tournamentプレビュー取得レスポンス本文の読込に失敗しました: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "start.ggがエラーを返しました: HTTP {status} / body={} ",
            summarize_response_body(&raw_body)
        ));
    }

    let payload: Response<tournament_preview_query::ResponseData> = serde_json::from_str(&raw_body)
        .map_err(|e| {
            format!("tournamentプレビュー取得レスポンスのJSONパースに失敗しました: {e}")
        })?;

    if let Some(errors) = payload.errors {
        return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
    }

    let data = payload
        .data
        .ok_or_else(|| "tournamentプレビュー取得レスポンスにdataがありません。".to_owned())?;
    let tournament = data
        .tournament
        .ok_or_else(|| "指定slugのtournamentが見つかりません。".to_owned())?;

    let events = tournament
        .events
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .map(|event| TournamentEventPreviewItem {
            event_id: event.id.to_string(),
            event_name: event.name.unwrap_or_else(|| "Unnamed event".to_owned()),
            event_slug: event.slug,
            bracket_types: event
                .phase_groups
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .filter_map(|group| group.bracket_type.map(bracket_type_name))
                .collect(),
            set_count: 0,
        })
        .filter(|event| {
            !event.bracket_types.is_empty()
                && event
                    .bracket_types
                    .iter()
                    .all(|bracket_type| is_supported_bracket_type(bracket_type))
        })
        .collect::<Vec<_>>();

    Ok(TournamentPreview {
        tournament_id: tournament.id.to_string(),
        slug: tournament.slug.unwrap_or_else(|| slug.to_owned()),
        name: tournament
            .name
            .unwrap_or_else(|| "Unnamed tournament".to_owned()),
        updated_at: Utc::now(),
        events,
    })
}

pub async fn report_set_result(
    token: &str,
    set_id: &str,
    winner_id: &str,
    score_csv: &str,
    force_overwrite: bool,
) -> Result<(), String> {
    if force_overwrite {
        reset_set_if_needed(token, set_id).await?;
    }

    let entrant_ids = fetch_set_entrant_ids_until_ready(token, set_id).await?;
    if entrant_ids.len() < 2 {
        return Err("対戦の組み合わせが確定していないsetは報告できません。".to_owned());
    }

    if !entrant_ids.iter().any(|id| id == winner_id) {
        return Err("winnerIdがこのsetの参加entrantに含まれていません。".to_owned());
    }

    let parsed_score = parse_score_csv(score_csv)?;
    let game_data = if let Some((winner_wins, loser_wins)) = parsed_score {
        Some(
            build_game_data(&entrant_ids, winner_id, winner_wins, loser_wins)?
                .into_iter()
                .map(Some)
                .collect(),
        )
    } else {
        None
    };

    let variables = report_set_result::Variables {
        set_id: set_id.to_owned(),
        winner_id: winner_id.to_owned(),
        game_data,
    };
    let body = ReportSetResult::build_query(variables);

    let client = Client::new();
    let response = post_graphql_with_retry(&client, token, &body, "試合結果報告").await?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned();
    let raw_body = response
        .text()
        .await
        .map_err(|e| format!("試合結果報告レスポンス本文の読込に失敗しました: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "start.ggがエラーを返しました: HTTP {status} / content-type={content_type} / body={} ",
            summarize_response_body(&raw_body)
        ));
    }

    let payload: Response<report_set_result::ResponseData> = serde_json::from_str(&raw_body)
        .map_err(|e| {
            format!(
                "試合結果報告レスポンスのJSONパースに失敗しました: {e} / content-type={content_type} / body={} ",
                summarize_response_body(&raw_body)
            )
        })?;

    if let Some(errors) = payload.errors {
        return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
    }

    let data = payload
        .data
        .ok_or_else(|| "GraphQLレスポンスにdataがありません。".to_owned())?;

    let reported_sets = data
        .report_bracket_set
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .collect::<Vec<report_set_result::ReportSetResultReportBracketSet>>();

    if reported_sets.is_empty() {
        return Err("reportBracketSetの結果が空でした。入力値を確認してください。".to_owned());
    }

    Ok(())
}

pub async fn reset_set_result(token: &str, set_id: &str) -> Result<(), String> {
    reset_set_if_needed(token, set_id).await
}
