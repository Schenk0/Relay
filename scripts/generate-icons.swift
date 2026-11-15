import AppKit
import Foundation
let directory = URL(fileURLWithPath: "apps/apple/Assets.xcassets/AppIcon.appiconset")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedWhite: 0.095, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
NSColor.white.setStroke()
for radius in [180.0, 320.0] {
    for angles in [(135.0, 225.0), (-45.0, 45.0)] {
        let arc = NSBezierPath()
        arc.appendArc(withCenter: NSPoint(x: 512, y: 512), radius: radius, startAngle: angles.0, endAngle: angles.1)
        arc.lineWidth = 45; arc.lineCapStyle = .round; arc.stroke()
    }
}
NSColor.white.setFill()
NSBezierPath(ovalIn: NSRect(x: 462, y: 462, width: 100, height: 100)).fill()
image.unlockFocus()
var icons: [[String: String]] = []
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
        NSGraphicsContext.restoreGraphicsState()
        let filename = "icon-\(size)@\(scale)x.png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent(filename))
        icons.append(["idiom": "mac", "size": "\(size)x\(size)", "scale": "\(scale)x", "filename": filename])
    }
}
icons.append(["idiom": "universal", "platform": "ios", "size": "1024x1024", "filename": "icon-512@2x.png"])
let contents: [String: Any] = ["images": icons, "info": ["author": "xcode", "version": 1]]
try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("Contents.json"))
