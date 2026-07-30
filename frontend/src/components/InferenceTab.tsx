import { useState } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Spinner,
  TextInput,
} from '@patternfly/react-core';

import { useDeleteInferenceRoute, useInferenceRoute, useSetInferenceRoute } from '../api/inference';
import { useProviders } from '../api/providers';
import type { ApiError } from '../api/client';
import type { ModelPickerSlot } from '../types';

type InferenceTabProps = {
  workspace: string;
  renderModelPicker?: ModelPickerSlot;
};

const SYSTEM_ROUTE = 'sandbox-system';

const RouteCard: React.FC<{ workspace: string; route: string; title: string; note: string }> = ({
  workspace,
  route,
  title,
  note,
}) => {
  const query = useInferenceRoute(workspace, route);
  const deleteRoute = useDeleteInferenceRoute(workspace);
  const notConfigured = query.isError && (query.error as ApiError).status === 404;

  return (
    <Card data-testid={`inference-route-${route || 'user'}`}>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        <Content component="small">{note}</Content>
        {query.isLoading ? (
          <Spinner size="md" aria-label="Loading route" />
        ) : notConfigured ? (
          <Content component="p">Not configured</Content>
        ) : query.isError ? (
          <Alert
            variant="danger"
            isInline
            title="Failed to load route"
            actionLinks={<Button variant="link" onClick={() => query.refetch()}>Retry</Button>}
          >
            {(query.error as Error).message}
          </Alert>
        ) : (
          <>
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>Provider</DescriptionListTerm>
                <DescriptionListDescription>{query.data?.providerName}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Model</DescriptionListTerm>
                <DescriptionListDescription>{query.data?.modelId}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Timeout</DescriptionListTerm>
                <DescriptionListDescription>
                  {query.data?.timeoutSecs ? `${query.data.timeoutSecs}s` : 'default (60s)'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Version</DescriptionListTerm>
                <DescriptionListDescription>{query.data?.version}</DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
            <Button
              variant="link"
              isDanger
              isInline
              onClick={() => deleteRoute.mutate(route)}
              isDisabled={deleteRoute.isPending}
              data-testid={`delete-route-${route || 'user'}`}
            >
              Delete route
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
};

// Inference routing: all sandboxes in the workspace reach inference.local,
// and the gateway routes it to the configured provider/model.
const InferenceTab: React.FC<InferenceTabProps> = ({ workspace, renderModelPicker }) => {
  const providers = useProviders(workspace);
  const setRoute = useSetInferenceRoute(workspace);
  const [providerName, setProviderName] = useState('');
  const [modelId, setModelId] = useState('');
  const [timeoutSecs, setTimeoutSecs] = useState('');
  const [isSystem, setIsSystem] = useState(false);
  const [noVerify, setNoVerify] = useState(false);

  const submit = () => {
    setRoute.mutate(
      {
        routeName: isSystem ? SYSTEM_ROUTE : '',
        providerName,
        modelId,
        timeoutSecs: timeoutSecs ? Number(timeoutSecs) : undefined,
        noVerify,
      },
      {
        onSuccess: () => {
          setProviderName('');
          setModelId('');
          setTimeoutSecs('');
        },
      },
    );
  };

  return (
    <Grid hasGutter>
      <GridItem md={6}>
        <RouteCard
          workspace={workspace}
          route=""
          title="User route (inference.local)"
          note="Used by user code inside sandboxes."
        />
      </GridItem>
      <GridItem md={6}>
        <RouteCard
          workspace={workspace}
          route={SYSTEM_ROUTE}
          title="System route (sandbox-system)"
          note="Used by platform functions (agent harness); not accessible to user code."
        />
      </GridItem>
      <GridItem span={12}>
        <Card>
          <CardTitle>Set route</CardTitle>
          <CardBody>
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <FormGroup label="Provider" isRequired fieldId="inference-provider">
                <FormSelect
                  id="inference-provider"
                  data-testid="inference-provider-select"
                  value={providerName}
                  onChange={(_event, value) => setProviderName(value)}
                >
                  <FormSelectOption value="" label="Select a provider" isDisabled />
                  {(providers.data ?? []).map((provider) => (
                    <FormSelectOption
                      key={provider.metadata.name}
                      value={provider.metadata.name}
                      label={`${provider.metadata.name} (${provider.type})`}
                    />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Model" isRequired fieldId="inference-model">
                {renderModelPicker ? (
                  renderModelPicker(modelId, setModelId)
                ) : (
                  <TextInput
                    id="inference-model"
                    data-testid="inference-model-input"
                    isRequired
                    value={modelId}
                    onChange={(_event, value) => setModelId(value)}
                    placeholder="e.g. claude-sonnet-5"
                  />
                )}
              </FormGroup>
              <FormGroup label="Timeout (seconds)" fieldId="inference-timeout">
                <TextInput
                  id="inference-timeout"
                  data-testid="inference-timeout-input"
                  value={timeoutSecs}
                  onChange={(_event, value) => setTimeoutSecs(value)}
                  placeholder="0 = default (60s)"
                />
              </FormGroup>
              <FormGroup fieldId="inference-flags" role="group">
                <Checkbox
                  id="inference-system"
                  data-testid="inference-system-checkbox"
                  label="Configure the system route instead of the user route"
                  isChecked={isSystem}
                  onChange={(_event, checked) => setIsSystem(checked)}
                />
                <Checkbox
                  id="inference-no-verify"
                  data-testid="inference-no-verify-checkbox"
                  label="Skip endpoint verification before saving"
                  isChecked={noVerify}
                  onChange={(_event, checked) => setNoVerify(checked)}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      By default the gateway probes the provider endpoint before persisting the
                      route.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              {setRoute.isError && (
                <Alert variant="danger" isInline title="Failed to set route">
                  {(setRoute.error as Error).message}
                </Alert>
              )}
              <ActionGroup>
                <Button
                  variant="primary"
                  onClick={submit}
                  isDisabled={!providerName || !modelId || setRoute.isPending}
                  isLoading={setRoute.isPending}
                  data-testid="set-inference-route"
                >
                  Set route
                </Button>
              </ActionGroup>
            </Form>
          </CardBody>
        </Card>
      </GridItem>
    </Grid>
  );
};

export default InferenceTab;
