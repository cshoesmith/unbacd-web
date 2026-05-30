import SwiftUI

struct ContentView: View {
    @ObservedObject var model: WatchAppModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 10)) { context in
            ZStack {
                background(for: context.date)
                    .ignoresSafeArea()

                switch model.screenState {
                case .loading:
                    ProgressView()
                        .tint(.white)
                case .pairing:
                    PairingView(model: model)
                case .waitingForData:
                    WaitingView(model: model)
                case .failed(let message):
                    FailureView(model: model, message: message)
                case .ready(let snapshot):
                    ReadyView(model: model, snapshot: snapshot, now: context.date)
                }
            }
        }
    }

    @ViewBuilder
    private func background(for date: Date) -> some View {
        switch model.screenState {
        case .ready(let snapshot):
            if model.shouldShowDoNotWalk(for: snapshot.bac) && Int(date.timeIntervalSinceReferenceDate) % 2 == 0 {
                Color(red: 0.12, green: 0.25, blue: 0.69)
            } else {
                model.backgroundColor(for: snapshot.bac)
            }
        default:
            Color.black
        }
    }
}

private struct PairingView: View {
    @ObservedObject var model: WatchAppModel

    var body: some View {
        VStack(spacing: 10) {
            Text("un'bac'd")
                .font(.headline.weight(.bold))

            Text("Enter the 6-character PIN from the web app.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            TextField("ABC123", text: $model.pin)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .multilineTextAlignment(.center)

            Button(model.isPairing ? "Connecting..." : "Connect") {
                Task {
                    await model.submitPin()
                }
            }
            .disabled(model.isPairing)

            if let notice = model.networkNotice {
                Text(notice)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.orange)
            }
        }
        .padding()
    }
}

private struct WaitingView: View {
    @ObservedObject var model: WatchAppModel

    var body: some View {
        VStack(spacing: 10) {
            Text("un'bac'd")
                .font(.headline.weight(.bold))

            Text("Waiting for data...")
                .font(.title3.weight(.semibold))

            if let notice = model.networkNotice {
                Text(notice)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.orange)
            }

            Button("Refresh") {
                Task {
                    await model.refreshBAC()
                }
            }

            Button("Re-pair") {
                model.resetPairing()
            }
            .buttonStyle(.borderless)
        }
        .padding()
        .foregroundStyle(.white)
    }
}

private struct FailureView: View {
    @ObservedObject var model: WatchAppModel
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Text("un'bac'd")
                .font(.headline.weight(.bold))

            Text(message)
                .font(.footnote)
                .multilineTextAlignment(.center)

            Button("Try Again") {
                Task {
                    await model.refreshBAC(forceRePairOn404: true)
                }
            }

            Button("Enter PIN") {
                model.resetPairing()
            }
            .buttonStyle(.borderless)
        }
        .padding()
        .foregroundStyle(.white)
    }
}

private struct ReadyView: View {
    @ObservedObject var model: WatchAppModel
    let snapshot: BACSnapshot
    let now: Date

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("un'bac'd")
                    .font(.headline.weight(.bold))

                Text(snapshot.bac, format: .number.precision(.fractionLength(2)))
                    .font(.system(size: 34, weight: .bold, design: .rounded))

                Text(model.bacLabel(for: snapshot.bac))
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.black.opacity(0.2), in: Capsule())

                if snapshot.bac < 0.001 {
                    EmptyView()
                } else {
                    Text(soberText)
                        .font(.footnote.weight(.medium))
                }

                Text(drinkCountText)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.85))

                if !snapshot.username.isEmpty {
                    Text("@\(snapshot.username)")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.8))
                }

                if let updatedText {
                    Text(updatedText)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                }

                if let notice = model.networkNotice {
                    Text(notice)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.yellow)
                }

                if model.isStale(referenceDate: now) {
                    Text("Data may be stale")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.yellow)
                }

                if model.shouldShowDoNotDrive(for: snapshot.bac) {
                    Text("DO NOT DRIVE")
                        .font(.caption.weight(.bold))
                }

                if model.shouldShowDoNotWalk(for: snapshot.bac) {
                    Text("DO NOT WALK")
                        .font(.caption.weight(.bold))
                }

                Button("Refresh") {
                    Task {
                        await model.refreshBAC()
                    }
                }
                .tint(.white)

                Button("Re-pair") {
                    model.resetPairing()
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.white.opacity(0.9))
            }
            .padding()
            .foregroundStyle(.white)
        }
    }

    private var drinkCountText: String {
        if snapshot.drinkCount == 0 {
            return "No drinks recorded"
        }

        let suffix = snapshot.drinkCount == 1 ? "drink" : "drinks"
        return "\(snapshot.drinkCount) \(suffix) · 24h window"
    }

    private var updatedText: String? {
        guard let lastUpdated = model.lastUpdatedAt else { return nil }
        return "Updated \(RelativeDateTimeFormatter().localizedString(for: lastUpdated, relativeTo: now))"
    }

    private var soberText: String {
        let generatedAt = Date(timeIntervalSince1970: TimeInterval(snapshot.calculatedAt) / 1000)
        let remainingMs = snapshot.soberMs - Int64(now.timeIntervalSince(generatedAt) * 1000)

        if remainingMs <= 0 || snapshot.bac < 0.005 {
            return "Sober now"
        }

        return "Sober in \(DurationFormatter.string(fromMilliseconds: remainingMs))"
    }
}

private enum DurationFormatter {
    static func string(fromMilliseconds milliseconds: Int64) -> String {
        let totalMinutes = max(0, milliseconds / 60_000)
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60

        if hours > 0 && minutes > 0 {
            return "\(hours)h \(minutes)m"
        }

        if hours > 0 {
            return "\(hours)h"
        }

        return "\(minutes)m"
    }
}