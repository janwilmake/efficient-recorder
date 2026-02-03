
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