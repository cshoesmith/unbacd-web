import Foundation
import SwiftUI

struct BACSnapshot: Decodable {
    let bac: Double
    let soberMs: Int64
    let drinkCount: Int
    let calculatedAt: Int64
    let username: String
}

@MainActor
final class WatchAppModel: ObservableObject {
    enum ScreenState {
        case loading
        case pairing
        case waitingForData
        case ready(BACSnapshot)
        case failed(String)
    }

    private enum Constants {
        static let apiBase = "https://unbacd-web.vercel.app"
        static let webPollIntervalNs: UInt64 = 60 * 1_000_000_000
        static let staleAfterMs: Int64 = 15 * 60_000
        static let bacDoNotDrive = 0.05
        static let bacCaution = 0.12
        static let bacDanger = 0.20
        static let tokenKey = "device-token"
        static let installationKey = "watch-installation-id"
    }

    @Published private(set) var screenState: ScreenState = .loading
    @Published var pin = ""
    @Published private(set) var isPairing = false
    @Published private(set) var lastUpdatedAt: Date?
    @Published private(set) var networkNotice: String?

    private let defaults: UserDefaults
    private let session: URLSession
    private var pollingTask: Task<Void, Never>?
    private var deviceToken: String?
    private let installationId: String
    private var currentPhase: ScenePhase = .inactive

    init(defaults: UserDefaults = .standard, session: URLSession = .shared) {
        self.defaults = defaults
        self.session = session
        self.deviceToken = defaults.string(forKey: Constants.tokenKey)

        if let existingInstallation = defaults.string(forKey: Constants.installationKey) {
            self.installationId = existingInstallation
        } else {
            let generatedInstallation = UUID().uuidString
            defaults.set(generatedInstallation, forKey: Constants.installationKey)
            self.installationId = generatedInstallation
        }

        if deviceToken == nil {
            screenState = .pairing
        } else {
            screenState = .waitingForData
        }
    }

    func setScenePhase(_ phase: ScenePhase) {
        currentPhase = phase
        switch phase {
        case .active:
            startPollingIfPossible()
        case .background, .inactive:
            pollingTask?.cancel()
            pollingTask = nil
        @unknown default:
            pollingTask?.cancel()
            pollingTask = nil
        }
    }

    func submitPin() async {
        guard !isPairing else { return }

        let normalizedPin = pin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalizedPin.count == 6 else {
            networkNotice = "Enter the 6-character PIN"
            screenState = .pairing
            return
        }

        isPairing = true
        networkNotice = nil

        defer {
            isPairing = false
        }

        do {
            var request = URLRequest(url: URL(string: Constants.apiBase + "/api/pair")!)
            request.httpMethod = "PUT"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(PairRequest(pin: normalizedPin, deviceId: installationId))

            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw RequestError.invalidResponse
            }

            guard httpResponse.statusCode == 200 else {
                throw RequestError.server(code: httpResponse.statusCode)
            }

            let pairResponse = try JSONDecoder().decode(PairResponse.self, from: data)
            defaults.set(pairResponse.deviceToken, forKey: Constants.tokenKey)
            deviceToken = pairResponse.deviceToken
            pin = ""
            screenState = .waitingForData
            await refreshBAC(forceRePairOn404: true)
            startPollingIfPossible()
        } catch let error as RequestError {
            networkNotice = error.message
            screenState = .pairing
        } catch {
            networkNotice = "Connection error"
            screenState = .pairing
        }
    }

    func refreshBAC(forceRePairOn404: Bool = true) async {
        guard let deviceToken else {
            screenState = .pairing
            return
        }

        do {
            var components = URLComponents(string: Constants.apiBase + "/api/bac")!
            components.queryItems = [URLQueryItem(name: "device", value: deviceToken)]
            let (data, response) = try await session.data(from: components.url!)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw RequestError.invalidResponse
            }

            if httpResponse.statusCode == 404, forceRePairOn404 {
                clearPairing()
                networkNotice = "Pairing expired. Enter a new PIN."
                return
            }

            guard httpResponse.statusCode == 200 else {
                throw RequestError.server(code: httpResponse.statusCode)
            }

            let snapshot = try JSONDecoder().decode(BACSnapshot.self, from: data)
            lastUpdatedAt = Date()
            screenState = .ready(snapshot)
            networkNotice = nil
        } catch let error as RequestError {
            networkNotice = error.message
            if case .waitingForData = screenState {
                screenState = .failed(error.message)
            }
        } catch {
            networkNotice = "Connection error"
            if case .waitingForData = screenState {
                screenState = .failed("Connection error")
            }
        }
    }

    func resetPairing() {
        clearPairing()
        networkNotice = nil
    }

    func bacLabel(for bac: Double) -> String {
        if bac < 0.02 { return "SOBER" }
        if bac < Constants.bacDoNotDrive { return "TRACE" }
        if bac < 0.07 { return "TIPSY" }
        if bac < Constants.bacCaution { return "CAUTION" }
        if bac < Constants.bacDanger { return "OVER LIMIT" }
        return "DANGER"
    }

    func backgroundColor(for bac: Double) -> Color {
        if bac >= Constants.bacDanger { return Color(red: 0.86, green: 0.15, blue: 0.15) }
        if bac < 0.02 { return Color(red: 0.03, green: 0.02, blue: 0.02) }
        if bac < Constants.bacDoNotDrive { return Color(red: 0.98, green: 0.57, blue: 0.24) }
        if bac < 0.07 { return Color(red: 0.98, green: 0.45, blue: 0.09) }
        if bac < Constants.bacCaution { return Color(red: 0.94, green: 0.27, blue: 0.27) }
        return Color(red: 0.86, green: 0.15, blue: 0.15)
    }

    func shouldShowDoNotDrive(for bac: Double) -> Bool {
        bac >= Constants.bacDoNotDrive && bac < Constants.bacDanger
    }

    func shouldShowDoNotWalk(for bac: Double) -> Bool {
        bac >= Constants.bacDanger
    }

    func isStale(referenceDate: Date = Date()) -> Bool {
        guard let lastUpdatedAt else { return false }
        return Int64(referenceDate.timeIntervalSince(lastUpdatedAt) * 1000) > Constants.staleAfterMs
    }

    private func startPollingIfPossible() {
        guard currentPhase == .active else { return }
        guard deviceToken != nil else {
            screenState = .pairing
            return
        }
        guard pollingTask == nil else { return }

        pollingTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshBAC()
            while !Task.isCancelled {
                do {
                        try await Task.sleep(nanoseconds: Constants.webPollIntervalNs)
                } catch {
                    break
                }
                await self.refreshBAC()
            }
            await MainActor.run {
                self.pollingTask = nil
            }
        }
    }

    private func clearPairing() {
        pollingTask?.cancel()
        pollingTask = nil
        defaults.removeObject(forKey: Constants.tokenKey)
        deviceToken = nil
        pin = ""
        screenState = .pairing
        lastUpdatedAt = nil
    }
}

private struct PairRequest: Encodable {
    let pin: String
    let deviceId: String
}

private struct PairResponse: Decodable {
    let deviceToken: String
}

private enum RequestError: Error {
    case invalidResponse
    case server(code: Int)

    var message: String {
        switch self {
        case .invalidResponse:
            return "Invalid server response"
        case .server(let code) where code == 400:
            return "Wrong PIN or expired"
        case .server(let code) where code == 404:
            return "Pairing no longer exists"
        case .server:
            return "Server unavailable"
        }
    }
}