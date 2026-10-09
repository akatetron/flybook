import AVFoundation
import ExpoModulesCore
import PDFKit

public class FlybookNativeModule: Module {
  // Synthesizers must stay alive until they finish writing.
  private var active: [ObjectIdentifier: AVSpeechSynthesizer] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("FlybookNative")

    AsyncFunction("getVoices") { () -> [[String: Any]] in
      // Every AVSpeechSynthesisVoice runs on the device; Personal Voice is left out.
      AVSpeechSynthesisVoice.speechVoices()
        .filter { voice in
          if #available(iOS 17.0, *) { return !voice.voiceTraits.contains(.isPersonalVoice) }
          return true
        }
        .map { voice in
          [
            "id": voice.identifier,
            "name": voice.name,
            "language": voice.language,
            "enhanced": voice.quality != .default,
          ]
        }
    }

    AsyncFunction("renderToFile") { (text: String, voiceId: String, rate: Double, path: String, promise: Promise) in
      guard let voice = AVSpeechSynthesisVoice(identifier: voiceId) else {
        promise.reject("ERR_VOICE", "This voice isn't available on the phone any more.")
        return
      }
      let url = path.hasPrefix("file://") ? URL(string: path)! : URL(fileURLWithPath: path)
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? FileManager.default.removeItem(at: url)

      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = voice
      // AVSpeechUtterance's normal rate is 0.5 on a 0...1 scale.
      utterance.rate = Float(min(max(rate * Double(AVSpeechUtteranceDefaultSpeechRate), Double(AVSpeechUtteranceMinimumSpeechRate)), Double(AVSpeechUtteranceMaximumSpeechRate)))

      let synthesizer = AVSpeechSynthesizer()
      let key = ObjectIdentifier(synthesizer)
      self.retain(synthesizer, key)
      var file: AVAudioFile?
      var frames: AVAudioFramePosition = 0
      var sampleRate = 22050.0
      var finished = false

      synthesizer.write(utterance) { buffer in
        guard !finished else { return }
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        // A zero-length buffer marks the end.
        if pcm.frameLength == 0 {
          finished = true
          file = nil // closes the file
          self.release(key)
          promise.resolve(["durationMs": Double(frames) / sampleRate * 1000])
          return
        }
        do {
          if file == nil {
            sampleRate = pcm.format.sampleRate
            file = try AVAudioFile(forWriting: url, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
          }
          try file?.write(from: pcm)
          frames += AVAudioFramePosition(pcm.frameLength)
        } catch {
          finished = true
          file = nil
          self.release(key)
          promise.reject("ERR_TTS", "Couldn't save the audio: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("extractPdf") { (uri: String) throws -> [String: Any] in
      guard let url = URL(string: uri), let doc = PDFDocument(url: url) else {
        throw Exception(name: "ERR_PDF", description: "This file couldn't be opened — it may be damaged.")
      }
      if doc.isLocked {
        throw Exception(name: "ERR_PDF", description: "This PDF is password-protected.")
      }
      var pages: [[String: Any]] = []
      for index in 0..<doc.pageCount {
        guard let page = doc.page(at: index) else { continue }
        pages.append(["page": index + 1, "lines": Self.lines(of: page)])
      }
      var outline: [[String: Any]] = []
      if let root = doc.outlineRoot { Self.collect(root, in: doc, into: &outline) }
      let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      var result: [String: Any] = ["pageCount": doc.pageCount, "pages": pages, "outline": outline]
      if let title, !title.isEmpty { result["title"] = title }
      return result
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
  }

  private func retain(_ synthesizer: AVSpeechSynthesizer, _ key: ObjectIdentifier) {
    lock.lock(); active[key] = synthesizer; lock.unlock()
  }

  private func release(_ key: ObjectIdentifier) {
    lock.lock(); active[key] = nil; lock.unlock()
  }

  /// One entry per text line: its text, font size and top position measured from the top of the page.
  private static func lines(of page: PDFPage) -> [[String: Any]] {
    let bounds = page.bounds(for: .mediaBox)
    guard let selection = page.selection(for: bounds) else { return [] }
    return selection.selectionsByLine().compactMap { line in
      guard let raw = line.string else { return nil }
      let text = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
      if text.isEmpty { return nil }
      let box = line.bounds(for: page)
      var size = Double(box.height)
      if let attributed = line.attributedString, attributed.length > 0,
         let font = attributed.attribute(.font, at: 0, effectiveRange: nil) as? UIFont {
        size = Double(font.pointSize)
      }
      return [
        "text": text,
        "fontSize": size,
        "y": Double(bounds.maxY - box.maxY),
        "height": Double(box.height),
      ]
    }
  }

  private static func collect(_ node: PDFOutline, in doc: PDFDocument, into out: inout [[String: Any]]) {
    for i in 0..<node.numberOfChildren {
      guard let child = node.child(at: i) else { continue }
      let title = child.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !title.isEmpty, let page = child.destination?.page {
        let index = doc.index(for: page)
        if index != NSNotFound { out.append(["title": title, "page": index + 1]) }
      }
      collect(child, in: doc, into: &out)
    }
  }
}
