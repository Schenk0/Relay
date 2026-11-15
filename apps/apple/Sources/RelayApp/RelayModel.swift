import Foundation
import Combine
import SwiftUI
import UniformTypeIdentifiers

#if canImport(RelayCore)
  import RelayCore
#endif
#if os(macOS)
  import AppKit
  import ServiceManagement
#else
  import UIKit
#endif

@MainActor @Observable final class RelayModel {
  var identity = RelayStore.load(RelayIdentity.self, account: "identity")
  var pending = RelayStore.load(PendingPair.self, account: "pending")
  var items: [RelayItem] = []
  var devices: [RelayDevice] = []
  var error: String?
  var notice: String?
  var busy = false
  var queued = 0
  var connected = false
  var target = "owner"
  var server = UserDefaults.standard.string(forKey: "relay-server") ?? "http://127.0.0.1:4318"
  var deviceName = {
    #if os(macOS)
      Host.current().localizedName ?? "My Mac"
    #else
      UIDevice.current.name
    #endif
  }()
  var approval: RelayPair?
  private var loop: Task<Void, Never>?
  private var refreshing = false
  private var sending = false
  private var hasLoaded = false
  @ObservationIgnored private var clipboardObserver: AnyCancellable?
  init() {
    // One observer per model, even when the menu bar and inbox window are both visible.
    clipboardObserver = NotificationCenter.default.publisher(for: Notification.Name("RelaySendClipboard"))
      .sink { [weak self] _ in
        self?.perform { [weak self] in try await self?.sendClipboard() }
      }
    loop = Task { [weak self] in
      while !Task.isCancelled {
        await self?.tick()
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }
  func perform(_ work: @escaping @MainActor () async throws -> Void) {
    guard !busy else { return }
    busy = true
    error = nil
    Task {
      do { try await work() } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
  func tick() async {
    if let identity {
      let api = RelayAPI(identity: identity)
      do {
        try await flush(api)
        await refresh()
      } catch {
        self.error = error.localizedDescription
        connected = false
      }
    } else if let pending {
      guard pending.expiresAt > Date().timeIntervalSince1970 * 1000 else {
        self.pending = nil
        RelayStore.remove(account: "pending")
        error = "Pairing expired. Connect again."
        return
      }
      do {
        if let identity = try await RelayAPI.poll(pending) {
          try RelayStore.save(identity, account: "identity")
          self.identity = identity
          self.pending = nil
          RelayStore.remove(account: "pending")
          await RelayAPI(identity: identity).acknowledge(pending)
          await refresh()
        }
      } catch { self.error = error.localizedDescription }
    }
  }
  func connect() async throws {
    let normalized = server.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(
      in: CharacterSet(charactersIn: "/"))
    let pair = try await RelayAPI.startPair(server: normalized, name: deviceName)
    try RelayStore.save(pair, account: "pending")
    pending = pair
    server = normalized
    UserDefaults.standard.set(normalized, forKey: "relay-server")
  }
  func refresh() async {
    guard let identity, !refreshing else { return }
    refreshing = true
    defer { refreshing = false }
    do {
      let api = RelayAPI(identity: identity)
      let devices = try await api.devices()
      let items = try await api.items(devices: devices)
      guard self.identity?.id == identity.id else { return }
      let known = Set(self.items.map(\.id))
      if hasLoaded,
        let incoming = items.first(where: {
          !known.contains($0.id) && $0.transfer.author != identity.id
        })
      {
        NotificationCenter.default.post(
          name: Notification.Name("RelayIncoming"), object: nil,
          userInfo: ["name": incoming.info.name])
      }
      hasLoaded = true
      self.devices = devices
      self.items = items
      queued = try api.queuedCount()
      connected = true
      cleanPreviews()
    } catch {
      connected = false
      self.error = error.localizedDescription
    }
  }
  private func flush(_ api: RelayAPI) async throws {
    guard !sending else { return }
    sending = true
    defer { sending = false }
    queued = try api.queuedCount()
    try await api.flush()
    queued = try api.queuedCount()
  }
  func sendText(_ text: String) async throws {
    guard let identity, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return
    }
    let api = RelayAPI(identity: identity)
    try api.enqueue(
      info: RelayMetadata(name: String(text.prefix(100)), type: "text/plain", kind: "text"),
      data: Data(text.utf8), scope: target, devices: devices)
    queued = try api.queuedCount()
    try await flush(api)
    await refresh()
  }
  func sendFiles(_ urls: [URL]) async throws {
    guard let identity else { throw RelayError.message("Connect this device first.") }
    let api = RelayAPI(identity: identity)
    for url in urls {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      let size = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
      guard size.isRegularFile == true, (size.fileSize ?? 0) <= 25 * 1024 * 1024 else {
        throw RelayError.message("Choose files of 25 MiB or smaller. Zip folders first.")
      }
      let type =
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
        ?? "application/octet-stream"
      try api.enqueue(
        info: RelayMetadata(name: url.lastPathComponent, type: type, kind: "file"),
        data: Data(contentsOf: url), scope: target, devices: devices)
    }
    queued = try api.queuedCount()
    try await flush(api)
    await refresh()
  }
  func sendClipboard() async throws {
    #if os(macOS)
      if let urls = NSPasteboard.general.readObjects(forClasses: [NSURL.self], options: nil)
        as? [URL], !urls.filter(\.isFileURL).isEmpty
      {
        try await sendFiles(urls.filter(\.isFileURL))
        return
      }
      if let image = NSPasteboard.general.data(forType: .png), let identity {
        let api = RelayAPI(identity: identity)
        try api.enqueue(
          info: RelayMetadata(name: "Clipboard.png", type: "image/png", kind: "file"), data: image,
          scope: target, devices: devices)
        try await flush(api)
        await refresh()
        return
      }
      guard let text = NSPasteboard.general.string(forType: .string) else {
        throw RelayError.message("Copy text, an image, or files first.")
      }
    #else
      if let image = UIPasteboard.general.image?.pngData(), let identity {
        let api = RelayAPI(identity: identity)
        try api.enqueue(
          info: RelayMetadata(name: "Clipboard.png", type: "image/png", kind: "file"), data: image,
          scope: target, devices: devices)
        try await flush(api)
        await refresh()
        return
      }
      guard let text = UIPasteboard.general.string else {
        throw RelayError.message("Copy text or an image first.")
      }
    #endif
    try await sendText(text)
  }
  func copy(_ item: RelayItem) async throws {
    guard let identity else { return }
    let data = try await RelayAPI(identity: identity).download(item)
    #if os(macOS)
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(String(decoding: data, as: UTF8.self), forType: .string)
    #else
      UIPasteboard.general.string = String(decoding: data, as: UTF8.self)
    #endif
    notice = "Copied to clipboard."
  }
  func download(_ item: RelayItem) async throws -> URL {
    guard let identity else { throw RelayError.message("Connect first.") }
    let data = try await RelayAPI(identity: identity).download(item)
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "relay-previews/\(item.id)")
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let name = item.info.kind == "text" ? "Shared text.txt" : item.info.name
    let safe = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(
      of: ":", with: "_"
    ).replacingOccurrences(of: "\\", with: "_")
    let url = directory.appendingPathComponent(
      safe.isEmpty || safe == "." || safe == ".." ? "Shared file" : safe)
    try data.write(
      to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    return url
  }
  func cleanPreviews() {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("relay-previews")
    guard
      let contents = try? FileManager.default.contentsOfDirectory(
        at: root, includingPropertiesForKeys: nil)
    else { return }
    let live = Set(items.map(\.id))
    for url in contents where !live.contains(url.lastPathComponent) {
      try? FileManager.default.removeItem(at: url)
    }
  }
  func remove(_ item: RelayItem) async throws {
    if let identity {
      try await RelayAPI(identity: identity).delete(item.id)
      await refresh()
    }
  }
  func find(_ code: String) async throws {
    if let identity { approval = try await RelayAPI(identity: identity).findPair(code) }
  }
  func approve() async throws {
    if let identity, let approval {
      try await RelayAPI(identity: identity).approve(approval)
      self.approval = nil
      await refresh()
    }
  }
  func revoke(_ device: RelayDevice) async throws {
    if let identity {
      try await RelayAPI(identity: identity).revoke(device.id)
      await refresh()
    }
  }
  func disconnect() {
    identity = nil
    items = []
    devices = []
    pending = nil
    connected = false
    hasLoaded = false
    cleanPreviews()
    RelayStore.remove(account: "identity")
    RelayStore.remove(account: "pending")
  }
  func restore(_ url: URL) throws {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let value = try JSONDecoder().decode(RelayIdentity.self, from: Data(contentsOf: url))
    _ = try RelayAPI.validateServer(value.server)
    guard try RelayCrypto.bytes(value.key).count == 32 else {
      throw RelayError.message("Invalid recovery key.")
    }
    try RelayStore.save(value, account: "identity")
    identity = value
    pending = nil
    RelayStore.remove(account: "pending")
    server = value.server
    UserDefaults.standard.set(value.server, forKey: "relay-server")
  }
  #if os(macOS)
    var launchAtLogin: Bool { SMAppService.mainApp.status == .enabled }
    func setLaunchAtLogin(_ enabled: Bool) {
      do {
        if enabled { try SMAppService.mainApp.register() }
        else { try SMAppService.mainApp.unregister() }
      } catch { self.error = error.localizedDescription }
    }
  #endif
}
