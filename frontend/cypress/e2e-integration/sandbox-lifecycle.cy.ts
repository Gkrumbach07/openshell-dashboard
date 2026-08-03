// Integration e2e: real sandbox creation through the BFF + gateway.
// The gateway uses the Docker compute driver — sandboxes are real containers.
describe('Sandbox lifecycle (integration)', () => {
  const sandboxName = `e2e-sbx-${Date.now()}`;

  beforeEach(() => {
    cy.login();
  });

  it('creates a sandbox with the base image', () => {
    cy.request('POST', '/api/v1/workspaces/default/sandboxes', {
      name: sandboxName,
      image: 'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
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
      expect(resp.body.status.phase).to.be.oneOf([
        'PROVISIONING',
        'READY',
      ]);
    });
  });

  it('sandbox reaches READY state', () => {
    const pollForReady = (attempts = 0): Cypress.Chainable => {
      if (attempts > 30) {
        throw new Error('Sandbox did not reach READY within 60s');
      }
      return cy
        .request(`/api/v1/workspaces/default/sandboxes/${sandboxName}`)
        .then((resp) => {
          if (resp.body.status.phase === 'READY') {
            return;
          }
          if (resp.body.status.phase === 'ERROR') {
            throw new Error(
              `Sandbox entered ERROR: ${JSON.stringify(resp.body.status.conditions)}`,
            );
          }
          cy.wait(2000);
          return pollForReady(attempts + 1);
        });
    };

    pollForReady();
  });

  it('sandbox appears in list', () => {
    cy.request('/api/v1/workspaces/default/sandboxes').then((resp) => {
      const names = resp.body.map(
        (s: { metadata: { name: string } }) => s.metadata.name,
      );
      expect(names).to.include(sandboxName);
    });
  });

  it('sandbox detail page loads', () => {
    cy.visit(`/workspaces/default/sandboxes/${sandboxName}`);
    cy.contains(sandboxName, { timeout: 10000 }).should('be.visible');
    cy.contains('READY').should('be.visible');
  });

  it('gets sandbox logs', () => {
    cy.request(
      `/api/v1/workspaces/default/sandboxes/${sandboxName}/logs`,
    ).then((resp) => {
      expect(resp.status).to.eq(200);
    });
  });

  it('deletes the sandbox', () => {
    cy.request(
      'DELETE',
      `/api/v1/workspaces/default/sandboxes/${sandboxName}`,
    ).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body.deleted).to.eq(true);
    });
  });
});
