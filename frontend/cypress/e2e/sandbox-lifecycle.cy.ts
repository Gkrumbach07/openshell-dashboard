import { interceptAll } from '../support/intercepts';

describe('Sandbox Lifecycle', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
    cy.visit('/workspaces/default');
    cy.wait('@authConfig');
    cy.wait('@whoami');
    cy.wait('@listSandboxes');
    // Switch to table/list view for consistent selectors
    cy.get('[data-testid="view-toggle-list"]').click();
  });

  it('displays sandbox list with different phases', () => {
    cy.contains('my-agent').should('be.visible');
    cy.contains('data-processor').should('be.visible');
    cy.contains('broken-sandbox').should('be.visible');
  });

  it('shows sandbox phase labels in table view', () => {
    cy.get('[data-testid="phase-label"]').should('have.length.at.least', 1);
  });

  it('opens create sandbox modal', () => {
    cy.get('[data-testid="create-sandbox"]').click();
    cy.get('.pf-v6-c-modal-box').should('be.visible');
  });

  it('fills and submits create sandbox form', () => {
    cy.get('[data-testid="create-sandbox"]').click();
    cy.get('.pf-v6-c-modal-box').should('be.visible');

    cy.get('[data-testid="sandbox-name-input"]').type('new-sandbox');
    cy.get('[data-testid="sandbox-image-input"]').clear().type(
      'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
    );

    cy.get('[data-testid="create-sandbox-submit"]').click();
    cy.wait('@createSandbox');
  });

  it('navigates to sandbox detail on click', () => {
    cy.get('[data-testid="sandbox-link-my-agent"]').click();
    cy.url().should('include', '/workspaces/default/sandboxes/my-agent');
  });

  it('deletes a sandbox via row action', () => {
    // Open the per-row actions kebab on the first sandbox row
    cy.get('table tbody tr').first().find('.pf-v6-c-menu-toggle').click();
    cy.contains('.pf-v6-c-menu__item', 'Delete').click();

    cy.get('.pf-v6-c-modal-box').should('be.visible');
    cy.get('[data-testid="confirm-delete-name-input"]').type('my-agent');
    cy.get('[data-testid="confirm-delete"]').click();
    cy.wait('@deleteSandbox');
  });
});
