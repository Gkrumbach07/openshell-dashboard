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
    providerProfiles: 'Provider profiles',
    globalPolicy: 'Global policy',
    settings: 'Settings',
    primary: 'Primary navigation',
    global: 'Global navigation',
  },
  header: {
    actions: 'Header actions',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    help: 'Help',
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
  // The About dialog, from the masthead's help menu, and the masthead logo's
  // alt text.
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
    // What the label beside it is the value of. The states are in sentence
    // case: the region they sit in is announced on every change, and some
    // screen readers spell out text in capitals letter by letter.
    label: 'Gateway status:',
    healthy: 'Healthy',
    notHealthy: 'Not healthy',
    unreachable: 'Unreachable',
    unknown: 'Unknown',
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
  // The platform's provider profiles page.
  providerProfiles: {
    title: 'Provider profiles',
    description:
      'Platform-scoped profiles for connecting sandboxes to external services, such as LLM inference backends, code repositories, or enterprise APIs. Every workspace can create providers from them and attach those providers to its sandboxes; a profile a workspace keeps itself with the same ID takes precedence there.',
  },
} as const;
