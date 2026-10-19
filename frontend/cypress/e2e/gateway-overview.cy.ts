import { interceptAll } from '../support/intercepts';

describe('Gateway Overview', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
    cy.visit('/gateway');
    cy.wait('@authConfig');
    cy.wait('@whoami');
    cy.wait('@gateway');
  });

  it('displays gateway page heading', () => {
    cy.contains('h1', 'Gateway').should('be.visible');
  });

  // The health check's answer is the masthead's, on every page.
  it('shows the gateway as healthy in the masthead', () => {
    cy.get('[data-testid="gateway-status-indicator"]').should(
      'contain.text',
      'Healthy',
    );
  });

  // The status the gateway reports for itself sits with its version.
  it('shows the status the gateway reports', () => {
    cy.get('[data-testid="gateway-facts"]').within(() => {
      cy.get('[data-testid="gateway-status"]').should('contain.text', 'HEALTHY');
    });
  });

  it('shows gateway version', () => {
    cy.get('[data-testid="gateway-version"]')
      .should('be.visible')
      .and('contain.text', 'Gateway version: 0.0.92');
  });

  it('shows compute drivers table', () => {
    cy.get('[data-testid="gateway-drivers-card"]').within(() => {
      cy.contains('Compute drivers').should('be.visible');
      cy.get('table').should('be.visible');
      cy.contains('podman').should('be.visible');
      cy.contains('5.4.2').should('be.visible');
    });
  });

  it('shows error state when gateway is unreachable', () => {
    cy.intercept('GET', '/api/v1/gateway', {
      statusCode: 502,
      body: { code: 'UNAVAILABLE', message: 'Gateway unreachable' },
    }).as('gatewayError');

    cy.visit('/gateway');
    cy.wait('@gatewayError');
    cy.contains('Cannot reach the OpenShell gateway').should('be.visible');
    cy.contains('Retry').should('be.visible');
  });
});
