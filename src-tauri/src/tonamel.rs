use std::collections::{HashMap, HashSet};
use std::time::Duration;

use reqwest::header::{ACCEPT, COOKIE, ORIGIN, REFERER, SET_COOKIE};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

const GRAPHQL_URL: &str = "https://tonamel.com/graphql/competition_management";
const CSRF_URL: &str = "https://tonamel.com/api/csrf_token";
const PARTICIPANTS_PER_PAGE: usize = 32;
const MAX_PARTICIPANTS: usize = 512;
const USER_AGENT_VALUE: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

const COMPETITION_QUERY: &str = r#"
query TonamelImportCompetition($competitionId: ID!) {
  competition(id: $competitionId) {
    id
    title
    tournaments { id status }
    entryMenus {
      id
      forParticipation
      countSummary { currentEntrantNum }
            questions { id label private index }
    }
  }
}
"#;

const ENTRANTS_QUERY: &str = r#"
query TonamelImportEntrants($competitionId: ID!, $entryMenuId: ID!, $entrantFilter: EntrantFilter!, $entryMenuEntrantStatus: EntryMenuEntrantStatus!) {
  competition(id: $competitionId) {
    entryMenu(id: $entryMenuId) {
      entrants(filter: $entrantFilter, entryMenuEntrantStatus: $entryMenuEntrantStatus) {
        edges {
          node {
            id
            serialNumber
            canceled
            entrantName { text { answer } }
            overridePlayerName
                        answers {
                            question { id }
                            text { answer }
                            selection { selectableItems { text } }
                        }
          }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
}
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonamelParticipant {
    id: String,
    name: String,
    serial_number: u32,
    status: String,
    answers: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonamelColumn {
    id: String,
    label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonamelEvent {
    event_name: String,
    columns: Vec<TonamelColumn>,
    users: Vec<TonamelParticipant>,
}

struct TonamelPageUrl {
    competition_id: String,
    tournament_id: Option<String>,
    referer: String,
}

fn parse_competition_url(raw: &str) -> Result<TonamelPageUrl, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Invalid Tonamel competition URL")?;
    let path: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let is_competition_page = path.len() == 2;
    let is_participants_page = path.len() == 3 && path[2] == "participants";
    if url.scheme() != "https"
        || url.host_str() != Some("tonamel.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || (!is_competition_page && !is_participants_page)
        || path[0] != "competition"
        || !path[1].bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Enter a Tonamel competition URL".into());
    }
    let tournament_id = url.query_pairs()
        .find(|(key, _)| key == "tournament_id")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty());
    let mut referer_url = url.clone();
    referer_url.set_fragment(None);
    Ok(TonamelPageUrl {
        competition_id: path[1].to_owned(),
        tournament_id,
        referer: referer_url.to_string(),
    })
}

#[derive(Deserialize)]
struct CsrfToken {
    csrf_token: String,
}

#[derive(Deserialize)]
struct GraphqlError {
    message: String,
}

#[derive(Deserialize)]
struct GraphqlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

async fn post_graphql<T: DeserializeOwned>(
    client: &Client,
    cookie: &str,
    csrf_token: &str,
    referer: &str,
    body: Value,
) -> Result<T, String> {
    let response = client.post(GRAPHQL_URL)
        .header(ACCEPT, "application/json")
        .header(ORIGIN, "https://tonamel.com")
        .header(REFERER, referer)
        .header(COOKIE, cookie)
        .header("x-csrf-token", csrf_token)
        .json(&body)
        .send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let result: GraphqlResponse<T> = response.json().await.map_err(|error| error.to_string())?;
    if let Some(error) = result.errors.first() {
        return Err(format!("Tonamel GraphQL: {}", error.message));
    }
    if !status.is_success() {
        return Err(format!("Tonamel returned HTTP {status}"));
    }
    result.data.ok_or_else(|| "Tonamel returned no data".into())
}

#[derive(Deserialize)]
struct CompetitionData {
    competition: Option<Competition>,
}

#[derive(Deserialize)]
struct Competition {
    title: String,
    tournaments: Vec<Tournament>,
    #[serde(rename = "entryMenus")]
    entry_menus: Vec<EntryMenu>,
}

#[derive(Deserialize)]
struct Tournament {
    id: String,
}

#[derive(Deserialize)]
struct EntryMenu {
    id: String,
    #[serde(rename = "forParticipation")]
    for_participation: bool,
    questions: Vec<EntryQuestion>,
}

#[derive(Deserialize)]
struct EntryQuestion {
    id: String,
    label: String,
    private: bool,
    index: i64,
}

#[derive(Deserialize)]
struct EntrantsData {
    competition: Option<CompetitionEntrants>,
}

#[derive(Deserialize)]
struct CompetitionEntrants {
    #[serde(rename = "entryMenu")]
    entry_menu: Option<EntryMenuEntrants>,
}

#[derive(Deserialize)]
struct EntryMenuEntrants {
    entrants: EntrantsConnection,
}

#[derive(Deserialize)]
struct EntrantsConnection {
    edges: Vec<EntrantEdge>,
    #[serde(rename = "pageInfo")]
    page_info: PageInfo,
}

#[derive(Deserialize)]
struct EntrantEdge {
    node: EntrantNode,
}

#[derive(Deserialize)]
struct EntrantNode {
    id: String,
    #[serde(rename = "serialNumber")]
    serial_number: Option<u32>,
    canceled: bool,
    #[serde(rename = "entrantName")]
    entrant_name: Option<EntrantName>,
    #[serde(rename = "overridePlayerName")]
    override_player_name: Option<String>,
    #[serde(default)]
    answers: Vec<EntrantAnswer>,
}

#[derive(Deserialize)]
struct EntrantAnswer {
    question: AnswerQuestion,
    text: Option<TextAnswer>,
    selection: Option<SelectionAnswer>,
}

#[derive(Deserialize)]
struct AnswerQuestion {
    id: String,
}

#[derive(Deserialize)]
struct TextAnswer {
    answer: String,
}

#[derive(Deserialize)]
struct SelectionAnswer {
    #[serde(rename = "selectableItems", default)]
    selectable_items: Vec<SelectedItem>,
}

#[derive(Deserialize)]
struct SelectedItem {
    text: String,
}

#[derive(Deserialize)]
struct EntrantName {
    text: Option<EntrantNameText>,
}

#[derive(Deserialize)]
struct EntrantNameText {
    answer: String,
}

#[derive(Deserialize)]
struct PageInfo {
    #[serde(rename = "endCursor")]
    end_cursor: Option<String>,
    #[serde(rename = "hasNextPage")]
    has_next_page: bool,
}

fn participant_from_node(node: EntrantNode, public_question_ids: &HashSet<String>) -> Result<Option<TonamelParticipant>, String> {
    if node.canceled {
        return Ok(None);
    }
    let name = node.entrant_name.and_then(|entrant_name| entrant_name.text)
        .map(|text| text.answer)
        .filter(|name| !name.trim().is_empty())
        .or(node.override_player_name)
        .ok_or("A Tonamel entry has no name")?;
    let answers = node.answers.into_iter().filter_map(|answer| {
        if !public_question_ids.contains(&answer.question.id) {
            return None;
        }
        let text = answer.text.map(|text| text.answer).unwrap_or_default();
        let value = if !text.trim().is_empty() {
            text
        } else {
            answer.selection.map(|selection| selection.selectable_items.into_iter()
                .map(|item| item.text).collect::<Vec<_>>().join(","))?
        };
        Some((answer.question.id, value))
    }).collect();
    Ok(Some(TonamelParticipant {
        id: node.id,
        name: name.trim().to_owned(),
        serial_number: node.serial_number.unwrap_or_default(),
        status: "ENTRY".into(),
        answers,
    }))
}

#[tauri::command]
pub async fn fetch_tonamel_participants(url: String) -> Result<TonamelEvent, String> {
    let page = parse_competition_url(&url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT_VALUE)
        .build().map_err(|error| error.to_string())?;

    let csrf_response = client.get(CSRF_URL)
        .header(ACCEPT, "application/json")
        .header(ORIGIN, "https://tonamel.com")
        .header(REFERER, &page.referer)
        .send().await.map_err(|error| error.to_string())?;
    if !csrf_response.status().is_success() {
        return Err(format!("Tonamel returned HTTP {}", csrf_response.status()));
    }
    let cookie = csrf_response.headers().get_all(SET_COOKIE).iter()
        .filter_map(|header| header.to_str().ok())
        .find_map(|value| value.split(';').next()
            .filter(|cookie| cookie.starts_with("tournament%3A%3Aweb_session=")))
        .ok_or("Tonamel did not provide an anonymous session")?
        .to_owned();
    let csrf: CsrfToken = csrf_response.json().await.map_err(|error| error.to_string())?;

    let competition_data: CompetitionData = post_graphql(
        &client, &cookie, &csrf.csrf_token, &page.referer,
        json!({"query": COMPETITION_QUERY, "variables": {"competitionId": page.competition_id}}),
    ).await?;
    let competition = competition_data.competition.ok_or("Tonamel competition was not found")?;
    match page.tournament_id {
        Some(id) if competition.tournaments.iter().any(|tournament| tournament.id == id) => {},
        Some(_) => return Err("The tournament_id does not belong to this Tonamel competition".into()),
        None if competition.tournaments.is_empty() => return Err("Tonamel competition has no tournament".into()),
        None => {},
    }
    let entry_menus: Vec<_> = competition.entry_menus.into_iter()
        .filter(|menu| menu.for_participation).collect();
    if entry_menus.is_empty() {
        return Err("Tonamel competition has no participant entry menu".into());
    }

    let mut columns_by_id = HashMap::new();
    for question in entry_menus.iter().flat_map(|menu| &menu.questions) {
        if !question.private && !question.label.trim().is_empty() {
            columns_by_id.entry(question.id.clone())
                .or_insert((question.index, question.label.trim().to_owned()));
        }
    }
    let mut ordered_columns: Vec<_> = columns_by_id.into_iter().collect();
    ordered_columns.sort_by_key(|(_, (index, _))| *index);
    let public_question_ids: HashSet<_> = ordered_columns.iter().map(|(id, _)| id.clone()).collect();
    let columns = ordered_columns.into_iter().map(|(id, (_, label))| TonamelColumn { id, label }).collect();

    let mut seen = HashSet::new();
    let mut users = Vec::new();
    for menu in entry_menus {
        let mut after = String::new();
        loop {
            let variables = json!({
                "competitionId": page.competition_id,
                "entryMenuId": menu.id,
                "entrantFilter": {"first": PARTICIPANTS_PER_PAGE, "last": 0, "before": "", "after": after},
                "entryMenuEntrantStatus": "ENTRY",
            });
            let data: EntrantsData = post_graphql(
                &client, &cookie, &csrf.csrf_token, &page.referer,
                json!({"query": ENTRANTS_QUERY, "variables": variables}),
            ).await?;
            let connection = data.competition.and_then(|competition| competition.entry_menu)
                .ok_or("Tonamel participant list was not found")?.entrants;
            for edge in connection.edges {
                if seen.insert(edge.node.id.clone()) {
                    if let Some(user) = participant_from_node(edge.node, &public_question_ids)? {
                        users.push(user);
                        if users.len() > MAX_PARTICIPANTS {
                            return Err("Tonamel participants exceed the 512 participant limit".into());
                        }
                    }
                }
            }
            if !connection.page_info.has_next_page {
                break;
            }
            let next = connection.page_info.end_cursor.ok_or("Tonamel pagination cursor is missing")?;
            if next.is_empty() || next == after {
                return Err("Tonamel pagination did not advance".into());
            }
            after = next;
        }
    }
    if users.is_empty() {
        return Err("Tonamel has no active participant entries".into());
    }
    users.sort_by_key(|user| user.serial_number);
    Ok(TonamelEvent { event_name: competition.title, columns, users })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_tonamel_competition_and_participants_urls() {
        let page = parse_competition_url("https://tonamel.com/competition/GGzJP").unwrap();
        assert_eq!(page.competition_id, "GGzJP");
        assert_eq!(page.tournament_id, None);
        let page = parse_competition_url("https://tonamel.com/competition/GGzJP/participants?tournament_id=dG91cm5hbWVudA").unwrap();
        assert_eq!(page.competition_id, "GGzJP");
        assert_eq!(page.tournament_id.as_deref(), Some("dG91cm5hbWVudA"));
    }

    #[test]
    fn rejects_urls_outside_tonamel_participant_pages() {
        for raw in [
            "http://tonamel.com/competition/GGzJP",
            "https://evil.test/competition/GGzJP",
            "https://tonamel.com.evil.test/competition/GGzJP",
            "https://tonamel.com/competition/GGzJP/tournament",
            "https://user@tonamel.com/competition/GGzJP/participants",
            "https://tonamel.com:444/competition/GGzJP/participants",
            "https://tonamel.com/competition/GGzJP/participants/extra",
        ] {
            assert!(parse_competition_url(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn imports_entry_name_and_skips_canceled_entries() {
        let participant = participant_from_node(EntrantNode {
            id: "entrant-1".into(), serial_number: Some(3), canceled: false,
            entrant_name: Some(EntrantName { text: Some(EntrantNameText { answer: " Full Entry Name ".into() }) }),
            override_player_name: Some("Other Name".into()),
            answers: vec![
                EntrantAnswer {
                    question: AnswerQuestion { id: "public".into() },
                    text: Some(TextAnswer { answer: "A,B".into() }), selection: None,
                },
                EntrantAnswer {
                    question: AnswerQuestion { id: "private".into() },
                    text: Some(TextAnswer { answer: "secret".into() }), selection: None,
                },
                EntrantAnswer {
                    question: AnswerQuestion { id: "selection".into() }, text: None,
                    selection: Some(SelectionAnswer { selectable_items: vec![
                        SelectedItem { text: "Stage 1".into() }, SelectedItem { text: "Stage 2".into() },
                    ] }),
                },
            ],
        }, &HashSet::from(["public".into(), "selection".into()])).unwrap().unwrap();
        assert_eq!(participant.name, "Full Entry Name");
        assert_eq!(participant.serial_number, 3);
        assert_eq!(participant.answers.get("public").map(String::as_str), Some("A,B"));
        assert_eq!(participant.answers.get("selection").map(String::as_str), Some("Stage 1,Stage 2"));
        assert!(!participant.answers.contains_key("private"));
        assert!(participant_from_node(EntrantNode {
            id: "canceled".into(), serial_number: None, canceled: true,
            entrant_name: None, override_player_name: None,
            answers: vec![],
        }, &HashSet::new()).unwrap().is_none());
    }

    #[test]
    #[ignore = "requires network access to the public reference competition"]
    fn fetches_public_reference_participants_without_login() {
        let event = tauri::async_runtime::block_on(fetch_tonamel_participants(
            "https://tonamel.com/competition/GGzJP".into(),
        )).unwrap();
        assert_eq!(event.event_name, "20260726第2回2XKO中級者大会");
        assert_eq!(event.users.len(), 7);
        assert_eq!(event.users[0].name, "テンカク");
    }
}