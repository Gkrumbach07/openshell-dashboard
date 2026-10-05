// Integration e2e: sandbox templates against a gateway that does not have
// them. Gateway 0.0.116 — the only one this line supports — answers the
// template RPCs with gRPC UNIMPLEMENTED. The BFF must relay that as HTTP 501
// `unimplemented`, and the UI must say "not supported" instead of failing.
describe('Sandbox templates on gateway 0.0.116 (integration)', () => {
  const policy = {
    version: 1,
    filesystem: {
      includeWorkdir: true,
      readOnly: ['/usr'],
      readWrite: ['/sandbox'],
    },
    networkPolicies: {},
  };

  const expectUnimplemented = (resp: Cypress.Response<{ code: string }>) => {
    expect(resp.status).to.eq(501);
    expect(resp.body.code).to.eq('unimplemented');
  };

  beforeEach(() => {
    cy.login();
  });

  it('listing templates answers 501 unimplemented, not 500', () => {
    cy.request({
      url: '/api/v1/workspaces/default/templates',
      failOnStatusCode: false,
    }).then(expectUnimplemented);
  });

  it('creating a template answers 501 unimplemented', () => {
    cy.request({
      method: 'POST',
      url: '/api/v1/workspaces/default/templates',
      body: {
        name: 'e2e-template',
        spec: { workload: { image: Cypress.expose('sandboxImage') } },
      },
      failOnStatusCode: false,
    }).then(expectUnimplemented);
  });

  // 0.0.116 does not reject a create that names a template: it ignores the
  // field it does not know and creates a default-image sandbox. The BFF has to
  // stop the request before it gets that far.
  it('creating a sandbox from a template answers 501 and creates nothing', () => {
    const sandboxName = `e2e-tpl-${Math.random().toString(36).slice(2, 8)}`;
    cy.request({
      method: 'POST',
      url: '/api/v1/workspaces/default/sandboxes/from-template',
      body: { name: sandboxName, templateName: 'e2e-template', policy },
      failOnStatusCode: false,
    }).then(expectUnimplemented);

    cy.request('/api/v1/workspaces/default/sandboxes').then((resp) => {
      const names = resp.body.map(
        (s: { metadata: { name: string } }) => s.metadata.name,
      );
      expect(names).not.to.include(sandboxName);
    });
  });

  it('the Templates tab says templates are not supported', () => {
    cy.visit('/workspaces/default');
    cy.get('[data-testid="tab-templates"]').click();
    cy.get('[data-testid="templates-unsupported"]').should('be.visible');
    cy.contains('This gateway does not support sandbox templates').should(
      'be.visible',
    );
    cy.contains('Failed to load templates').should('not.exist');
  });
});
