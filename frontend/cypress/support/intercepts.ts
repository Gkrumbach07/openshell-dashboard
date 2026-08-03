export const interceptAuth = () => {
  cy.intercept('GET', '/api/v1/auth/config', {
    fixture: 'auth-config.json',
  }).as('authConfig');

  cy.intercept('GET', '/api/v1/auth/whoami', {
    fixture: 'whoami.json',
  }).as('whoami');

  cy.intercept('GET', '/api/v1/auth/userinfo', {
    statusCode: 200,
    body: {
      sub: 'test-user-id',
      email: 'testuser@example.com',
      name: 'Test User',
    },
  }).as('userinfo');
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
    fixture: 'workspaces.json',
    headers: { 'content-type': 'application/json' },
  }).as('getWorkspaceDefault');

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
  cy.intercept(
    'GET',
    `/api/v1/workspaces/${workspace}/sandboxes`,
    { fixture: 'sandboxes.json' },
  ).as('listSandboxes');

  cy.intercept(
    'GET',
    `/api/v1/workspaces/${workspace}/sandboxes/*`,
    (req) => {
      const name = req.url.split('/').pop()?.split('?')[0];
      req.reply({
        statusCode: 200,
        fixture: 'sandboxes.json',
        headers: { 'content-type': 'application/json' },
      });
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

  cy.intercept(
    'DELETE',
    `/api/v1/workspaces/${workspace}/sandboxes/*`,
    { statusCode: 200, body: { deleted: true } },
  ).as('deleteSandbox');
};

export const interceptProviders = (workspace = 'default') => {
  cy.intercept(
    'GET',
    `/api/v1/workspaces/${workspace}/providers`,
    { fixture: 'providers.json' },
  ).as('listProviders');

  cy.intercept(
    'GET',
    `/api/v1/workspaces/${workspace}/provider-profiles`,
    {
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
        },
      ],
    },
  ).as('listProviderProfiles');

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

export const interceptAll = (workspace = 'default') => {
  interceptAuth();
  interceptGateway();
  interceptWorkspaces();
  interceptSandboxes(workspace);
  interceptProviders(workspace);
};
