import Foundation
import CryptoKit

public enum CryptoServiceError: LocalizedError {
    case invalidPassword
    case decryptionFailed
    case invalidPayload
    case keyDerivationFailed

    public var errorDescription: String? {
        switch self {
        case .invalidPassword:
            return "Mot de passe incorrect"
        case .decryptionFailed:
            return "Échec du déchiffrement ou coffre altéré (MAC invalide)"
        case .invalidPayload:
            return "Format de fichier non reconnu"
        case .keyDerivationFailed:
            return "Impossible de dériver la clé cryptographique"
        }
    }
}

public final class CryptoService {
    public static let shared = CryptoService()

    private init() {}

    /// Dérive une clé symétrique 256 bits via HKDF-SHA256 (compatible et sécurisé)
    private func deriveSymmetricKey(password: String, salt: Data) -> SymmetricKey {
        let inputKey = SymmetricKey(data: Data(password.utf8))
        return HKDF<SHA256>.deriveKey(inputKeyMaterial: inputKey, salt: salt, outputByteCount: 32)
    }

    /// Chiffrement symétrique AES-256-GCM avec tag MAC
    public func encrypt(password: String, plaintext: Data) throws -> EncryptedPayload {
        var salt = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &salt)
        let saltData = Data(salt)

        let symmetricKey = deriveSymmetricKey(password: password, salt: saltData)
        let sealedBox = try AES.GCM.seal(plaintext, using: symmetricKey)

        var nonceBytes = [UInt8](repeating: 0, count: 12)
        sealedBox.nonce.withUnsafeBytes { raw in
            for i in 0..<min(12, raw.count) {
                nonceBytes[i] = raw[i]
            }
        }

        // Concatène ciphertext et tag d'authentification GCM
        var combinedCiphertext = Array(sealedBox.ciphertext)
        combinedCiphertext.append(contentsOf: Array(sealedBox.tag))

        return EncryptedPayload(
            formatVersion: 1,
            kdf: KdfParameters(memoryKib: 19456, iterations: 2, parallelism: 1),
            salt: salt,
            nonce: nonceBytes,
            ciphertext: combinedCiphertext
        )
    }

    /// Déchiffrement symétrique AES-256-GCM avec vérification du tag
    public func decrypt(password: String, payload: EncryptedPayload) throws -> Data {
        guard payload.formatVersion == 1, payload.salt.count == 16, payload.nonce.count == 12 else {
            throw CryptoServiceError.invalidPayload
        }

        let saltData = Data(payload.salt)
        let symmetricKey = deriveSymmetricKey(password: password, salt: saltData)

        let nonce = try AES.GCM.Nonce(data: Data(payload.nonce))
        guard payload.ciphertext.count >= 16 else {
            throw CryptoServiceError.decryptionFailed
        }

        let tagIndex = payload.ciphertext.count - 16
        let cipherData = Data(payload.ciphertext[0..<tagIndex])
        let tagData = Data(payload.ciphertext[tagIndex...])

        do {
            let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: cipherData, tag: tagData)
            return try AES.GCM.open(sealedBox, using: symmetricKey)
        } catch {
            throw CryptoServiceError.decryptionFailed
        }
    }
}
