export default {
  title: 'Workspaces',
  description:
    'Workspaces are hard isolation boundaries for sandboxes, providers, and members.',
  loading: 'Loading workspaces',
  loadFailed: 'Failed to load workspaces',
  empty: {
    title: 'No workspaces',
    // The sentence that was here is now the page description, which the empty
    // state is shown under. This one says what to do instead of repeating it.
    body: 'Create one to give a team sandboxes, providers and members of its own.',
    // Only a platform admin can create a workspace; anyone else is added to
    // one.
    bodyMember: 'Ask a platform admin to add you to a workspace.',
  },
  create: 'Create workspace',
  actionsToolbar: 'Workspace actions',
  pagination: {
    loadFailed: 'Could not load this page',
    startAtFirst: 'Start at first page',
  },
  filter: {
    label: 'Filter workspaces by label selector',
    placeholder: 'Filter by label, e.g. env=staging',
    apply: 'Apply label filter',
    clear: 'Clear label filter',
    noMatch: 'No workspaces match this label selector.',
    failed: 'The label selector could not be applied',
  },
  table: {
    ariaLabel: 'Workspaces',
    name: 'Name',
    phase: 'Phase',
    labels: 'Labels',
    age: 'Age',
    actions: 'Actions',
  },
  delete: {
    action: 'Delete',
    title: 'Delete workspace?',
    body: 'Workspace "{{name}}" and everything in it (sandboxes, providers, members) will be deleted.',
    toast: 'Workspace "{{name}}" deleted',
  },
  // Deleting the workspaces that are selected. {{total}} is two or more.
  bulkDelete: {
    menu: 'Actions',
    action: 'Delete selected',
    actionCount: 'Delete selected ({{total}})',
    selectAll: 'Select all workspaces',
    title: 'Delete {{total}} workspaces?',
    body: 'These workspaces and everything in them (sandboxes, providers, members) will be deleted: {{names}}.',
    // What has to be typed to confirm. It is shown in the dialog.
    confirmPhrase: 'delete {{total}} workspaces',
    toast: '{{total}} workspaces deleted',
    // Some of the selected workspaces were deleted and some were not.
    toastSome: 'Workspaces deleted: {{names}}',
  },
  members: {
    add: {
      // Under the subject field of the Add member dialog. {{action}} is the
      // user menu's item that copies the signed-in user's subject.
      subjectHelp:
        'The OIDC subject (the "sub" claim) of the user, usually not their email address or username. Once they can sign in, they get it from "{{action}}" in the user menu.',
    },
  },
  // The list is refreshed in the background, and a refresh failed.
  refreshFailed: {
    title: 'The workspace list could not be refreshed',
    stale: 'The workspaces shown were loaded earlier and may be out of date.',
  },
} as const;
