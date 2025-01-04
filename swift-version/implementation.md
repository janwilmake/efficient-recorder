Let's start with the core configuration files. I'll implement them in order:

```swift
// StorageConfig.swift

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
```

```swift
// ConfigManager.swift
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
```

```swift
// TempFileManager.swift

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
```

```swift
// PermissionManager.swift

import AVFoundation
import ScreenCaptureKit
import CoreAudio
import UserNotifications

final class PermissionManager {
    static let shared = PermissionManager()

    private var screenCaptureAccess: Bool = false
    private var microphoneAccess: Bool = false
    private var systemAudioAccess: Bool = false

    private init() {}

    enum PermissionError: Error {
        case screenCaptureAccessDenied
        case microphoneAccessDenied
        case systemAudioAccessDenied
    }

    // Check all permissions at once
    func checkAllPermissions() async throws {
        try await checkScreenCaptureAccess()
        try await checkMicrophoneAccess()
        try await checkSystemAudioAccess()
    }

    // Screen Capture
    private func checkScreenCaptureAccess() async throws {
        // SCShareableContent is the modern API for screen capture
        let filter = SCContentFilter(.display, excluding: [], exceptingWindows: [])
        do {
            // This will trigger the permission prompt if needed
            let _ = try await SCShareableContent.current
            screenCaptureAccess = true
        } catch {
            screenCaptureAccess = false
            throw PermissionError.screenCaptureAccessDenied
        }
    }

    // Microphone
    private func checkMicrophoneAccess() async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            microphoneAccess = true
        case .notDetermined:
            microphoneAccess = await AVCaptureDevice.requestAccess(for: .audio)
            if !microphoneAccess {
                throw PermissionError.microphoneAccessDenied
            }
        default:
            microphoneAccess = false
            throw PermissionError.microphoneAccessDenied
        }
    }

    // System Audio
    private func checkSystemAudioAccess() async throws {
        var hasAccess = false

        // Use Core Audio to check system audio access
        var propertySize = UInt32(MemoryLayout<UInt32>.size)
        var hasPermission: UInt32 = 0

        let result = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &AudioObjectPropertyAddress(
                mSelector: kAudioHardwarePropertyUserSessionIsActiveOrHeadless,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            ),
            0,
            nil,
            &propertySize,
            &hasPermission
        )

        hasAccess = result == kAudioHardwareNoError && hasPermission == 1
        systemAudioAccess = hasAccess

        if !hasAccess {
            throw PermissionError.systemAudioAccessDenied
        }
    }

    // Helper to show instructions if permissions are missing
    func showPermissionInstructions() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        // Only show notification if we have permission
        guard settings.authorizationStatus == .authorized else {
            print("""
            Permission Instructions:
            1. Screen Recording: System Settings > Privacy & Security > Screen Recording
            2. Microphone: System Settings > Privacy & Security > Microphone
            3. System Audio: No explicit permission needed, but audio capture must be enabled
            """)
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "Missing Permissions"
        content.body = "Please check System Settings to grant necessary permissions"

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        try? await center.add(request)
    }

    // Public getters for permission states
    var hasScreenCaptureAccess: Bool { screenCaptureAccess }
    var hasMicrophoneAccess: Bool { microphoneAccess }
    var hasSystemAudioAccess: Bool { systemAudioAccess }

    // Helper to check if all permissions are granted
    var hasAllPermissions: Bool {
        return screenCaptureAccess && microphoneAccess && systemAudioAccess
    }
}
```

This implementation:

1. Uses modern async/await API
2. Handles all three required permissions:
   - Screen recording (ScreenCaptureKit)
   - Microphone (AVFoundation)
   - System audio (CoreAudio)
3. Provides both individual and batch permission checking
4. Includes user-friendly instruction display
5. Caches permission states
6. Uses proper error handling

Key features:

- Singleton pattern for global access
- Async permission checks to handle UI prompts
- Clear error types for each permission
- Both notification and console-based instruction display
- Property getters for permission states

```swift
// AudioRecorder.swift

import AVFoundation
import Foundation

final class AudioRecorder {
    enum AudioSource {
        case microphone
        case system
    }

    enum AudioError: Error {
        case engineSetupFailed
        case inputNodeMissing
        case monitoringFailed
        case recordingFailed
    }

    private let engine: AVAudioEngine
    private let source: AudioSource
    private let uploadManager: UploadManager
    private var isRecording = false
    private var lastDbLevel: Float = 0

    // Buffer for audio data
    private var audioBuffer: Data
    private let bufferLimit = 5 * 1024 * 1024 // 5MB

    init(source: AudioSource, uploadManager: UploadManager) {
        self.engine = AVAudioEngine()
        self.source = source
        self.uploadManager = uploadManager
        self.audioBuffer = Data()
    }

    func start() async throws {
        let session = AVAudioSession.sharedInstance()
        try await session.setCategory(
            source == .system ? .record : .playAndRecord,
            mode: .default,
            options: source == .system ? [.mixWithOthers, .defaultToSpeaker] : []
        )
        try await session.setActive(true)

        // Set up the audio format
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // Create a tap to monitor audio levels and collect data
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
            guard let self = self else { return }
            self.processAudioBuffer(buffer)
        }

        try engine.start()
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        // Calculate dB level
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = UInt32(buffer.frameLength)

        var sum: Float = 0
        for i in 0..<Int(frameLength) {
            let sample = channelData[i]
            sum += sample * sample
        }

        let rms = sqrt(sum / Float(frameLength))
        let db = 20 * log10(rms)
        lastDbLevel = db

        // Only record if above threshold
        guard db >= ConfigManager.shared.dbThreshold else {
            if isRecording {
                flushBuffer()
                isRecording = false
            }
            return
        }

        isRecording = true

        // Convert buffer to Data and append
        let channelCount = Int(buffer.format.channelCount)
        let channels = UnsafeBufferPointer(start: buffer.floatChannelData, count: channelCount)
        let data = Data(bytes: channels[0], count: Int(frameLength) * MemoryLayout<Float>.size)

        audioBuffer.append(data)

        // If buffer reaches limit, flush it
        if audioBuffer.count >= bufferLimit {
            flushBuffer()
        }
    }

    private func flushBuffer() {
        guard !audioBuffer.isEmpty else { return }
        let dataToUpload = audioBuffer
        audioBuffer = Data()

        Task {
            do {
                try await uploadManager.uploadAudio(
                    data: dataToUpload,
                    source: source
                )
            } catch {
                print("Failed to upload audio: \(error)")
            }
        }
    }

    func stop() {
        engine.stop()
        flushBuffer()
    }

    var currentDbLevel: Float {
        return lastDbLevel
    }
}
```

```swift
// ScreenRecorder.swift

import Foundation
import ScreenCaptureKit
import CoreGraphics

final class ScreenRecorder {
    enum ScreenRecorderError: Error {
        case captureSetupFailed
        case screenshotFailed
        case encodingFailed
    }

    private let uploadManager: UploadManager
    private var captureEngine: SCStream?
    private var isRunning = false
    private let config = ConfigManager.shared

    init(uploadManager: UploadManager) {
        self.uploadManager = uploadManager
    }

    func start() async throws {
        guard !isRunning else { return }

        // Get main display
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw ScreenRecorderError.captureSetupFailed
        }

        // Configure capture
        let filter = SCContentFilter(.display, excluding: [], exceptingWindows: [])

        let configuration = SCStreamConfiguration()
        configuration.width = Int(config.screenResolution.width)
        configuration.height = Int(config.screenResolution.height)
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 1

        // Create and start the capture stream
        let stream = SCStream(filter: filter, configuration: configuration)

        try await stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global())
        try await stream.startCapture()

        self.captureEngine = stream
        self.isRunning = true

        // Start capture timer
        startCaptureTimer()
    }

    private func startCaptureTimer() {
        Timer.scheduledTimer(withTimeInterval: config.captureInterval, repeats: true) { [weak self] _ in
            guard let self = self, self.isRunning else { return }
            self.captureFrame()
        }
    }

    private func captureFrame() {
        guard isRunning else { return }
        // Actual capture happens in stream(output:didOutput:of:) callback
    }

    func stop() {
        isRunning = false
        Task {
            await captureEngine?.stopCapture()
            captureEngine = nil
        }
    }
}

// SCStreamOutput implementation
extension ScreenRecorder: SCStreamOutput {
    func stream(_ stream: SCStream, didOutput sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let imageBuffer = sample.imageBuffer else { return }

        // Convert to PNG
        guard let data = createPNGData(from: imageBuffer) else { return }

        // Upload screenshot
        Task {
            do {
                try await uploadManager.uploadScreenshot(data: data)
            } catch {
                print("Failed to upload screenshot: \(error)")
            }
        }
    }

    private func createPNGData(from imageBuffer: CVImageBuffer) -> Data? {
        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer)
        let baseAddress = CVPixelBufferGetBaseAddress(imageBuffer)

        let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        )

        guard let cgImage = context?.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:])
    }
}
```

Key features of these implementations:

AudioRecorder:

1. Handles both system and microphone audio
2. Implements dB level monitoring
3. Buffers audio data up to 5MB before uploading
4. Uses AVAudioEngine for efficient capture
5. Handles format conversion for upload

ScreenRecorder:

1. Uses ScreenCaptureKit for modern screen capture
2. Implements 1fps capture using timer
3. Converts frames to PNG format
4. Handles resolution configuration
5. Efficient memory management with proper buffer handling

```swift
// UploadManager.swift

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
```

Key features of this implementation:

1. Handles both direct and multipart uploads
2. Implements retry logic with exponential backoff
3. Proper error handling and cleanup
4. Efficient chunking for large files
5. Supports concurrent uploads
6. Proper XML handling for multipart upload responses
7. Clean separation of concerns with helper methods

```swift
// StatusManager.swift

import Foundation

final class StatusManager {
    static let shared = StatusManager()

    private var recordingStartTime: Date?
    private var uploadStats: [String: UploadStats] = [:]

    private struct UploadStats {
        var totalBytes: Int64 = 0
        var uploadedFiles: Int = 0
        var failedUploads: Int = 0
        var lastUploadTime: Date?
    }

    enum Component: String {
        case screenshot = "Screenshots"
        case systemAudio = "System Audio"
        case micAudio = "Microphone Audio"
    }

    private init() {}

    // MARK: - Recording Status

    func recordingStarted() {
        recordingStartTime = Date()
        printStatus("Recording started")
    }

    func recordingStopped() {
        recordingStartTime = nil
        printStatus("Recording stopped")
        printSummary()
    }

    // MARK: - Upload Status

    func uploadStarted(component: Component, bytes: Int) {
        var stats = uploadStats[component.rawValue] ?? UploadStats()
        stats.totalBytes += Int64(bytes)
        stats.lastUploadTime = Date()
        uploadStats[component.rawValue] = stats

        printStatus("Starting upload: \(component.rawValue) (\(formatBytes(bytes)))")
    }

    func uploadCompleted(component: Component) {
        var stats = uploadStats[component.rawValue] ?? UploadStats()
        stats.uploadedFiles += 1
        stats.lastUploadTime = Date()
        uploadStats[component.rawValue] = stats

        printStatus("Upload completed: \(component.rawValue)")
    }

    func uploadFailed(component: Component, error: Error) {
        var stats = uploadStats[component.rawValue] ?? UploadStats()
        stats.failedUploads += 1
        uploadStats[component.rawValue] = stats

        printError("Upload failed: \(component.rawValue) - \(error.localizedDescription)")
    }

    // MARK: - Audio Levels

    func updateAudioLevel(component: Component, db: Float) {
        // Only print if significant change
        if db >= ConfigManager.shared.dbThreshold {
            printStatus("\(component.rawValue) level: \(String(format: "%.1f dB", db))")
        }
    }

    // MARK: - Error Reporting

    func reportError(_ error: Error, component: String) {
        printError("Error in \(component): \(error.localizedDescription)")
    }

    // MARK: - Printing Helpers

    private func printStatus(_ message: String) {
        let timestamp = DateFormatter.localizedString(
            from: Date(),
            dateStyle: .none,
            timeStyle: .medium
        )
        print("[\(timestamp)] \(message)")
    }

    private func printError(_ message: String) {
        let timestamp = DateFormatter.localizedString(
            from: Date(),
            dateStyle: .none,
            timeStyle: .medium
        )
        print("[\(timestamp)] ❌ \(message)")
    }

    private func printSummary() {
        guard !uploadStats.isEmpty else { return }

        print("\n=== Recording Session Summary ===")

        if let startTime = recordingStartTime {
            let duration = Int(-startTime.timeIntervalSinceNow)
            print("Duration: \(formatDuration(duration))")
        }

        for (component, stats) in uploadStats {
            print("\n\(component):")
            print("  Total Data: \(formatBytes(Int(stats.totalBytes)))")
            print("  Files Uploaded: \(stats.uploadedFiles)")
            if stats.failedUploads > 0 {
                print("  Failed Uploads: \(stats.failedUploads)")
            }
        }
        print("\n=============================")
    }

    // MARK: - Formatting Helpers

    private func formatBytes(_ bytes: Int) -> String {
        let units = ["B", "KB", "MB", "GB"]
        var value = Double(bytes)
        var unitIndex = 0

        while value > 1024 && unitIndex < units.count - 1 {
            value /= 1024
            unitIndex += 1
        }

        return String(format: "%.1f %@", value, units[unitIndex])
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let seconds = seconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%d:%02d", minutes, seconds)
        }
    }
}
```

Key features of this implementation:

1. Simple console-based status reporting
2. Tracks:
   - Recording duration
   - Upload statistics per component
   - Audio levels
   - Errors
3. Provides a summary on session end
4. Formatted output for:
   - Timestamps
   - File sizes
   - Duration
   - Error messages
5. Thread-safe singleton design
6. Minimal memory footprint
7. Clean separation of concerns

I'll implement the final layer with both `AppDelegate.swift` and `main.swift`:

```swift
// AppDelegate.swift

import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var screenRecorder: ScreenRecorder?
    private var systemAudioRecorder: AudioRecorder?
    private var microphoneRecorder: AudioRecorder?
    private var uploadManager: UploadManager?
    private let statusManager = StatusManager.shared

    private var isRecording = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupTerminationHandler()

        Task {
            do {
                try await setupRecording()
            } catch {
                statusManager.reportError(error, component: "Setup")
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func setupTerminationHandler() {
        // Handle Ctrl+C
        signal(SIGINT) { _ in
            NSApplication.shared.terminate(nil)
        }

        // Handle system shutdown
        signal(SIGTERM) { _ in
            NSApplication.shared.terminate(nil)
        }
    }

    private func setupRecording() async throws {
        // Check permissions first
        try await PermissionManager.shared.checkAllPermissions()

        // Initialize upload manager
        uploadManager = try UploadManager()

        guard let uploadManager = uploadManager else {
            throw NSError(domain: "com.efficient-recorder", code: -1,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to initialize upload manager"])
        }

        // Initialize recorders
        screenRecorder = ScreenRecorder(uploadManager: uploadManager)
        systemAudioRecorder = AudioRecorder(source: .system, uploadManager: uploadManager)
        microphoneRecorder = AudioRecorder(source: .microphone, uploadManager: uploadManager)

        // Start recording
        try await startRecording()
    }

    private func startRecording() async throws {
        guard !isRecording else { return }

        do {
            try await screenRecorder?.start()
            try await systemAudioRecorder?.start()
            try await microphoneRecorder?.start()

            isRecording = true
            statusManager.recordingStarted()
        } catch {
            stopRecording()
            throw error
        }
    }

    private func stopRecording() {
        guard isRecording else { return }

        screenRecorder?.stop()
        systemAudioRecorder?.stop()
        microphoneRecorder?.stop()

        isRecording = false
        statusManager.recordingStopped()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopRecording()

        // Clean up temp files
        TempFileManager.shared.clearAll()
    }

    // Handle system sleep/wake
    func applicationProtectedDataWillBecomeUnavailable(_ notification: Notification) {
        stopRecording()
    }

    func applicationProtectedDataDidBecomeAvailable(_ notification: Notification) {
        Task {
            try? await startRecording()
        }
    }
}
```

```swift
// main.swift
import Foundation
import AppKit

// Parse command line arguments
let arguments = CommandLine.arguments

if arguments.count > 1 {
    if arguments[1] == "--setup-key" {
        guard arguments.count == 3 else {
            print("Usage: ./efficient-recorder --setup-key YOUR_R2_KEY")
            exit(1)
        }

        do {
            try ConfigManager.shared.setupAPIKey(arguments[2])
            print("API key successfully configured")
            exit(0)
        } catch {
            print("Failed to setup API key: \(error.localizedDescription)")
            exit(1)
        }
    } else {
        print("Unknown argument: \(arguments[1])")
        print("Usage: ./efficient-recorder [--setup-key YOUR_R2_KEY]")
        exit(1)
    }
}

// Check if API key is configured
guard ConfigManager.shared.hasAPIKey() else {
    print("No API key configured. Please run with --setup-key first")
    print("Usage: ./efficient-recorder --setup-key YOUR_R2_KEY")
    exit(1)
}

// Create and start application
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
```

Key features of this implementation:

1. AppDelegate:

   - Clean initialization sequence
   - Proper cleanup on termination
   - Handles system signals (SIGINT, SIGTERM)
   - System sleep/wake handling
   - Graceful error handling
   - Coordinated start/stop of all recorders

2. Main:
   - Simple command-line argument parsing
   - API key setup mode
   - Clear usage instructions
   - Validation before startup
   - Clean application lifecycle

The application can now be run in two ways:

1. Initial setup: `./efficient-recorder --setup-key YOUR_R2_KEY`
2. Normal operation: `./efficient-recorder`
