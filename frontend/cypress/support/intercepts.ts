export const interceptAuth = () => {
  cy.intercept('GET', '/api/v1/auth/config', {
    fixture: 'auth-config.json',
  }).as('authConfig');

  cy.intercept('GET', '/api/v1/auth/whoami', {
    fixture: 'whoami.json',
  }).as('whoami');
};

export const interceptGateway = () => {
  cy.intercept('GET', '/api/v1/gateway', {
    fixture: 'gateway.json',
  }).as('gateway');
};

export const interceptWorkspaces = () => {
  cy.intercept('GET', '/api/v1/workspaces', {
    fixture: 'workspaces.json',
  }).as('listWorkspaces');

  cy.intercept('GET', '/api/v1/workspaces/default', {
    statusCode: 200,
    body: {
      metadata: {
        id: 'ws-default-id',
        name: 'default',
        labels: {},
        annotations: {},
        createdAtMs: 1722700000000,
        resourceVersion: 1,
      },
      phase: 'ACTIVE',
    },
  }).as('getWorkspaceDefault');

  cy.intercept('GET', /\/api\/v1\/workspaces\/(?!default)[^/]+$/, {
    statusCode: 200,
    body: {
      metadata: {
        id: 'ws-other-id',
        name: 'dev-team',
        labels: {},
        annotations: {},
        createdAtMs: 1722700100000,
        resourceVersion: 2,
      },
      phase: 'ACTIVE',
    },
  }).as('getWorkspace');

  cy.intercept('POST', '/api/v1/workspaces', {
    statusCode: 201,
    body: {
      metadata: {
        id: 'ws-new-id',
        name: 'new-workspace',
        createdAtMs: Date.now(),
        resourceVersion: 1,
      },
      phase: 'ACTIVE',
    },
  }).as('createWorkspace');
};

export const interceptSandboxes = (workspace = 'default') => {
  cy.intercept('GET', `/api/v1/workspaces/${workspace}/sandboxes`, {
    fixture: 'sandboxes.json',
  }).as('listSandboxes');

  cy.intercept(
    'GET',
    new RegExp(`/api/v1/workspaces/${workspace}/sandboxes/[^/]+$`),
    {
      statusCode: 200,
      body: {
        metadata: {
          id: 'sbx-1-id',
          name: 'my-agent',
          workspace,
          labels: { purpose: 'agent' },
          annotations: {},
          createdAtMs: 1722700000000,
          resourceVersion: 3,
        },
        spec: {
          image: 'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
          providers: ['anthropic'],
          policy: {
            filesystem: { includeWorkdir: true },
            networkPolicies: {},
          },
        },
        status: { phase: 'READY', currentPolicyVersion: 1 },
      },
    },
  ).as('getSandbox');

  cy.intercept('POST', `/api/v1/workspaces/${workspace}/sandboxes`, {
    statusCode: 201,
    body: {
      metadata: {
        id: 'sbx-new-id',
        name: 'new-sandbox',
        workspace,
        createdAtMs: Date.now(),
        resourceVersion: 1,
      },
      spec: {
        image: 'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
        policy: { filesystem: { includeWorkdir: true } },
      },
      status: { phase: 'PROVISIONING', currentPolicyVersion: 1 },
    },
  }).as('createSandbox');

  cy.intercept('DELETE', `/api/v1/workspaces/${workspace}/sandboxes/*`, {
    statusCode: 200,
    body: { deleted: true },
  }).as('deleteSandbox');
};

export const interceptProviders = (workspace = 'default') => {
  cy.intercept('GET', `/api/v1/workspaces/${workspace}/providers`, {
    fixture: 'providers.json',
  }).as('listProviders');

  cy.intercept('GET', `/api/v1/workspaces/${workspace}/provider-profiles`, {
    statusCode: 200,
    body: [
      {
        id: 'claude',
        displayName: 'Anthropic Claude',
        description: 'Anthropic Claude API',
        category: 'INFERENCE',
        credentials: [
          { name: 'api_key', description: 'API key', required: true },
        ],
        inferenceCapable: true,
        source: 'builtin',
        resourceVersion: 0,
      },
      {
        id: 'openai',
        displayName: 'OpenAI',
        description: 'OpenAI API',
        category: 'INFERENCE',
        credentials: [
          { name: 'api_key', description: 'API key', required: true },
        ],
        inferenceCapable: true,
        source: 'builtin',
        resourceVersion: 0,
      },
      {
        id: 'custom-llm',
        displayName: 'Custom LLM',
        description: 'A custom inference provider',
        category: 'INFERENCE',
        credentials: [
          { name: 'token', description: 'Auth token', required: true },
        ],
        inferenceCapable: true,
        source: 'user',
        resourceVersion: 1,
      },
    ],
  }).as('listProviderProfiles');

  cy.intercept('POST', `/api/v1/workspaces/${workspace}/provider-profiles`, {
    statusCode: 201,
    body: {
      diagnostics: [],
      profiles: [
        {
          id: 'new-profile',
          displayName: 'New Profile',
          category: 'OTHER',
          credentials: [],
          inferenceCapable: false,
          source: 'user',
          resourceVersion: 1,
        },
      ],
      imported: true,
    },
  }).as('importProviderProfiles');

  cy.intercept(
    'DELETE',
    new RegExp(
      `/api/v1/workspaces/${workspace}/provider-profiles/[^/]+$`,
    ),
    { statusCode: 200, body: { deleted: true } },
  ).as('deleteProviderProfile');

  cy.intercept('POST', `/api/v1/workspaces/${workspace}/providers`, {
    statusCode: 201,
    body: {
      metadata: {
        id: 'prov-new-id',
        name: 'new-provider',
        workspace,
        createdAtMs: Date.now(),
        resourceVersion: 1,
      },
      type: 'claude',
      credentialNames: ['api_key'],
    },
  }).as('createProvider');
};

export const interceptPolicies = (workspace = 'default') => {
  cy.intercept(
    'GET',
    new RegExp(`/api/v1/workspaces/${workspace}/sandboxes/[^/]+/policy`),
    {
      statusCode: 200,
      body: {
        version: 1,
        filesystem: { includeWorkdir: true },
        networkPolicies: {},
      },
    },
  ).as('getSandboxPolicy');

  cy.intercept(
    'GET',
    new RegExp(`/api/v1/workspaces/${workspace}/sandboxes/[^/]+/drafts$`),
    { statusCode: 200, body: { chunks: [], version: 0 } },
  ).as('getDraftPolicy');

  cy.intercept(
    'GET',
    new RegExp(`/api/v1/workspaces/${workspace}/sandboxes/[^/]+/providers`),
    { statusCode: 200, body: [] },
  ).as('listSandboxProviders');

  cy.intercept(
    'GET',
    new RegExp(`/api/v1/workspaces/${workspace}/sandboxes/[^/]+/services`),
    { statusCode: 200, body: [] },
  ).as('listServices');

  cy.intercept('GET', `/api/v1/workspaces/${workspace}/inference`, {
    statusCode: 404,
    body: { code: 'not_found', message: 'no inference route' },
  }).as('getInference');
};

export const interceptMembers = (workspace = 'default') => {
  cy.intercept('GET', `/api/v1/workspaces/${workspace}/members`, {
    statusCode: 200,
    body: [
      {
        metadata: {
          id: 'member-1',
          name: 'test-user-id',
          workspace,
          labels: {},
          annotations: {},
          createdAtMs: 1722700000000,
          resourceVersion: 1,
        },
        principalSubject: 'test-user-id',
        role: 'ADMIN',
      },
    ],
  }).as('listMembers');
};

export const interceptMisc = () => {
  cy.intercept('GET', '/api/v1/draft-summary', {
    statusCode: 200,
    body: { pending: 0 },
  }).as('draftSummary');

  cy.intercept('GET', /\/api\/v1\/workspaces\/[^/]+\/inference/, {
    statusCode: 404,
    body: { code: 'not_found', message: 'no inference route' },
  }).as('inferenceRoute');

  cy.intercept('GET', '/api/v1/global-policy', {
    statusCode: 200,
    body: {},
  }).as('globalPolicy');

  cy.intercept('GET', '/api/v1/settings/global', {
    statusCode: 200,
    body: {},
  }).as('globalSettings');
};

export const interceptAll = (workspace = 'default') => {
  interceptAuth();
  interceptGateway();
  interceptWorkspaces();
  interceptSandboxes(workspace);
  interceptProviders(workspace);
  interceptMembers(workspace);
  interceptPolicies(workspace);
  interceptMisc();
};
