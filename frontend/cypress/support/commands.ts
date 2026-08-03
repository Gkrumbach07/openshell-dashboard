declare global {
  namespace Cypress {
    interface Chainable {
      login(): Chainable<void>;
    }
  }
}

Cypress.Commands.add('login', () => {
  cy.window().then((win) => {
    win.sessionStorage.setItem('openshell-dashboard.devMode', 'true');
    win.sessionStorage.setItem(
      'openshell-dashboard.token',
      'cypress-test-token',
    );
  });
});

export {};
