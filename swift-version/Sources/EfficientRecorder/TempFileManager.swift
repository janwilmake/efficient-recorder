
import Foundation

final class TempFileManager {
    static let shared = TempFileManager()

    private let fileManager = FileManager.default
    private let tempDirectory: URL

    private init() {
        tempDirectory = fileManager.temporaryDirectory
            .appendingPathComponent("efficient-recorder", isDirectory: true)

        try? fileManager.createDirectory(at: tempDirectory,
                                       withIntermediateDirectories: true)
    }

    func createTempFile(withExtension ext: String) throws -> URL {
        let fileName = UUID().uuidString + "." + ext
        return tempDirectory.appendingPathComponent(fileName)
    }

    func cleanOldFiles(olderThan age: TimeInterval = 3600) {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: tempDirectory,
            includingPropertiesForKeys: [.creationDateKey]
        ) else { return }

        let oldDate = Date().addingTimeInterval(-age)

        for url in contents {
            guard let creation = try? url.resourceValues(
                forKeys: [.creationDateKey]).creationDate,
                  creation < oldDate else { continue }

            try? fileManager.removeItem(at: url)
        }
    }

    func clearAll() {
        try? fileManager.removeItem(at: tempDirectory)
        try? fileManager.createDirectory(at: tempDirectory,
                                       withIntermediateDirectories: true)
    }

    deinit {
        clearAll()
    }
}