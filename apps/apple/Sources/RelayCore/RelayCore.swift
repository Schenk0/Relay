import CryptoKit
import Foundation
import Security

public enum RelayError: LocalizedError {
  case message(String)
  public var errorDescription: String? {
    if case .message(let value) = self { return value }
    return nil
  }
}
public struct RelayIdentity: Codable, Sendable {
  public var id, token, scope, name, key, server: String
  public var expiresAt: Double?
  public init(access: RelayAccess, key: String, server: String) {
    id = access.id
    token = access.token
    scope = access.scope
    name = access.name
    expiresAt = access.expiresAt
    self.key = key
    self.server = server
  }
}
public struct RelayAccess: Codable, Sendable {
  public let id, token, scope, name: String
  public let expiresAt: Double?
}
public struct RelayDevice: Codable, Identifiable, Sendable {
  public let id, name, scope: String
  public let createdAt: Double
  public let expiresAt: Double?
  public let revoked: Bool
  public let encryptedKey: String?
  public var active: Bool {
    !revoked && (expiresAt == nil || expiresAt! > Date().timeIntervalSince1970 * 1000)
  }
}
public struct RelayTransfer: Codable, Identifiable, Sendable {
  public let id, scope, author, metadata: String
  public let createdAt, expiresAt: Double
  public let size: Int
}
public struct RelayMetadata: Codable, Sendable {
  public let name, type, kind: String
  public init(name: String, type: String, kind: String) {
    self.name = name
    self.type = type
    self.kind = kind
  }
}
public struct RelayItem: Identifiable, Sendable {
  public let transfer: RelayTransfer
  public let info: RelayMetadata
  public let key: String
  public var id: String { transfer.id }
}
public struct RelayPair: Codable, Sendable {
  public let id, name, scope, publicKey, code: String
  public let expiresAt: Double
}
public struct PendingPair: Codable, Sendable {
  public let id, secret, code, privateKey, server: String
  public let expiresAt: Double
}
public struct RelayQueued: Codable, Identifiable, Sendable {
  public let id, owner, scope, metadata: String
  public let body: Data
}
private struct Ticket: Codable {
  let id, secret: String
  let expiresAt: Double
}
private struct Poll: Decodable {
  let status: String
  let result: PairResult?
}
private struct PairResult: Decodable {
  let access: RelayAccess
  let publicKey, wrappedKey: String
}
private struct Okay: Decodable { let ok: Bool }
private struct APIError: Decodable { let error: String }

public enum RelayCrypto {
  public static func bytes(_ value: String) throws -> Data {
    guard let data = Data(base64Encoded: value) else {
      throw RelayError.message("Invalid encryption data.")
    }
    return data
  }
  public static func randomKey() -> String {
    SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).base64EncodedString() }
  }
  public static func seal(key: String, data: Data, aad: String) throws -> Data {
    let box = try AES.GCM.seal(
      data, using: SymmetricKey(data: bytes(key)), authenticating: Data(aad.utf8))
    guard let combined = box.combined else { throw RelayError.message("Could not encrypt item.") }
    return combined
  }
  public static func open(key: String, data: Data, aad: String) throws -> Data {
    try AES.GCM.open(
      AES.GCM.SealedBox(combined: data), using: SymmetricKey(data: bytes(key)),
      authenticating: Data(aad.utf8))
  }
  public static func fingerprint(_ publicKey: String) throws -> String {
    SHA256.hash(data: try bytes(publicKey)).prefix(6).map { String(format: "%02X", $0) }.joined()
  }
  public static func pairingKey(privateKey: String, publicKey: String, id: String) throws -> String
  {
    let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: bytes(privateKey))
    let shared = try key.sharedSecretFromKeyAgreement(
      with: P256.KeyAgreement.PublicKey(x963Representation: bytes(publicKey)))
    return shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: Data(id.utf8), sharedInfo: Data("relay-pair-v1".utf8),
      outputByteCount: 32
    ).withUnsafeBytes { Data($0).base64EncodedString() }
  }
  public static func aad(_ id: String, _ scope: String, _ part: String) -> String {
    "relay-v1:\(id):\(scope):\(part)"
  }
}

public enum RelayStore {
  private static var group: String? {
    Bundle.main.object(forInfoDictionaryKey: "RelayKeychainGroup") as? String
  }
  private static func query(_ account: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Relay",
      kSecAttrAccount as String: account,
    ]
    if let group, !group.isEmpty { query[kSecAttrAccessGroup as String] = group }
    return query
  }
  public static func save<T: Encodable>(_ value: T, account: String) throws {
    let data = try JSONEncoder().encode(value)
    let base = query(account)
    let update = SecItemUpdate(
      base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else {
      throw RelayError.message("Could not update secure storage (\(update)).")
    }
    var insertion = base
    insertion[kSecValueData as String] = data
    insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let result = SecItemAdd(insertion as CFDictionary, nil)
    guard result == errSecSuccess else {
      throw RelayError.message("Could not save to secure storage (\(result)).")
    }
  }
  public static func load<T: Decodable>(_ type: T.Type, account: String) -> T? {
    var q = query(account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }
  public static func remove(account: String) { SecItemDelete(query(account) as CFDictionary) }
  public static func queueDirectory() throws -> URL {
    let root: URL
    if let appGroup = Bundle.main.object(forInfoDictionaryKey: "RelayAppGroup") as? String {
      guard
        let container = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: appGroup)
      else {
        throw RelayError.message("The shared app container is unavailable. Check app signing.")
      }
      root = container
    } else {
      root = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appendingPathComponent("Relay")
    }
    let directory = root.appendingPathComponent("outbox")
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return directory
  }
}

public struct RelayAPI: Sendable {
  public let identity: RelayIdentity
  public init(identity: RelayIdentity) { self.identity = identity }
  public static func validateServer(_ server: String) throws -> URL {
    guard let url = URL(string: server), let host = url.host, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil,
      url.path.isEmpty || url.path == "/"
    else { throw RelayError.message("Enter the service URL, without a path.") }
    guard
      url.scheme == "https"
        || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
    else { throw RelayError.message("Use HTTPS for a service outside this machine.") }
    return url
  }
  private static func raw(
    server: String, token: String?, path: String, method: String = "GET", body: Data? = nil,
    headers: [String: String] = [:]
  ) async throws -> Data {
    let root = try validateServer(server)
    guard let url = URL(string: "/api\(path)", relativeTo: root) else {
      throw RelayError.message("Invalid service URL.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.timeoutInterval = 120
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw RelayError.message("No response from Relay.")
    }
    guard (200..<300).contains(response.statusCode) else {
      throw RelayError.message(
        (try? JSONDecoder().decode(APIError.self, from: data).error)
          ?? "Relay request failed (\(response.statusCode)).")
    }
    return data
  }
  private static func json<T: Decodable>(
    server: String, token: String? = nil, path: String, method: String = "GET",
    body: [String: String]? = nil
  ) async throws -> T {
    let data = try await raw(
      server: server, token: token, path: path, method: method,
      body: try body.map { try JSONEncoder().encode($0) },
      headers: body == nil ? [:] : ["Content-Type": "application/json"])
    return try JSONDecoder().decode(T.self, from: data)
  }
  public static func startPair(server: String, name: String) async throws -> PendingPair {
    let key = P256.KeyAgreement.PrivateKey()
    let publicKey = key.publicKey.x963Representation.base64EncodedString()
    let code = try RelayCrypto.fingerprint(publicKey)
    let ticket: Ticket = try await json(
      server: server, path: "/pairs", method: "POST",
      body: ["name": name, "scope": "owner", "publicKey": publicKey, "code": code])
    return PendingPair(
      id: ticket.id, secret: ticket.secret, code: code,
      privateKey: key.rawRepresentation.base64EncodedString(), server: server,
      expiresAt: ticket.expiresAt)
  }
  public static func poll(_ pair: PendingPair) async throws -> RelayIdentity? {
    let poll: Poll = try await json(
      server: pair.server, token: pair.secret, path: "/pairs/\(pair.id)")
    guard let result = poll.result else { return nil }
    let wrapping = try RelayCrypto.pairingKey(
      privateKey: pair.privateKey, publicKey: result.publicKey, id: pair.id)
    let key = try RelayCrypto.open(
      key: wrapping, data: RelayCrypto.bytes(result.wrappedKey), aad: "relay-pair-v1:\(pair.id)"
    ).base64EncodedString()
    return RelayIdentity(access: result.access, key: key, server: pair.server)
  }
  public func acknowledge(_ pair: PendingPair) async {
    let _: Okay? = try? await Self.json(
      server: pair.server, token: pair.secret, path: "/pairs/\(pair.id)", method: "DELETE")
  }
  public func devices() async throws -> [RelayDevice] {
    try await Self.json(server: identity.server, token: identity.token, path: "/devices")
  }
  public func transfers() async throws -> [RelayTransfer] {
    try await Self.json(server: identity.server, token: identity.token, path: "/transfers")
  }
  public func findPair(_ code: String) async throws -> RelayPair {
    let code = code.uppercased().filter { $0.isHexDigit }
    return try await Self.json(
      server: identity.server, token: identity.token, path: "/pairs/code/\(code)")
  }
  public func approve(_ pair: RelayPair) async throws {
    guard try RelayCrypto.fingerprint(pair.publicKey) == pair.code else {
      throw RelayError.message("Pairing code mismatch.")
    }
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let key = pair.scope == "owner" ? identity.key : RelayCrypto.randomKey()
    let wrapping = try RelayCrypto.pairingKey(
      privateKey: ephemeral.rawRepresentation.base64EncodedString(), publicKey: pair.publicKey,
      id: pair.id)
    let wrapped = try RelayCrypto.seal(
      key: wrapping, data: RelayCrypto.bytes(key), aad: "relay-pair-v1:\(pair.id)"
    ).base64EncodedString()
    let encrypted: String? =
      pair.scope == "session"
      ? "\(pair.id).\(try RelayCrypto.seal(key: identity.key, data: RelayCrypto.bytes(key), aad: "relay-session-v1:\(pair.id)").base64EncodedString())"
      : nil
    let body: [String: String?] = [
      "publicKey": ephemeral.publicKey.x963Representation.base64EncodedString(),
      "wrappedKey": wrapped, "encryptedKey": encrypted,
    ]
    let _ = try await Self.raw(
      server: identity.server, token: identity.token, path: "/pairs/\(pair.id)/approve",
      method: "POST", body: JSONEncoder().encode(body),
      headers: ["Content-Type": "application/json"])
  }
  public func revoke(_ id: String) async throws {
    let _: Okay = try await Self.json(
      server: identity.server, token: identity.token, path: "/devices/\(id)", method: "DELETE")
  }
  public func delete(_ id: String) async throws {
    let _: Okay = try await Self.json(
      server: identity.server, token: identity.token, path: "/transfers/\(id)", method: "DELETE")
  }
  public func key(scope: String, devices: [RelayDevice]) throws -> String {
    if scope == "owner" || identity.scope == "session" { return identity.key }
    guard let value = devices.first(where: { $0.id == scope })?.encryptedKey,
      let separator = value.firstIndex(of: ".")
    else { throw RelayError.message("This session key is unavailable.") }
    let pair = String(value[..<separator])
    let cipher = String(value[value.index(after: separator)...])
    return try RelayCrypto.open(
      key: identity.key, data: RelayCrypto.bytes(cipher), aad: "relay-session-v1:\(pair)"
    ).base64EncodedString()
  }
  public func items(devices: [RelayDevice]) async throws -> [RelayItem] {
    try await transfers().map { item in
      let key = try key(scope: item.scope, devices: devices)
      let info: RelayMetadata
      do {
        let data = try RelayCrypto.open(
          key: key, data: RelayCrypto.bytes(item.metadata),
          aad: RelayCrypto.aad(item.id, item.scope, "metadata"))
        info = try JSONDecoder().decode(RelayMetadata.self, from: data)
      } catch {
        info = RelayMetadata(
          name: "Unreadable item", type: "application/octet-stream", kind: "file")
      }
      return RelayItem(transfer: item, info: info, key: key)
    }
  }
  public func download(_ item: RelayItem) async throws -> Data {
    let cipher = try await Self.raw(
      server: identity.server, token: identity.token, path: "/transfers/\(item.id)")
    return try RelayCrypto.open(
      key: item.key, data: cipher, aad: RelayCrypto.aad(item.id, item.transfer.scope, "content"))
  }
  public func enqueue(
    info: RelayMetadata, data: Data, scope: String = "owner", devices: [RelayDevice] = []
  ) throws {
    guard data.count <= 25 * 1024 * 1024 else {
      throw RelayError.message("Files must be 25 MiB or smaller.")
    }
    let key = try key(scope: scope, devices: devices)
    let id = UUID().uuidString.lowercased()
    let metadata = try RelayCrypto.seal(
      key: key, data: JSONEncoder().encode(info), aad: RelayCrypto.aad(id, scope, "metadata")
    ).base64EncodedString()
    let cipher = try RelayCrypto.seal(
      key: key, data: data, aad: RelayCrypto.aad(id, scope, "content"))
    let queued = RelayQueued(
      id: id, owner: identity.id, scope: scope, metadata: metadata, body: cipher)
    let url = try outboxDirectory().appendingPathComponent("\(id).json")
    try JSONEncoder().encode(queued).write(
      to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
  private func outboxDirectory() throws -> URL {
    guard UUID(uuidString: identity.id) != nil else {
      throw RelayError.message("Invalid connection identifier in recovery data.")
    }
    let directory = try RelayStore.queueDirectory().appendingPathComponent(identity.id)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return directory
  }
  private func queueFiles() throws -> [URL] {
    try FileManager.default.contentsOfDirectory(
      at: outboxDirectory(), includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "json" }
  }
  public func queuedCount() throws -> Int { try queueFiles().count }
  public func discardQueued() throws {
    for file in try queueFiles() { try FileManager.default.removeItem(at: file) }
  }
  public func flush() async throws {
    for file in try queueFiles() {
      let entry = try JSONDecoder().decode(RelayQueued.self, from: Data(contentsOf: file))
      guard entry.owner == identity.id else {
        throw RelayError.message("This queued item belongs to a different connection.")
      }
      let _ = try await Self.raw(
        server: identity.server, token: identity.token,
        path: "/transfers/\(entry.id)?scope=\(entry.scope)", method: "PUT", body: entry.body,
        headers: ["Content-Type": "application/octet-stream", "X-Relay-Metadata": entry.metadata])
      try? FileManager.default.removeItem(at: file)
    }
  }
}
