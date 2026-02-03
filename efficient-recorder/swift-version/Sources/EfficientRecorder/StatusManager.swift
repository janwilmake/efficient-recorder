
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