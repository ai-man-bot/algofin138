# 📱 AlgoFin.ai PWA Installation Guide

## What is a PWA (Progressive Web App)?

AlgoFin.ai is now a **Progressive Web App**, which means you can install it on your Android device (or any device) and use it just like a native app! Benefits include:

- ✅ **Home Screen Icon** - Quick access from your device
- ✅ **Offline Support** - Works even without internet (cached content)
- ✅ **Full Screen Mode** - No browser UI, feels like a native app
- ✅ **Push Notifications** - Get trading alerts (coming soon)
- ✅ **Fast Loading** - Cached assets for instant startup
- ✅ **Auto Updates** - Automatic updates when available

---

## 🤖 Installation on Android

### Method 1: Using Chrome (Recommended)
1. Open **Chrome** browser on your Android device
2. Navigate to your AlgoFin.ai website URL
3. Tap the **menu (⋮)** in the top right corner
4. Select **"Add to Home screen"** or **"Install App"**
5. Confirm the installation
6. The app icon will appear on your home screen!

### Method 2: Using In-App Install Prompt
1. Visit AlgoFin.ai in your mobile browser
2. A **blue banner** will appear at the bottom asking to install
3. Tap **"Install App"** button
4. Confirm the installation
5. Done! The app is now on your home screen

### Method 3: Using Firefox
1. Open **Firefox** browser
2. Navigate to AlgoFin.ai
3. Tap the **home icon** in the address bar
4. Select **"Add to Home screen"**
5. Tap **"Add"** to confirm

---

## 🍎 Installation on iOS (iPhone/iPad)

### Using Safari
1. Open **Safari** browser (PWAs only work in Safari on iOS)
2. Navigate to your AlgoFin.ai website
3. Tap the **Share button** (square with arrow pointing up)
4. Scroll down and tap **"Add to Home Screen"**
5. Name the app "AlgoFin.ai" and tap **"Add"**
6. The app icon will appear on your home screen!

**Note:** iOS has limited PWA support compared to Android, but core features still work!

---

## 💻 Installation on Desktop (Windows/Mac/Linux)

### Chrome, Edge, Brave
1. Visit AlgoFin.ai
2. Look for the **install icon** (⊕) in the address bar
3. Click it and select **"Install"**
4. The app will open in its own window

### Alternatively:
1. Click the **menu (⋮)** 
2. Select **"Install AlgoFin.ai..."** or **"Create shortcut..."**
3. Check **"Open as window"**
4. Click **"Install"**

---

## 🔧 Features Available

### ✅ Currently Working
- Offline page caching (core app shell)
- Install prompt banner
- Home screen installation
- Standalone app mode (no browser UI)
- Auto-update notifications
- App shortcuts (Dashboard, Trades, Strategies)

### 🔜 Coming Soon
- Push notifications for trade alerts
- Background sync for offline trades
- Enhanced offline functionality

---

## 🎨 App Icons

The PWA includes optimized icons for all screen sizes:
- 72x72, 96x96, 128x128, 144x144, 152x152
- 192x192 (standard)
- 384x384, 512x512 (high-res)

All icons use your brand colors:
- Background: Dark Slate (#0f172a)
- Primary: Electric Blue (#3b82f6)

---

## 🛠️ Technical Details

### Service Worker
- Caches app shell for instant loading
- Network-first strategy for real-time data
- Automatic updates when new versions are available
- Smart caching excludes API calls to ensure fresh data

### Manifest Configuration
- **Name:** AlgoFin.ai - Algorithmic Trading Dashboard
- **Short Name:** AlgoFin.ai
- **Theme Color:** #3b82f6 (Electric Blue)
- **Background Color:** #0f172a (Dark Slate)
- **Display:** Standalone (full-screen app mode)

### Browser Compatibility
- ✅ Chrome (Android & Desktop) - Full support
- ✅ Edge (Desktop) - Full support
- ✅ Samsung Internet - Full support
- ✅ Firefox (Android) - Good support
- ⚠️ Safari (iOS) - Limited but functional
- ❌ Opera Mini - Not supported

---

## 📋 How to Check if Installed

### On Mobile:
- Look for the **AlgoFin.ai icon** on your home screen
- The app opens without browser UI (no address bar)

### On Desktop:
- Check your **Start Menu** (Windows) or **Applications** folder (Mac)
- Look for a dedicated window with app icon

---

## 🔄 Updating the App

When a new version is available:
1. A **green update banner** appears at the top
2. Click **"Update Now"** to get the latest version
3. The page will refresh automatically
4. You're now on the latest version!

---

## 🗑️ Uninstalling

### Android:
1. Long-press the app icon
2. Select **"Uninstall"** or drag to uninstall
3. Confirm removal

### iOS:
1. Long-press the app icon
2. Tap the **"X"** button
3. Confirm removal

### Desktop:
1. Right-click the app icon
2. Select **"Uninstall"**
3. Confirm removal

---

## 🆘 Troubleshooting

### Install Button Not Showing?
- Make sure you're using HTTPS (required for PWA)
- Clear browser cache and reload
- Try using Chrome browser
- Check if already installed

### App Not Working Offline?
- The app needs to be opened at least once while online
- Some features require internet (live trading data)
- Only the app shell is cached, not dynamic data

### Not Getting Update Notifications?
- Updates are checked every hour automatically
- Manually refresh the page to check for updates
- Clear service worker cache in browser settings

---

## 📞 Support

Having issues with PWA installation?
- Check browser console for errors (F12 or Cmd+Opt+I)
- Verify HTTPS is enabled
- Ensure service worker is registered (check DevTools > Application > Service Workers)

---

**Enjoy your AlgoFin.ai mobile trading experience! 🚀📈**
