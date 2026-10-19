export default {
  nav: {
    gateway: 'Gateway',
    workspaces: 'Workspaces',
    // Providers, templates and services across every workspace — resources,
    // not workspaces, which is the question "what is the difference between
    // Workspaces and All workspaces?" that the old label invited. Sandboxes
    // are their own entry.
    allWorkspaces: 'Resources',
    proposals: 'Proposals',
    sandboxes: 'Sandboxes',
    providerProfiles: 'Providers',
    globalPolicy: 'Global policy',
    settings: 'Settings',
    primary: 'Primary navigation',
    global: 'Global navigation',
    // The sidebar's sections are told apart by a rule and no longer named.
    // Kept all the same — a locale is published API.
    groupWorkspaces: 'Workspaces',
    groupPlatform: 'Platform',
  },
  header: {
    actions: 'Header actions',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    // No longer used, and kept all the same — a locale is published API.
    // The About modal retired into the Gateway page, which says everything
    // it did, and the help menu went with the last item it had left.
    help: 'Help',
    documentation: 'Documentation',
    about: 'About',
    // What the badge beside it is the value of — same form as gatewayHealth.label.
    roleLabel: 'Role:',
    roleAdmin: 'Platform admin',
    roleUser: 'Standard user',
    userFallback: 'User',
    copySubject: 'Copy my subject ID',
    identity: 'My identity',
    logOut: 'Log out',
  },
  identity: {
    title: 'Signed-in identity',
    subject: 'Subject',
    name: 'Name',
    provider: 'Identity provider',
    roles: 'Roles',
    scopes: 'Scopes',
    none: 'None',
    close: 'Close',
  },
  // Only brandAlt is still shown, on the masthead logo. The rest belonged to
  // the About modal, which retired into the Gateway page. The keys stay: a
  // locale is published API (ADR 0004), and a consumer may have overridden
  // them.
  about: {
    productName: 'OpenShell Dashboard',
    trademark: 'Apache-2.0 license.',
    brandAlt: 'OpenShell Dashboard',
    // What identifies a build. It has no version number of its own to show:
    // it is for one gateway release line, and it is made from one commit.
    builtForGateway: 'Built for gateway',
    // {{line}} is the gateway release line as major.minor, so this reads
    // "0.1.x": every gateway release whose version starts with those numbers.
    gatewayLine: '{{line}}.x',
    dashboardCommit: 'Dashboard commit',
    gatewayVersion: 'Gateway version',
    unknown: 'Unknown',
  },
  gatewayCompatibility: {
    unsupported: {
      title: 'This dashboard does not support this gateway version',
      // {{line}} is the gateway release line as major.minor, so "{{line}}.x"
      // reads "0.1.x": every release whose version starts with those numbers.
      body: 'This dashboard is built for OpenShell gateway {{line}}.x. This gateway reports {{version}}. Pages might fail to load or show errors that do not explain the cause. Use a gateway {{line}}.x release, or a dashboard release built for gateway {{version}}.',
    },
  },
  // What the gateway's own health check says, shown in the masthead.
  gatewayHealth: {
    // What the label beside it is the value of. The states no longer name
    // the gateway themselves, and they are cased as the Gateway page cases
    // the same status, which is as the gateway itself sends it.
    label: 'Gateway status:',
    healthy: 'HEALTHY',
    notHealthy: 'NOT HEALTHY',
    unreachable: 'UNREACHABLE',
    unknown: 'UNKNOWN',
  },
  logs: {
    autoRefresh: 'Auto-refresh',
    updatesOff: 'Automatic log updates are off.',
    pollingTitle: 'Using polling',
    pollingDescription:
      'Streaming is unavailable. Logs refresh every {{seconds}} seconds until you retry streaming.',
    pollingPaused: 'Streaming is unavailable. Automatic log updates are off.',
    pollingFailed:
      'Automatic log updates stopped after an error. Press Retry to resume.',
    retryStream: 'Retry stream',
    loadErrorTitle: 'Failed to load logs',
    refreshErrorTitle: 'The logs could not be refreshed',
  },
  actions: {
    retry: 'Retry',
  },
  pagination: {
    itemsPerPage: 'Items per page',
    perPage: '{{count}} per page',
    previous: 'Go to previous page',
    next: 'Go to next page',
    previousText: 'Previous',
    nextText: 'Next',
    page: 'Page {{number}}',
    topNavigation: 'Top pagination',
    bottomNavigation: 'Bottom pagination',
    loaded: 'Page {{number}} loaded',
    sandboxResults: 'Sandbox results',
    workspaceResults: 'Workspace results',
    resourceResults: '{{title}} results',
  },
} as const;
