import SwiftUI

@main
struct UnbacdWatchAppApp: App {
    @StateObject private var model = WatchAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onAppear {
                    model.setScenePhase(scenePhase)
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            model.setScenePhase(newPhase)
        }
    }
}