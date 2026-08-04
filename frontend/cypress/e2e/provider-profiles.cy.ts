import { interceptAll } from '../support/intercepts';

describe('Provider Profile Management', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
    cy.visit('/workspaces/default');
    cy.wait('@authConfig');
    cy.wait('@whoami');
  });

  it('displays profiles table in the Profiles tab', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="profiles-table"]').should('be.visible');
    cy.contains('Anthropic Claude').should('exist');
    cy.contains('OpenAI').should('exist');
    cy.contains('Custom LLM').should('exist');
  });

  it('shows source labels for each profile', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="profiles-table"]').within(() => {
      cy.contains('builtin').should('exist');
      cy.contains('user').should('exist');
    });
  });

  it('shows create profile button for admins', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="create-profile"]').should('be.visible');
  });

  it('opens and closes the create profile modal', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="create-profile"]').click();
    cy.get('.pf-v6-c-modal-box').should('be.visible');
    cy.contains('Create provider profile').should('be.visible');

    cy.get('[data-testid="profile-id-input"]').should('exist');
    cy.get('[data-testid="profile-display-name-input"]').should('exist');
    cy.get('[data-testid="profile-category-select"]').should('exist');

    cy.get('.pf-v6-c-modal-box').contains('Cancel').click();
    cy.get('.pf-v6-c-modal-box').should('not.exist');
  });

  it('submit is disabled until required fields are filled', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="create-profile"]').click();

    cy.get('[data-testid="create-profile-submit"]').should('be.disabled');

    cy.get('[data-testid="profile-id-input"]').type('my-custom');
    cy.get('[data-testid="create-profile-submit"]').should('be.disabled');

    cy.get('[data-testid="profile-display-name-input"]').type('My Custom');
    cy.get('[data-testid="create-profile-submit"]').should('be.enabled');
  });

  it('creates a new profile via the modal', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="create-profile"]').click();

    cy.get('[data-testid="profile-id-input"]').type('new-profile');
    cy.get('[data-testid="profile-display-name-input"]').type('New Profile');
    cy.get('[data-testid="profile-description-input"]').type(
      'A test custom profile',
    );
    cy.get('[data-testid="profile-category-select"]').select('INFERENCE');
    cy.get('[data-testid="profile-inference-checkbox"]').click();

    cy.get('[data-testid="cred-add"]').click();
    cy.get('[data-testid="cred-name-0"]').type('api_key');
    cy.get('[data-testid="cred-env-0"]').type('MY_API_KEY');
    cy.get('[data-testid="cred-required-0"]').click();

    cy.get('[data-testid="endpoint-add"]').click();
    cy.get('[data-testid="endpoint-host-0"]').type('api.example.com');
    cy.get('[data-testid="endpoint-port-0"]').type('443');

    cy.get('[data-testid="create-profile-submit"]').click();
    cy.wait('@importProviderProfiles');

    cy.get('.pf-v6-c-modal-box').should('not.exist');
  });

  it('expands a profile row to show credential details', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');

    cy.get('[data-testid="profiles-table"]')
      .find('button[aria-label="Details"]')
      .first()
      .click();

    cy.contains('api_key (required)').should('be.visible');
  });

  it('shows delete action only on custom (user) profiles', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');

    cy.get('[data-testid="profiles-table"]').within(() => {
      // Custom LLM row (source=user) should have kebab actions
      cy.contains('Custom LLM')
        .closest('tr')
        .find('.pf-v6-c-menu-toggle')
        .should('exist');

      // Builtin rows should NOT have kebab actions
      cy.contains('Anthropic Claude')
        .closest('tr')
        .find('.pf-v6-c-menu-toggle')
        .should('not.exist');
    });
  });

  it('deletes a custom profile', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');

    cy.get('[data-testid="profiles-table"]').within(() => {
      cy.contains('Custom LLM')
        .closest('tr')
        .find('.pf-v6-c-menu-toggle')
        .click();
    });

    cy.contains('Delete').click();

    cy.get('.pf-v6-c-modal-box').should('be.visible');
    cy.contains('Delete provider profile?').should('be.visible');
    cy.contains('custom-llm').should('be.visible');

    cy.get('.pf-v6-c-modal-box')
      .find('button')
      .contains('Delete')
      .click();
    cy.wait('@deleteProviderProfile');
  });

  it('can add and remove credentials in the create modal', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="create-profile"]').click();

    cy.get('[data-testid="cred-add"]').click();
    cy.get('[data-testid="cred-name-0"]').should('exist');

    cy.get('[data-testid="cred-add"]').click();
    cy.get('[data-testid="cred-name-1"]').should('exist');

    cy.get('[data-testid="cred-remove-0"]').click();
    cy.get('[data-testid="cred-name-0"]').should('exist');
    cy.get('[data-testid="cred-name-1"]').should('not.exist');
  });

  it('can add and remove endpoints in the create modal', () => {
    cy.get('[data-testid="tab-profiles"]').click();
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="create-profile"]').click();

    cy.get('[data-testid="endpoint-add"]').click();
    cy.get('[data-testid="endpoint-host-0"]').should('exist');

    cy.get('[data-testid="endpoint-add"]').click();
    cy.get('[data-testid="endpoint-host-1"]').should('exist');

    cy.get('[data-testid="endpoint-remove-0"]').click();
    cy.get('[data-testid="endpoint-host-0"]').should('exist');
    cy.get('[data-testid="endpoint-host-1"]').should('not.exist');
  });
});
