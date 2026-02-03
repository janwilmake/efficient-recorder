
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