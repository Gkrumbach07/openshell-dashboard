import { interceptAll } from '../support/intercepts';

describe('Navigation', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
  });

  it('shows sidebar navigation items', () => {
    cy.visit('/workspaces');
    cy.wait('@authConfig');
    cy.wait('@whoami');

    cy.get('nav[aria-label="Primary navigation"]').within(() => {
      cy.contains('Gateway').should('be.visible');
      cy.contains('Workspaces').should('be.visible');
      cy.contains('Global policy').should('be.visible');
      cy.contains('Settings').should('be.visible');
    });
  });

  it('navigates to Gateway page via sidebar', () => {
    cy.visit('/workspaces');
    cy.wait('@authConfig');
    cy.wait('@whoami');

    cy.get('nav[aria-label="Primary navigation"]')
      .contains('Gateway')
      .click();
    cy.wait('@gateway');
    cy.url().should('include', '/gateway');
    cy.contains('h1', 'Gateway').should('be.visible');
  });

  it('navigates to Workspaces page via sidebar', () => {
    cy.visit('/gateway');
    cy.wait('@authConfig');
    cy.wait('@whoami');

    cy.get('nav[aria-label="Primary navigation"]')
      .contains('Workspaces')
      .click();
    cy.wait('@listWorkspaces');
    cy.url().should('include', '/workspaces');
    cy.contains('h1', 'Workspaces').should('be.visible');
  });

  it('shows breadcrumbs on workspace detail page', () => {
    cy.visit('/workspaces/default');
    cy.wait('@authConfig');
    cy.wait('@whoami');

    cy.get('nav[aria-label="Breadcrumb"]').within(() => {
      cy.contains('Workspaces').should('be.visible');
      cy.contains('default').should('be.visible');
    });
  });

  it('breadcrumb Workspaces link navigates back to list', () => {
    cy.visit('/workspaces/default');
    cy.wait('@authConfig');
    cy.wait('@whoami');

    cy.get('nav[aria-label="Breadcrumb"]').contains('Workspaces').click();
    cy.url().should('match', /\/workspaces$/);
  });

  it('shows user menu in masthead', () => {
    cy.visit('/workspaces');
    cy.wait('@authConfig');
    cy.wait('@whoami');

    cy.get('[data-testid="current-user"]').should('contain', 'Test User');
  });

  it('redirects unknown routes to /workspaces', () => {
    cy.visit('/nonexistent-page');
    cy.wait('@authConfig');
    cy.url().should('include', '/workspaces');
  });
});
