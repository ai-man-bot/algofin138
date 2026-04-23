/**
 * PWA Health Check Utility
 * 
 * Use this to verify PWA features are working correctly
 * Run in browser console: checkPWAHealth()
 */

export function checkPWAHealth() {
  console.log('🔍 AlgoFin.ai PWA Health Check\n');
  console.log('═══════════════════════════════════════\n');

  const results = {
    pass: 0,
    fail: 0,
    warn: 0
  };

  // Check 1: HTTPS
  console.log('1️⃣  HTTPS Check:');
  if (window.location.protocol === 'https:' || window.location.hostname === 'localhost') {
    console.log('   ✅ PASS - Running on HTTPS (required for PWA)');
    results.pass++;
  } else {
    console.log('   ❌ FAIL - Not running on HTTPS (PWA requires HTTPS)');
    results.fail++;
  }
  console.log('');

  // Check 2: Service Worker API Support
  console.log('2️⃣  Service Worker API Support:');
  if ('serviceWorker' in navigator) {
    console.log('   ✅ PASS - Service Worker API supported');
    results.pass++;
  } else {
    console.log('   ❌ FAIL - Service Worker API not supported');
    results.fail++;
  }
  console.log('');

  // Check 3: Service Worker Registration
  console.log('3️⃣  Service Worker Registration:');
  navigator.serviceWorker.getRegistration().then(registration => {
    if (registration) {
      console.log('   ✅ PASS - Service Worker registered');
      console.log('   📄 Scope:', registration.scope);
      console.log('   📊 State:', registration.active?.state || 'No active worker');
      results.pass++;
    } else {
      console.log('   ❌ FAIL - Service Worker not registered');
      console.log('   💡 Try refreshing the page');
      results.fail++;
    }
    console.log('');

    // Continue with remaining checks
    continueChecks();
  });

  function continueChecks() {
    // Check 4: Manifest
    console.log('4️⃣  Web App Manifest:');
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      console.log('   ✅ PASS - Manifest link found');
      console.log('   📄 URL:', manifestLink.getAttribute('href'));
      results.pass++;
      
      // Try to fetch and validate manifest
      fetch(manifestLink.getAttribute('href') || '')
        .then(r => r.json())
        .then(manifest => {
          console.log('   📋 Manifest Details:');
          console.log('      Name:', manifest.name);
          console.log('      Short Name:', manifest.short_name);
          console.log('      Theme Color:', manifest.theme_color);
          console.log('      Display:', manifest.display);
          console.log('      Icons:', manifest.icons?.length || 0, 'defined');
        })
        .catch(e => {
          console.log('   ⚠️  WARN - Could not fetch manifest:', e.message);
          results.warn++;
        });
    } else {
      console.log('   ❌ FAIL - Manifest link not found');
      results.fail++;
    }
    console.log('');

    // Check 5: Meta Tags
    console.log('5️⃣  PWA Meta Tags:');
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const viewport = document.querySelector('meta[name="viewport"]');
    const appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    
    let metaScore = 0;
    if (themeColor) {
      console.log('   ✅ theme-color meta tag found');
      metaScore++;
    }
    if (viewport) {
      console.log('   ✅ viewport meta tag found');
      metaScore++;
    }
    if (appleCapable) {
      console.log('   ✅ apple-mobile-web-app-capable found (iOS support)');
      metaScore++;
    }

    if (metaScore === 3) {
      console.log('   ✅ PASS - All meta tags present');
      results.pass++;
    } else if (metaScore > 0) {
      console.log(`   ⚠️  WARN - Only ${metaScore}/3 meta tags found`);
      results.warn++;
    } else {
      console.log('   ❌ FAIL - No PWA meta tags found');
      results.fail++;
    }
    console.log('');

    // Check 6: Cache Storage API
    console.log('6️⃣  Cache Storage API:');
    if ('caches' in window) {
      console.log('   ✅ PASS - Cache Storage API supported');
      results.pass++;
      
      caches.keys().then(cacheNames => {
        console.log('   📦 Cached storage keys:', cacheNames.length);
        cacheNames.forEach(name => console.log('      -', name));
      });
    } else {
      console.log('   ❌ FAIL - Cache Storage API not supported');
      results.fail++;
    }
    console.log('');

    // Check 7: Notification API
    console.log('7️⃣  Notification API:');
    if ('Notification' in window) {
      console.log('   ✅ PASS - Notification API supported');
      console.log('   📬 Permission:', Notification.permission);
      results.pass++;
    } else {
      console.log('   ⚠️  WARN - Notification API not supported');
      results.warn++;
    }
    console.log('');

    // Check 8: Install Status
    console.log('8️⃣  Installation Status:');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                        (window.navigator as any).standalone === true ||
                        document.referrer.includes('android-app://');
    
    if (isStandalone) {
      console.log('   ✅ Running as installed PWA (standalone mode)');
      results.pass++;
    } else {
      console.log('   ℹ️  Running in browser (not installed)');
      console.log('   💡 Install via browser menu or install prompt');
    }
    console.log('');

    // Check 9: Icons
    console.log('9️⃣  App Icons:');
    const icons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
    if (icons.length > 0) {
      console.log(`   ✅ PASS - ${icons.length} icon(s) found`);
      results.pass++;
      icons.forEach(icon => {
        const sizes = icon.getAttribute('sizes');
        const href = icon.getAttribute('href');
        console.log(`      - ${sizes || 'default'}: ${href}`);
      });
    } else {
      console.log('   ⚠️  WARN - No app icons found');
      results.warn++;
    }
    console.log('');

    // Check 10: Device/Browser Info
    console.log('🔟 Device & Browser Info:');
    console.log('   📱 Platform:', navigator.platform);
    console.log('   🌐 User Agent:', navigator.userAgent);
    console.log('   📶 Online:', navigator.onLine ? 'Yes' : 'No');
    console.log('   🔋 Battery API:', 'getBattery' in navigator ? 'Supported' : 'Not supported');
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════\n');
    console.log('📊 SUMMARY:\n');
    console.log(`   ✅ Passed: ${results.pass}`);
    console.log(`   ❌ Failed: ${results.fail}`);
    console.log(`   ⚠️  Warnings: ${results.warn}`);
    console.log('');

    const total = results.pass + results.fail + results.warn;
    const score = Math.round((results.pass / total) * 100);
    
    console.log(`   🎯 PWA Score: ${score}%`);
    console.log('');

    if (score >= 90) {
      console.log('   🎉 EXCELLENT - Your PWA is fully functional!');
    } else if (score >= 70) {
      console.log('   👍 GOOD - PWA is working but has some issues');
    } else if (score >= 50) {
      console.log('   ⚠️  NEEDS WORK - Several PWA features missing');
    } else {
      console.log('   ❌ CRITICAL - PWA not properly configured');
    }

    console.log('');
    console.log('💡 For more details, check:');
    console.log('   - Chrome DevTools > Application > Service Workers');
    console.log('   - Chrome DevTools > Application > Manifest');
    console.log('   - Chrome DevTools > Application > Cache Storage');
    console.log('');
    console.log('═══════════════════════════════════════\n');
  }
}

// Auto-run check if in development
if (typeof window !== 'undefined') {
  (window as any).checkPWAHealth = checkPWAHealth;
  console.log('💡 PWA Health Check available!');
  console.log('   Run: checkPWAHealth()');
}

export function quickPWACheck() {
  const checks = {
    https: window.location.protocol === 'https:' || window.location.hostname === 'localhost',
    serviceWorker: 'serviceWorker' in navigator,
    cache: 'caches' in window,
    manifest: !!document.querySelector('link[rel="manifest"]'),
    installed: window.matchMedia('(display-mode: standalone)').matches
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  
  return {
    score: `${passed}/${total}`,
    percentage: Math.round((passed / total) * 100),
    checks,
    ready: passed >= 4
  };
}

// Export for use in components
export function isPWAReady(): boolean {
  return quickPWACheck().ready;
}

export function getPWAScore(): number {
  return quickPWACheck().percentage;
}
