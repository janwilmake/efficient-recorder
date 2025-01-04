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