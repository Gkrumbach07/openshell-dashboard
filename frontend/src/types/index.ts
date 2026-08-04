// TypeScript interfaces matching the OpenShell proto messages as serialized
// by the BFF (camelCase, protojson-style). Proto is source of truth:
// backend/proto/*.proto.

export type ObjectMeta = {
  id: string;
  name: string;
  workspace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  createdAtMs: number;
  resourceVersion: number;
  deletionTimestampMs?: number;
};

// openshell.datamodel.v1.WorkspacePhase
export type WorkspacePhase = 'ACTIVE' | 'TERMINATING' | 'UNSPECIFIED';

export type Workspace = {
  metadata: ObjectMeta;
  phase: WorkspacePhase;
};

// openshell.v1.WorkspaceRole — USER or ADMIN. There is no role-update RPC;
// changing a role means remove + re-add.
export type WorkspaceRole = 'USER' | 'ADMIN';

export type WorkspaceMember = {
  metadata: ObjectMeta;
  principalSubject: string;
  role: WorkspaceRole | 'UNSPECIFIED';
};

// openshell.v1.SandboxPhase — the full lifecycle. There is no stopped or
// suspended state; a sandbox runs until deleted.
export type SandboxPhase =
  'PROVISIONING' | 'READY' | 'ERROR' | 'DELETING' | 'UNKNOWN' | 'UNSPECIFIED';

export type SandboxCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
};

export type SandboxStatus = {
  sandboxName?: string;
  agentPod?: string;
  conditions?: SandboxCondition[];
  phase: SandboxPhase;
  currentPolicyVersion: number;
};

// --- openshell.sandbox.v1.SandboxPolicy (protojson camelCase) ---

export type FilesystemPolicy = {
  includeWorkdir?: boolean;
  readOnly?: string[];
  readWrite?: string[];
};

export type LandlockPolicy = {
  compatibility?: string;
};

export type ProcessPolicy = {
  runAsUser?: string;
  runAsGroup?: string;
};

export type L7QueryMatcher = {
  glob?: string;
  any?: string[];
};

export type L7Allow = {
  method?: string;
  path?: string;
  command?: string;
  query?: Record<string, L7QueryMatcher>;
  operationType?: string;
  operationName?: string;
  fields?: string[];
};

export type L7Rule = {
  allow?: L7Allow;
};

export type L7DenyRule = Omit<L7Allow, never>;

export type NetworkEndpoint = {
  host?: string;
  port?: number;
  ports?: number[];
  protocol?: string;
  tls?: string;
  enforcement?: string;
  access?: string;
  rules?: L7Rule[];
  denyRules?: L7DenyRule[];
  allowedIps?: string[];
  path?: string;
  advisorProposed?: boolean;
};

export type NetworkBinary = {
  path?: string;
};

export type NetworkPolicyRule = {
  name?: string;
  endpoints?: NetworkEndpoint[];
  binaries?: NetworkBinary[];
};

export type SandboxPolicy = {
  version?: number;
  filesystem?: FilesystemPolicy;
  landlock?: LandlockPolicy;
  process?: ProcessPolicy;
  networkPolicies?: Record<string, NetworkPolicyRule>;
};

// --- Sandbox ---

export type SandboxSpec = {
  logLevel?: string;
  environment?: Record<string, string>;
  image?: string;
  providers?: string[];
  policy?: SandboxPolicy;
};

export type Sandbox = {
  metadata: ObjectMeta;
  spec: SandboxSpec;
  status: SandboxStatus;
};

export type CreateSandboxRequest = {
  name?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  image: string;
  logLevel?: string;
  environment?: Record<string, string>;
  providers?: string[];
  // GPU request via ResourceRequirements.gpu; omit for none.
  gpuCount?: number;
  // K8s-style quantities applied as template resource limits.
  cpu?: string;
  memory?: string;
  // Required — SandboxSpec.policy is a required field on CreateSandbox.
  policy: SandboxPolicy;
};

// --- Providers ---

// openshell.datamodel.v1.Provider as returned by the BFF. Credential values
// are secret and never serialized — only key names.
export type Provider = {
  metadata: ObjectMeta;
  type: string;
  config?: Record<string, string>;
  credentialNames?: string[];
  credentialExpiresAtMs?: Record<string, number>;
  profileWorkspace?: string;
};

export type CreateProviderRequest = {
  name: string;
  type: string;
  credentials?: Record<string, string>;
  config?: Record<string, string>;
  labels?: Record<string, string>;
};

// openshell.v1.ProviderProfileCategory
export type ProviderProfileCategory =
  | 'OTHER'
  | 'INFERENCE'
  | 'AGENT'
  | 'SOURCE_CONTROL'
  | 'MESSAGING'
  | 'DATA'
  | 'KNOWLEDGE'
  | 'UNSPECIFIED';

export type ProfileCredential = {
  name: string;
  description?: string;
  envVars?: string[];
  required: boolean;
  authStyle?: string;
};

export type ProviderProfile = {
  id: string;
  displayName: string;
  description?: string;
  category: ProviderProfileCategory;
  credentials: ProfileCredential[];
  // host:port summaries of the profile's network endpoints.
  endpoints?: string[];
  inferenceCapable: boolean;
  source?: string;
  scope?: string;
  resourceVersion: number;
};

export type ProfileEndpoint = {
  host: string;
  port?: number;
};

export type ImportProfileRequest = {
  id: string;
  displayName: string;
  description?: string;
  category: ProviderProfileCategory;
  credentials?: ProfileCredentialInput[];
  endpoints?: ProfileEndpoint[];
  inferenceCapable: boolean;
  resourceVersion?: number;
};

export type ProfileCredentialInput = {
  name: string;
  description?: string;
  envVars?: string[];
  required: boolean;
  authStyle?: string;
};

export type ProfileDiagnostic = {
  source?: string;
  profileId?: string;
  field?: string;
  message: string;
  severity?: string;
};

export type ImportProfilesResponse = {
  diagnostics?: ProfileDiagnostic[];
  profiles: ProviderProfile[];
  imported: boolean;
};

export type UpdateProfileResponse = {
  diagnostics?: ProfileDiagnostic[];
  profile?: ProviderProfile;
  updated: boolean;
};

export type LintProfilesResponse = {
  diagnostics?: ProfileDiagnostic[];
  valid: boolean;
};

// --- Credential refresh ---

export type RefreshStrategy =
  | 'oauth2-refresh-token'
  | 'oauth2-client-credentials'
  | 'google-service-account-jwt'
  | 'aws-sts-assume-role'
  | 'static'
  | 'external';

export type ConfigureProviderRefreshRequest = {
  credentialKey: string;
  strategy: RefreshStrategy;
  material?: Record<string, string>;
  secretMaterialKeys?: string[];
  expiresAtMs?: number;
};

export type CredentialRefreshStatus = {
  credentialKey: string;
  strategy: string;
  status: string;
  expiresAtMs?: number;
  nextRefreshAtMs?: number;
  lastRefreshAtMs?: number;
  lastError?: string;
};

// --- Gateway ---

export type ServiceStatus =
  'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNSPECIFIED';

export type ComputeDriver = {
  name: string;
  driverName?: string;
  driverVersion?: string;
};

// openshell.v1.GetGatewayInfoResponse — status, version, and compute drivers
// are everything the gateway exposes about itself.
export type GatewayInfo = {
  status: ServiceStatus;
  gatewayVersion: string;
  computeDrivers: ComputeDriver[];
};

// --- Auth / misc ---

export type DeploymentContext = 'standalone' | 'managed' | 'openshift';

export type FeatureFlags = {
  terminal: boolean;
  fileTransfer: boolean;
  settings: boolean;
  globalPolicy: boolean;
  credentialRefresh: boolean;
  services: boolean;
  draftPolicy: boolean;
  deploymentContext: DeploymentContext;
  workspaceBinding: boolean;
  resourceLinks: boolean;
};

export type AuthConfig = {
  authDisabled: boolean;
  adminRole?: string;
  logoutUrl?: string;
  features: FeatureFlags;
};

export type CurrentUser = {
  subject: string;
  displayName?: string;
  email?: string;
  roles: string[];
  scopes?: string[];
  identityProvider?: string;
};

export type CreateWorkspaceRequest = {
  name: string;
  labels?: Record<string, string>;
};

export type AddMemberRequest = {
  principalSubject: string;
  role: WorkspaceRole;
};

// --- Logs (SandboxLogLine) ---

export type LogLine = {
  sandboxId?: string;
  timestampMs: number;
  level?: string;
  target?: string;
  message: string;
  // "gateway" or "sandbox".
  source?: string;
  // Structured decision context (dst_host, action, …) — the dashboard's only
  // window into security decisions; there is no events API.
  fields?: Record<string, string>;
};

export type SandboxLogs = {
  logs: LogLine[];
  bufferTotal: number;
};

// --- Policy revisions (SandboxPolicyRevision) ---

export type PolicyStatus =
  'PENDING' | 'LOADED' | 'FAILED' | 'SUPERSEDED' | 'UNSPECIFIED';

export type PolicyRevision = {
  version: number;
  policyHash?: string;
  status: PolicyStatus;
  loadError?: string;
  createdAtMs: number;
  loadedAtMs?: number;
  policy?: SandboxPolicy;
  provenance?: Record<string, string>;
};

export type SandboxPolicyView = {
  activeVersion: number;
  latest?: PolicyRevision;
  revisions: PolicyRevision[];
};

export type PolicyUpdateResult = {
  version: number;
  policyHash?: string;
};

// --- Draft policy advisor (PolicyChunk) ---

export type PolicyChunk = {
  id: string;
  // "pending", "approved", or "rejected".
  status: string;
  ruleName?: string;
  proposedRule?: NetworkPolicyRule;
  rationale?: string;
  securityNotes?: string;
  confidence: number;
  createdAtMs: number;
  decidedAtMs?: number;
  hitCount: number;
  binary?: string;
  // Gateway prover verdict — there is no separate verify RPC.
  validationResult?: string;
  rejectionReason?: string;
};

export type DraftPolicy = {
  chunks: PolicyChunk[];
  rollingSummary?: string;
  draftVersion: number;
  lastAnalyzedAtMs?: number;
};

export type DraftHistoryEntry = {
  timestampMs: number;
  eventType: string;
  description: string;
  chunkId?: string;
};

export type DraftSandboxSummary = {
  workspace: string;
  sandboxName: string;
  pendingCount: number;
  hasSecurityFlags: boolean;
  latestDraftMs: number;
};

export type DraftSummary = {
  sandboxes: DraftSandboxSummary[];
  totalPending: number;
};

// --- Inference routes ---

export type InferenceRoute = {
  // "" = user-facing inference.local; "sandbox-system" = system route.
  routeName: string;
  providerName: string;
  modelId: string;
  version: number;
  timeoutSecs: number;
};

export type SetInferenceRouteRequest = {
  routeName?: string;
  providerName: string;
  modelId: string;
  timeoutSecs?: number;
  noVerify?: boolean;
};

// --- Service endpoints ---

export type ServiceEndpoint = {
  sandboxName: string;
  serviceName: string;
  targetPort: number;
  domain: boolean;
  url?: string;
};

export type ExposeServiceRequest = {
  service: string;
  targetPort: number;
  domain?: boolean;
};

// --- Gateway settings ---

export type SettingEntry = { key: string; value: string };

export type GatewaySettings = {
  settings: SettingEntry[];
  settingsRevision: number;
};

export type LogFilters = {
  lines?: number;
  sinceMs?: number;
  sources?: string[];
  level?: string;
};

export type { CredentialInputSlot, ModelPickerSlot } from '../slots/types';
