import { interceptAll } from '../support/intercepts';

describe('Provider Management', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
    cy.visit('/workspaces/default');
    cy.wait('@authConfig');
    cy.wait('@whoami');
  });

  it('displays provider list', () => {
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.get('[data-testid="provider-table"]').should('be.visible');
    cy.get('[data-testid="provider-link-anthropic"]').should('exist');
    cy.get('[data-testid="provider-link-openai-dev"]').should('exist');
  });

  it('shows provider types', () => {
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.get('[data-testid="provider-table"]').within(() => {
      cy.get('.pf-v6-c-label').should('have.length.at.least', 2);
    });
  });

  it('opens create provider modal', () => {
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.get('[data-testid="create-provider"]').click();
    cy.get('.pf-v6-c-modal-box').should('be.visible');
  });

  it('navigates to provider detail on click', () => {
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.get('[data-testid="provider-link-anthropic"]').click();
    cy.url().should('include', '/workspaces/default/providers/anthropic');
  });
});
