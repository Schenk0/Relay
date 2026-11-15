import Foundation
import SwiftUI
import UniformTypeIdentifiers

#if os(iOS)
  import UIKit
  typealias PlatformController = UIViewController
#else
  import AppKit
  typealias PlatformController = NSViewController
#endif

@MainActor final class ShareViewController: PlatformController {
  private var items: [SharedInput] = []
  private let state = ShareState()
  override func viewDidLoad() {
    super.viewDidLoad()
    #if os(iOS)
      overrideUserInterfaceStyle = .dark
    #endif
    let sheet = ShareSheet(
      state: state, send: { [weak self] in self?.send() },
      close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) })
    #if os(iOS)
      let host = UIHostingController(rootView: sheet)
      addChild(host)
      host.view.frame = view.bounds
      host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      view.addSubview(host.view)
      host.didMove(toParent: self)
    #else
      let host = NSHostingController(rootView: sheet)
      addChild(host)
      view = host.view
      view.appearance = NSAppearance(named: .darkAqua)
      preferredContentSize = NSSize(width: 380, height: 280)
    #endif
    Task { await load() }
  }
  private func load() async {
    guard RelayStore.load(RelayIdentity.self, account: "identity") != nil else {
      state.status = "Open Relay and connect this device first."
      return
    }
    let inputs = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    for input in inputs {
      let providers = input.attachments ?? []
      if providers.isEmpty, let text = input.attributedContentText?.string {
        items.append(.text(text))
      }
      items.append(contentsOf: providers.map { .provider($0) })
    }
    state.status =
      items.isEmpty
      ? "No supported items to share."
      : "\(items.count) \(items.count == 1 ? "item" : "items") ready for your devices."
    state.ready = !items.isEmpty
  }

  private func payload(_ provider: NSItemProvider) async throws -> SharedPayload {
    let types = provider.registeredTypeIdentifiers
    let selected =
      types.first(where: { UTType($0)?.conforms(to: .fileURL) == true }) ?? types.first(where: {
        UTType($0)?.conforms(to: .image) == true
      }) ?? types.first(where: { UTType($0)?.conforms(to: .url) == true }) ?? types.first
      ?? UTType.plainText.identifier
    let suggestedName = provider.suggestedName
    return try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: selected, options: nil) { item, error in
        do {
          if let error { throw error }
          let data: Data
          let name: String
          let type: String
          let kind: String
          if let url = item as? URL {
            if url.isFileURL {
              let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
              guard size <= 25 * 1024 * 1024 else {
                throw RelayError.message("Files must be 25 MiB or smaller.")
              }
              data = try Data(contentsOf: url)
              name = url.lastPathComponent
              type =
                UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
              kind = "file"
            } else {
              data = Data(url.absoluteString.utf8)
              name = String(url.absoluteString.prefix(100))
              type = "text/plain"
              kind = "text"
            }
          } else if let text = item as? String {
            data = Data(text.utf8)
            name = String(text.prefix(100))
            type = "text/plain"
            kind = "text"
          } else if let bytes = item as? Data {
            data = bytes
            let ut = UTType(selected)
            let isText = ut?.conforms(to: .text) == true || ut?.conforms(to: .url) == true
            kind = isText ? "text" : "file"
            type = ut?.preferredMIMEType ?? "application/octet-stream"
            name =
              isText
              ? String(String(decoding: bytes, as: UTF8.self).prefix(100))
              : suggestedName ?? "Shared file.\(ut?.preferredFilenameExtension ?? "bin")"
          } else {
            throw RelayError.message(
              "This app did not provide a transferable file or text representation.")
          }
          guard data.count <= 25 * 1024 * 1024 else {
            throw RelayError.message("Files must be 25 MiB or smaller.")
          }
          continuation.resume(
            returning: SharedPayload(
              info: RelayMetadata(name: name, type: type, kind: kind), data: data))
        } catch { continuation.resume(throwing: error) }
      }
    }
  }
  private func send() {
    guard state.ready else { return }
    state.ready = false
    state.status = "Sending…"
    Task {
      do {
        guard let identity = RelayStore.load(RelayIdentity.self, account: "identity") else {
          throw RelayError.message("Open Relay and connect this device first.")
        }
        let api = RelayAPI(identity: identity)
        // Load one provider at a time so a batch does not retain every file in memory.
        while let input = items.first {
          let item: SharedPayload
          switch input {
          case .provider(let provider): item = try await payload(provider)
          case .text(let text):
            item = SharedPayload(
              info: RelayMetadata(name: String(text.prefix(100)), type: "text/plain", kind: "text"),
              data: Data(text.utf8))
          }
          try api.enqueue(info: item.info, data: item.data)
          items.removeFirst()
        }
        do {
          try await api.flush()
          state.status = "Sent to your devices."
        } catch {
          state.status =
            "Encrypted and queued. Open Relay to finish sending.\n\(error.localizedDescription)"
        }
        state.finished = true
      } catch {
        state.status = error.localizedDescription
        state.ready = true
      }
    }
  }
}
private enum SharedInput {
  case provider(NSItemProvider)
  case text(String)
}
private struct SharedPayload: Sendable {
  let info: RelayMetadata
  let data: Data
}
@MainActor @Observable private final class ShareState {
  var status = "Preparing items…"
  var ready = false
  var finished = false
}
private struct ShareSheet: View {
  let state: ShareState
  let send: () -> Void
  let close: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      Label("Relay", systemImage: "dot.radiowaves.left.and.right").font(.title2.bold())
      Text(state.status).font(.callout)
      HStack {
        Button(state.finished ? "Done" : "Cancel", action: close)
        Spacer()
        if !state.finished {
          Button("Send to my devices", action: send).buttonStyle(.borderedProminent).disabled(
            !state.ready)
        }
      }
    }.padding(28).frame(minWidth: 300, minHeight: 200).preferredColorScheme(.dark)
  }
}
