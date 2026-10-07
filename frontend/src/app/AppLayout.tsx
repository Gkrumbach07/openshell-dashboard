import { useState } from 'react';
import { APP_VERSION } from '../constants';
import {
  AboutModal,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  MenuToggle,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  BarsIcon,
  MoonIcon,
  QuestionCircleIcon,
  SunIcon,
} from '@patternfly/react-icons';
import { Link, useLocation } from 'react-router-dom';

import openshellLogo from '~/assets/openshell-logo.svg';
import openshellLogoDark from '~/assets/openshell-logo-dark.svg';
import { useGatewayInfo } from '../api/gateway';
import { useCurrentUser, useFeatureFlags } from '../api/auth';
import { useUserRole } from '../api/rbac';
import CurrentUserModal from '../components/CurrentUserModal';
import GatewayCompatibilityAlert from '../components/GatewayCompatibilityAlert';
import GatewayStatusIndicator from '../components/GatewayStatusIndicator';
import RoleBadge from '../components/RoleBadge';
import { useI18n } from '../i18n';
import { logout } from './logout';
import { useTheme } from './theme';

type AppLayoutProps = {
  children: React.ReactNode;
};

type NavEntry = {
  path: string;
  labelKey:
    | 'nav.gateway'
    | 'nav.workspaces'
    | 'nav.allWorkspaces'
    | 'nav.providerProfiles'
    | 'nav.globalPolicy'
    | 'nav.settings';
  adminOnly?: boolean;
  featureKey?: keyof import('../types').FeatureFlags;
};

const navEntries: NavEntry[] = [
  { path: '/gateway', labelKey: 'nav.gateway', adminOnly: true },
  { path: '/workspaces', labelKey: 'nav.workspaces' },
  { path: '/all-workspaces', labelKey: 'nav.allWorkspaces', adminOnly: true },
  {
    path: '/provider-profiles',
    labelKey: 'nav.providerProfiles',
    adminOnly: true,
  },
  {
    path: '/global-policy',
    labelKey: 'nav.globalPolicy',
    adminOnly: true,
    featureKey: 'globalPolicy',
  },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    adminOnly: true,
    featureKey: 'settings',
  },
];

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { t } = useI18n('common');
  const location = useLocation();
  const user = useCurrentUser();
  const { isPlatformAdmin, isUser, isLoading: isRoleLoading } = useUserRole();
  const features = useFeatureFlags();
  const gateway = useGatewayInfo();
  const [isAboutOpen, setAboutOpen] = useState(false);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isUserOpen, setUserOpen] = useState(false);
  const [isIdentityOpen, setIdentityOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const logoSrc = theme === 'dark' ? openshellLogoDark : openshellLogo;

  const masthead = (
    <Masthead
      display={{ default: 'inline' }}
      className="pf-v6-u-align-items-center"
    >
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton variant="plain" aria-label={t('nav.global')}>
            <BarsIcon />
          </PageToggleButton>
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo
            component={(props) => (
              <Link
                {...props}
                to={isPlatformAdmin ? '/gateway' : '/workspaces'}
                className="pf-v6-u-text-decoration-none"
              />
            )}
          >
            <img
              src={logoSrc}
              alt={t('about.brandAlt')}
              style={{ height: 'var(--pf-t--global--spacer--2xl)' }}
            />
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight isStatic aria-label={t('header.actions')}>
          <ToolbarContent>
            <ToolbarItem align={{ default: 'alignEnd' }} alignSelf="center">
              <GatewayStatusIndicator />
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="plain"
                onClick={toggleTheme}
                aria-label={
                  theme === 'dark'
                    ? t('header.themeToLight')
                    : t('header.themeToDark')
                }
                data-testid="theme-toggle"
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Dropdown
                isOpen={isHelpOpen}
                onSelect={() => setHelpOpen(false)}
                onOpenChange={setHelpOpen}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    variant="plain"
                    onClick={() => setHelpOpen(!isHelpOpen)}
                    isExpanded={isHelpOpen}
                    aria-label={t('header.help')}
                    data-testid="help-menu"
                  >
                    <QuestionCircleIcon />
                  </MenuToggle>
                )}
                popperProps={{ position: 'end' }}
              >
                <DropdownList>
                  <DropdownItem
                    key="about"
                    onClick={() => setAboutOpen(true)}
                    data-testid="about-menu-item"
                  >
                    {t('header.about')}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
            {!isRoleLoading && (isPlatformAdmin || isUser) && (
              <ToolbarItem alignSelf="center">
                <RoleBadge
                  isPlatformAdmin={isPlatformAdmin}
                  isUser={isUser}
                  isLoading={isRoleLoading}
                />
              </ToolbarItem>
            )}
            <ToolbarItem>
              <Dropdown
                isOpen={isUserOpen}
                onSelect={() => setUserOpen(false)}
                onOpenChange={setUserOpen}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    onClick={() => setUserOpen(!isUserOpen)}
                    isExpanded={isUserOpen}
                    data-testid="current-user"
                  >
                    {user.data?.displayName ||
                      user.data?.subject ||
                      t('header.userFallback')}
                  </MenuToggle>
                )}
                popperProps={{ position: 'end' }}
              >
                <DropdownList>
                  {user.data?.subject && (
                    <DropdownItem
                      key="copy-subject"
                      onClick={() => {
                        navigator.clipboard.writeText(user.data!.subject);
                      }}
                      data-testid="copy-subject"
                    >
                      {t('header.copySubject')}
                    </DropdownItem>
                  )}
                  <DropdownItem
                    key="identity"
                    onClick={() => setIdentityOpen(true)}
                    data-testid="view-identity"
                  >
                    {t('header.identity')}
                  </DropdownItem>
                  <Divider key="divider" />
                  <DropdownItem
                    key="logout"
                    onClick={() => logout()}
                    data-testid="logout"
                  >
                    {t('header.logOut')}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  const sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <Nav aria-label={t('nav.primary')}>
          <NavList>
            {navEntries
              .filter(
                (e) =>
                  (!e.adminOnly || isPlatformAdmin) &&
                  (!e.featureKey || features[e.featureKey]),
              )
              .map((entry) => (
                <NavItem
                  key={entry.path}
                  itemId={entry.path}
                  to={entry.path}
                  isActive={location.pathname.startsWith(entry.path)}
                  component={(props) => <Link {...props} to={entry.path} />}
                >
                  {t(entry.labelKey)}
                </NavItem>
              ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page masthead={masthead} sidebar={sidebar} isManagedSidebar>
      {/* Above every route, so an unsupported gateway is explained on the
          same screen as the errors it causes, for every signed-in user. It
          lives here rather than in a page so that it stays mounted across
          navigation and is announced once, when it appears. The title is not
          a heading: it sits above each page's h1, where a heading would break
          the outline. Wrapped in a section only when shown. */}
      <GatewayCompatibilityAlert
        component="div"
        wrapper={(alert) => <PageSection>{alert}</PageSection>}
      />
      {children}
      <CurrentUserModal
        user={user.data}
        isOpen={isIdentityOpen}
        onClose={() => setIdentityOpen(false)}
      />
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setAboutOpen(false)}
        productName={t('about.productName')}
        trademark={t('about.trademark')}
        brandImageSrc={logoSrc}
        brandImageAlt={t('about.brandAlt')}
      >
        <Content>
          <DescriptionList
            isCompact
            isAutoFit
            autoFitMinModifier={{ default: '200px' }}
          >
            <DescriptionListGroup>
              <DescriptionListTerm>
                {t('about.dashboardVersion')}
              </DescriptionListTerm>
              <DescriptionListDescription>
                {APP_VERSION}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>
                {t('about.gatewayVersion')}
              </DescriptionListTerm>
              <DescriptionListDescription>
                {gateway.data?.gatewayVersion || t('about.unknown')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>
                {t('about.gatewayStatus')}
              </DescriptionListTerm>
              <DescriptionListDescription>
                {gateway.data?.status || t('about.unknown')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>
                {t('about.computeDriver')}
              </DescriptionListTerm>
              <DescriptionListDescription>
                {gateway.data?.computeDrivers?.[0]
                  ? `${gateway.data.computeDrivers[0].driverName} ${gateway.data.computeDrivers[0].driverVersion}`
                  : t('about.unknown')}
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        </Content>
      </AboutModal>
    </Page>
  );
};

export default AppLayout;
