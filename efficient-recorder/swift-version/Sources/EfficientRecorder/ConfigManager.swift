import Foundation
import KeychainAccess

final class ConfigManager {
    static let shared = ConfigManager()

    private let keychain = Keychain(service: "com.efficient-recorder")
    private let apiKeyIdentifier = "r2_api_key"

    // Default configuration
    let screenResolution = CGSize(width: 1280, height: 720)
    let captureInterval: TimeInterval = 1.0
    let dbThreshold: Float = 50.0
    let audioSampleRate: Double = 44100.0

    private var storageConfig: StorageConfig?

    private init() {}

    func setupAPIKey(_ key: String) throws {
        try keychain.set(key, key: apiKeyIdentifier)
        // Verify we can create storage config with this key
        storageConfig = try StorageConfig(apiKey: key)
    }

    func getStorageConfig() throws -> StorageConfig {
        if let config = storageConfig {
            return config
        }

        guard let apiKey = try keychain.get(apiKeyIdentifier) else {
            throw ConfigError.invalidAPIKey
        }

        let config = try StorageConfig(apiKey: apiKey)
        storageConfig = config
        return config
    }

    func clearAPIKey() throws {
        try keychain.remove(apiKeyIdentifier)
        storageConfig = nil
    }

    func hasAPIKey() -> Bool {
        return (try? keychain.get(apiKeyIdentifier)) != nil
    }
}