import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  LabelGroup,
  MenuToggle,
  Pagination,
  Spinner,
  Stack,
  StackItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import { EllipsisVIcon, PlusCircleIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import {
  deleteProvider,
  useProviderProfiles,
  useProviders,
} from '../api/providers';
import { useAlerts } from '../app/AlertContext';
import { useWorkspaceRole } from '../api/rbac';
import { useSlots } from '../slots';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import ProviderFormModal from '../components/provider/ProviderFormModal';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import { useBulkDelete } from '../hooks/useBulkDelete';
import { useListPage } from '../hooks/useListPage';
import { describeDeletions } from '../utils/deletion';
import { formatAge } from '../utils/formatters';
import { profileForProvider } from '../utils/providerProfiles';
import {
  credentialSummary,
  policySummary,
  profileLabel,
  providerCategoryLabel,
  unprofiledLabel,
} from '../utils/providerSummary';
import type { CredentialInputSlot } from '../types';

type ProviderListPageProps = {
  workspace: string;
  onSelect?: (name: string) => void;
  renderCredentialInput?: CredentialInputSlot;
};

// The providers of a workspace, each with what the profile its type resolves
// to says about it: the profile's name and category, how many of the
// credentials it requires the provider holds, and how much policy it carries.
// These are the PROFILE, CATEGORY, CREDS and POLICY columns of the OpenShell
// TUI's provider list.
const ProviderListPage: React.FC<ProviderListPageProps> = ({
  workspace,
  onSelect,
  renderCredentialInput,
}) => {
  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const providers = useProviders(workspace);
  const profiles = useProviderProfiles(workspace);
  const { addAlert } = useAlerts();
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const {
    page,
    setPage,
    perPage,
    onPerPageSelect,
    selected,
    numSelected,
    toggleAll,
    toggleOne,
    pageAllSelected,
    clearSelection,
    isActionsOpen,
    setActionsOpen,
    deleteTargets,
    setDeleteTargets,
    closeDeleteModal,
    deleteSelectedLabel,
    pageOf,
  } = useListPage();

  const bulkDelete = useBulkDelete(
    (name) => deleteProvider(workspace, name),
    ['providers', workspace],
  );

  if (providers.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading providers" />
      </Bullseye>
    );
  }

  // The list is polled. A refresh that fails leaves the providers that loaded
  // before on screen, with a note above them, and leaves a dialog that is
  // open over them as it was; only a list that never loaded takes the page.
  const refreshFailed = isRefreshError(providers);
  if (providers.isError && !refreshFailed) {
    return (
      <Alert
        variant="danger"
        title="Failed to load providers"
        actionLinks={
          <Button variant="link" onClick={() => providers.refetch()}>
            Retry
          </Button>
        }
      >
        {(providers.error as Error).message}
      </Alert>
    );
  }

  const allRows = providers.data ?? [];
  const totalCount = allRows.length;
  // A provider is unprofiled when the profiles were read and none matches its
  // type. Until they are read, or when they cannot be, the columns that come
  // from the profile say nothing rather than "unprofiled". Profiles read
  // earlier still stand when reading them again fails.
  const profilesKnown = profiles.data !== undefined;
  // The rows of the page that is shown. The list is polled and rows are
  // deleted, here and elsewhere, so the page that was chosen can cease to
  // exist and a selected provider can be gone: pageOf shows the last page
  // that has rows, and drops from the selection what is no longer listed.
  const pageRows = pageOf(allRows, (provider) => provider.metadata.name);
  const pageNames = pageRows.map((p) => p.metadata.name);
  // Each provider of the page with the profile its type resolves to, by the
  // scope the provider names: one id can be a workspace profile and a platform
  // profile at once.
  const rows = pageRows.map((provider) => ({
    provider,
    profile: profileForProvider(profiles.data ?? [], provider),
    storedKeys: provider.credentialNames ?? [],
  }));

  // One return for the empty list and the table. The dialogs sit after
  // whichever of the two is shown, at the same place among their siblings, so
  // React keeps them, and what was typed in them, when a poll takes the list
  // from empty to not empty or back.
  return (
    <>
      {refreshFailed && (
        <RefreshErrorAlert
          title="The provider list could not be refreshed"
          staleNote="The providers shown were loaded earlier and may be out of date."
          error={providers.error}
          onRetry={() => providers.refetch()}
          className="pf-v6-u-mb-md"
          data-testid="providers-refresh-error"
        />
      )}
      {totalCount === 0 ? (
        <EmptyState variant="lg" titleText="No providers" icon={PlusCircleIcon}>
          <EmptyStateBody>
            Providers register inference endpoints and service credentials
            (Anthropic, NVIDIA NIM, GitLab, ...) that sandboxes can use.
          </EmptyStateBody>
          {isWorkspaceAdmin && (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  onClick={() => setCreateOpen(true)}
                  data-testid="create-provider-empty"
                >
                  Add provider
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          )}
        </EmptyState>
      ) : (
        <>
          <Toolbar aria-label="Provider actions">
            <ToolbarContent>
              {isWorkspaceAdmin && (
                <ToolbarItem>
                  <Button
                    onClick={() => setCreateOpen(true)}
                    data-testid="create-provider"
                  >
                    Add provider
                  </Button>
                </ToolbarItem>
              )}
              {isWorkspaceAdmin && (
                <ToolbarItem>
                  <Dropdown
                    isOpen={isActionsOpen}
                    onOpenChange={setActionsOpen}
                    onSelect={() => setActionsOpen(false)}
                    toggle={(toggleRef) => (
                      <MenuToggle
                        ref={toggleRef}
                        variant="plain"
                        onClick={() => setActionsOpen((prev) => !prev)}
                        isExpanded={isActionsOpen}
                        aria-label="Actions"
                        data-testid="provider-actions-kebab"
                      >
                        <EllipsisVIcon />
                      </MenuToggle>
                    )}
                  >
                    <DropdownList>
                      <DropdownItem
                        key="delete-selected"
                        isDisabled={numSelected === 0}
                        onClick={() => setDeleteTargets(selected)}
                        data-testid="delete-selected-providers"
                      >
                        {deleteSelectedLabel}
                      </DropdownItem>
                    </DropdownList>
                  </Dropdown>
                </ToolbarItem>
              )}
              <ToolbarItem align={{ default: 'alignEnd' }}>
                <Pagination
                  itemCount={totalCount}
                  perPage={perPage}
                  page={page}
                  onSetPage={(_event, p) => setPage(p)}
                  onPerPageSelect={(_event, pp) => onPerPageSelect(pp)}
                  isCompact
                />
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
          {profiles.isError && !profilesKnown && (
            <Alert
              variant="warning"
              isInline
              title="Provider profiles could not be loaded"
              data-testid="provider-profiles-unavailable"
              actionLinks={
                <Button variant="link" onClick={() => profiles.refetch()}>
                  Retry
                </Button>
              }
            >
              The profile, category and policy of each provider are not shown:{' '}
              {(profiles.error as Error).message}
            </Alert>
          )}
          <Table aria-label="Providers" data-testid="provider-table">
            <Thead>
              <Tr>
                {isWorkspaceAdmin && (
                  <Th
                    select={{
                      onSelect: (_event, isSelecting) =>
                        toggleAll(pageNames, isSelecting),
                      isSelected: pageAllSelected(pageNames),
                    }}
                    aria-label="Select all providers"
                  />
                )}
                <Th>Name</Th>
                <Th>Profile</Th>
                <Th>Category</Th>
                <Th>Credentials</Th>
                <Th>Policy</Th>
                <Th>Config</Th>
                <Th>Age</Th>
                {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map(({ provider, profile, storedKeys }, rowIndex) => (
                <Tr key={provider.metadata.name}>
                  {isWorkspaceAdmin && (
                    <Td
                      select={{
                        rowIndex,
                        onSelect: (_event, isSelecting) =>
                          toggleOne(provider.metadata.name, isSelecting),
                        isSelected: selected.includes(provider.metadata.name),
                      }}
                    />
                  )}
                  <Td dataLabel="Name" modifier="truncate">
                    <Tooltip content={provider.metadata.name}>
                      <Button
                        variant="link"
                        isInline
                        onClick={() => onSelect?.(provider.metadata.name)}
                        data-testid={`provider-link-${provider.metadata.name}`}
                      >
                        {provider.metadata.name}
                      </Button>
                    </Tooltip>
                  </Td>
                  <Td
                    dataLabel="Profile"
                    data-testid={`provider-profile-${provider.metadata.name}`}
                  >
                    {profile || !profilesKnown ? (
                      <>
                        {profile && `${profileLabel(profile)} `}
                        <Label color="purple" isCompact={!!profile}>
                          {provider.type}
                        </Label>
                      </>
                    ) : (
                      <Label status="warning">
                        {unprofiledLabel(provider.type)}
                      </Label>
                    )}
                  </Td>
                  <Td
                    dataLabel="Category"
                    data-testid={`provider-category-${provider.metadata.name}`}
                  >
                    {profilesKnown ? providerCategoryLabel(profile) : '-'}
                  </Td>
                  <Td
                    dataLabel="Credentials"
                    data-testid={`provider-credentials-${provider.metadata.name}`}
                  >
                    <Stack>
                      <StackItem>
                        {credentialSummary(
                          profilesKnown ? profile : undefined,
                          storedKeys,
                        )}
                      </StackItem>
                      {storedKeys.length > 0 && (
                        <StackItem>
                          <LabelGroup>
                            {storedKeys.map((name) => (
                              <Label key={name} color="grey" isCompact>
                                {name}
                              </Label>
                            ))}
                          </LabelGroup>
                        </StackItem>
                      )}
                    </Stack>
                  </Td>
                  <Td
                    dataLabel="Policy"
                    data-testid={`provider-policy-${provider.metadata.name}`}
                  >
                    {profilesKnown ? policySummary(profile) : '-'}
                  </Td>
                  <Td dataLabel="Config">
                    {Object.keys(provider.config ?? {}).length > 0 ? (
                      <LabelGroup>
                        {Object.keys(provider.config ?? {})
                          .sort()
                          .map((key) => (
                            <Label key={key} color="grey" isCompact>
                              {key}
                            </Label>
                          ))}
                      </LabelGroup>
                    ) : (
                      '-'
                    )}
                  </Td>
                  <Td dataLabel="Age">
                    {formatAge(provider.metadata.createdAtMs)}
                  </Td>
                  {isWorkspaceAdmin && (
                    <Td isActionCell>
                      <ActionsColumn
                        items={[
                          {
                            title: 'Delete',
                            onClick: () =>
                              setDeleteTargets([provider.metadata.name]),
                          },
                        ]}
                      />
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        </>
      )}
      <ProviderFormModal
        mode="create"
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
        renderCredentialInput={resolvedCredentialInput}
      />
      <ConfirmDeleteModal
        title={
          deleteTargets && deleteTargets.length > 1
            ? 'Delete providers?'
            : 'Delete provider?'
        }
        body={
          deleteTargets && deleteTargets.length > 1
            ? `${deleteTargets.length} providers will be deleted. Sandboxes using them lose access to their credentials.`
            : `Provider "${deleteTargets?.[0] ?? ''}" will be deleted. Sandboxes using it lose access to its credentials.`
        }
        confirmName={deleteTargets?.length === 1 ? deleteTargets[0] : undefined}
        isOpen={deleteTargets !== null}
        isDeleting={bulkDelete.isDeleting}
        error={bulkDelete.error}
        onConfirm={() => {
          if (deleteTargets) {
            bulkDelete.run(deleteTargets, (outcomes) => {
              // What the gateway answered for each provider, not "deleted"
              // whatever it said.
              const notice = describeDeletions(
                { singular: 'provider', plural: 'providers' },
                deleteTargets,
                outcomes,
              );
              addAlert(notice.title, notice.variant);
              clearSelection();
              closeDeleteModal();
            });
          }
        }}
        onCancel={() => {
          bulkDelete.clearError();
          closeDeleteModal();
        }}
      />
    </>
  );
};

export default ProviderListPage;
