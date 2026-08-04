import './commands';

Cypress.on('uncaught:exception', (err) => {
  // Don't fail the test on React error boundaries or runtime errors
  // that are caused by missing API responses in the mocked environment.
  if (err.message.includes('Cannot read properties of undefined')) {
    return false;
  }
  return true;
});
