import CryptoKit
import Foundation
import XCTest

@testable import RelayCore

final class RelayCryptoTests: XCTestCase {
  func testAuthenticatedContent() throws {
    let key = RelayCrypto.randomKey()
    let original = Data([0, 255, 10, 90])
    let cipher = try RelayCrypto.seal(key: key, data: original, aad: "item-1")
    XCTAssertEqual(try RelayCrypto.open(key: key, data: cipher, aad: "item-1"), original)
    XCTAssertThrowsError(try RelayCrypto.open(key: key, data: cipher, aad: "item-2"))
  }
  func testWebInteroperability() throws {
    guard let input = ProcessInfo.processInfo.environment["RELAY_INTEROP_INPUT"],
      let output = ProcessInfo.processInfo.environment["RELAY_INTEROP_OUTPUT"]
    else { throw XCTSkip("Run pnpm test for web/Swift interoperability fixtures.") }
    struct Fixture: Decodable {
      let key, aad, plaintext, ciphertext, privateKey, publicKey, pairId, derived: String
    }
    let fixture = try JSONDecoder().decode(
      Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: input)))
    let plaintext = try RelayCrypto.bytes(fixture.plaintext)
    XCTAssertEqual(
      try RelayCrypto.open(
        key: fixture.key, data: RelayCrypto.bytes(fixture.ciphertext), aad: fixture.aad), plaintext)
    XCTAssertEqual(
      try RelayCrypto.pairingKey(
        privateKey: fixture.privateKey, publicKey: fixture.publicKey, id: fixture.pairId),
      fixture.derived)
    let cipher = try RelayCrypto.seal(key: fixture.key, data: plaintext, aad: fixture.aad)
      .base64EncodedString()
    try JSONEncoder().encode(["ciphertext": cipher]).write(to: URL(fileURLWithPath: output))
  }
  func testServerURLs() throws {
    XCTAssertNoThrow(try RelayAPI.validateServer("http://127.0.0.1:4318"))
    XCTAssertNoThrow(try RelayAPI.validateServer("https://relay.example.com"))
    XCTAssertThrowsError(try RelayAPI.validateServer("http://relay.example.com"))
    XCTAssertThrowsError(try RelayAPI.validateServer("https://user:password@relay.example.com"))
  }
  func testRecoveryCannotEscapeOutbox() throws {
    let access = RelayAccess(
      id: "../../outside", token: "test", scope: "owner", name: "Test", expiresAt: nil)
    let identity = RelayIdentity(
      access: access, key: RelayCrypto.randomKey(), server: "http://127.0.0.1:4318")
    XCTAssertThrowsError(try RelayAPI(identity: identity).discardQueued())
  }

}
