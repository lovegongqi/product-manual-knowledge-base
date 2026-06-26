import CoreGraphics
import Foundation
import ImageIO
import Vision

struct PageResult: Codable {
    let path: String
    let text: String
    let error: String?
}

func recognize(path: String) -> PageResult {
    let url = URL(fileURLWithPath: path)
    guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        return PageResult(path: path, text: "", error: "Unable to load image")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]

    do {
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        let lines = (request.results ?? []).compactMap { observation in
            observation.topCandidates(1).first?.string
        }
        return PageResult(path: path, text: lines.joined(separator: "\n"), error: nil)
    } catch {
        return PageResult(path: path, text: "", error: String(describing: error))
    }
}

let paths = Array(CommandLine.arguments.dropFirst())
let results = paths.map { recognize(path: $0) }
let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]

do {
    let data = try encoder.encode(results)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("Failed to encode OCR output: \(error)\n".utf8))
    exit(1)
}
