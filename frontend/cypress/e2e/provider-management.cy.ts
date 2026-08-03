import { interceptAll } from '../support/intercepts';

describe('Provider Management', () => {
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
    cy.wait('@listProviders');
  });

  it('displays provider list', () => {
    cy.get('[role="tab"]').contains('Providers').click();
    cy.contains('anthropic').should('be.visible');
    cy.contains('openai-dev').should('be.visible');
  });

  it('shows provider types', () => {
    cy.get('[role="tab"]').contains('Providers').click();
    cy.contains('claude').should('be.visible');
    cy.contains('openai').should('be.visible');
  });

  it('opens create provider modal', () => {
    cy.get('[role="tab"]').contains('Providers').click();
    cy.get('[data-testid="create-provider"]').click();
    cy.get('.pf-v6-c-modal-box').should('be.visible');
  });

  it('navigates to provider detail on click', () => {
    cy.get('[role="tab"]').contains('Providers').click();
    cy.get('[data-testid="provider-link-anthropic"]').click();
    cy.url().should('include', '/workspaces/default/providers/anthropic');
  });
});
