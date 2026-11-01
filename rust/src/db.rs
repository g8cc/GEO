use rusqlite::Connection;
use std::sync::{Mutex, OnceLock};

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

static INIT_SQL: &str = include_str!("../migrations/init.sql");

pub async fn init() {
    let path = std::env::var("GEO_DB_PATH").unwrap_or("data/geo.db".into());
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(&path).expect("open db");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").ok();
    conn.execute_batch(INIT_SQL).expect("migrate");
    DB.set(Mutex::new(conn)).ok();
}

pub fn with_db<F, T>(f: F) -> T
where F: FnOnce(&Connection) -> T
{
    let mutex = DB.get().expect("db not initialized");
    let mut guard = mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&guard)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_schema_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(INIT_SQL).unwrap();
        // 验证所有核心表存在
        for table in ["users", "projects", "questions", "articles", "monitorTasks", "sourceAssets", "reports"] {
            let count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                [table], |r| r.get(0)
            ).unwrap();
            assert!(count > 0, "table {} missing", table);
        }
    }

    #[test]
    fn test_wal_mode() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL").unwrap();
        let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
    }
}

#[cfg(test)]
pub fn test_init() {
    if DB.get().is_none() {
        let conn = Connection::open_in_memory().expect("test db");
        conn.execute_batch(INIT_SQL).expect("test migrate");
        DB.set(Mutex::new(conn)).ok();
    }
}
