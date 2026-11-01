use sha2::{Digest, Sha256};

// Open Key / API 层哈希
pub fn sha256(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn rand_hex(n: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

// 密码哈希：scrypt(N=16384,r=8,p=1,32B)，与 Node 版 crypto.scryptSync(password, salt, 32) 完全兼容，
// 这样 Rust 版可以直接接管 Node 版数据库中的既有账号。
pub fn hash_password(password: &str, salt: &str) -> String {
    let params = scrypt::Params::new(14, 8, 1, 32).expect("scrypt params");
    let mut out = [0u8; 32];
    scrypt::scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut out).expect("scrypt");
    out.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn verify_password(password: &str, salt: &str, expected_hash: &str) -> bool {
    if hash_password(password, salt) == expected_hash {
        return true;
    }
    // 兼容早期 Rust 版使用的迭代 SHA256（scrypt 迁移前的本地库）
    let mut result = {
        let mut h = Sha256::new();
        h.update(salt.as_bytes());
        h.update(b":");
        h.update(password.as_bytes());
        h.finalize()
    };
    for _ in 0..999 {
        let mut h = Sha256::new();
        h.update(result);
        result = h.finalize();
    }
    format!("{:x}", result) == expected_hash
}

pub fn new_salt() -> String {
    rand_hex(16)
}

pub fn random_hex(n_bytes: usize) -> String {
    rand_hex(n_bytes)
}

pub fn gen_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn add_days_iso(days: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn add_minutes_iso(minutes: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::minutes(minutes)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

// 密码策略：至少 8 位，须同时包含字母和数字（与 Node 版 passwordPolicyError 一致）
pub fn password_policy_error(p: &str) -> Option<&'static str> {
    if p.chars().count() < 8 {
        return Some("密码至少 8 位");
    }
    let has_letter = p.chars().any(|c| c.is_ascii_alphabetic());
    let has_digit = p.chars().any(|c| c.is_ascii_digit());
    if !has_letter || !has_digit {
        return Some("密码须同时包含字母和数字");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_deterministic() {
        assert_eq!(sha256("hello"), sha256("hello"));
        assert_ne!(sha256("hello"), sha256("world"));
    }

    #[test]
    fn test_sha256_known_value() {
        assert_eq!(sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    #[test]
    fn test_password_hash_verify() {
        let salt = new_salt();
        let hash = hash_password("mypassword", &salt);
        assert!(verify_password("mypassword", &salt, &hash));
        assert!(!verify_password("wrongpassword", &salt, &hash));
    }

    #[test]
    fn test_password_hash_different_salts() {
        let h1 = hash_password("same", "salt1");
        let h2 = hash_password("same", "salt2");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_uuid_unique() {
        let a = gen_uuid();
        let b = gen_uuid();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
    }

    #[test]
    fn test_password_policy() {
        assert!(password_policy_error("short").is_some());
        assert!(password_policy_error("onlyletters").is_some());
        assert!(password_policy_error("12345678").is_some());
        assert!(password_policy_error("abcd1234").is_none());
    }
}
