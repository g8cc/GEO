use sha2::{Digest, Sha256};

pub fn sha256(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn hash_password(password: &str, salt: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(salt.as_bytes());
    hash.update(b":");
    hash.update(password.as_bytes());
    let mut result = hash.finalize();
    for _ in 0..999 {
        let mut h = Sha256::new();
        h.update(&result);
        result = h.finalize();
    }
    format!("{:x}", result)
}

pub fn verify_password(password: &str, salt: &str, expected_hash: &str) -> bool {
    hash_password(password, salt) == expected_hash
}

pub fn gen_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
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
        // SHA256("hello") 的已知值
        assert_eq!(sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    #[test]
    fn test_password_hash_verify() {
        let salt = "testsalt123";
        let hash = hash_password("mypassword", salt);
        assert!(verify_password("mypassword", salt, &hash));
        assert!(!verify_password("wrongpassword", salt, &hash));
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
    fn test_now_iso_format() {
        let ts = now_iso();
        assert!(ts.contains("T"));
        assert!(ts.contains("Z") || ts.contains("+"));
    }
}
