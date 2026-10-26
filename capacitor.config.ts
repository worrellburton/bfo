import type { CapacitorConfig } from "@capacitor/cli";

/**
 * BFO for iPhone and iPad (ios/, built with Capacitor).
 *
 * The app is a native shell around the live site: it opens
 * https://www.burtonfamilyoffice.com in a WKWebView with Capacitor's bridge,
 * so every web deploy reaches the app at once and only native changes (this
 * file, ios/, the plugins) need a new build. The site uses the bridge for
 * native touches (app/native.ts): haptics, a status bar that follows the
 * theme, the splash screen, push notifications for new mail (app/push.ts) and
 * a Face ID lock (app/app-lock.tsx). native/www is the bundled fallback the shell shows
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
    // iPads get the site at their real width (iPad Safari's default "desktop" mode lays smaller iPads out at 980px and shrinks it).
    preferredContentMode: "mobile",
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
    // New-mail notices show as banners even while the app is open (app/push.ts refreshes the list too).
    PushNotifications: {
      presentationOptions: ["banner", "list", "sound"],
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DEFAULT",
    },
  },
};

export default config;
