// Integration e2e: real workspace CRUD through the BFF + gateway.
describe('Workspace lifecycle (integration)', () => {
  const wsName = `e2e-ws-${Date.now()}`;

  beforeEach(() => {
    cy.login();
  });

  it('lists workspaces (default always exists)', () => {
    cy.request('/api/v1/workspaces').then((resp) => {
      expect(resp.status).to.eq(200);
      const names = resp.body.map((ws: { metadata: { name: string } }) => ws.metadata.name);
      expect(names).to.include('default');
    });
  });

  it('creates a workspace', () => {
    cy.request('POST', '/api/v1/workspaces', { name: wsName }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body.metadata.name).to.eq(wsName);
      expect(resp.body.phase).to.eq('ACTIVE');
    });
  });

  it('gets the created workspace', () => {
    cy.request(`/api/v1/workspaces/${wsName}`).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body.metadata.name).to.eq(wsName);
    });
  });

  it('workspace list page shows the new workspace', () => {
    cy.visit('/workspaces');
    cy.contains(wsName, { timeout: 10000 }).should('be.visible');
  });

  it('deletes the workspace', () => {
    cy.request('DELETE', `/api/v1/workspaces/${wsName}`).then((resp) => {
      expect(resp.status).to.eq(200);
    });
  });
});
