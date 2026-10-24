use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::Manager;

const MAX_BYTES: u64 = 32 * 1024 * 1024;
const BUILT_IN_COMPONENT_IDS: [&str; 8] = [
    "builtin-redPlayerName",
    "builtin-redSetWins",
    "builtin-text",
    "builtin-setName",
    "builtin-roundName",
    "builtin-blueSetWins",
    "builtin-bluePlayerName",
    "builtin-eventAlias",
];
static STORE: OnceLock<Mutex<(PathBuf, Layouts)>> = OnceLock::new();
static REVISION: AtomicU64 = AtomicU64::new(1);
static VISIBILITY_SHOW_REVISION: AtomicU64 = AtomicU64::new(0);
static FONT_FAMILIES: Mutex<Option<Vec<String>>> = Mutex::new(None);
static VISIBILITY_OVERRIDES: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
static VISIBILITY_SHOW_REVISIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();

pub fn revision() -> String {
    REVISION.load(Ordering::SeqCst).to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentFrame {
    Plate,
    SetMain,
    SetSub,
    EventAlias,
    Glass,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Component {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    kind: String,
    source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    number_value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    item_category: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    delimiter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    clock_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wrap_text: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shrink_text: Option<bool>,
    text: String,
    image: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_aspect_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    preserve_aspect_ratio: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_alpha: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    flip_horizontal: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_animation_on_display: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_animation_value_source: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    font_family: String,
    font_size: f64,
    color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text_outline_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text_outline_color: Option<String>,
    background: String,
    align: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vertical_align: Option<String>,
    bold: bool,
    visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    frame: Option<ComponentFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preset {
    id: String,
    name: String,
    width: u32,
    height: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    visibility_control_ids: Vec<String>,
    components: Vec<Component>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layouts {
    version: u32,
    active_preset_id: Option<String>,
    presets: Vec<Preset>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    default_visibility_control_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityControl {
    pub slot: usize,
    pub id: String,
    pub name: String,
    pub visible: bool,
}

impl Default for Layouts {
    fn default() -> Self {
        Self {
            version: 1,
            active_preset_id: None,
            presets: Vec::new(),
            default_visibility_control_ids: Vec::new(),
        }
    }
}

fn color(value: &str) -> bool {
    matches!(value.len(), 7 | 9)
        && value.starts_with('#')
        && value[1..].bytes().all(|c| c.is_ascii_hexdigit())
}

fn image(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    if value.len() > 4_194_304_usize.div_ceil(3) * 4 + 64 {
        return false;
    }
    let Some((prefix, data)) = value.split_once(',') else {
        return false;
    };
    if ![
        "data:image/png;base64",
        "data:image/jpeg;base64",
        "data:image/gif;base64",
        "data:image/webp;base64",
    ]
    .contains(&prefix)
    {
        return false;
    }
    let body = data.trim_end_matches('=');
    !body.is_empty()
        && data.len() - body.len() <= 2
        && data.len() % 4 == 0
        && data.len() / 4 * 3 - (data.len() - body.len()) <= 4_194_304
        && body
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
}

fn within(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}

impl Layouts {
    fn migrate(&mut self) {
        for component in self
            .presets
            .iter_mut()
            .flat_map(|preset| &mut preset.components)
        {
            if component.kind == "text"
                && ["redSetWins", "blueSetWins"].contains(&component.source.as_str())
            {
                component.kind = "number".to_owned();
            }
        }
    }

    fn validate(&self) -> Result<(), String> {
        let invalid = || "Invalid overlay preset data.".to_owned();
        if self.version != 1 || self.presets.len() > 64 {
            return Err(invalid());
        }
        let mut ids = HashSet::new();
        for preset in &self.presets {
            if preset.id.is_empty()
                || preset.id.encode_utf16().count() > 128
                || !ids.insert(&preset.id)
                || preset.name.trim().is_empty()
                || preset.name.chars().count() > 256
                || !(1..=16384).contains(&preset.width)
                || !(1..=16384).contains(&preset.height)
                || preset.components.len() > 128
            {
                return Err(invalid());
            }
            let mut component_ids = HashSet::new();
            for c in &preset.components {
                if c.id.is_empty()
                    || c.id.encode_utf16().count() > 128
                    || !component_ids.insert(&c.id)
                    || c.name.as_ref().is_some_and(|name| {
                        name.trim().is_empty() || name.encode_utf16().count() > 256
                    })
                    || !["text", "number", "image", "item", "clock"].contains(&c.kind.as_str())
                    || ![
                        "text",
                        "number",
                        "redPlayerName",
                        "bluePlayerName",
                        "redSetWins",
                        "blueSetWins",
                        "roundText",
                        "setName",
                        "roundName",
                        "eventName",
                        "eventAlias",
                        "redItems",
                        "blueItems",
                        "clock",
                    ]
                    .contains(&c.source.as_str())
                    || (if c.kind == "clock" {
                        c.source != "clock" || c.clock_format.is_none()
                    } else {
                        c.source == "clock"
                    })
                    || c.clock_format.as_ref().is_some_and(|value| value.is_empty() || value.encode_utf16().count() > 256)
                    || (if c.kind == "item" {
                        !["redItems", "blueItems"].contains(&c.source.as_str())
                            || !matches!(c.item_category, Some(1..=3))
                            || c.delimiter.is_none()
                    } else {
                        ["redItems", "blueItems"].contains(&c.source.as_str())
                    })
                    || c.item_category.is_some_and(|value| !(1..=3).contains(&value))
                    || c.delimiter.as_ref().is_some_and(|value| value.encode_utf16().count() > 256)
                    || (c.kind == "number"
                        && !["redSetWins", "blueSetWins", "number"].contains(&c.source.as_str()))
                    || (c.source == "number" && (c.kind != "number" || c.number_value.is_none()))
                    || c.number_value.is_some_and(|value| !value.is_finite())
                    || c.text.chars().count() > 10000
                    || !image(&c.image)
                    || c.image_file_name
                        .as_ref()
                        .is_some_and(|name| name.encode_utf16().count() > 1024)
                    || c.image_aspect_ratio
                        .is_some_and(|value| !within(value, 1. / 16384., 16384.))
                    || c.image_alpha.is_some_and(|value| value > 255)
                    || c.image_animation_value_source.as_ref().is_some_and(|source| {
                        ![
                            "redPlayerName",
                            "bluePlayerName",
                            "roundText",
                            "setName",
                            "roundName",
                            "redSetWins",
                            "blueSetWins",
                        ]
                        .contains(&source.as_str())
                    })
                    || !within(c.x, 0., 16384.)
                    || !within(c.y, 0., 16384.)
                    || !within(c.width, 1., 16384.)
                    || !within(c.height, 1., 16384.)
                    || !within(c.font_size, 1., 1000.)
                    || c.font_family.chars().count() > 256
                    || !color(&c.color)
                    || c.text_outline_width
                        .is_some_and(|value| value != 0. && !within(value, 0.5, 16.))
                    || c.text_outline_color
                        .as_ref()
                        .is_some_and(|value| !color(value))
                    || !(c.background == "transparent" || color(&c.background))
                    || !["left", "center", "right"].contains(&c.align.as_str())
                    || c.vertical_align.as_ref().is_some_and(|value| !["top", "center", "bottom"].contains(&value.as_str()))
                {
                    return Err(invalid());
                }
            }
            let mut visibility_control_ids = HashSet::new();
            if preset.visibility_control_ids.len() > 6
                || preset.visibility_control_ids.iter().any(|id| {
                    !id.is_empty()
                        && (!component_ids.contains(id)
                            || !visibility_control_ids.insert(id))
                })
            {
                return Err(invalid());
            }
        }
        let mut default_visibility_control_ids = HashSet::new();
        if self.default_visibility_control_ids.len() > 6
            || self.default_visibility_control_ids.iter().any(|id| {
                !id.is_empty()
                    && (!BUILT_IN_COMPONENT_IDS.contains(&id.as_str())
                        || !default_visibility_control_ids.insert(id))
            })
        {
            return Err(invalid());
        }
        if self
            .active_preset_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
        {
            return Err(invalid());
        }
        Ok(())
    }
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Cannot create overlay settings directory: {e}"))?;
    let path = dir.join("overlay-layouts.json");
    let layouts = read_layouts(&path)?;
    STORE
        .set(Mutex::new((path, layouts)))
        .map_err(|_| "Overlay settings already initialized.".to_owned())
}

fn read_layouts(path: &Path) -> Result<Layouts, String> {
    match fs::metadata(path) {
        Ok(metadata) => {
            if metadata.len() > MAX_BYTES {
                return Err("Overlay settings exceed 32MB.".to_owned());
            }
            let data = fs::read(&path).map_err(|e| e.to_string())?;
            let mut layouts: Layouts = serde_json::from_slice(&data)
                .map_err(|e| format!("Cannot read overlay settings: {e}"))?;
            layouts.migrate();
            layouts.validate()?;
            Ok(layouts)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Layouts::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_layouts(path: &Path, data: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, data).map_err(|e| format!("Cannot write overlay settings: {e}"))?;
    fs::rename(&temporary, path).map_err(|e| format!("Cannot replace overlay settings: {e}"))
}

#[tauri::command]
pub fn get_overlay_layouts() -> Result<Layouts, String> {
    let store = STORE
        .get()
        .ok_or("Overlay settings are not initialized.")?
        .lock()
        .map_err(|_| "Cannot lock overlay settings.")?;
    Ok(store.1.clone())
}

pub fn visibility_controls() -> Result<Vec<VisibilityControl>, String> {
    let layouts = get_overlay_layouts()?;
    if let Some(preset) = layouts
        .presets
        .iter()
        .find(|preset| Some(&preset.id) == layouts.active_preset_id.as_ref())
    {
        return Ok(preset
            .visibility_control_ids
            .iter()
            .enumerate()
            .filter_map(|(slot, id)| {
                preset
                    .components
                    .iter()
                    .find(|component| component.id == *id)
                    .map(|component| VisibilityControl {
                        slot,
                        id: id.clone(),
                        name: component
                            .name
                            .clone()
                            .filter(|name| !name.trim().is_empty())
                            .unwrap_or_else(|| component.id.clone()),
                        visible: component.visible,
                    })
            })
            .collect());
    }

    Ok(layouts
        .default_visibility_control_ids
        .iter()
        .enumerate()
        .filter_map(|(slot, id)| {
            let name = match id.as_str() {
                "builtin-redPlayerName" => "1P プレイヤー名",
                "builtin-redSetWins" => "1P 取得ゲーム数",
                "builtin-text" => "セット情報の背景",
                "builtin-setName" => "Phase / Pool / Set名",
                "builtin-roundName" => "ラウンド名",
                "builtin-blueSetWins" => "2P 取得ゲーム数",
                "builtin-bluePlayerName" => "2P プレイヤー名",
                "builtin-eventAlias" => "イベントエイリアス",
                _ => return None,
            };
            Some(VisibilityControl {
                slot,
                id: id.clone(),
                name: name.to_owned(),
                visible: true,
            })
        })
        .collect())
}

fn unique_font_families<'a>(families: impl Iterator<Item = &'a str>) -> Vec<String> {
    families
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.encode_utf16().count() <= 256)
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn system_font_families() -> Result<Vec<String>, String> {
    let mut cached = FONT_FAMILIES
        .lock()
        .map_err(|_| "Cannot lock the system font list.")?;
    if let Some(families) = cached.as_ref() {
        return Ok(families.clone());
    }
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let families = unique_font_families(
        database
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.as_str())),
    );
    if families.is_empty() {
        return Err("No system font families were found in the standard font directories.".to_owned());
    }
    *cached = Some(families.clone());
    Ok(families)
}

#[tauri::command]
pub async fn list_overlay_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(system_font_families)
        .await
        .map_err(|error| format!("Cannot list system fonts: {error}"))?
}

fn persist_layouts(
    store: &mut (PathBuf, Layouts),
    mut layouts: Layouts,
) -> Result<Layouts, String> {
    layouts.migrate();
    layouts.validate()?;
    let data = serde_json::to_vec(&layouts).map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_BYTES {
        return Err("Overlay settings exceed 32MB.".to_owned());
    }
    let mut overrides = VISIBILITY_OVERRIDES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cannot lock overlay visibility settings.")?;
    let mut show_revisions = VISIBILITY_SHOW_REVISIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cannot lock overlay visibility settings.")?;
    let active_preset_changed = store.1.active_preset_id != layouts.active_preset_id;
    let mut reset_overrides = HashSet::new();
    if !active_preset_changed {
        let previous = store.1.presets.iter().find(|preset| {
            Some(&preset.id) == store.1.active_preset_id.as_ref()
        });
        let next = layouts
            .presets
            .iter()
            .find(|preset| Some(&preset.id) == layouts.active_preset_id.as_ref());
        if let (Some(previous), Some(next)) = (previous, next) {
            for component in &previous.components {
                if next.components.iter().any(|candidate| {
                    candidate.id == component.id && candidate.visible != component.visible
                }) {
                    reset_overrides.insert(component.id.clone());
                }
            }
        }
    }
    write_layouts(&store.0, &data)?;
    store.1 = layouts.clone();
    if active_preset_changed {
        overrides.clear();
        show_revisions.clear();
    } else {
        let allowed = layouts
            .presets
            .iter()
            .find(|preset| Some(&preset.id) == layouts.active_preset_id.as_ref())
            .map(|preset| {
                preset
                    .visibility_control_ids
                    .iter()
                    .filter(|id| !id.is_empty())
                    .cloned()
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_else(|| {
                layouts
                    .default_visibility_control_ids
                    .iter()
                    .filter(|id| !id.is_empty())
                    .cloned()
                    .collect::<HashSet<_>>()
            });
        overrides.retain(|id, _| allowed.contains(id) && !reset_overrides.contains(id));
            show_revisions.retain(|id, _| allowed.contains(id));
    }
    REVISION.fetch_add(1, Ordering::SeqCst);
    Ok(layouts)
}

#[tauri::command]
pub fn save_overlay_layouts(layouts: Layouts) -> Result<Layouts, String> {
    let mut store = STORE
        .get()
        .ok_or("Overlay settings are not initialized.")?
        .lock()
        .map_err(|_| "Cannot lock overlay settings.")?;
    persist_layouts(&mut store, layouts)
}

fn apply_saved_preset(
    store: &mut (PathBuf, Layouts),
    preset_id: Option<String>,
) -> Result<Layouts, String> {
    let mut layouts = store.1.clone();
    layouts.active_preset_id = preset_id;
    persist_layouts(store, layouts)
}

#[tauri::command]
pub fn apply_overlay_preset(preset_id: Option<String>) -> Result<Layouts, String> {
    let mut store = STORE
        .get()
        .ok_or("Overlay settings are not initialized.")?
        .lock()
        .map_err(|_| "Cannot lock overlay settings.")?;
    apply_saved_preset(&mut store, preset_id)
}

#[tauri::command]
pub fn set_overlay_component_visibility(
    component_id: String,
    visible: bool,
) -> Result<bool, String> {
    let store = STORE
        .get()
        .ok_or("Overlay settings are not initialized.")?
        .lock()
        .map_err(|_| "Cannot lock overlay settings.")?;
    let preset = store
        .1
        .presets
        .iter()
        .find(|preset| Some(&preset.id) == store.1.active_preset_id.as_ref());
    let initial_visibility = if let Some(preset) = preset {
        if !preset.visibility_control_ids.contains(&component_id) {
            return Err("The component is not available for display toggling.".to_owned());
        }
        preset
            .components
            .iter()
            .find(|component| component.id == component_id)
            .map(|component| component.visible)
    } else {
        (store
            .1
            .default_visibility_control_ids
            .contains(&component_id)
            && BUILT_IN_COMPONENT_IDS.contains(&component_id.as_str()))
        .then_some(true)
    };
    let Some(initial_visibility) = initial_visibility else {
        return Err("The component is not available for display toggling.".to_owned());
    };
    let mut overrides = VISIBILITY_OVERRIDES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cannot lock overlay visibility settings.")?;
    let was_visible = overrides
        .get(&component_id)
        .copied()
        .unwrap_or(initial_visibility);
    if is_visibility_show_transition(was_visible, visible) {
        let revision = VISIBILITY_SHOW_REVISION.fetch_add(1, Ordering::SeqCst) + 1;
        VISIBILITY_SHOW_REVISIONS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "Cannot lock overlay visibility settings.")?
            .insert(component_id.clone(), revision);
    }
    set_visibility_override(&mut overrides, &component_id, initial_visibility, visible);
    Ok(visible)
}

fn set_visibility_override(
    overrides: &mut HashMap<String, bool>,
    component_id: &str,
    initial_visibility: bool,
    visible: bool,
) {
    if visible == initial_visibility {
        overrides.remove(component_id);
    } else {
        overrides.insert(component_id.to_owned(), visible);
    }
}

fn is_visibility_show_transition(was_visible: bool, visible: bool) -> bool {
    !was_visible && visible
}

pub fn visibility_overrides() -> Result<HashMap<String, bool>, String> {
    let store = STORE
        .get()
        .ok_or("Overlay settings are not initialized.")?
        .lock()
        .map_err(|_| "Cannot lock overlay settings.")?;
    let preset = store
        .1
        .presets
        .iter()
        .find(|preset| Some(&preset.id) == store.1.active_preset_id.as_ref());
    let selected_ids = preset.map_or(&store.1.default_visibility_control_ids, |preset| {
        &preset.visibility_control_ids
    });
    let overrides = VISIBILITY_OVERRIDES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cannot lock overlay visibility settings.")?;
    Ok(selected_ids
        .iter()
        .filter_map(|id| {
            if id.is_empty() {
                return None;
            }
            overrides.get(id).map(|visible| (id.clone(), *visible))
        })
        .collect())
}

pub fn visibility_show_revisions() -> Result<HashMap<String, u64>, String> {
    let store = STORE
        .get()
        .ok_or("Overlay settings are not initialized.")?
        .lock()
        .map_err(|_| "Cannot lock overlay settings.")?;
    let preset = store
        .1
        .presets
        .iter()
        .find(|preset| Some(&preset.id) == store.1.active_preset_id.as_ref());
    let selected_ids = preset.map_or(&store.1.default_visibility_control_ids, |preset| {
        &preset.visibility_control_ids
    });
    let revisions = VISIBILITY_SHOW_REVISIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cannot lock overlay visibility settings.")?;
    Ok(selected_ids
        .iter()
        .filter_map(|id| {
            if id.is_empty() {
                return None;
            }
            revisions.get(id).map(|revision| (id.clone(), *revision))
        })
        .collect())
}

pub fn active_json() -> Result<String, String> {
    let layouts = get_overlay_layouts()?;
    let preset = layouts
        .presets
        .iter()
        .find(|p| Some(&p.id) == layouts.active_preset_id.as_ref());
    serde_json::to_string(&preset).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn applies_only_saved_presets_and_persists_selection_without_changing_contents() {
        let directory =
            std::env::temp_dir().join(format!("savakan-apply-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("layouts.json");
        let original = sample();
        let contents = serde_json::to_value(&original).unwrap()["presets"].clone();
        let mut store = (path.clone(), original);
        let before_revision = revision();
        let legacy = apply_saved_preset(&mut store, None).unwrap();
        assert_eq!(legacy.active_preset_id, None);
        assert_eq!(read_layouts(&path).unwrap().active_preset_id, None);
        assert_ne!(revision(), before_revision);
        let selected = apply_saved_preset(&mut store, Some("preset".to_owned())).unwrap();
        assert_eq!(selected.active_preset_id.as_deref(), Some("preset"));
        assert_eq!(
            serde_json::to_value(&selected).unwrap()["presets"],
            contents
        );
        assert_eq!(
            read_layouts(&path).unwrap().active_preset_id.as_deref(),
            Some("preset")
        );
        let saved_file = fs::read(&path).unwrap();
        assert!(apply_saved_preset(&mut store, Some("unsaved-preset".to_owned())).is_err());
        assert_eq!(store.1.active_preset_id.as_deref(), Some("preset"));
        assert_eq!(fs::read(&path).unwrap(), saved_file);
        let mut failed_store = (directory.join("missing").join("layouts.json"), selected);
        assert!(apply_saved_preset(&mut failed_store, None).is_err());
        assert_eq!(failed_store.1.active_preset_id.as_deref(), Some("preset"));
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn migrates_legacy_text_scores_without_changing_display_fields() {
        let mut layouts = sample();
        let component = &mut layouts.presets[0].components[0];
        component.kind = "text".to_owned();
        component.source = "redSetWins".to_owned();
        let original = serde_json::to_value(&layouts).unwrap();
        layouts.migrate();
        layouts.validate().unwrap();
        let mut expected = original;
        expected["presets"][0]["components"][0]["kind"] = serde_json::json!("number");
        assert_eq!(serde_json::to_value(&layouts).unwrap(), expected);
        let directory =
            std::env::temp_dir().join(format!("savakan-numeric-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("layouts.json");
        layouts.presets[0].components[0].kind = "text".to_owned();
        write_layouts(&path, &serde_json::to_vec(&layouts).unwrap()).unwrap();
        assert_eq!(
            read_layouts(&path).unwrap().presets[0].components[0].kind,
            "number"
        );
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn persists_numeric_values_and_rejects_invalid_numeric_sources() {
        let mut layouts = sample();
        let component = &mut layouts.presets[0].components[0];
        component.kind = "number".to_owned();
        component.source = "number".to_owned();
        assert!(layouts.validate().is_err());
        for value in [0., -12.5, 123., 1e100] {
            layouts.presets[0].components[0].number_value = Some(value);
            layouts.validate().unwrap();
            let decoded: Layouts =
                serde_json::from_slice(&serde_json::to_vec(&layouts).unwrap()).unwrap();
            assert_eq!(decoded.presets[0].components[0].number_value, Some(value));
        }
        layouts.presets[0].components[0].number_value = Some(f64::INFINITY);
        assert!(layouts.validate().is_err());
        layouts.presets[0].components[0].number_value = Some(1.);
        layouts.presets[0].components[0].source = "redPlayerName".to_owned();
        assert!(layouts.validate().is_err());
    }
    #[test]
    fn persists_clock_format_and_rejects_inconsistent_sources() {
        let mut layouts = sample();
        let component = &mut layouts.presets[0].components[0];
        component.kind = "clock".to_owned();
        component.source = "clock".to_owned();
        assert!(layouts.validate().is_err());
        for format in ["YYYY-MM-DD HH:mm:ss", "YYYY年MM月DD日\nHH:mm:ss", &"x".repeat(256)] {
            layouts.presets[0].components[0].clock_format = Some(format.to_owned());
            layouts.validate().unwrap();
            let decoded: Layouts = serde_json::from_slice(&serde_json::to_vec(&layouts).unwrap()).unwrap();
            assert_eq!(decoded.presets[0].components[0].clock_format.as_deref(), Some(format));
        }
        let valid = layouts.clone();
        for format in [None, Some(String::new()), Some("x".repeat(257)), Some("\u{1f600}".repeat(129))] {
            layouts.presets[0].components[0].clock_format = format;
            assert!(layouts.validate().is_err());
        }
        for source in ["text", "redPlayerName", "number", "redItems", "redSetWins"] {
            layouts = valid.clone();
            layouts.presets[0].components[0].source = source.to_owned();
            assert!(layouts.validate().is_err());
        }
        for kind in ["text", "number", "image", "item"] {
            layouts = valid.clone();
            layouts.presets[0].components[0].kind = kind.to_owned();
            assert!(layouts.validate().is_err());
        }
        let directory = std::env::temp_dir().join(format!("savakan-clock-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("layouts.json");
        write_layouts(&path, &serde_json::to_vec(&valid).unwrap()).unwrap();
        let restored = read_layouts(&path).unwrap();
        assert_eq!(serde_json::to_value(restored).unwrap(), serde_json::to_value(valid).unwrap());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn persists_item_categories_and_delimiters_and_rejects_inconsistent_sources() {
        let mut layouts = sample();
        for source in ["redItems", "blueItems"] {
            for category in 1..=3 {
                for delimiter in [" / ", "", "\n", "<>&", &"a".repeat(256)] {
                    let component = &mut layouts.presets[0].components[0];
                    component.kind = "item".to_owned();
                    component.source = source.to_owned();
                    component.item_category = Some(category);
                    component.delimiter = Some(delimiter.to_owned());
                    layouts.validate().unwrap();
                    let decoded: Layouts = serde_json::from_slice(&serde_json::to_vec(&layouts).unwrap()).unwrap();
                    assert_eq!(decoded.presets[0].components[0].item_category, Some(category));
                    assert_eq!(decoded.presets[0].components[0].delimiter.as_deref(), Some(delimiter));
                }
            }
        }
        let valid = layouts.clone();
        for category in [None, Some(0), Some(4)] {
            layouts.presets[0].components[0].item_category = category;
            assert!(layouts.validate().is_err());
        }
        layouts = valid.clone();
        for delimiter in [None, Some("a".repeat(257)), Some("\u{1f600}".repeat(129))] {
            layouts.presets[0].components[0].delimiter = delimiter;
            assert!(layouts.validate().is_err());
        }
        layouts = valid.clone();
        for source in ["text", "number", "redPlayerName", "redSetWins"] {
            layouts.presets[0].components[0].source = source.to_owned();
            assert!(layouts.validate().is_err());
        }
        layouts = valid.clone();
        for kind in ["text", "number", "image"] {
            layouts.presets[0].components[0].kind = kind.to_owned();
            assert!(layouts.validate().is_err());
        }
        let directory = std::env::temp_dir().join(format!("savakan-items-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("layouts.json");
        write_layouts(&path, &serde_json::to_vec(&valid).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(read_layouts(&path).unwrap()).unwrap(), serde_json::to_value(valid).unwrap());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn preserves_optional_text_overflow_settings() {
        let original = serde_json::to_value(sample()).unwrap();
        for wrap in [false, true] {
            for shrink in [false, true] {
                let mut data = original.clone();
                data["presets"][0]["components"][0]["wrapText"] = serde_json::json!(wrap);
                data["presets"][0]["components"][0]["shrinkText"] = serde_json::json!(shrink);
                let decoded: Layouts = serde_json::from_value(data.clone()).unwrap();
                decoded.validate().unwrap();
                assert_eq!(serde_json::to_value(decoded).unwrap(), data);
            }
        }
        let legacy: Layouts = serde_json::from_value(original.clone()).unwrap();
        assert!(legacy.presets[0].components[0].wrap_text.is_none());
        assert!(legacy.presets[0].components[0].shrink_text.is_none());
        for field in ["wrapText", "shrinkText"] {
            for invalid in [serde_json::json!(0), serde_json::json!("true"), serde_json::json!([])] {
                let mut data = original.clone();
                data["presets"][0]["components"][0][field] = invalid;
                assert!(serde_json::from_value::<Layouts>(data).is_err());
            }
        }
    }
    #[test]
    fn preserves_vertical_alignment_and_accepts_legacy_missing_values() {
        let mut layouts = sample();
        layouts.validate().unwrap();
        assert!(layouts.presets[0].components[0].vertical_align.is_none());
        for value in ["top", "center", "bottom"] {
            layouts.presets[0].components[0].vertical_align = Some(value.to_owned());
            layouts.validate().unwrap();
            let decoded: Layouts = serde_json::from_slice(&serde_json::to_vec(&layouts).unwrap()).unwrap();
            assert_eq!(decoded.presets[0].components[0].vertical_align.as_deref(), Some(value));
        }
        for value in ["", "left", "middle", "unknown"] {
            layouts.presets[0].components[0].vertical_align = Some(value.to_owned());
            assert!(layouts.validate().is_err());
        }
    }
    #[test]
    fn preserves_optional_image_filenames_and_validates_length() {
        let original = serde_json::to_value(sample()).unwrap();
        assert!(original["presets"][0]["components"][0]
            .get("imageFileName")
            .is_none());
        for name in ["logo.png".to_owned(), "a".repeat(1024)] {
            let mut data = original.clone();
            data["presets"][0]["components"][0]["imageFileName"] = serde_json::json!(name);
            let decoded: Layouts = serde_json::from_value(data.clone()).unwrap();
            decoded.validate().unwrap();
            assert_eq!(
                serde_json::to_value(decoded).unwrap()["presets"][0]["components"][0]
                    ["imageFileName"],
                name
            );
        }
        let mut layouts = sample();
        layouts.presets[0].components[0].image_file_name = Some("a".repeat(1025));
        assert!(layouts.validate().is_err());
    }
    #[test]
    fn preserves_and_validates_image_component_settings() {
        let original = serde_json::to_value(sample()).unwrap();
        let mut data = original.clone();
        data["presets"][0]["components"][0]["imageAspectRatio"] = serde_json::json!(1.5);
        data["presets"][0]["components"][0]["preserveAspectRatio"] = serde_json::json!(true);
        data["presets"][0]["components"][0]["imageAlpha"] = serde_json::json!(128);
        data["presets"][0]["components"][0]["flipHorizontal"] = serde_json::json!(true);
        data["presets"][0]["components"][0]["imageAnimationOnDisplay"] = serde_json::json!(true);
        data["presets"][0]["components"][0]["imageAnimationValueSource"] =
            serde_json::json!("redPlayerName");
        data["presets"][0]["components"][0]["frame"] = serde_json::json!("image");
        let decoded: Layouts = serde_json::from_value(data.clone()).unwrap();
        decoded.validate().unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), data);

        for (field, value) in [
            ("imageAspectRatio", serde_json::json!(0)),
            ("imageAlpha", serde_json::json!(256)),
            ("imageAnimationValueSource", serde_json::json!("eventAlias")),
        ] {
            let mut invalid = original.clone();
            invalid["presets"][0]["components"][0][field] = value;
            let decoded: Layouts = serde_json::from_value(invalid).unwrap();
            assert!(decoded.validate().is_err());
        }
    }
    #[test]
    fn accepts_legacy_missing_names_and_validates_new_names() {
        let original = serde_json::to_value(sample()).unwrap();
        assert!(original["presets"][0]["components"][0]
            .get("name")
            .is_none());
        for name in ["Logo".to_owned(), "a".repeat(256)] {
            let mut data = original.clone();
            data["presets"][0]["components"][0]["name"] = serde_json::json!(name);
            let decoded: Layouts = serde_json::from_value(data).unwrap();
            decoded.validate().unwrap();
            assert_eq!(
                serde_json::to_value(decoded).unwrap()["presets"][0]["components"][0]["name"],
                name
            );
        }
        for name in ["".to_owned(), "   ".to_owned(), "a".repeat(257)] {
            let mut data = original.clone();
            data["presets"][0]["components"][0]["name"] = serde_json::json!(name);
            let decoded: Layouts = serde_json::from_value(data).unwrap();
            assert!(decoded.validate().is_err());
        }
    }
    #[test]
    fn preserves_optional_frames_and_rejects_unknown_decorations() {
        let original = serde_json::to_value(sample()).unwrap();
        assert!(original["presets"][0]["components"][0]
            .get("frame")
            .is_none());
        for frame in ["plate", "setMain", "setSub", "eventAlias", "glass", "image"] {
            let mut data = original.clone();
            data["presets"][0]["components"][0]["frame"] = serde_json::json!(frame);
            let decoded: Layouts = serde_json::from_value(data).unwrap();
            decoded.validate().unwrap();
            let encoded = serde_json::to_value(decoded).unwrap();
            assert_eq!(encoded["presets"][0]["components"][0]["frame"], frame);
        }
        let mut data = original;
        data["presets"][0]["components"][0]["frame"] = serde_json::json!("unknown");
        assert!(serde_json::from_value::<Layouts>(data).is_err());
    }
    #[test]
    fn preserves_optional_text_outlines_and_rejects_invalid_values() {
        let original = serde_json::to_value(sample()).unwrap();
        let mut data = original.clone();
        data["presets"][0]["components"][0]["textOutlineWidth"] = serde_json::json!(2.5);
        data["presets"][0]["components"][0]["textOutlineColor"] = serde_json::json!("#12345680");
        let decoded: Layouts = serde_json::from_value(data).unwrap();
        decoded.validate().unwrap();
        let encoded = serde_json::to_value(decoded).unwrap();
        assert_eq!(encoded["presets"][0]["components"][0]["textOutlineWidth"], 2.5);
        assert_eq!(encoded["presets"][0]["components"][0]["textOutlineColor"], "#12345680");

        for width in [-1.0, 0.25, 16.1] {
            let mut data = original.clone();
            data["presets"][0]["components"][0]["textOutlineWidth"] = serde_json::json!(width);
            let decoded: Layouts = serde_json::from_value(data).unwrap();
            assert!(decoded.validate().is_err());
        }
        let mut data = original;
        data["presets"][0]["components"][0]["textOutlineColor"] = serde_json::json!("red");
        let decoded: Layouts = serde_json::from_value(data).unwrap();
        assert!(decoded.validate().is_err());
    }
    #[test]
    fn validates_and_persists_display_toggle_component_ids() {
        let original = serde_json::to_value(sample()).unwrap();
        let mut data = original.clone();
        data["presets"][0]["visibilityControlIds"] = serde_json::json!(["image"]);
        let decoded: Layouts = serde_json::from_value(data.clone()).unwrap();
        decoded.validate().unwrap();
        assert_eq!(
            serde_json::to_value(decoded).unwrap()["presets"][0]["visibilityControlIds"],
            serde_json::json!(["image"])
        );
        data["presets"][0]["components"][0]["visible"] = serde_json::json!(false);
        let decoded: Layouts = serde_json::from_value(data).unwrap();
        decoded.validate().unwrap();

        for ids in [
            serde_json::json!(["missing"]),
            serde_json::json!(["image", "image"]),
            serde_json::json!(["a", "b", "c", "d", "e", "f", "g"]),
        ] {
            let mut data = original.clone();
            data["presets"][0]["visibilityControlIds"] = ids;
            let decoded: Layouts = serde_json::from_value(data).unwrap();
            assert!(decoded.validate().is_err());
        }
        let mut data = original.clone();
        data["defaultVisibilityControlIds"] =
            serde_json::json!(["builtin-redPlayerName", "", "builtin-eventAlias", "", "", ""]);
        let decoded: Layouts = serde_json::from_value(data.clone()).unwrap();
        decoded.validate().unwrap();
        assert_eq!(
            serde_json::to_value(decoded).unwrap()["defaultVisibilityControlIds"],
            data["defaultVisibilityControlIds"]
        );
        for ids in [
            serde_json::json!(["missing"]),
            serde_json::json!(["builtin-redPlayerName", "builtin-redPlayerName"]),
            serde_json::json!(["a", "b", "c", "d", "e", "f", "g"]),
        ] {
            let mut data = original.clone();
            data["defaultVisibilityControlIds"] = ids;
            let decoded: Layouts = serde_json::from_value(data).unwrap();
            assert!(decoded.validate().is_err());
        }
    }
    #[test]
    fn stores_only_visibility_values_that_differ_from_the_initial_state() {
        let mut overrides = HashMap::new();
        set_visibility_override(&mut overrides, "off", false, true);
        assert_eq!(overrides.get("off"), Some(&true));
        set_visibility_override(&mut overrides, "off", false, false);
        assert!(!overrides.contains_key("off"));

        set_visibility_override(&mut overrides, "on", true, false);
        assert_eq!(overrides.get("on"), Some(&false));
        set_visibility_override(&mut overrides, "on", true, true);
        assert!(!overrides.contains_key("on"));
    }

    #[test]
    fn identifies_only_off_to_on_visibility_transitions() {
        assert!(!is_visibility_show_transition(true, true));
        assert!(!is_visibility_show_transition(true, false));
        assert!(!is_visibility_show_transition(false, false));
        assert!(is_visibility_show_transition(false, true));
    }

    fn sample() -> Layouts {
        serde_json::from_value(serde_json::json!({
            "version": 1, "activePresetId": "preset", "presets": [{
                "id": "preset", "name": "Test", "width": 1280, "height": 720,
                "components": [{
                    "id": "image", "kind": "image", "source": "text", "text": "",
                    "image": "data:image/png;base64,YQ==", "x": 30, "y": 40, "width": 300,
                    "height": 100, "fontFamily": "sans-serif", "fontSize": 48,
                    "color": "#ffffff", "background": "transparent", "align": "center",
                    "bold": true, "visible": true
                }]
            }]
        }))
        .unwrap()
    }
    #[test]
    fn persists_and_replaces_presets_with_images_and_selection() {
        let directory =
            std::env::temp_dir().join(format!("savakan-overlay-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("layouts.json");
        let mut layouts = sample();
        layouts.presets[0].components[0].name = Some("Logo".to_owned());
        layouts.presets[0].components[0].image_file_name = Some("logo.png".to_owned());
        layouts.presets[0].components[0].color = "#ffffff80".to_owned();
        layouts.presets[0].components[0].background = "#12345600".to_owned();
        layouts.validate().unwrap();
        write_layouts(&path, &serde_json::to_vec(&layouts).unwrap()).unwrap();
        let restored = read_layouts(&path).unwrap();
        assert_eq!(restored.presets[0].components[0].color, "#ffffff80");
        assert_eq!(restored.presets[0].components[0].background, "#12345600");
        assert_eq!(restored.active_preset_id, Some("preset".into()));
        assert_eq!(restored.presets[0].width, 1280);
        assert_eq!(
            restored.presets[0].components[0].name.as_deref(),
            Some("Logo")
        );
        assert_eq!(
            restored.presets[0].components[0].image,
            "data:image/png;base64,YQ=="
        );
        assert_eq!(
            restored.presets[0].components[0].image_file_name.as_deref(),
            Some("logo.png")
        );
        layouts.active_preset_id = None;
        write_layouts(&path, &serde_json::to_vec(&layouts).unwrap()).unwrap();
        assert_eq!(read_layouts(&path).unwrap().active_preset_id, None);
        fs::write(&path, "invalid").unwrap();
        assert!(read_layouts(&path).is_err());
        fs::remove_file(&path).unwrap();
        assert!(read_layouts(&path).unwrap().presets.is_empty());
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn rejects_invalid_components_and_duplicate_ids() {
        let mut layouts = sample();
        layouts.presets[0].components[0].width = 0.;
        assert!(layouts.validate().is_err());
        layouts.presets[0].components[0].width = 300.;
        let duplicate = layouts.presets[0].components[0].clone();
        layouts.presets[0].components.push(duplicate);
        assert!(layouts.validate().is_err());
        layouts.presets[0].components.pop();
        layouts.presets.push(layouts.presets[0].clone());
        assert!(layouts.validate().is_err());
    }
    #[test]
    fn validates_version_and_selection() {
        assert!(Layouts::default().validate().is_ok());
        assert!(Layouts {
            version: 2,
            ..Layouts::default()
        }
        .validate()
        .is_err());
        assert!(Layouts {
            active_preset_id: Some("missing".into()),
            ..Layouts::default()
        }
        .validate()
        .is_err());
    }
    #[test]
    fn accepts_only_embedded_raster_images_and_safe_colors() {
        assert!(image("data:image/png;base64,YQ=="));
        assert!(!image("data:image/svg+xml;base64,YQ=="));
        assert!(!image("https://example.com/image.png"));
        assert!(!image("data:image/png;base64,Y=Q"));
        assert!(color("#aabbCC"));
        for value in ["#aabbCC00", "#aabbCC80", "#aabbCCff"] {
            assert!(color(value));
            let mut layouts = sample();
            layouts.presets[0].components[0].color = value.to_owned();
            layouts.presets[0].components[0].background = value.to_owned();
            layouts.validate().unwrap();
        }
        for value in ["#abc", "#aabbccd", "#aabbccddff", "#aabbccgg", "rgba(0,0,0,0.5)"] {
            assert!(!color(value));
            let mut layouts = sample();
            layouts.presets[0].components[0].background = value.to_owned();
            assert!(layouts.validate().is_err());
        }
        assert!(!color("red;position:fixed"));
    }

    #[test]
    fn font_families_are_unique_sorted_and_within_name_limits() {
        let too_long = "a".repeat(257);
        let too_many_utf16_units = "\u{1f600}".repeat(129);
        let names = unique_font_families(
            ["Yu Gothic", "Arial", "Arial", " 游ゴシック ", "", " ", &too_long, &too_many_utf16_units]
                .into_iter(),
        );
        assert_eq!(names, vec!["Arial", "Yu Gothic", "游ゴシック"]);
    }

    #[test]
    fn scans_system_font_directories() {
        match system_font_families() {
            Ok(names) => {
                println!("Discovered {} installed font families.", names.len());
                assert!(!names.is_empty());
                assert!(names.windows(2).all(|pair| pair[0] < pair[1]));
                let mut second = system_font_families().unwrap();
                assert_eq!(second, names);
                second[0].push_str("-edited");
                assert_eq!(system_font_families().unwrap(), names);
            }
            Err(error) => assert_eq!(
                error,
                "No system font families were found in the standard font directories."
            ),
        }
    }
}
