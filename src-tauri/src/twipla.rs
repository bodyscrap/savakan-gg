use std::collections::HashSet;
use std::time::Duration;

use scraper::{Html, Selector};
use serde::Serialize;

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
    parse_event(&source)
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
    #[ignore = "requires network access to the public reference event"]
    fn fetches_reference_event_name_and_users() {
        let event = tauri::async_runtime::block_on(fetch_twipla_users(
            "https://twipla.jp/events/745567".into(),
        )).unwrap();
        assert_eq!(event.event_name, "組合BYOC");
        assert!(!event.users.is_empty());
    }
}