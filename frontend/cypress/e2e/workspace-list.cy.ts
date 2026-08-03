import { interceptAll } from '../support/intercepts';

describe('Workspace List', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
    cy.visit('/workspaces');
    cy.wait('@authConfig');
    cy.wait('@whoami');
    cy.wait('@listWorkspaces');
  });

  it('displays workspace list heading', () => {
    cy.contains('h1', 'Workspaces').should('be.visible');
  });

  it('shows all workspaces in the table', () => {
    cy.get('[data-testid="workspace-table"]').should('be.visible');
    cy.contains('default').should('be.visible');
    cy.contains('dev-team').should('be.visible');
    cy.contains('staging').should('be.visible');
  });

  it('shows table headers', () => {
    cy.get('[data-testid="workspace-table"]').within(() => {
      cy.contains('th', 'Name').should('be.visible');
      cy.contains('th', 'Phase').should('be.visible');
      cy.contains('th', 'Labels').should('be.visible');
      cy.contains('th', 'Age').should('be.visible');
    });
  });

  it('navigates to workspace detail on click', () => {
    cy.get('[data-testid="workspace-link-default"]').click();
    cy.url().should('include', '/workspaces/default');
  });

  it('shows create workspace button for admin users', () => {
    cy.get('[data-testid="create-workspace"]').should('be.visible');
  });

  it('shows error state when workspaces fail to load', () => {
    cy.intercept('GET', '/api/v1/workspaces', {
      statusCode: 500,
      body: { code: 'INTERNAL', message: 'Internal error' },
    }).as('workspacesError');

    cy.visit('/workspaces');
    cy.wait('@workspacesError');
    cy.contains('Failed to load workspaces').should('be.visible');
  });
});
