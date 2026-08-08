# Feature Flags

The OpenShell Dashboard supports feature flags to enable/disable specific capabilities per deployment. This is critical because some features (terminal, file transfer) require direct WebSocket access to the BFF and break when the dashboard is served through a federation proxy.

## Architecture

Flags are set as **BFF environment variables** and exposed to the frontend via `GET /api/v1/auth/config`. The frontend reads them once at login and conditionally renders features.

### BFF configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FEATURE_TERMINAL` | `true` | Interactive terminal tab (WebSocket to ExecSandboxInteractive). Disable in federated deployments where the proxy can't upgrade WS. |
| `FEATURE_FILE_TRANSFER` | `true` | File upload/download via ExecSandbox. Disable if exec is restricted. |
| `FEATURE_SETTINGS` | `true` | Gateway settings page (Platform Admin). Disable to prevent runtime config changes. |
| `FEATURE_GLOBAL_POLICY` | `true` | Global policy page (Platform Admin). Disable in single-tenant deployments. |
| `FEATURE_CREDENTIAL_REFRESH` | `true` | Credential refresh configure/rotate/delete on provider detail. Disable if refresh is managed externally. |
| `FEATURE_SERVICES` | `true` | Sandbox services (expose/list/delete). Disable if service routing is not available. |
| `FEATURE_DRAFT_POLICY` | `true` | Draft policy advisor inbox (approve/reject/edit/undo). Disable if the policy advisor is not configured. |

### Frontend consumption

The `/api/v1/auth/config` response includes a `features` object:

```json
{
  "authDisabled": false,
  "adminRole": "admin",
  "logoutUrl": "/oauth2/sign_out",
  "features": {
    "terminal": true,
    "fileTransfer": true,
    "settings": true,
    "globalPolicy": true,
    "credentialRefresh": true,
    "services": true,
    "draftPolicy": true
  }
}
```

A `useFeatureFlags()` hook reads from the cached auth config:

```typescript
export const useFeatureFlags = () => {
  const { data } = useAuthConfig();
  return data?.features ?? {};
};
```

### Gating pattern

Features are gated at two levels:

1. **Navigation** — hide nav items and tabs when the feature is off.
2. **Components** — wrap feature-gated content with a check; render nothing or an info alert.

```tsx
const flags = useFeatureFlags();

// In nav entries:
{ path: '/settings', label: 'Settings', adminOnly: true, hidden: !flags.settings }

// In tab rendering:
{flags.terminal && (
  <Tab eventKey="terminal" title={<TabTitleText>Terminal</TabTitleText>}>
    <SandboxTerminalTab ... />
  </Tab>
)}
```

### Downstream override

When consumed via module federation, the downstream wrapper can override flags by passing them as props to the page components, or by configuring the BFF sidecar's env vars in the deployment manifest.

## Implementation steps

1. Add `FeatureFlags` struct to `backend/internal/api/app.go` parsed from env vars
2. Include in `AuthConfigResponse` served by `GET /api/v1/auth/config`
3. Add `features` to the `AuthConfig` TypeScript type
4. Create `useFeatureFlags()` hook
5. Gate: Terminal tab, Files tab, Services tab, Proposals tab, Settings nav, Global Policy nav, credential refresh UI on ProviderDetailPage
