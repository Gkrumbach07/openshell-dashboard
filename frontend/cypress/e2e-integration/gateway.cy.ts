// Integration e2e: hit the real gateway through the BFF — no mocks.
describe('Gateway (integration)', () => {
  beforeEach(() => {
    cy.login();
  });

  it('healthz returns OK', () => {
    cy.request('/api/v1/healthz').its('status').should('eq', 200);
  });

  it('gateway info returns version and status', () => {
    cy.request('/api/v1/gateway').then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body).to.have.property('gatewayVersion');
      expect(resp.body).to.have.property('status');
      expect(resp.body.computeDrivers).to.be.an('array');
    });
  });

  it('overview page loads with real gateway data', () => {
    cy.visit('/');
    cy.contains('Gateway Overview', { timeout: 10000 }).should('be.visible');
    cy.contains('HEALTHY').should('be.visible');
  });
});
