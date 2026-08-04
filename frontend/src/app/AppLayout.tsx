import { useState } from 'react';
import { APP_VERSION } from '../constants';
import {
  AboutModal,
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
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { BarsIcon, QuestionCircleIcon } from '@patternfly/react-icons';
import { Link, useLocation } from 'react-router-dom';

import openshellLogo from '~/assets/openshell-logo.svg';
import { useGatewayInfo } from '../api/gateway';
import { useCurrentUser, useFeatureFlags } from '../api/auth';
import { useUserRole } from '../api/rbac';
import { logout } from './logout';

type AppLayoutProps = {
  children: React.ReactNode;
};

type NavEntry = {
  path: string;
  label: string;
  adminOnly?: boolean;
  featureKey?: keyof import('../types').FeatureFlags;
};

const navEntries: NavEntry[] = [
  { path: '/gateway', label: 'Gateway', adminOnly: true },
  { path: '/workspaces', label: 'Workspaces' },
  {
    path: '/global-policy',
    label: 'Global policy',
    adminOnly: true,
    featureKey: 'globalPolicy',
  },
  {
    path: '/settings',
    label: 'Settings',
    adminOnly: true,
    featureKey: 'settings',
  },
];

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const location = useLocation();
  const user = useCurrentUser();
  const { isPlatformAdmin } = useUserRole();
  const features = useFeatureFlags();
  const gateway = useGatewayInfo();
  const [isAboutOpen, setAboutOpen] = useState(false);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isUserOpen, setUserOpen] = useState(false);

  const masthead = (
    <Masthead
      display={{ default: 'inline' }}
      className="pf-v6-u-align-items-center"
    >
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton variant="plain" aria-label="Global navigation">
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
              src={openshellLogo}
              alt="OpenShell Dashboard"
              style={{ height: 'var(--pf-t--global--spacer--2xl)' }}
            />
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight isStatic aria-label="Header actions">
          <ToolbarContent>
            <ToolbarItem align={{ default: 'alignEnd' }}>
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
                    aria-label="Help"
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
                    About
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
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
                    {user.data?.displayName || user.data?.subject || 'User'}
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
                      Copy my subject ID
                    </DropdownItem>
                  )}
                  <Divider key="divider" />
                  <DropdownItem
                    key="logout"
                    onClick={() => logout()}
                    data-testid="logout"
                  >
                    Log out
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
        <Nav aria-label="Primary navigation">
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
                  {entry.label}
                </NavItem>
              ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page masthead={masthead} sidebar={sidebar} isManagedSidebar>
      {children}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setAboutOpen(false)}
        productName="OpenShell Dashboard"
        trademark="Apache-2.0 license."
        brandImageSrc={openshellLogo}
        brandImageAlt="OpenShell Dashboard"
      >
        <Content>
          <DescriptionList isCompact>
            <DescriptionListGroup>
              <DescriptionListTerm>Dashboard version</DescriptionListTerm>
              <DescriptionListDescription>
                {APP_VERSION}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Gateway version</DescriptionListTerm>
              <DescriptionListDescription>
                {gateway.data?.gatewayVersion || 'Unknown'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Gateway status</DescriptionListTerm>
              <DescriptionListDescription>
                {gateway.data?.status || 'Unknown'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Compute driver</DescriptionListTerm>
              <DescriptionListDescription>
                {gateway.data?.computeDrivers?.[0]
                  ? `${gateway.data.computeDrivers[0].driverName} ${gateway.data.computeDrivers[0].driverVersion}`
                  : 'Unknown'}
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        </Content>
      </AboutModal>
    </Page>
  );
};

export default AppLayout;
