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

  it('shows gateway status as HEALTHY', () => {
    cy.get('[data-testid="gateway-status-card"]').within(() => {
      cy.contains('Status').should('be.visible');
      cy.contains('HEALTHY').should('be.visible');
    });
  });

  it('shows gateway version', () => {
    cy.get('[data-testid="gateway-version-card"]').within(() => {
      cy.contains('Gateway version').should('be.visible');
      cy.contains('0.0.92').should('be.visible');
    });
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
