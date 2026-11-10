// English copy · demo, login, boot, errors, updates, install, session.
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/session.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'demo' | 'login' | 'splash' | 'errorBoundary' | 'surfaceError' | 'symbols' | 'update'
  | 'install' | 'meldeleiste' | 'session' | 'tabLock'

export const sessionCopy: Localizable<Pick<Copy, Keys>> = {
  login: {
    subtitle: 'Command support',
    pinEnter: 'Enter PIN',
    connectionFailed: 'Connection to the server failed',
    loadingRoster: 'Loading roster…',
    noUsers: 'No users configured',
    whoAreYou: 'Who are you?',
    unsentTitle: 'Unsent changes by {name}',
    unsentFormer: 'a former account',
    unsentLogin: 'Sign in as {name}',
    unsentMore: 'and {n} more',
    unsentBody: 'They exist only on this device and are sent once this account signs in here.',
    loginFailed: 'Login failed',
    pleaseWait: 'Please wait a moment…',
    clearDigit: 'Delete',
    submitPin: 'Sign in',
    retry: 'Try again',
    offlineHint: 'Signing in needs a connection. Saved incidents only open if this device was still signed in.',
    microsoft: 'Sign in with Microsoft',
    microsoftErrors: {
      cancelled: 'Microsoft sign-in cancelled.',
      expired: 'The Microsoft sign-in took too long. Please try again.',
      failed: 'Microsoft sign-in failed. Please try again or sign in with your PIN.',
      unknown: 'This Microsoft account is not enabled for KP Front. Please sign in with your PIN or ask the admin.',
      inactive: 'The linked account is deactivated. Please ask the admin.',
    },
  },
  splash: {
    stuck: 'Startup is taking longer than usual',
    stuckHint: 'Weak connection or server unreachable. Saved incidents are available offline.',
    reload: 'Restart',
  },
  errorBoundary: {
    title: 'Something went wrong',
    body: 'The view could not be loaded. Your local changes are saved and stay intact.',
    bodyRepeat: 'This incident will not open – not even after a reload. Close it to get back to the overview; the saved data stays on the server.',
    reload: 'Reload',
    closeIncident: 'Close incident',
    discardLocal: 'Discard local copy',
    discardLocalHint: 'Discards only the copy on this device and reloads the incident from the server. Changes made on this device that have not synced yet will be lost.',
    discardLocalOffline: 'Not possible without a connection – the incident could not be reloaded from the server afterwards.',
    discardLocalOfflineUnsynced: 'Changes from this device have not been sent yet.',
    bodyRepeatRoot: 'The app will not start – not even after a reload. Reset the local lists; saved incidents and changes stay intact.',
    resetShell: 'Reset app',
    resetShellHint: 'Clears only the incident list and the sign-in data on this device. Incidents and their changes stay saved.',
  },
  surfaceError: {
    title: 'This view could not be loaded',
    body: 'The rest of the incident keeps running – SCBA monitoring stays active, your changes are saved.',
    retry: 'Rebuild view',
    toMap: 'To the map',
    repeatHint: 'This view keeps crashing – please report it in the feedback.',
  },
  symbols: {
    loadFailedTitle: 'Symbol library could not be loaded',
    loadFailedSub: 'Map and sketch keep running without symbol graphics',
    retry: 'Try again',
    dismiss: 'Hide',
  },
  meldeleiste: {
    region: 'Messages',
    more: '+{n} more message',
    moreMany: '+{n} more messages',
    less: 'Show less',
  },
  session: {
    expiredTitle: 'Sign-in expired',
    expiredHint: 'Changes stay on this device and sync once you are signed in again',
    expiredHintNamed: 'Changes stay on this device and sync once {name} is signed in again',
    relogin: 'Sign in again',
    foreignUnsentTitle: 'Unsent changes by {name} on this device',
    foreignUnsentSub: '{name} has to sign in here',
    foreignUnsentFormerSub: 'They stay stored on this device',
    foreignUnsentDismiss: 'Hide',
  },
  tabLock: {
    title: 'Open in another tab',
    hint: 'This tab is read-only – editing is active in the other tab.',
    takeOver: 'Edit here',
  },
  update: {
    available: 'Update ready',
    hint: 'Becomes active on the next start – fully close and reopen the app.',
    hintApply: 'One tap – the app reloads briefly.',
    apply: 'Update now',
    applying: 'Updating …',
    dismiss: 'Hide',
    updated: 'Updated – {v}',
  },
  install: {
    menu: 'Install as app',
    bannerTitle: 'Install KP Front as an app',
    bannerHint: 'Works offline, full screen, own icon.',
    bannerAction: 'How to',
    dismiss: 'Hide',
    title: 'Install as app',
    why: 'Installed, KP Front runs like an app: available offline at the scene, full screen without the browser bar, with its own icon on the home screen.',
    nativeButton: 'Install now',
    nativeHint: 'The browser will ask briefly – confirm with “Install”.',
    manualIntro: 'Or manually:',
    installed: 'Installed! From now on, launch KP Front from the app icon.',
    alreadyStandalone: 'KP Front is already running as an installed app.',
    ios: {
      intro: 'On iPad/iPhone:',
      steps: [
        'Tap the share icon {share} in the toolbar',
        'Choose “Add to Home Screen”',
        'Confirm with “Add”',
      ],
      note: 'If “Add to Home Screen” is missing: open the page in Safari.',
    },
    android: {
      intro: 'In Chrome on Android:',
      steps: [
        'Tap the ⋮ menu in the top right',
        'Choose “Install app”',
        'Confirm',
      ],
      note: 'In other browsers: menu → “Add to Home screen”.',
    },
    desktop: {
      intro: 'In Chrome or Edge:',
      steps: [
        'Open the browser menu ⋮ at the top right',
        'Choose “Install KP Front” and confirm',
      ],
      note: 'Depending on the version the menu lists it directly or under “Save and share”. If an install icon shows at the right of the address bar, that works too. If neither is there, KP Front is already installed on this device.',
    },
    macSafari: {
      intro: 'In Safari on the Mac:',
      steps: [
        'Open the “File” menu',
        'Choose “Add to Dock”',
        'Confirm with “Add”',
      ],
      note: '',
    },
    unsupported: 'This browser does not support installation. Best open the page in Chrome, Edge or Safari and install there.',
  },
  demo: {
    ribbon: 'DEMO',
    ariaLabel: 'Demo instance with synthetic data',
    actionBlocked: 'Not possible in the demo.',
    welcome: {
      title: 'Welcome to KP Front',
      intro: 'A prepared incident with invented data. Draw, run teams and try the situation management freely.',
      reloadWarn: 'All visitors work together. The demo resets at midnight and at noon.',
      canTitle: 'What you can try',
      can: ['Edit the map and plan', 'Run SCBA and material', 'Open object plans and the report'],
      cta: 'Let\'s go',
      meta: 'No real incident data – new incidents are disabled',
    },
  },
}
