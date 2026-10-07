import {
  Checkbox,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextArea,
} from '@patternfly/react-core';

import type { SandboxLaunchOptions } from '../../hooks/useSandboxLaunchOptions';
import { isUnsplitCommand } from '../../utils/sandboxOptions';
import ApprovalModeField from './ApprovalModeField';
import ServiceExposureEditor from './ServiceExposureEditor';

type SandboxLaunchFieldsProps = {
  workspace: string;
  options: SandboxLaunchOptions;
  // Prefix for element ids and data-testids, so the two create forms differ.
  idPrefix: string;
};

// The fields both create forms share: what the sandbox runs, the services it
// exposes from the start, and how proposals from its agent are approved. They
// map onto `openshell sandbox create -- <command>`, `--tty`, `--expose` and
// `--approval-mode`.
const SandboxLaunchFields: React.FC<SandboxLaunchFieldsProps> = ({
  workspace,
  options,
  idPrefix,
}) => {
  const hasCommand = options.command.length > 0;
  const unsplit = isUnsplitCommand(options.command);

  return (
    <>
      <FormGroup label="Command" fieldId={`${idPrefix}-command`}>
        <TextArea
          id={`${idPrefix}-command`}
          data-testid={`${idPrefix}-command-input`}
          value={options.commandText}
          onChange={(_event, value) => options.setCommandText(value)}
          rows={3}
          resizeOrientation="vertical"
          className="pf-v6-u-font-family-monospace"
          placeholder={'sh\n-c\nexec sleep infinity'}
          validated={unsplit ? 'warning' : 'default'}
        />
        <FormHelperText>
          <HelperText>
            {unsplit ? (
              <HelperTextItem
                variant="warning"
                data-testid={`${idPrefix}-command-unsplit`}
              >
                This is one argument that contains spaces, and no shell splits
                it. Put each argument on a line of its own.
              </HelperTextItem>
            ) : (
              <HelperTextItem>
                The main process of the sandbox, one argument per line. No shell
                parses it; name a shell to use shell syntax. Leave empty to run
                the login shell of the image.
              </HelperTextItem>
            )}
          </HelperText>
        </FormHelperText>
        <Checkbox
          id={`${idPrefix}-tty`}
          data-testid={`${idPrefix}-tty`}
          label="Give the command a terminal (TTY)"
          isChecked={hasCommand && options.tty}
          isDisabled={!hasCommand}
          onChange={(_event, checked) => options.setTty(checked)}
          description={
            hasCommand
              ? undefined
              : 'Applies to a command. The default login shell always gets a terminal.'
          }
          className="pf-v6-u-mt-sm"
        />
      </FormGroup>
      <FormGroup
        label="Expose services"
        fieldId={`${idPrefix}-expose`}
        role="group"
      >
        <ServiceExposureEditor
          rows={options.exposureRows}
          onChange={options.setExposureRows}
          testIdPrefix={`${idPrefix}-expose`}
        />
        <FormHelperText>
          <HelperText>
            <HelperTextItem
              variant={options.exposureError ? 'error' : 'default'}
              data-testid={`${idPrefix}-expose-help`}
            >
              {options.exposureError ??
                'HTTP or WebSocket ports the sandbox serves on its loopback interface, exposed as it is created. A service without a name is the unnamed service of the sandbox. If a service cannot be exposed, the sandbox is not created.'}
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      </FormGroup>
      <ApprovalModeField
        workspace={workspace}
        id={`${idPrefix}-approval-mode`}
        value={options.approvalMode}
        onChange={options.setApprovalMode}
      />
    </>
  );
};

export default SandboxLaunchFields;
