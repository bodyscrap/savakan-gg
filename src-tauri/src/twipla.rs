use std::collections::{HashMap, HashSet};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use scraper::{Html, Selector};
use serde::Serialize;
use tokio::time::Instant;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwiplaUser {
    id: String,
    name: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwiplaEvent {
    event_name: String,
    users: Vec<TwiplaUser>,
}

fn event_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "Invalid Twipla event URL")?;
    let path: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str() != Some("twipla.jp")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || path.len() != 3
        || path[1] != "events"
        || path[2].is_empty()
        || !path[2].bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("Invalid Twipla event URL".into());
    }
    Ok(format!("https://twipla.jp/events/{}", path[2]))
}

fn parse_event(source: &str) -> Result<TwiplaEvent, String> {
    let document = Html::parse_document(source);
    let title = Selector::parse("h1.largetext2").unwrap();
    let event_name = document.select(&title).next()
        .map(|element| element.text().collect::<String>().trim().to_owned())
        .filter(|name| !name.is_empty())
        .ok_or("Twipla event name is unavailable. Check that the event is public.")?;
    let groups = Selector::parse(".member_list").unwrap();
    let entries = Selector::parse("ul > li").unwrap();
    let account = Selector::parse("a.namelist").unwrap();
    let mut found = HashSet::new();
    let mut users = Vec::new();
    for group in document.select(&groups) {
        let heading = group.text().next().unwrap_or_default().trim();
        let status = if heading.starts_with("参加者") {
            "attending"
        } else if heading.starts_with("興味あり") {
            "interested"
        } else if heading.starts_with("不参加") {
            "notAttending"
        } else {
            continue;
        };
        if !found.insert(status) {
            return Err("Unexpected Twipla participant list format".into());
        }
        for (index, entry) in group.select(&entries).enumerate() {
            let link = entry.select(&account).next();
            let name = link
                .and_then(|element| element.value().attr("n").map(str::to_owned))
                .unwrap_or_else(|| entry.text().collect::<String>())
                .trim()
                .to_owned();
            if name.is_empty() {
                return Err("Twipla participant has no display name".into());
            }
            let id = link
                .and_then(|element| element.value().attr("s"))
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("anonymous:{status}:{index}"));
            users.push(TwiplaUser { id, name, status: status.into() });
        }
    }
    if found.len() != 3 {
        return Err("Twipla participant lists are unavailable. Check that the event is public.".into());
    }
    Ok(TwiplaEvent { event_name, users })
}

fn is_x_username(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 15
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn parse_x_display_name(source: &str, username: &str) -> Option<String> {
    if !is_x_username(username) {
        return None;
    }
    let document = Html::parse_document(source);
    let title_selector = Selector::parse("meta[property='og:title']").ok()?;
    let title = document.select(&title_selector).next()?.value().attr("content")?;
    let (name, account) = title.rsplit_once(" (@")?;
    let account = account.strip_suffix(") on X")
        .or_else(|| account.strip_suffix(") / X"))?;
    if !account.eq_ignore_ascii_case(username) {
        return None;
    }
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

fn apply_x_display_names(event: &mut TwiplaEvent, names: &HashMap<String, String>) {
    for user in &mut event.users {
        if let Some(name) = names.get(&user.id) {
            user.name.clone_from(name);
        }
    }
}

async fn fetch_x_display_name(client: reqwest::Client, username: String) -> Option<(String, String)> {
    let url = format!("https://x.com/{username}");
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success()
        || response.content_length().is_some_and(|length| length > 2 * 1024 * 1024)
    {
        return None;
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > 2 * 1024 * 1024 {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    let source = String::from_utf8(body).ok()?;
    parse_x_display_name(&source, &username).map(|name| (username, name))
}

async fn enrich_x_display_names(event: &mut TwiplaEvent) {
    let mut seen = HashSet::<String>::new();
    let usernames: Vec<_> = event.users.iter().map(|user| user.id.as_str())
        .filter(|username| is_x_username(username))
        .filter(|username| seen.insert((*username).to_owned()))
        .take(512)
        .map(str::to_owned)
        .collect();
    if usernames.is_empty() {
        return;
    }
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")
        .build() else {
        return;
    };
    let mut requests = stream::iter(usernames)
        .map(|username| fetch_x_display_name(client.clone(), username))
        .buffer_unordered(8);
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut names = HashMap::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, requests.next()).await {
            Ok(Some(Some((username, name)))) => { names.insert(username, name); }
            Ok(Some(None)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    apply_x_display_names(event, &names);
}

#[tauri::command]
pub async fn fetch_twipla_users(url: String) -> Result<TwiplaEvent, String> {
    let url = event_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client.get(url).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Twipla returned HTTP {}", response.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if body.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("Twipla page is too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    let source = String::from_utf8(body).map_err(|error| error.to_string())?;
    let mut event = parse_event(&source)?;
    enrich_x_display_names(&mut event).await;
    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricts_urls_to_twipla_events() {
        assert_eq!(event_url(" http://twipla.jp/events/123/?x=1#test ").unwrap(), "https://twipla.jp/events/123");
        for raw in ["https://evil.test/events/123", "https://twipla.jp.evil.test/events/123", "https://twipla.jp/events/", "https://twipla.jp/users/123", "https://twipla.jp:444/events/123", "https://user@twipla.jp/events/123"] {
            assert!(event_url(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn extracts_all_statuses_and_anonymous_users_without_merging_names() {
        let event = parse_event(r#"
            <title>Wrong title - TwiPla</title>
            <h1 class='largetext2'> 組合BYOC &amp; <span>Friends</span> </h1>
            <div class='member_list'>参加者 (3人)<ul>
              <li><img src='/img/egg.png'>&nbsp;<a class='namelist' s='alice' n='Alice &amp; Bob'>ignored</a></li>
              <li><img src='/img/hatena_avatar.gif'>&nbsp;Guest</li>
              <li>&nbsp;Guest</li>
            </ul></div>
            <div class='member_list'>興味あり (1人)<ul><li><a class='namelist' s='bob'>Bob</a></li></ul></div>
            <div class='member_list'>不参加 (1人)<ul><li><a class='namelist' s='carol' n='Carol'>Carol</a></li></ul></div>
        "#).unwrap();
        assert_eq!(event.event_name, "組合BYOC & Friends");
        let users = event.users;
        assert_eq!(users.len(), 5);
        assert_eq!(users[0].name, "Alice & Bob");
        assert_eq!(users[0].id, "alice");
        assert_eq!(users[1].name, "Guest");
        assert_ne!(users[1].id, users[2].id);
        assert_eq!(users[0].status, "attending");
        assert_eq!(users[3].status, "interested");
        assert_eq!(users[4].status, "notAttending");
    }

    #[test]
    fn rejects_missing_lists_but_accepts_empty_events() {
        assert!(parse_event("<h1 class='largetext2'>Event</h1>").is_err());
        let lists = "<div class='member_list'>参加者 (0人)<ul></ul></div><div class='member_list'>興味あり (0人)<ul></ul></div><div class='member_list'>不参加 (0人)<ul></ul></div>";
        assert!(parse_event(lists).is_err());
        assert!(parse_event(&format!("<h1 class='largetext2'> </h1>{lists}")).is_err());
        let event = parse_event(&format!("<h1 class='largetext2'>Event</h1>{lists}")).unwrap();
        assert!(event.users.is_empty());
        assert_eq!(event.event_name, "Event");
    }

    #[test]
    fn parses_x_display_name_only_for_the_requested_account() {
        let source = r#"<meta property="og:title" content="Alice Example (@alice_01) on X">"#;
        assert_eq!(parse_x_display_name(source, "alice_01").as_deref(), Some("Alice Example"));
        assert_eq!(parse_x_display_name(source, "other_user"), None);
        assert_eq!(parse_x_display_name(source, "anonymous:attending:0"), None);
    }

    #[test]
    fn preserves_twipla_name_when_x_lookup_does_not_return_a_name() {
        let mut event = parse_event(r#"
            <h1 class='largetext2'>Event</h1>
            <div class='member_list'>参加者 (2人)<ul>
              <li><a class='namelist' s='alice' n='Twipla Alice'>Alice</a></li>
              <li><a class='namelist' s='bob' n='Twipla Bob'>Bob</a></li>
            </ul></div>
            <div class='member_list'>興味あり (0人)<ul></ul></div>
            <div class='member_list'>不参加 (0人)<ul></ul></div>
        "#).unwrap();
        apply_x_display_names(&mut event, &HashMap::from([
            ("alice".to_owned(), "X Alice".to_owned()),
        ]));
        assert_eq!(event.users[0].name, "X Alice");
        assert_eq!(event.users[1].name, "Twipla Bob");
    }

    #[test]
    #[ignore = "requires network access to public X profiles"]
    fn fetches_public_x_display_name() {
        let name = tauri::async_runtime::block_on(fetch_x_display_name(
            reqwest::Client::new(), "two_siren".into(),
        ));
        assert_eq!(name, Some(("two_siren".into(), "サイレン".into())));
    }

    #[test]
    #[ignore = "requires network access to the public reference event"]
    fn fetches_reference_event_name_and_users() {
        let event = tauri::async_runtime::block_on(fetch_twipla_users(
            "https://twipla.jp/events/745567".into(),
        )).unwrap();
        assert_eq!(event.event_name, "組合BYOC");
        assert!(!event.users.is_empty());
    }
}