// The crossWorkspace namespace. See src/i18n/catalogs.ts.
//
// The pages that read across workspaces: every sandbox on the gateway, and
// the policy proposals waiting in the workspaces the signed-in user can read.
export default {
  sandboxes: {
    title: 'Sandboxes',
    description:
      'Secure execution environments, across every workspace on the gateway.',
  },
  proposals: {
    title: 'Proposals',
    description:
      'Policy rules your sandboxes have proposed, waiting for a decision. Select a sandbox to review, edit, approve or reject what it has proposed.',
    tableTitle: 'Proposals',
    filterPlaceholder: 'Filter by workspace or sandbox',
    empty: 'No sandbox you can see has a policy rule waiting for a decision.',
    // Some workspaces could not be read, so "none you can see" would say too
    // much about them.
    emptyPartial:
      'No sandbox in the workspaces that could be read has a policy rule waiting for a decision.',
    columns: {
      pending: 'Pending',
      workspace: 'Workspace',
      sandbox: 'Sandbox',
      security: 'Security',
      latest: 'Latest',
    },
    unavailableLabel: 'Could not be read',
    flagged: 'Flagged',
    // A link's name starts with what it shows (WCAG 2.5.3), then says which
    // sandbox it leads to.
    pendingLinkAria_one:
      '{{count}} proposal waiting in {{workspace}}/{{sandbox}}',
    pendingLinkAria_other:
      '{{count}} proposals waiting in {{workspace}}/{{sandbox}}',
    unavailableLinkAria:
      'Could not be read: the proposals of {{workspace}}/{{sandbox}}',
    disabled: {
      title: 'Policy proposals are switched off',
      body: 'This dashboard was started with the draft-policy feature disabled, so no proposals are read.',
    },
    partial: {
      title_one: 'A workspace could not be read',
      title_other: '{{count}} workspaces could not be read',
      body: 'No proposals are shown for {{workspaces}}. There may be some waiting there.',
      retry: 'Retry',
    },
    // A sandbox whose inbox the summary could not read: listed after those
    // with a known count, and counted here once rather than one alert each.
    unavailable: {
      title_one: 'The proposals of one sandbox could not be read',
      title_other: 'The proposals of {{count}} sandboxes could not be read',
      body: 'They are listed last, as "Could not be read", which is not the same as none waiting. The list is read again shortly; open a sandbox to see its proposals now.',
    },
  },
} as const;
