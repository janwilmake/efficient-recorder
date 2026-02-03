
import Foundation
import KeychainAccess

struct StorageConfig {
    let apiKey: String
    let bucketName: String
    let endpoint: URL
    let region: String

    // Multipart upload configuration
    let partSize: Int = 5 * 1024 * 1024  // 5MB default chunk size
    let maxRetries: Int = 3
    let uploadTimeout: TimeInterval = 30

    init(apiKey: String, bucketName: String = "recordings",
         endpoint: String = "https://your-endpoint.r2.cloudflarestorage.com",
         region: String = "auto") throws {
        guard !apiKey.isEmpty else {
            throw ConfigError.invalidAPIKey
        }
        guard let endpointURL = URL(string: endpoint) else {
            throw ConfigError.invalidEndpoint
        }

        self.apiKey = apiKey
        self.bucketName = bucketName
        self.endpoint = endpointURL
        self.region = region
    }
}

enum ConfigError: Error {
    case invalidAPIKey
    case invalidEndpoint
    case keychainError
}