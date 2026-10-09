export default {
  nav: {
    gateway: 'Gateway',
    workspaces: 'Workspaces',
    allWorkspaces: 'All workspaces',
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
  about: {
    productName: 'OpenShell Dashboard',
    trademark: 'Apache-2.0 license.',
    brandAlt: 'OpenShell Dashboard',
    dashboardVersion: 'Dashboard version',
    gatewayVersion: 'Gateway version',
    gatewayStatus: 'Gateway status',
    computeDriver: 'Compute driver',
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
    healthy: 'Gateway healthy',
    notHealthy: 'Gateway not healthy',
    unreachable: 'Gateway unreachable',
    unknown: 'Gateway status unknown',
  },
  actions: {
    retry: 'Retry',
  },
} as const;
