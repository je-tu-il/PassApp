// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PassAppIOS",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "PassAppCore",
            targets: ["PassAppCore"]
        )
    ],
    dependencies: [],
    targets: [
        .target(
            name: "PassAppCore",
            path: "PassApp",
            exclude: ["PassAppApp.swift"]
        )
    ]
)
