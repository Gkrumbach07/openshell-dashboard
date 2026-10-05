// Integration e2e: a workspace is a real boundary on the gateway this line
// supports.
//
// Why this spec exists. Dashboard 0.3.0 was believed to work with gateway
// 0.0.116, and every test agreed, because every test only ever used the
// `default` workspace. Its SDK names the workspace in a request field that
// 0.0.116 does not know. The gateway does not reject such a request: it
// ignores the field and runs the call in `default`. A sandbox created "in" a
// second workspace landed in `default`, every workspace page listed
// `default`'s sandboxes, and nothing returned an error.
//
// So this spec leaves `default`: it creates a second workspace, creates a
// sandbox in it, and checks from both sides that the sandbox is there and NOT
// in `default`. If the SDK pin in backend/go.mod ever moves to one that
// gateway 0.0.116 cannot scope, this is the spec that fails.
describe('Workspace scoping (integration)', () => {
  // Gateway enforces name length limits — keep them short.
  const suffix = Math.random().toString(36).slice(2, 8);
  const wsName = `e2e-ws-${suffix}`;
  const sandboxName = `e2e-sc-${suffix}`;
  // Pinned by digest in deploy/ci/gateway-pins.json and handed in through
  // cypress.config.integration.ts, so this never follows a moving tag.
  const sandboxImage: string = Cypress.expose('sandboxImage');

  const sandboxNamesIn = (workspace: string) =>
    cy.request(`/api/v1/workspaces/${workspace}/sandboxes`).then((resp) => {
      expect(resp.status).to.eq(200);
      return resp.body.map(
        (s: { metadata: { name: string } }) => s.metadata.name,
      ) as string[];
    });

  beforeEach(() => {
    cy.login();
  });

  // Runs whether or not the tests passed, and removes the sandbox from
  // `default` as well: that is where it ends up when scoping is broken. The
  // name is random and used by nothing else, so this can only ever delete
  // this spec's own sandbox. The gateway refuses to delete a workspace that
  // still holds a sandbox, hence the order.
  after(() => {
    for (const workspace of [wsName, 'default']) {
      cy.request({
        method: 'DELETE',
        url: `/api/v1/workspaces/${workspace}/sandboxes/${sandboxName}`,
        failOnStatusCode: false,
      });
    }
    cy.request({
      method: 'DELETE',
      url: `/api/v1/workspaces/${wsName}`,
      failOnStatusCode: false,
    });
  });

  it('creates a second workspace', () => {
    cy.request('POST', '/api/v1/workspaces', { name: wsName }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body.metadata.name).to.eq(wsName);
    });
  });

  it('creates a sandbox in the second workspace', () => {
    expect(sandboxImage, 'pinned sandbox image').to.include('@sha256:');
    cy.request('POST', `/api/v1/workspaces/${wsName}/sandboxes`, {
      name: sandboxName,
      image: sandboxImage,
      policy: {
        version: 1,
        filesystem: {
          includeWorkdir: true,
          readOnly: ['/usr'],
          readWrite: ['/sandbox'],
        },
        networkPolicies: {},
      },
    }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body.metadata.name).to.eq(sandboxName);
    });
  });

  it('lists the sandbox in the second workspace', () => {
    sandboxNamesIn(wsName).should('include', sandboxName);
  });

  it('does NOT list the sandbox in default', () => {
    sandboxNamesIn('default').should('not.include', sandboxName);
  });

  it('serves the sandbox by name in its workspace only', () => {
    cy.request(`/api/v1/workspaces/${wsName}/sandboxes/${sandboxName}`)
      .its('status')
      .should('eq', 200);
    cy.request({
      url: `/api/v1/workspaces/default/sandboxes/${sandboxName}`,
      failOnStatusCode: false,
    })
      .its('status')
      .should('eq', 404);
  });

  it('shows the sandbox on its workspace page and not on the default page', () => {
    cy.visit(`/workspaces/${wsName}`);
    cy.contains(sandboxName).should('be.visible');

    cy.visit('/workspaces/default');
    // Either "Create sandbox" button means the list has finished loading:
    // the empty state has one and the toolbar above the table has the other.
    cy.get(
      '[data-testid="create-sandbox-empty"], [data-testid="create-sandbox"]',
    ).should('exist');
    cy.contains(sandboxName).should('not.exist');
  });

  // The gateway counts what a workspace holds by the workspace the sandbox
  // was really created in, so this only answers 409 when the sandbox is
  // where it was asked to be.
  it('refuses to delete the workspace while it holds the sandbox', () => {
    cy.request({
      method: 'DELETE',
      url: `/api/v1/workspaces/${wsName}`,
      failOnStatusCode: false,
    })
      .its('status')
      .should('eq', 409);
  });

  it('does not delete the sandbox through default', () => {
    cy.request({
      method: 'DELETE',
      url: `/api/v1/workspaces/default/sandboxes/${sandboxName}`,
      failOnStatusCode: false,
    })
      .its('status')
      .should('eq', 404);
    sandboxNamesIn(wsName).should('include', sandboxName);
  });

  it('deletes the sandbox, then the workspace', () => {
    cy.request(
      'DELETE',
      `/api/v1/workspaces/${wsName}/sandboxes/${sandboxName}`,
    ).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body.deleted).to.eq(true);
    });
    cy.request('DELETE', `/api/v1/workspaces/${wsName}`)
      .its('status')
      .should('eq', 200);
    cy.request('/api/v1/workspaces').then((resp) => {
      const names = resp.body.map(
        (ws: { metadata: { name: string } }) => ws.metadata.name,
      );
      expect(names).not.to.include(wsName);
    });
  });
});
