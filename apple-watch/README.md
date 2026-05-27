# un'bac'd Apple Watch Package

This folder contains the standalone watchOS app used to test the current BAC sync flow.

Open `UnbacdWatchApp.xcodeproj` in Xcode, choose a watchOS simulator, and run `UnbacdWatchApp`.

Notes:
- The app is watch-only and does not require a companion iPhone app.
- It uses the existing web API at `https://unbacd-web.vercel.app`.
- Pairing still uses the 6-character PIN from the web app.