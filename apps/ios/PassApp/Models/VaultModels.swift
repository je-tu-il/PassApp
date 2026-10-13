import Foundation

public struct VaultAttachment: Identifiable, Codable, Equatable {
    public let id: String
    public var name: String
    public var size: Int
    public var mimeType: String
    public var data: String // Contenu du fichier encodé en base64
    public var updatedAt: UInt64

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case size
        case mimeType = "mime_type"
        case data
        case updatedAt = "updated_at"
    }

    public init(
        id: String = UUID().uuidString,
        name: String,
        size: Int,
        mimeType: String,
        data: String,
        updatedAt: UInt64 = UInt64(Date().timeIntervalSince1970)
    ) {
        self.id = id
        self.name = name
        self.size = size
        self.mimeType = mimeType
        self.data = data
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        size = try container.decode(Int.self, forKey: .size)
        mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType) ?? "application/octet-stream"
        data = try container.decode(String.self, forKey: .data)
        updatedAt = try container.decodeIfPresent(UInt64.self, forKey: .updatedAt) ?? 0
    }
}

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
    public var folder: String?
    public var itemType: String? // "login", "note", "file"
    public var attachments: [VaultAttachment]

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
        case folder
        case itemType = "item_type"
        case attachments
    }

    public init(
        id: String = UUID().uuidString,
        title: String,
        username: String = "",
        password: String? = nil,
        url: String? = nil,
        notes: String? = nil,
        totpSecret: String? = nil,
        category: String = "Personnel",
        favorite: Bool = false,
        updatedAt: UInt64 = UInt64(Date().timeIntervalSince1970),
        folder: String? = nil,
        itemType: String? = "login",
        attachments: [VaultAttachment] = []
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
        self.folder = folder
        self.itemType = itemType
        self.attachments = attachments
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        username = try container.decodeIfPresent(String.self, forKey: .username) ?? ""
        password = try container.decodeIfPresent(String.self, forKey: .password)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        totpSecret = try container.decodeIfPresent(String.self, forKey: .totpSecret)
        category = try container.decodeIfPresent(String.self, forKey: .category) ?? "Personnel"
        favorite = try container.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
        updatedAt = try container.decodeIfPresent(UInt64.self, forKey: .updatedAt) ?? 0
        folder = try container.decodeIfPresent(String.self, forKey: .folder)
        itemType = try container.decodeIfPresent(String.self, forKey: .itemType) ?? "login"
        attachments = try container.decodeIfPresent([VaultAttachment].self, forKey: .attachments) ?? []
    }
}

public struct VaultDocument: Codable {
    public var schemaVersion: UInt32
    public var updatedAt: UInt64
    public var entries: [VaultEntry]
    public var customFolders: [String]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case updatedAt = "updated_at"
        case entries
        case customFolders = "custom_folders"
    }

    public init(
        schemaVersion: UInt32 = 1,
        updatedAt: UInt64 = 0,
        entries: [VaultEntry] = [],
        customFolders: [String] = []
    ) {
        self.schemaVersion = schemaVersion
        self.updatedAt = updatedAt
        self.entries = entries
        self.customFolders = customFolders
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(UInt32.self, forKey: .schemaVersion) ?? 1
        updatedAt = try container.decodeIfPresent(UInt64.self, forKey: .updatedAt) ?? 0
        entries = try container.decodeIfPresent([VaultEntry].self, forKey: .entries) ?? []
        customFolders = try container.decodeIfPresent([String].self, forKey: .customFolders) ?? []
    }

    public static func empty() -> VaultDocument {
        return VaultDocument(schemaVersion: 1, updatedAt: 0, entries: [], customFolders: [])
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
