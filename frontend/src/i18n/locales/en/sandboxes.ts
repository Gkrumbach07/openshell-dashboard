export default {
  // The cause the gateway gives for a failed exchange
  // (openshell.v1.EndpointFailure), in the words `openshell sandbox get` uses.
  // Codes, stages and request IDs are shown as the gateway sends them.
  failure: {
    ariaLabel: 'Failure cause',
    cause: 'Cause',
    // {{domain}} is one of the domain names below.
    causeValue: '{{code}} ({{domain}})',
    stage: 'Stage',
    upstreamStatus: 'Upstream HTTP status',
    credential: 'Credential',
    recovery: 'Recovery',
    requestId: 'Request ID',
    domain: {
      TOKEN_GRANT: 'token grant',
      UNSPECIFIED: 'unknown',
    },
    recoveryAction: {
      RETRY: 'Retry later; the failure can be temporary.',
      REAUTHORIZE: 'Reauthorize the provider credential.',
      FIX_CONFIGURATION:
        'An operator must fix the provider or identity configuration.',
      INVESTIGATE: 'An operator must investigate gateway and supervisor logs.',
      none: 'No recovery action provided.',
      // An action this build has no words for, by the gateway's name for it.
      other: 'The gateway reports the recovery action {{action}}.',
    },
  },
  tokenGrantFailure: {
    title: 'Last token grant failure',
    destination: 'Destination',
    destinationValue: '{{host}} (port {{port}})',
    help: "The latest token grant the sandbox refused, for any destination. It describes the attempted call, not the destination's current health, and clears once a grant to the same destination succeeds.",
  },
};
