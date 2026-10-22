// The gateway namespace: the Gateway overview page. See src/i18n/catalogs.ts.
export default {
  title: 'Gateway',
  description:
    "The gateway's status, what is waiting for a decision, and what it runs on.",
  loading: 'Loading gateway info',
  loadFailed: 'Cannot reach the OpenShell gateway',
  retry: 'Retry',
  // The strip at the top right: the gateway's own status, both versions and
  // the verdict that relates them.
  facts: {
    gatewayVersion: 'Gateway version: {{version}}',
    dashboard: 'Dashboard: {{build}}',
    dashboardFor: 'for {{line}}.x',
    compatibility: 'Compatibility: {{verdict}}',
    notKnown: 'Not known',
  },
  compatibility: {
    supported: 'Supported',
    supportedLine: 'Supported ({{line}})',
    unsupported: 'Not supported',
    unsupportedLine: 'Not supported (built for {{line}})',
    notKnown: 'Not known',
  },
  attention: {
    title: 'Needs attention',
    ariaLabel: 'Needs attention',
    allClear: 'Nothing needs attention',
    loading: 'Reading what needs attention',
    loadingMore: 'Still reading the rest of the gateway',
    filter: {
      all: 'All types',
      allCount: 'All types ({{count}})',
      typeCount: '{{label}} ({{count}})',
    },
    // Plural, because the filter picks out a set of them and counts it.
    types: {
      unread: 'Lists not read',
      proposals: 'Proposals',
      errors: 'Sandbox errors',
      setup: 'Setup',
    },
    // Singular, because a badge is on one row and says what that row is.
    badges: {
      unread: 'Not read',
      proposals: 'Proposal',
      errors: 'Sandbox error',
      setup: 'Setup',
    },
    unread: {
      sandboxes: 'Sandboxes could not be read',
      providers: 'Providers could not be read',
      proposals: 'Proposals could not be read',
      detail:
        'What is in this list is not known, so it is not counted as nothing to do.',
    },
    proposals: {
      unavailable:
        'Its proposal inbox could not be read, so what is waiting in it is not known.',
      pending_one: '{{count}} policy rule waiting for a decision.',
      pending_other: '{{count}} policy rules waiting for a decision.',
      pendingFlagged_one:
        '{{count}} policy rule waiting for a decision, flagged by the prover.',
      pendingFlagged_other:
        '{{count}} policy rules waiting for a decision, flagged by the prover.',
      more_one: '{{count}} more sandbox with proposals',
      more_other: '{{count}} more sandboxes with proposals',
      moreDetail: 'Every sandbox with a rule waiting is on the Proposals page.',
      total_one: '{{count}} policy rule waiting for a decision',
      total_other: '{{count}} policy rules waiting for a decision',
      totalDetail:
        'Proposed from connections the sandboxes were denied; each takes effect only once somebody approves it.',
    },
    errors: {
      detail:
        'Provisioning failed, or the main process exited non-zero; the log says which.',
      more_one: '{{count}} more sandbox in error',
      more_other: '{{count}} more sandboxes in error',
      moreDetail: 'Every sandbox on the gateway is under Sandboxes.',
    },
    setup: {
      noProviders: 'No providers',
      noProvidersDetail:
        'Sandboxes have no credentials to reach a model or a service until one is added.',
    },
  },
  getStarted: {
    title: 'Get started',
    intro:
      'Nothing has been created on this gateway yet. Three steps make a sandbox to work in.',
    ariaLabel: 'Getting started',
    workspace: 'Create a workspace',
    workspaceDetail:
      "A workspace holds a team's sandboxes, providers and members. The gateway starts with a workspace called default.",
    provider: 'Add a provider',
    providerDetail:
      'A provider holds the credentials a sandbox uses to reach a model or a service. Its type comes from a provider profile.',
    sandbox: 'Create a sandbox',
    sandboxDetail:
      'A sandbox is a secure execution environment, governed by the security policy it is created with. Attach the providers it may use.',
  },
  drivers: {
    title: 'Compute drivers',
    description:
      'Pluggable components that create, inspect, and delete sandbox workloads.',
    ariaLabel: 'Compute drivers',
    name: 'Name',
    driver: 'Driver',
    version: 'Version',
    empty: 'No compute drivers reported',
  },
  extensions: {
    title: 'Extensions',
    description:
      'What the gateway negotiated at start-up with each compute driver, credential driver, gateway interceptor and supervisor middleware.',
    ariaLabel: 'Extensions',
    name: 'Name',
    kind: 'Kind',
    implementation: 'Implementation',
    protocol: 'Protocol',
    capabilities: 'Capabilities',
    requires: 'Requires from gateway',
    empty: 'No extensions reported',
    kinds: {
      COMPUTE_DRIVER: 'Compute driver',
      CREDENTIAL_DRIVER: 'Credential driver',
      GATEWAY_INTERCEPTOR: 'Gateway interceptor',
      SUPERVISOR_MIDDLEWARE: 'Supervisor middleware',
      UNSPECIFIED: 'Unspecified',
    },
  },
};
