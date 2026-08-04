// Integration e2e: hit the real gateway through the BFF — no mocks.
// UI rendering is covered by the mocked e2e suite; these tests verify
// the full BFF → gateway gRPC path returns correct data.
describe('Gateway (integration)', () => {
  it('healthz returns OK', () => {
    cy.request('/api/v1/healthz').then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body).to.have.property('status', 'ok');
    });
  });

  it('gateway info returns version and status', () => {
    cy.request('/api/v1/gateway').then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body).to.have.property('gatewayVersion');
      expect(resp.body).to.have.property('status');
      expect(resp.body.status).to.eq('HEALTHY');
      expect(resp.body.computeDrivers).to.be.an('array').and.have.length.gt(0);
      expect(resp.body.computeDrivers[0]).to.have.property('name');
    });
  });

  it('auth config endpoint works with auth disabled', () => {
    cy.request('/api/v1/auth/config').then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body).to.have.property('authDisabled', true);
    });
  });
});
