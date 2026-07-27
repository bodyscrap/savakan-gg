use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum ID {
    String(String),
    Int(i64),
    UInt(u64),
}

pub type GgID = ID;

impl std::fmt::Display for ID {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ID::String(v) => write!(f, "{v}"),
            ID::Int(v) => write!(f, "{v}"),
            ID::UInt(v) => write!(f, "{v}"),
        }
    }
}
