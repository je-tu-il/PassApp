#![forbid(unsafe_code)]

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const FORMAT_VERSION: u8 = 1;
pub const SALT_LENGTH: usize = 16;
pub const NONCE_LENGTH: usize = 12;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct KdfParameters {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParameters {
    fn default() -> Self {
        Self {
            memory_kib: 19 * 1024,
            iterations: 2,
            parallelism: 1,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EncryptedPayload {
    pub format_version: u8,
    pub kdf: KdfParameters,
    pub salt: Vec<u8>,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Eq, PartialEq)]
pub enum CryptoError {
    InvalidParameters,
    InvalidPayload,
    AuthenticationFailed,
    RandomnessUnavailable,
}

fn derive_key(
    password: &[u8],
    salt: &[u8],
    params: &KdfParameters,
) -> Result<[u8; 32], CryptoError> {
    if salt.len() != SALT_LENGTH
        || params.memory_kib < 8 * params.parallelism
        || params.iterations == 0
        || params.parallelism == 0
    {
        return Err(CryptoError::InvalidParameters);
    }
    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(32),
    )
    .map_err(|_| CryptoError::InvalidParameters)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password, salt, &mut key)
        .map_err(|_| CryptoError::InvalidParameters)?;
    Ok(key)
}

pub fn encrypt(password: &[u8], plaintext: &[u8]) -> Result<EncryptedPayload, CryptoError> {
    let kdf = KdfParameters::default();
    let mut salt = vec![0u8; SALT_LENGTH];
    let mut nonce = vec![0u8; NONCE_LENGTH];
    getrandom::fill(&mut salt).map_err(|_| CryptoError::RandomnessUnavailable)?;
    getrandom::fill(&mut nonce).map_err(|_| CryptoError::RandomnessUnavailable)?;
    let mut key = derive_key(password, &salt, &kdf)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::InvalidParameters)?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| CryptoError::AuthenticationFailed)?;
    key.zeroize();
    Ok(EncryptedPayload {
        format_version: FORMAT_VERSION,
        kdf,
        salt,
        nonce,
        ciphertext,
    })
}

pub fn decrypt(password: &[u8], payload: &EncryptedPayload) -> Result<Vec<u8>, CryptoError> {
    if payload.format_version != FORMAT_VERSION
        || payload.salt.len() != SALT_LENGTH
        || payload.nonce.len() != NONCE_LENGTH
    {
        return Err(CryptoError::InvalidPayload);
    }
    let mut key = derive_key(password, &payload.salt, &payload.kdf)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::InvalidParameters)?;
    let result = cipher
        .decrypt(
            Nonce::from_slice(&payload.nonce),
            payload.ciphertext.as_ref(),
        )
        .map_err(|_| CryptoError::AuthenticationFailed);
    key.zeroize();
    result
}

/// Returns the crate identity used by startup and integration checks.
pub fn crate_identity() -> &'static str {
    "passapp-crypto-core"
}

#[cfg(test)]
mod tests {
    use super::{decrypt, encrypt, CryptoError, EncryptedPayload, FORMAT_VERSION};

    #[test]
    fn exposes_expected_identity() {
        assert_eq!(super::crate_identity(), "passapp-crypto-core");
    }

    #[test]
    fn round_trip_encrypts_and_decrypts() {
        let payload =
            encrypt(b"master password", b"vault document").expect("encryption should work");
        assert_eq!(
            decrypt(b"master password", &payload).unwrap(),
            b"vault document"
        );
        assert_ne!(payload.ciphertext, b"vault document");
    }

    #[test]
    fn rejects_wrong_password_and_tampering() {
        let mut payload = encrypt(b"master password", b"vault document").unwrap();
        assert_eq!(
            decrypt(b"wrong password", &payload),
            Err(CryptoError::AuthenticationFailed)
        );
        payload.ciphertext[0] ^= 1;
        assert_eq!(
            decrypt(b"master password", &payload),
            Err(CryptoError::AuthenticationFailed)
        );
    }

    #[test]
    fn rejects_unknown_format_and_invalid_nonce() {
        let mut payload = encrypt(b"master password", b"vault document").unwrap();
        payload.format_version = FORMAT_VERSION + 1;
        assert_eq!(
            decrypt(b"master password", &payload),
            Err(CryptoError::InvalidPayload)
        );
        let mut invalid_payload: EncryptedPayload =
            encrypt(b"master password", b"vault document").unwrap();
        invalid_payload.nonce.pop();
        assert_eq!(
            decrypt(b"master password", &invalid_payload),
            Err(CryptoError::InvalidPayload)
        );
    }
}
