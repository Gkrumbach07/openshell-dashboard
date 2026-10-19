// The sandbox namespace. See src/i18n/catalogs.ts.
export default {
  create: {
    // The folded section of optional fields in the Create sandbox form, and
    // its counterpart in Create sandbox from template, which has no
    // resources. Only the name is generated when it is left empty.
    optionalSection: 'Name, labels and resources',
    optionalSectionFromTemplate: 'Name and labels',
    nameHelper: 'A name is generated when this is left empty.',
  },
  drafts: {
    status: {
      // The dropdown's accessible name; it names the filter, not its value.
      label: 'Proposal status',
      all: 'All statuses',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
    },
    summary: {
      source:
        'An LLM-generated analysis of the activity behind these proposals.',
      sourceAriaLabel: 'Where the analysis summary comes from',
    },
    chunk: {
      labels: 'Labels',
      securityNotes: 'Security notes',
    },
  },
};
