import { interceptAll } from '../support/intercepts';

describe('Sandbox Lifecycle', () => {
  beforeEach(() => {
    interceptAll();
    cy.intercept('GET', '/api/v1/workspaces/default/members', {
      statusCode: 200,
      body: [],
    }).as('listMembers');
    cy.login();
    cy.visit('/workspaces/default');
    cy.wait('@authConfig');
    cy.wait('@whoami');
    cy.wait('@listSandboxes');
  });

  it('displays sandbox list with different phases', () => {
    cy.contains('my-agent').should('be.visible');
    cy.contains('data-processor').should('be.visible');
    cy.contains('broken-sandbox').should('be.visible');
  });

  it('shows sandbox phase labels', () => {
    cy.contains('Ready').should('be.visible');
    cy.contains('Provisioning').should('be.visible');
    cy.contains('Error').should('be.visible');
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

  it('deletes a sandbox', () => {
    cy.get('[data-testid="sandbox-actions-my-agent"]').click();
    cy.contains('Delete').click();

    cy.get('.pf-v6-c-modal-box').should('be.visible');
    cy.get('[data-testid="confirm-delete-input"]').type('my-agent');
    cy.get('[data-testid="confirm-delete-button"]').click();
    cy.wait('@deleteSandbox');
  });
});
