
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