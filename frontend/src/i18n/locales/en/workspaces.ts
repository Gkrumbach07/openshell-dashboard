export default {
  title: 'Workspaces',
  loading: 'Loading workspaces',
  loadFailed: 'Failed to load workspaces',
  empty: {
    title: 'No workspaces',
    body: 'Workspaces are hard isolation boundaries for sandboxes, providers, and members.',
  },
  create: 'Create workspace',
  actionsToolbar: 'Workspace actions',
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
} as const;
