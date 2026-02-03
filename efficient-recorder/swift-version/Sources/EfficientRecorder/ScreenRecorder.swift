
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