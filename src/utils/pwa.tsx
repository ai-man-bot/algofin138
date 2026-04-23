// Service Worker Registration and PWA Utilities

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js', {
          scope: '/'
        });

        console.log('✅ Service Worker registered successfully:', registration.scope);

        // Check for updates every hour
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('🔄 New Service Worker found, installing...');

          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('✨ New content available! Please refresh.');
              }
            });
          }
        });

        // Listen for controller change (new SW activated)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('🔄 Service Worker controller changed');
        });

      } catch (error) {
        console.error('❌ Service Worker registration failed:', error);
      }
    });
  } else {
    console.log('⚠️ Service Workers not supported in this browser');
  }
}

export function unregisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(registration => {
        registration.unregister();
        console.log('✅ Service Worker unregistered');
      })
      .catch(error => {
        console.error('❌ Service Worker unregistration failed:', error);
      });
  }
}

// Check if app is installed (running as PWA)
export function isPWAInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as any).standalone === true ||
         document.referrer.includes('android-app://');
}

// Check if device is iOS
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

// Check if device is Android
export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

// Get install instructions based on device
export function getInstallInstructions(): string {
  if (isIOS()) {
    return 'Tap the Share button and select "Add to Home Screen"';
  } else if (isAndroid()) {
    return 'Tap the menu button and select "Add to Home Screen" or "Install App"';
  }
  return 'Click the install button in your browser\'s address bar';
}

// Request notification permission
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.log('⚠️ Notifications not supported');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    console.log('📬 Notification permission:', permission);
    return permission;
  }

  return Notification.permission;
}

// Show notification
export function showNotification(title: string, options?: NotificationOptions) {
  if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification(title, {
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        vibrate: [200, 100, 200],
        ...options
      });
    });
  }
}

// Background sync
export function registerBackgroundSync(tag: string) {
  if ('serviceWorker' in navigator && 'sync' in (self as any).registration) {
    navigator.serviceWorker.ready.then(registration => {
      return (registration as any).sync.register(tag);
    }).then(() => {
      console.log(`✅ Background sync registered: ${tag}`);
    }).catch(error => {
      console.error('❌ Background sync registration failed:', error);
    });
  }
}

// Add to cache
export function cacheAssets(urls: string[]) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: 'CACHE_URLS',
      urls
    });
  }
}

// PWA meta tags helper
export function addPWAMetaTags() {
  const head = document.head;

  // Viewport
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.setAttribute('name', 'viewport');
    head.appendChild(viewport);
  }
  viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes');

  // Theme color
  let themeColor = document.querySelector('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement('meta');
    themeColor.setAttribute('name', 'theme-color');
    head.appendChild(themeColor);
  }
  themeColor.setAttribute('content', '#3b82f6');

  // Apple meta tags
  const appleMeta = [
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'AlgoFin.ai' }
  ];

  appleMeta.forEach(meta => {
    let tag = document.querySelector(`meta[name="${meta.name}"]`);
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', meta.name);
      head.appendChild(tag);
    }
    tag.setAttribute('content', meta.content);
  });

  // Apple touch icons
  const iconSizes = [57, 60, 72, 76, 114, 120, 144, 152, 180];
  iconSizes.forEach(size => {
    let link = document.querySelector(`link[rel="apple-touch-icon"][sizes="${size}x${size}"]`);
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'apple-touch-icon');
      link.setAttribute('sizes', `${size}x${size}`);
      link.setAttribute('href', `/icons/icon-${size}x${size}.png`);
      head.appendChild(link);
    }
  });

  // Manifest
  let manifest = document.querySelector('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.setAttribute('rel', 'manifest');
    manifest.setAttribute('href', '/manifest.json');
    head.appendChild(manifest);
  }

  // Favicon
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.setAttribute('rel', 'icon');
    favicon.setAttribute('type', 'image/png');
    favicon.setAttribute('href', '/icons/icon-96x96.png');
    head.appendChild(favicon);
  }
}

// Initialize PWA
export function initializePWA() {
  console.log('🚀 Initializing PWA...');
  
  // Add meta tags
  addPWAMetaTags();
  
  // Register service worker
  registerServiceWorker();
  
  // Log install status
  if (isPWAInstalled()) {
    console.log('✅ Running as installed PWA');
  } else {
    console.log('📱 Running in browser - install available');
  }
  
  // Log device info
  console.log('📱 Device:', {
    iOS: isIOS(),
    Android: isAndroid(),
    standalone: isPWAInstalled()
  });
}
