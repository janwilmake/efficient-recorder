
import Foundation

final class UploadManager {
    enum UploadError: Error {
        case invalidConfiguration
        case uploadFailed(Error)
        case multipartUploadFailed
        case invalidResponse
    }

    private let tempFileManager: TempFileManager
    private let config: StorageConfig
    private let session: URLSession

    init() throws {
        self.tempFileManager = TempFileManager.shared
        self.config = try ConfigManager.shared.getStorageConfig()

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = config.uploadTimeout
        configuration.httpMaximumConnectionsPerHost = 6
        self.session = URLSession(configuration: configuration)
    }

    // MARK: - Upload Methods

    func uploadScreenshot(data: Data) async throws {
        let fileName = "screenshot-\(Int(Date().timeIntervalSince1970)).png"
        try await uploadData(data, fileName: fileName)
    }

    func uploadAudio(data: Data, source: AudioRecorder.AudioSource) async throws {
        let prefix = source == .microphone ? "mic" : "system"
        let fileName = "\(prefix)-\(Int(Date().timeIntervalSince1970)).raw"
        try await uploadData(data, fileName: fileName)
    }

    // MARK: - Core Upload Logic

    private func uploadData(_ data: Data, fileName: String) async throws {
        // For small files, use direct upload
        if data.count < config.partSize {
            try await directUpload(data, fileName: fileName)
            return
        }

        // For larger files, use multipart upload
        try await multipartUpload(data, fileName: fileName)
    }

    private func directUpload(_ data: Data, fileName: String) async throws {
        var request = try createRequest(for: fileName)
        request.httpMethod = "PUT"

        let (_, response) = try await session.upload(for: request, from: data)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw UploadError.uploadFailed(URLError(.badServerResponse))
        }
    }

    private func multipartUpload(_ data: Data, fileName: String) async throws {
        // 1. Initiate multipart upload
        let uploadId = try await initiateMultipartUpload(fileName: fileName)

        // 2. Upload parts
        var parts: [(partNumber: Int, etag: String)] = []
        let chunks = stride(from: 0, to: data.count, by: config.partSize)

        for (index, offset) in chunks.enumerated() {
            let chunk = data[offset..<min(offset + config.partSize, data.count)]
            let partNumber = index + 1

            // Retry logic for each part
            var retryCount = 0
            while retryCount < config.maxRetries {
                do {
                    let etag = try await uploadPart(
                        chunk,
                        fileName: fileName,
                        uploadId: uploadId,
                        partNumber: partNumber
                    )
                    parts.append((partNumber, etag))
                    break
                } catch {
                    retryCount += 1
                    if retryCount == config.maxRetries {
                        // Abort multipart upload on final retry failure
                        try? await abortMultipartUpload(fileName: fileName, uploadId: uploadId)
                        throw UploadError.multipartUploadFailed
                    }
                    try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(retryCount)) * 1_000_000_000))
                }
            }
        }

        // 3. Complete multipart upload
        try await completeMultipartUpload(fileName: fileName, uploadId: uploadId, parts: parts)
    }

    // MARK: - Multipart Upload Helpers

    private func initiateMultipartUpload(fileName: String) async throws -> String {
        var request = try createRequest(for: fileName)
        request.httpMethod = "POST"
        request.url?.append(queryItems: [URLQueryItem(name: "uploads", value: "")])

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode),
              let uploadId = String(data: data, encoding: .utf8)?.uploadIdFromXML() else {
            throw UploadError.uploadFailed(URLError(.badServerResponse))
        }

        return uploadId
    }

    private func uploadPart(_ data: Data, fileName: String, uploadId: String, partNumber: Int) async throws -> String {
        var request = try createRequest(for: fileName)
        request.httpMethod = "PUT"
        request.url?.append(queryItems: [
            URLQueryItem(name: "partNumber", value: "\(partNumber)"),
            URLQueryItem(name: "uploadId", value: uploadId)
        ])

        let (_, response) = try await session.upload(for: request, from: data)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode),
              let etag = httpResponse.allHeaderFields["ETag"] as? String else {
            throw UploadError.uploadFailed(URLError(.badServerResponse))
        }

        return etag
    }

    private func completeMultipartUpload(fileName: String, uploadId: String, parts: [(partNumber: Int, etag: String)]) async throws {
        var request = try createRequest(for: fileName)
        request.httpMethod = "POST"
        request.url?.append(queryItems: [URLQueryItem(name: "uploadId", value: uploadId)])

        let completionXML = createCompletionXML(parts: parts)
        request.httpBody = completionXML.data(using: .utf8)

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw UploadError.uploadFailed(URLError(.badServerResponse))
        }
    }

    private func abortMultipartUpload(fileName: String, uploadId: String) async throws {
        var request = try createRequest(for: fileName)
        request.httpMethod = "DELETE"
        request.url?.append(queryItems: [URLQueryItem(name: "uploadId", value: uploadId)])

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw UploadError.uploadFailed(URLError(.badServerResponse))
        }
    }

    // MARK: - Helper Methods

    private func createRequest(for fileName: String) throws -> URLRequest {
        var components = URLComponents(url: config.endpoint, resolvingAgainstBaseURL: false)
        components?.path = "/\(config.bucketName)/\(fileName)"

        guard let url = components?.url else {
            throw UploadError.invalidConfiguration
        }

        var request = URLRequest(url: url)
        request.setValue(config.apiKey, forHTTPHeaderField: "Authorization")
        return request
    }

    private func createCompletionXML(parts: [(partNumber: Int, etag: String)]) -> String {
        let partTags = parts
            .sorted { $0.partNumber < $1.partNumber }
            .map { "<Part><PartNumber>\($0.partNumber)</PartNumber><ETag>\($0.etag)</ETag></Part>" }
            .joined()

        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <CompleteMultipartUpload>
            \(partTags)
        </CompleteMultipartUpload>
        """
    }
}

// MARK: - String Extension for XML Parsing
private extension String {
    func uploadIdFromXML() -> String? {
        guard let start = range(of: "<UploadId>")?.upperBound,
              let end = range(of: "</UploadId>")?.lowerBound else {
            return nil
        }
        return String(self[start..<end])
    }
}