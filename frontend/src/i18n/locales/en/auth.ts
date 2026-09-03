export default {
  title: 'OpenShell Dashboard',
  description: 'Admin UI for the OpenShell agent sandboxing gateway.',
  devDisabledTitle: 'Authentication is disabled (dev mode)',
  continueAsDeveloper: 'Continue as developer',
  proxySignInTitle: "Sign-in is handled by this deployment's auth proxy",
  proxySignInBody: 'Reload the page to be redirected to sign-in.',
  sessionLoading: 'Loading session',
  sessionVerifyFailed: 'Cannot verify session',
  sessionBffUnreachable: 'Check that the BFF is running and reachable.',
  requiredTitle: 'Authentication required',
  requiredLead:
    'This deployment requires a signed-in session. For local development, run',
  requiredDevDefault: '(defaults to',
  requiredAuthOn: '). To test with auth enabled, use',
  requiredDevServerNote:
    '— note that the Vite dev server is not behind an auth proxy, so browser sign-in is not available without',
  requiredProxyNote: 'and a fronting proxy.',
} as const;
