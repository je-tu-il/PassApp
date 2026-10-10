import Foundation

public struct VaultEntry: Identifiable, Codable, Equatable {
    public let id: String
    public var title: String
    public var username: String
    public var password: String?
    public var url: String?
    public var notes: String?
    public var totpSecret: String?
    public var category: String
    public var favorite: Bool
    public var updatedAt: UInt64

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case username
        case password
        case url
        case notes
        case totpSecret = "totp_secret"
        case category
        case favorite
        case updatedAt = "updated_at"
    }

    public init(
        id: String = UUID().uuidString,
        title: String,
        username: String,
        password: String? = nil,
        url: String? = nil,
        notes: String? = nil,
        totpSecret: String? = nil,
        category: String = "Personnel",
        favorite: Bool = false,
        updatedAt: UInt64 = UInt64(Date().timeIntervalSince1970)
    ) {
        self.id = id
        self.title = title
        self.username = username
        self.password = password
        self.url = url
        self.notes = notes
        self.totpSecret = totpSecret
        self.category = category
        self.favorite = favorite
        self.updatedAt = updatedAt
    }
}

public struct VaultDocument: Codable {
    public var schemaVersion: UInt32
    public var updatedAt: UInt64
    public var entries: [VaultEntry]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case updatedAt = "updated_at"
        case entries
    }

    public static func empty() -> VaultDocument {
        return VaultDocument(schemaVersion: 1, updatedAt: 0, entries: [])
    }
}

public struct KdfParameters: Codable {
    public var memoryKib: UInt32
    public var iterations: UInt32
    public var parallelism: UInt32

    enum CodingKeys: String, CodingKey {
        case memoryKib = "memory_kib"
        case iterations
        case parallelism
    }
}

public struct EncryptedPayload: Codable {
    public var formatVersion: UInt8
    public var kdf: KdfParameters
    public var salt: [UInt8]
    public var nonce: [UInt8]
    public var ciphertext: [UInt8]

    enum CodingKeys: String, CodingKey {
        case formatVersion = "format_version"
        case kdf
        case salt
        case nonce
        case ciphertext
    }
}
