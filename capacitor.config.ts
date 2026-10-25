import type { CapacitorConfig } from "@capacitor/cli";

/**
 * BFO for iPhone (ios/, built with Capacitor).
 *
 * The app is a native shell around the live site: it opens
 * https://www.burtonfamilyoffice.com in a WKWebView with Capacitor's bridge,
 * so every web deploy reaches the app at once and only native changes (this
 * file, ios/, the plugins) need a new build. The site uses the bridge for
 * native touches (app/native.ts): haptics, a status bar that follows the
 * theme, the splash screen. native/www is the bundled fallback the shell shows
 * when the site can't be reached.
 *
 * Links to other sites open in Safari; only the BFO host stays in the app.
 */
const config: CapacitorConfig = {
  appId: "com.burtonfamilyoffice.app",
  appName: "BFO",
  webDir: "native/www",
  server: {
    url: "https://www.burtonfamilyoffice.com/home",
    errorPath: "offline.html",
  },
  ios: {
    // The site lays itself out under the status bar and home indicator (viewport-fit=cover + safe-area insets).
    contentInset: "never",
    backgroundColor: "#0a0a0a",
    scrollEnabled: true,
    allowsLinkPreview: false,
    // Lets the site tell it's inside the app, besides Capacitor.isNativePlatform().
    appendUserAgent: "BFO-iOS",
    // Sharing a link or a long press shouldn't offer "Open in BFO" previews of the app's own pages.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#0a0a0a",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DEFAULT",
    },
  },
};

export default config;
