import QuickLook
import SwiftUI
import UniformTypeIdentifiers

#if canImport(RelayCore)
  import RelayCore
#endif
#if os(macOS)
  import Carbon
  import AppKit
#endif

private struct SharedFile: Identifiable {
  let url: URL
  var id: URL { url }
}

@main struct RelayApp: App {
  @State private var model = RelayModel()
  #if os(macOS)
    @NSApplicationDelegateAdaptor(RelayDelegate.self) var delegate
    var body: some Scene {
      Window("Relay", id: "inbox") {
        RelayView(model: model).frame(minWidth: 460, minHeight: 420).preferredColorScheme(.dark)
      }
      .defaultSize(width: 560, height: 520)
      .commands {
        CommandGroup(after: .pasteboard) {
          Button("Send clipboard to Relay") { model.perform { try await model.sendClipboard() } }
            .keyboardShortcut("r", modifiers: [.command, .option, .control])
        }
      }
      MenuBarExtra("Relay", systemImage: "dot.radiowaves.left.and.right") {
        RelayView(model: model, isMenuBar: true)
          .frame(width: 460).fixedSize(horizontal: false, vertical: true)
          .preferredColorScheme(.dark)
      }.menuBarExtraStyle(.window)
    }
  #else
    var body: some Scene { WindowGroup { RelayView(model: model).preferredColorScheme(.dark) } }
  #endif
}

struct RelayView: View {
  @Bindable var model: RelayModel
  var isMenuBar = false
  @Environment(\.scenePhase) private var phase
  @Environment(\.openWindow) private var openWindow
  @State private var text = ""
  @FocusState private var composing: Bool
  @State private var editorBounds: CGRect = .null
  @State private var code = ""
  @State private var tab = 0
  @State private var importing = false
  @State private var importingRecovery = false
  @State private var previewURL: URL?
  @State private var sharingURL: SharedFile?
  @State private var fileToSave: RelayDocument?
  @State private var saving = false
  @State private var saveName = "Shared file"
  var body: some View {
    platformContent
      .fileImporter(
        isPresented: $importing,
        allowedContentTypes: importingRecovery ? [.json] : [.item],
        allowsMultipleSelection: !importingRecovery
      ) { result in
        model.perform {
          let urls = try result.get()
          if importingRecovery {
            if let url = urls.first { try model.restore(url) }
          } else {
            try await model.sendFiles(urls)
          }
        }
      }
      .fileExporter(
        isPresented: $saving, document: fileToSave, contentType: .data, defaultFilename: saveName
      ) { result in
        if case .failure(let error) = result { model.error = error.localizedDescription }
      }
      .quickLookPreview($previewURL)
      #if os(iOS)
        .sheet(item: $sharingURL) { url in ActivitySheet(url: url.url) }
      #endif
      .onChange(of: phase) { _, value in if value == .active { Task { await model.tick() } } }
      #if os(macOS)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RelayShowInbox"))) {
          _ in
          openWindow(id: "inbox")
          NSApp.activate(ignoringOtherApps: true)
        }
      #endif
      .onDrop(of: [UTType.fileURL.identifier], isTargeted: nil) { providers in
        guard !providers.isEmpty, !model.busy else { return false }
        // Keep the whole drop in one operation; separate callbacks can hit the busy guard.
        model.perform {
          var urls: [URL] = []
          for provider in providers {
            let url: URL = try await withCheckedThrowingContinuation { continuation in
              _ = provider.loadObject(ofClass: URL.self) { url, error in
                if let error {
                  continuation.resume(throwing: error)
                } else if let url {
                  continuation.resume(returning: url)
                } else {
                  continuation.resume(
                    throwing: RelayError.message("Could not read the dropped file."))
                }
              }
            }
            urls.append(url)
          }
          try await model.sendFiles(urls)
        }
        return true
      }
  }
  @ViewBuilder private var platformContent: some View {
    #if os(iOS)
      if model.identity == nil {
        NavigationStack {
          VStack(spacing: 0) {
            messages
            onboarding
          }.navigationTitle("Relay")
        }
      } else {
        TabView(selection: $tab) {
          mobileScreen("Send") { mobileComposer }
            .tabItem { Label("Send", systemImage: "paperplane") }
            .tag(0)

          mobileScreen("Inbox") { receivedItems }
            .tabItem { Label("Inbox", systemImage: "tray") }
            .tag(1)

          mobileScreen("Connections") { connections }
            .tabItem { Label("Connections", systemImage: "link") }
            .tag(2)
        }
        .onChange(of: tab) { _, _ in composing = false }
      }
    #else
      if isMenuBar {
        macContent
          .background(Color(nsColor: .windowBackgroundColor))
      } else {
        NavigationStack {
          macContent.navigationTitle("Relay")
        }
      }
    #endif
  }
  #if os(macOS)
    private var macContent: some View {
      VStack(spacing: 0) {
        messages
        if model.identity == nil {
          onboarding.frame(height: isMenuBar ? 330 : nil)
        } else {
          HStack {
            Picker("Section", selection: $tab) {
              Text("Inbox").tag(0)
              Text("Connections").tag(1)
            }.pickerStyle(.segmented).labelsHidden().frame(width: 220)
            Spacer()
            Button {
              model.perform { await model.tick() }
            } label: {
              Image(systemName: "arrow.clockwise")
            }.buttonStyle(.plain).accessibilityLabel("Refresh")
          }.padding(.horizontal, 12).padding(.vertical, 8)
          if tab == 0 { inbox } else { connections.frame(height: isMenuBar ? 420 : nil) }
        }
        Divider()
        HStack {
          Button("Open inbox window") {
            openWindow(id: "inbox")
            NSApp.activate(ignoringOtherApps: true)
          }
          Spacer()
          Button("Quit Relay") { NSApp.terminate(nil) }
        }.font(.callout).padding(.horizontal, 12).padding(.vertical, 8)
      }
    }
  #endif
  #if os(iOS)
    private var mobileComposer: some View {
      ScrollView { composer }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .scrollDismissesKeyboard(.interactively)
        .coordinateSpace(name: "RelaySend")
        .contentShape(Rectangle())
        .simultaneousGesture(
          SpatialTapGesture(coordinateSpace: .named("RelaySend")).onEnded { tap in
            if !editorBounds.contains(tap.location) { composing = false }
          }
        )
    }
    private func mobileScreen<Content: View>(
      _ title: String, @ViewBuilder content: () -> Content
    ) -> some View {
      NavigationStack {
        VStack(spacing: 0) {
          messages
          content()
        }
        .navigationTitle(title)
        .toolbar {
          ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: 4) {
              Circle().fill(model.connected ? .green : .gray).frame(width: 5, height: 5)
              Text(model.connected ? "Connected" : "Connecting")
            }
            .font(.caption2)
            .fixedSize()
            .onTapGesture { composing = false }
          }
          ToolbarItemGroup(placement: .topBarTrailing) {
            if composing {
              Button("Done") { composing = false }
            }
            Button {
              composing = false
              model.perform { await model.tick() }
            } label: {
              Image(systemName: "arrow.clockwise")
            }.accessibilityLabel("Refresh")
          }
        }
      }
    }
  #endif
  @ViewBuilder private var messages: some View {
    if let error = model.error {
      HStack {
        Text(error).font(.callout).foregroundStyle(.red)
        Spacer()
        Button {
          model.error = nil
        } label: {
          Image(systemName: "xmark")
        }.buttonStyle(.plain)
      }.padding().background(.red.opacity(0.08))
    }
    if let notice = model.notice {
      HStack {
        Text(notice).font(.callout)
        Spacer()
        Button {
          model.notice = nil
        } label: {
          Image(systemName: "xmark")
        }.buttonStyle(.plain)
      }.padding()
    }
  }
  private var onboarding: some View {
    Form {
      Section {
        Text("A temporary inbox for your devices.").font(.title2).padding(.vertical, 10)
        TextField("Service URL", text: $model.server).textContentType(.URL)
        TextField("Device name", text: $model.deviceName)
        if let pending = model.pending {
          Text("Approve this code in Connections on a trusted device.")
          Text(pending.code).font(.title.monospaced()).textSelection(.enabled)
          Text("This is a personal device with full inbox access.").font(.caption).foregroundStyle(
            .secondary)
          Button("Cancel request") {
            model.pending = nil
            RelayStore.remove(account: "pending")
          }
        } else {
          Button("Connect personal device") { model.perform { try await model.connect() } }
            .disabled(model.busy || model.deviceName.isEmpty)
        }
        Button("Restore recovery file") {
          importingRecovery = true
          importing = true
        }
        Text("Set up your first device in the web app. Use HTTPS to connect over the internet.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }.formStyle(.grouped)
  }
  private var inbox: some View {
    VStack(spacing: 0) {
      composer
      Divider()
      receivedItems.frame(height: isMenuBar ? menuListHeight : nil)
      connectionStatus
    }
  }
  // Let short inboxes shrink the menu; longer inboxes scroll instead of extending off-screen.
  private var menuListHeight: CGFloat {
    model.items.isEmpty ? 110 : CGFloat(min(model.items.count, 6)) * 52
  }
  private var contentPadding: CGFloat {
    #if os(macOS)
      10
    #else
      16
    #endif
  }
  private var composerSpacing: CGFloat {
    #if os(macOS)
      8
    #else
      12
    #endif
  }
  private var composer: some View {
    VStack(alignment: .leading, spacing: composerSpacing) {
      HStack {
        Text("Send to").foregroundStyle(.secondary)
        Picker("Destination", selection: $model.target) {
          Text("My devices").tag("owner")
          ForEach(model.devices.filter { $0.scope == "session" && $0.active }) {
            Text($0.name).tag($0.id)
          }
        }.labelsHidden()
      }.font(.callout)
      #if os(macOS)
        TextField("Text or a link", text: $text, axis: .vertical)
          .textFieldStyle(.roundedBorder).lineLimit(1...4)
          .accessibilityLabel("Text or a link")
      #else
        TextEditor(text: $text).accessibilityLabel("Text or a link")
          .focused($composing)
          .onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .named("RelaySend"))
          } action: { bounds in
            editorBounds = bounds
          }
          .frame(height: 160)
          .scrollContentBackground(.hidden).overlay(
            alignment: .topLeading
          ) {
            if text.isEmpty {
              Text("Text or a link").foregroundStyle(.secondary).padding(.top, 8).padding(
                .leading, 5
              )
              .allowsHitTesting(false)
            }
          }
      #endif
      HStack {
        Button {
          importingRecovery = false
          importing = true
        } label: {
          Label("Files", systemImage: "plus")
        }.disabled(model.busy)
        Button("Clipboard") { model.perform { try await model.sendClipboard() } }.disabled(
          model.busy)
        Spacer()
        Button("Send") {
          let value = text
          model.perform {
            try await model.sendText(value)
            text = ""
          }
        }.buttonStyle(.borderedProminent).disabled(
          model.busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      if model.queued > 0 {
        Button("Discard queued uploads", role: .destructive) {
          model.perform {
            if let identity = model.identity {
              try RelayAPI(identity: identity).discardQueued()
              await model.refresh()
            }
          }
        }
        Text("\(model.queued) encrypted uploads queued. Retrying while Relay is open.").font(
          .caption
        ).foregroundStyle(.secondary)
      }
    }.padding(contentPadding)
  }
  @ViewBuilder private var receivedItems: some View {
    if model.items.isEmpty {
      ContentUnavailableView(
        "Your inbox is ready", systemImage: "tray",
        description: Text("Send from another device. Items expire after 24 hours."))
    } else {
      List(model.items) { item in
        HStack(spacing: 12) {
          Image(
            systemName: item.info.kind == "text"
              ? "doc.text" : item.info.type.hasPrefix("image/") ? "photo" : "doc"
          ).foregroundStyle(.secondary)
          VStack(alignment: .leading, spacing: 4) {
            Text(item.info.name).lineLimit(2)
            Text(Date(timeIntervalSince1970: item.transfer.expiresAt / 1000), style: .relative)
              .font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Menu {
            itemActions(item)
          } label: {
            Image(systemName: "ellipsis")
          }.menuStyle(.borderlessButton)
            .accessibilityLabel("Actions for \(item.info.name)")
        }.padding(.vertical, 6)
          #if os(macOS)
            .onDrag {
              let provider = NSItemProvider()
              provider.suggestedName = item.info.kind == "text" ? "Shared text.txt" : item.info.name
              provider.registerFileRepresentation(
                forTypeIdentifier: (UTType(mimeType: item.info.type) ?? .data).identifier,
                fileOptions: [], visibility: .all
              ) { completion in
                Task { @MainActor in
                  do { completion(try await model.download(item), true, nil) } catch {
                    completion(nil, false, error)
                  }
                }
                return nil
              }
              return provider
            }
            .contextMenu { itemActions(item) }
          #endif
          .accessibilityElement(children: .contain)
      }.listStyle(.plain)
    }
  }
  @ViewBuilder private func itemActions(_ item: RelayItem) -> some View {
    Button("Preview") { model.perform { previewURL = try await model.download(item) } }
    if item.info.kind == "text" {
      Button("Copy text") { model.perform { try await model.copy(item) } }
    }
    #if os(macOS)
      if item.info.kind == "file" {
        Button("Copy file") { model.perform { try await model.copyFile(item) } }
          .disabled(model.busy)
      }
    #endif
    Button("Save a copy") {
      model.perform {
        let url = try await model.download(item)
        fileToSave = RelayDocument(data: try Data(contentsOf: url))
        saveName = url.lastPathComponent
        saving = true
      }
    }
    #if os(iOS)
      Button("Share") {
        model.perform { sharingURL = SharedFile(url: try await model.download(item)) }
      }
    #endif
    Button("Delete from Relay", role: .destructive) {
      model.perform { try await model.remove(item) }
    }
  }
  private var connectionStatus: some View {
    HStack {
      Circle().fill(model.connected ? .green : .gray).frame(width: 5, height: 5)
      Text(model.connected ? "Connected" : "Connecting")
      Spacer()
      Text("25 MiB per file")
    }.font(.caption).foregroundStyle(.secondary).padding(contentPadding)
  }
  private var connections: some View {
    Form {
      Section("Approve a connection") {
        TextField("Code on the other device", text: $code)
        Button("Find device") { model.perform { try await model.find(code) } }.disabled(
          model.busy || code.filter { $0.isHexDigit }.count != 12)
        if let approval = model.approval {
          Text(approval.name).bold()
          Text(
            approval.scope == "owner"
              ? "Full personal inbox access." : "Only its own transfers. Session lasts 4 hours.")
          Text(approval.code).font(.headline.monospaced())
          Button("Approve matching code") {
            model.perform {
              try await model.approve()
              code = ""
            }
          }.disabled(model.busy)
          Button("Cancel") { model.approval = nil }
        }
      }
      Section("Devices") {
        ForEach(model.devices) { device in
          HStack {
            VStack(alignment: .leading) {
              Text(device.name)
              Text(
                device.revoked
                  ? "Revoked" : device.scope == "session" ? "Temporary session" : "Personal device"
              ).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if device.id != model.identity?.id && !device.revoked {
              Button("Revoke") { model.perform { try await model.revoke(device) } }
            }
          }
        }
      }
      Section("Recovery") {
        Text("Anyone with your recovery file can access your inbox. Store it privately.").font(
          .caption
        ).foregroundStyle(.secondary)
        Button("Save recovery file") {
          model.perform {
            guard let identity = model.identity else { return }
            fileToSave = RelayDocument(data: try JSONEncoder().encode(identity))
            saveName = "relay-recovery.json"
            saving = true
          }
        }
        Button("Disconnect this device", role: .destructive) { model.disconnect() }
      }
      #if os(macOS)
        Section("Mac") {
          Toggle(
            "Open Relay at login",
            isOn: Binding(
              get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) }))
          Text("Send clipboard: Control-Option-Command-R").font(.caption)
        }
      #endif
    }.formStyle(.grouped)
  }
}
struct RelayDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.data] }
  var data: Data
  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}
#if os(iOS)
  struct ActivitySheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
      UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
  }
#else
  @MainActor final class RelayDelegate: NSObject, NSApplicationDelegate {
    private var hotkey: EventHotKeyRef?
    private var shelf: NSPanel?
    private var hideShelf: Task<Void, Never>?
    func applicationDidFinishLaunching(_ notification: Notification) {
      NotificationCenter.default.addObserver(
        self, selector: #selector(showIncoming(_:)), name: Notification.Name("RelayIncoming"),
        object: nil)
      let id = EventHotKeyID(signature: 0x524c_4159, id: 1)
      RegisterEventHotKey(
        UInt32(kVK_ANSI_R), UInt32(cmdKey | optionKey | controlKey), id,
        GetApplicationEventTarget(), 0, &hotkey)
      var event = EventTypeSpec(
        eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
      InstallEventHandler(
        GetApplicationEventTarget(),
        { _, _, _ in
          DispatchQueue.main.async {
            NotificationCenter.default.post(
              name: Notification.Name("RelaySendClipboard"), object: nil)
          }
          return noErr
        }, 1, &event, nil, nil)
    }
    @objc private func showIncoming(_ notification: Notification) {
      guard let name = notification.userInfo?["name"] as? String, let screen = NSScreen.main else {
        return
      }
      hideShelf?.cancel()
      shelf?.orderOut(nil)
      let frame = NSRect(
        x: screen.visibleFrame.maxX - 380, y: screen.visibleFrame.maxY - 110, width: 360, height: 90
      )
      let panel = NSPanel(
        contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
        defer: false)
      panel.level = .floating
      panel.isReleasedWhenClosed = false
      panel.hidesOnDeactivate = false
      panel.contentView = NSHostingView(
        rootView: VStack(alignment: .leading, spacing: 8) {
          Text(name).font(.callout).lineLimit(1)
          HStack {
            Text("Received in Relay").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button("Open") {
              NotificationCenter.default.post(
                name: Notification.Name("RelayShowInbox"), object: nil)
            }
          }
        }.padding(16).preferredColorScheme(.dark))
      panel.orderFrontRegardless()
      shelf = panel
      hideShelf = Task { [weak self] in
        do {
          try await Task.sleep(for: .seconds(8))
          self?.shelf?.orderOut(nil)
        } catch {}
      }
    }

  }
#endif
