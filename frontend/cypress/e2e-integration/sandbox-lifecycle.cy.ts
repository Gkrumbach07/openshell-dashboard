// Integration e2e: real sandbox creation through the BFF + gateway.
// The gateway uses the Docker compute driver — sandboxes are real containers.
describe('Sandbox lifecycle (integration)', () => {
  // Gateway enforces a max sandbox name length — keep it short.
  const suffix = Math.random().toString(36).slice(2, 8);
  const sandboxName = `e2e-${suffix}`;

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
        .request({
          url: `/api/v1/workspaces/default/sandboxes/${sandboxName}`,
          failOnStatusCode: false,
        })
        .then((resp) => {
          if (resp.status === 404) {
            cy.wait(2000);
            return pollForReady(attempts + 1);
          }
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
