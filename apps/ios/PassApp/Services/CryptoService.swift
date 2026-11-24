import CommonCrypto
import Foundation
import LocalAuthentication
import Security
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

/// Encrypted local iOS vault. Its versioned envelope is separate from desktop interchange.
enum LocalVault {
    struct Session: Sendable {
        let key: SymmetricKey
        let salt: Data
    }

    private struct Envelope: Codable {
        let version: Int
        let salt: Data
        let sealed: Data
    }

    private enum VaultError: LocalizedError {
        case alreadyExists, malformed, password, random, keychain
        var errorDescription: String? {
            switch self {
            case .alreadyExists: "Un coffre existe déjà sur cet appareil."
            case .malformed: "Le fichier du coffre n’est pas lisible."
            case .password: "Mot de passe incorrect ou coffre endommagé."
            case .random: "Impossible d’initialiser le chiffrement."
            case .keychain: "Le déverrouillage biométrique est indisponible. Utilisez le mot de passe principal."
            }
        }
    }

    private static let keychainQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.passapp.ios.local-vault",
        kSecAttrAccount as String: "vault-key-v1"
    ]

    static var exists: Bool {
        guard let url = try? vaultURL() else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    private static func vaultURL() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
            .appendingPathComponent("local-vault.v1", isDirectory: false)
    }

    static func create(password: String) throws -> Session {
        guard !exists else { throw VaultError.alreadyExists }
        var salt = Data(count: 16)
        let status = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        guard status == errSecSuccess else { throw VaultError.random }
        let session = try derive(password: password, salt: salt)
        try save([], session: session)
        return session
    }

    static func unlock(password: String) throws -> (Session, [VaultEntry]) {
        let envelope = try readEnvelope()
        let session = try derive(password: password, salt: envelope.salt)
        return (session, try decrypt(envelope, using: session))
    }

    static func save(_ entries: [VaultEntry], session: Session) throws {
        let plaintext = try JSONEncoder().encode(entries)
        guard let sealed = try AES.GCM.seal(plaintext, using: session.key).combined else {
            throw VaultError.malformed
        }
        let data = try JSONEncoder().encode(Envelope(version: 1, salt: session.salt, sealed: sealed))
        #if os(iOS)
        try data.write(to: vaultURL(), options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: vaultURL(), options: .atomic)
        #endif
    }

    static func enableBiometrics(for session: Session) throws {
        removeBiometrics()
        guard let accessControl = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                                  .biometryCurrentSet, nil) else {
            throw VaultError.keychain
        }
        var attributes = keychainQuery
        attributes[kSecAttrAccessControl as String] = accessControl
        attributes[kSecValueData as String] = session.key.withUnsafeBytes { Data($0) }
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else { throw VaultError.keychain }
    }

    static func removeBiometrics() {
        SecItemDelete(keychainQuery as CFDictionary)
    }

    static func unlockUsingBiometrics() throws -> (Session, [VaultEntry]) {
        let envelope = try readEnvelope()
        var query = keychainQuery
        let context = LAContext()
        context.localizedReason = "Déverrouiller votre coffre PassApp"
        query[kSecUseAuthenticationContext as String] = context
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let bytes = item as? Data, bytes.count == 32 else { throw VaultError.keychain }
        let session = Session(key: SymmetricKey(data: bytes), salt: envelope.salt)
        return (session, try decrypt(envelope, using: session))
    }

    private static func readEnvelope() throws -> Envelope {
        let data = try Data(contentsOf: vaultURL())
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.version == 1, envelope.salt.count == 16 else { throw VaultError.malformed }
        return envelope
    }

    private static func decrypt(_ envelope: Envelope, using session: Session) throws -> [VaultEntry] {
        let box = try AES.GCM.SealedBox(combined: envelope.sealed)
        let plaintext: Data
        do { plaintext = try AES.GCM.open(box, using: session.key) }
        catch { throw VaultError.password }
        return try JSONDecoder().decode([VaultEntry].self, from: plaintext)
    }

    private static func derive(password: String, salt: Data) throws -> Session {
        var key = Data(count: 32)
        let passwordLength = password.utf8.count
        let status = password.withCString { passwordPointer in
            salt.withUnsafeBytes { saltBytes in
                key.withUnsafeMutableBytes { output in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passwordPointer, passwordLength,
                                          saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 600_000,
                                          output.bindMemory(to: UInt8.self).baseAddress, 32)
                }
            }
        }
        guard status == kCCSuccess else { throw VaultError.random }
        return Session(key: SymmetricKey(data: key), salt: salt)
    }
}
