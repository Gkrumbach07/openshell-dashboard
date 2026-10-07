import {
  CodeBlock,
  CodeBlockCode,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
} from '@patternfly/react-core';

import LabelsList from '../LabelsList';
import {
  formatCommand,
  formatGpuRequest,
  sandboxResourceQuantities,
  userAnnotations,
} from '../../utils/sandboxOptions';
import type { Sandbox } from '../../types';

type SandboxSpecDetailsProps = {
  sandbox: Sandbox;
};

type RowProps = {
  term: string;
  testId: string;
  children: React.ReactNode;
};

const Row: React.FC<RowProps> = ({ term, testId, children }) => (
  <DescriptionListGroup>
    <DescriptionListTerm>{term}</DescriptionListTerm>
    <DescriptionListDescription data-testid={testId}>
      {children}
    </DescriptionListDescription>
  </DescriptionListGroup>
);

// What a sandbox was created with, as rows for the description list of the
// Details card: the workload template it came from, what it runs, its CPU,
// memory and GPU, its environment and annotations, and the rarer fields of its
// compute template when they are set.
const SandboxSpecDetails: React.FC<SandboxSpecDetailsProps> = ({ sandbox }) => {
  const { spec, metadata, createdFromWorkloadTemplate: from } = sandbox;
  const template = spec.template;
  const resources = sandboxResourceQuantities(spec);
  const command = spec.command ?? [];

  return (
    <>
      {from && (
        <Row term="Workload template" testId="sandbox-workload-template">
          {from.name}
          {from.resourceVersion ? ` (revision ${from.resourceVersion})` : ''}
        </Row>
      )}
      <Row term="Command" testId="sandbox-command">
        {command.length > 0 ? (
          <span className="pf-v6-u-font-family-monospace">
            {formatCommand(command)}
          </span>
        ) : (
          'Login shell of the image'
        )}
      </Row>
      <Row term="Terminal (TTY)" testId="sandbox-tty">
        {spec.tty ? 'Yes' : 'No'}
      </Row>
      <Row term="CPU limit" testId="sandbox-cpu-limit">
        {resources.cpuLimit ?? '-'}
      </Row>
      <Row term="Memory limit" testId="sandbox-memory-limit">
        {resources.memoryLimit ?? '-'}
      </Row>
      {resources.cpuRequest && (
        <Row term="CPU request" testId="sandbox-cpu-request">
          {resources.cpuRequest}
        </Row>
      )}
      {resources.memoryRequest && (
        <Row term="Memory request" testId="sandbox-memory-request">
          {resources.memoryRequest}
        </Row>
      )}
      <Row term="GPU" testId="sandbox-gpu">
        {formatGpuRequest(spec)}
      </Row>
      <Row term="Environment" testId="sandbox-environment">
        <LabelsList labels={spec.environment} />
      </Row>
      <Row term="Annotations" testId="sandbox-annotations">
        <LabelsList labels={userAnnotations(metadata.annotations)} />
      </Row>
      {spec.logLevel && (
        <Row term="Log level" testId="sandbox-log-level">
          {spec.logLevel}
        </Row>
      )}
      {template?.runtimeClassName && (
        <Row term="Runtime class" testId="sandbox-runtime-class">
          {template.runtimeClassName}
        </Row>
      )}
      {template?.userNamespaces !== undefined && (
        <Row term="User namespaces" testId="sandbox-user-namespaces">
          {template.userNamespaces ? 'Enabled' : 'Disabled'}
        </Row>
      )}
      {template?.environment && (
        <Row term="Template environment" testId="sandbox-template-environment">
          <LabelsList labels={template.environment} />
        </Row>
      )}
      {template?.labels && (
        <Row term="Template labels" testId="sandbox-template-labels">
          <LabelsList labels={template.labels} />
        </Row>
      )}
      {template?.annotations && (
        <Row term="Template annotations" testId="sandbox-template-annotations">
          <LabelsList labels={template.annotations} />
        </Row>
      )}
      {template?.driverConfig && (
        <Row term="Driver config" testId="sandbox-driver-config">
          <CodeBlock>
            <CodeBlockCode>
              {JSON.stringify(template.driverConfig, null, 2)}
            </CodeBlockCode>
          </CodeBlock>
        </Row>
      )}
    </>
  );
};

export default SandboxSpecDetails;
