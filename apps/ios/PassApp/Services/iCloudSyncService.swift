import Foundation

public final class iCloudSyncService: NSObject {
    public static let shared = iCloudSyncService()

    private var query = NSMetadataQuery()
    public var onRemoteChange: (() -> Void)?

    private override init() {
        super.init()
        setupQuery()
    }

    public var ubiquityURL: URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: nil)?
            .appendingPathComponent("Documents")
            .appendingPathComponent("vault.passapp")
    }

    private func setupQuery() {
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(format: "%K LIKE 'vault.passapp*'", NSMetadataItemFSNameKey)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(metadataQueryDidUpdate(_:)),
            name: .NSMetadataQueryDidUpdate,
            object: query
        )

        query.start()
    }

    @objc private func metadataQueryDidUpdate(_ notification: Notification) {
        onRemoteChange?()
    }
}
