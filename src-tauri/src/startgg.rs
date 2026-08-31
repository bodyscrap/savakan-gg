use chrono::Utc;
use std::collections::BTreeMap;
use graphql_client::{GraphQLQuery, Response};
use reqwest::StatusCode;
use reqwest::Client;
use serde::Serialize;

use crate::models::{
    EventSnapshot, SetSlotSnapshot, SetSnapshot, TournamentEventPreviewItem, TournamentPreview,
    TournamentSnapshot,
};

const START_GG_GQL_ENDPOINT: &str = "https://api.start.gg/gql/alpha";
const START_GG_RETRY_ATTEMPTS: usize = 3;

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

fn is_retryable_status(status: StatusCode) -> bool {
    matches!(status, StatusCode::TOO_MANY_REQUESTS | StatusCode::INTERNAL_SERVER_ERROR | StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT)
        || status.as_u16() == 520
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
            .json(body)
            .send()
            .await
        {
            Ok(response) => {
                if is_retryable_status(response.status()) && attempt + 1 < START_GG_RETRY_ATTEMPTS {
                    continue;
                }
                return Ok(response);
            }
            Err(err) => {
                let retryable_error = err.is_timeout() || err.is_connect() || err.is_request();
                if retryable_error && attempt + 1 < START_GG_RETRY_ATTEMPTS {
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
            let seed_id = slot.seed.as_ref().map(|seed| seed.id.to_string());
            let seed_num = slot.seed.and_then(|seed| seed.seed_num.map(i64::from));
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
                score,
            }
        })
        .collect::<Vec<SetSlotSnapshot>>();

    Ok(SetSnapshot {
        set_id: set.id.to_string(),
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
        state: set.state.unwrap_or_default(),
        winner_id: set.winner_id.map(|id| id.to_string()),
        slots,
    })
}

async fn reset_set_if_needed(token: &str, set_id: &str) -> Result<(), String> {
    let variables = reset_set::Variables {
        set_id: set_id.to_owned(),
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

    let winner_wins = parts[0]
        .parse::<u32>()
        .map_err(|_| format!("scoreCsvの勝者側スコアを数値として解釈できません: {}", parts[0]))?;
    let loser_wins = parts[1]
        .parse::<u32>()
        .map_err(|_| format!("scoreCsvの敗者側スコアを数値として解釈できません: {}", parts[1]))?;

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
    let variables = tournament_sync::Variables {
        slug: slug.to_owned(),
        per_page: per_page as i64,
    };
    let body = TournamentSync::build_query(variables);

    let client = Client::new();
    let response = post_graphql_with_retry(&client, token, &body, "start.gg tournament取得").await?;

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
        return Err(format!("GraphQLエラー: {}", join_graphql_errors(&errors)));
    }

    let data = payload
        .data
        .ok_or_else(|| "GraphQLレスポンスにdataがありません。".to_owned())?;
    let tournament = data
        .tournament
        .ok_or_else(|| "指定slugのtournamentが見つかりません。".to_owned())?;

    let events = tournament
        .events
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .map(|event| {
            let sets = event
                .sets
                .and_then(|conn| conn.nodes)
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .map(|set| {
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
                            let seed_num = slot.seed.and_then(|seed| seed.seed_num.map(i64::from));
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
                                score,
                            }
                        })
                        .collect::<Vec<SetSlotSnapshot>>();

                    SetSnapshot {
                        set_id: set.id.to_string(),
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
                        state: set.state.unwrap_or_default(),
                        winner_id: set.winner_id.map(|id| id.to_string()),
                        slots,
                    }
                })
                .collect::<Vec<SetSnapshot>>();

            EventSnapshot {
                event_id: event.id.to_string(),
                name: event.name.unwrap_or_else(|| "Unnamed event".to_owned()),
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
) -> Result<TournamentSnapshot, String> {
    let client = Client::new();
    let min_chunk_per_page: i64 = 10;
    let mut chunk_per_page = per_page.clamp(10, 200) as i64;
    let mut page: i64;
    let mut round_set_ids: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    let mut no_round_set_ids: Vec<String> = Vec::new();
    let mut all_sets: Vec<SetSnapshot> = Vec::new();

    let mut tournament_id = String::new();
    let mut tournament_name = String::new();
    let mut tournament_slug = String::new();
    let mut event_id = String::new();
    let mut event_name = String::new();

    'retry: loop {
        page = 1;
        round_set_ids.clear();
        no_round_set_ids.clear();
        all_sets.clear();

        loop {
            let variables = event_sync::Variables {
                slug: event_slug.to_owned(),
                page,
                per_page: chunk_per_page,
            };
            let body = EventSync::build_query(variables);

            let response = post_graphql_with_retry(&client, token, &body, "event取得").await?;

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
            let event = data
                .event
                .ok_or_else(|| "指定eventが見つかりません。event slugを確認してください。".to_owned())?;

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
                if let Some(round) = set.round {
                    round_set_ids.entry(round).or_default().push(set_id);
                } else {
                    no_round_set_ids.push(set_id);
                }
            }

            let count = page_set_nodes.len();

            if count < chunk_per_page as usize {
                break;
            }

            page += 1;
        }

        break;
    }

    for set_ids in round_set_ids.values() {
        for set_id in set_ids {
            let set = fetch_set_snapshot_detail_with_client(&client, token, set_id).await?;
            all_sets.push(set);
        }
    }

    for set_id in &no_round_set_ids {
        let set = fetch_set_snapshot_detail_with_client(&client, token, set_id).await?;
        all_sets.push(set);
    }

    Ok(TournamentSnapshot {
        tournament_id,
        slug: tournament_slug,
        name: tournament_name,
        events: vec![EventSnapshot {
            event_id,
            name: event_name,
            sets: all_sets,
        }],
        updated_at: Utc::now(),
    })
}

pub async fn fetch_tournament_preview(token: &str, slug: &str) -> Result<TournamentPreview, String> {
    let variables = tournament_preview_query::Variables {
        slug: slug.to_owned(),
    };
    let body = TournamentPreviewQuery::build_query(variables);

    let client = Client::new();
    let response = post_graphql_with_retry(&client, token, &body, "tournamentプレビュー取得").await?;

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
        .map_err(|e| format!("tournamentプレビュー取得レスポンスのJSONパースに失敗しました: {e}"))?;

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
            set_count: 0,
        })
        .collect::<Vec<_>>();

    Ok(TournamentPreview {
        tournament_id: tournament.id.to_string(),
        slug: tournament.slug.unwrap_or_else(|| slug.to_owned()),
        name: tournament.name.unwrap_or_else(|| "Unnamed tournament".to_owned()),
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

    let entrant_ids = fetch_set_entrant_ids(token, set_id).await?;
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

