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

  // What each provider gets from the profile its type resolves to: the
  // PROFILE, CATEGORY, CREDS and POLICY columns of the OpenShell TUI.
  it('shows what the profile says about each provider', () => {
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.wait('@listProviderProfiles');
    cy.get('[data-testid="provider-profile-anthropic"]')
      .should('contain', 'Anthropic Claude')
      .and('contain', 'claude');
    cy.get('[data-testid="provider-category-anthropic"]').should(
      'have.text',
      'inference',
    );
    cy.get('[data-testid="provider-credentials-anthropic"]').should(
      'contain',
      '1/1 req, 1 key',
    );
    cy.get('[data-testid="provider-policy-anthropic"]').should(
      'have.text',
      '0 endpoints, 0 bins, inference',
    );
  });

  it('marks a provider whose type matches no profile', () => {
    cy.fixture('providers.json').then((providers) => {
      cy.intercept('GET', '/api/v1/workspaces/default/providers', [
        ...providers,
        {
          ...providers[0],
          metadata: { ...providers[0].metadata, id: 'prov-3-id', name: 'old' },
          type: 'retired',
          credentialNames: ['LEGACY_TOKEN'],
        },
      ]).as('listProviders');
    });
    // Again, now that the list is the one above: the page asked for its
    // providers when it was first visited.
    cy.visit('/workspaces/default');
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.get('[data-testid="provider-profile-old"]').should(
      'have.text',
      'retired (unprofiled)',
    );
    cy.get('[data-testid="provider-category-old"]').should(
      'have.text',
      'legacy',
    );
    cy.get('[data-testid="provider-credentials-old"]').should(
      'contain',
      '1 key',
    );
    cy.get('[data-testid="provider-policy-old"]').should(
      'have.text',
      'no profile',
    );
  });

  // Choosing a type fills in a name no provider in the workspace has.
  it('fills in a free name when a type is chosen', () => {
    cy.fixture('providers.json').then((providers) => {
      cy.intercept('GET', '/api/v1/workspaces/default/providers', [
        ...providers,
        {
          ...providers[0],
          metadata: {
            ...providers[0].metadata,
            id: 'prov-3-id',
            name: 'claude',
          },
        },
      ]).as('listProviders');
    });
    cy.visit('/workspaces/default');
    cy.get('[data-testid="tab-providers"]').click();
    cy.wait('@listProviders');
    cy.get('[data-testid="create-provider"]').click();
    cy.get('[data-testid="provider-name-input"]').should('have.value', '');
    cy.get('[data-testid="provider-type-select"]').select('OpenAI (INFERENCE)');
    cy.get('[data-testid="provider-name-input"]').should(
      'have.value',
      'openai',
    );
    // A provider is already called "claude".
    cy.get('[data-testid="provider-type-select"]').select(
      'Anthropic Claude (INFERENCE)',
    );
    cy.get('[data-testid="provider-name-input"]').should(
      'have.value',
      'claude-1',
    );
  });
});

describe('Provider Detail', () => {
  beforeEach(() => {
    interceptAll();
    cy.login();
    cy.visit('/workspaces/default/providers/anthropic');
    cy.wait('@getProvider');
  });

  it('shows what the profile says about the provider', () => {
    cy.get('[data-testid="provider-profile-name"]').should(
      'have.text',
      'Anthropic Claude',
    );
    cy.get('[data-testid="provider-profile-category"]').should(
      'have.text',
      'inference',
    );
    cy.get('[data-testid="provider-credential-api_key"]')
      .should('contain', 'required')
      .and('contain', 'Present')
      .and('contain', 'secret — write-only');
    cy.get('[data-testid="provider-policy-card"]').should(
      'contain',
      'No profile endpoints.',
    );
    cy.get('[data-testid="provider-discovery-card"]').should('exist');
    cy.get('[data-testid="provider-profile-refresh-card"]').should(
      'contain',
      'No refresh metadata in profile.',
    );
    cy.get('[data-testid="provider-refresh-card"]').should('exist');
  });

  // The TUI's Object YAML and Profile YAML views. No credential value is in
  // either: the BFF returns none, and each key reads "<redacted>".
  it('shows the provider and its profile as YAML', () => {
    cy.get('[data-testid="tab-provider-object-yaml"]').click();
    cy.get('[data-testid="provider-object-yaml"]')
      .should('contain', 'name: "anthropic"')
      .and('contain', 'type: "claude"')
      .and('contain', 'api_key: "<redacted>"')
      .and('contain', 'api_key: 2030-01-01T00:00:00Z')
      .and('contain', 'ANTHROPIC_BASE_URL: "https://api.anthropic.com"');

    cy.get('[data-testid="tab-provider-profile-yaml"]').click();
    cy.get('[data-testid="provider-profile-yaml"]')
      .should('contain', 'id: claude')
      .and('contain', 'display_name: Anthropic Claude')
      .and('contain', 'category: inference');
  });
});
