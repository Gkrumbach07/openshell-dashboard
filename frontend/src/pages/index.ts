// Barrel for downstream consumers (package.json "./pages" export). Each page
// is self-contained: takes props, fetches via internal API hooks, renders
// pure PatternFly — no external context required.
export { default as LoginPage } from './LoginPage';
export { default as GatewayOverviewPage } from './GatewayOverviewPage';
export { default as WorkspaceListPage } from './WorkspaceListPage';
export { default as WorkspaceDetailPage } from './WorkspaceDetailPage';
export { default as SandboxListPage } from './SandboxListPage';
export { default as SandboxDetailPage } from './SandboxDetailPage';
export { default as ProviderListPage } from './ProviderListPage';
export { default as ProviderDetailPage } from './ProviderDetailPage';
export { default as MemberListPage } from './MemberListPage';
export { default as GlobalPolicyPage } from './GlobalPolicyPage';
export { default as SettingsPage } from './SettingsPage';
