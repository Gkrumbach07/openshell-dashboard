import {
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Title,
} from '@patternfly/react-core';
import type { LabelProps } from '@patternfly/react-core';

import { formatTimestamp } from '../utils/formatters';
import { logLevelOf, shownLogFields } from '../utils/logLines';
import type { LogLine } from '../types';

type LogLineDetailModalProps = {
  // The line to show. The dialog is closed while there is none.
  line?: LogLine;
  // The number the log viewer shows in front of the line, and how many lines
  // there are to step through.
  lineNumber?: number;
  lineCount?: number;
  // Step to the line before or after this one. Left out at either end.
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
};

// ERROR, WARN and INFO are coloured as in the log itself.
const levelColor = (level: string): LabelProps['color'] => {
  switch (level) {
    case 'ERROR':
      return 'red';
    case 'WARN':
      return 'yellow';
    case 'INFO':
      return 'green';
    default:
      return 'grey';
  }
};

// Everything one log line carries, each part on its own: the detail view the
// upstream TUI opens with Enter on a line. A row of the log shows the same in
// one line, where a long command line or ancestry runs off the side.
//
// The fields are in the order the row has them, and one without a value is
// left out, as in the row.
const LogLineDetailModal: React.FC<LogLineDetailModalProps> = ({
  line,
  lineNumber,
  lineCount,
  onPrevious,
  onNext,
  onClose,
}) => {
  const level = line ? logLevelOf(line) : '';
  const fields = line ? shownLogFields(line) : [];
  // The TUI lists the fields whenever a line has any, even when none of them
  // has a value to show.
  const hasFields = Object.keys(line?.fields ?? {}).length > 0;

  return (
    <Modal
      variant="medium"
      isOpen={line !== undefined}
      onClose={onClose}
      aria-label="Log line details"
      data-testid="log-line-detail"
    >
      <ModalHeader
        title="Log line details"
        description={
          lineNumber !== undefined && lineCount !== undefined
            ? `Line ${lineNumber} of ${lineCount}`
            : undefined
        }
      />
      <ModalBody>
        {line && (
          <>
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>Time</DescriptionListTerm>
                <DescriptionListDescription data-testid="log-detail-time">
                  {formatTimestamp(line.timestampMs)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Source</DescriptionListTerm>
                <DescriptionListDescription data-testid="log-detail-source">
                  {line.source || '-'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Level</DescriptionListTerm>
                <DescriptionListDescription data-testid="log-detail-level">
                  <Label isCompact color={levelColor(level)}>
                    {level}
                  </Label>
                </DescriptionListDescription>
              </DescriptionListGroup>
              {line.target && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Target</DescriptionListTerm>
                  <DescriptionListDescription
                    className="pf-v6-u-font-family-monospace pf-v6-u-text-break-word"
                    data-testid="log-detail-target"
                  >
                    {line.target}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
              <DescriptionListGroup>
                <DescriptionListTerm>Message</DescriptionListTerm>
                <DescriptionListDescription
                  className="pf-v6-u-font-family-monospace pf-v6-u-text-break-word"
                  data-testid="log-detail-message"
                >
                  {line.message.split('\n').map((part, index) => (
                    <div key={index}>{part}</div>
                  ))}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
            {hasFields && (
              <>
                <Title
                  headingLevel="h2"
                  size="md"
                  className="pf-v6-u-mt-lg pf-v6-u-mb-sm"
                >
                  Fields
                </Title>
                <DescriptionList
                  isHorizontal
                  isCompact
                  aria-label="Fields"
                  data-testid="log-detail-fields"
                >
                  {fields.map(([key, value]) => (
                    <DescriptionListGroup key={key}>
                      <DescriptionListTerm>{key}</DescriptionListTerm>
                      <DescriptionListDescription className="pf-v6-u-font-family-monospace pf-v6-u-text-break-word">
                        {value}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  ))}
                </DescriptionList>
              </>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={onClose}
          data-testid="log-detail-close"
        >
          Close
        </Button>
        <Button
          variant="secondary"
          onClick={onPrevious}
          isDisabled={!onPrevious}
          data-testid="log-detail-previous"
        >
          Previous line
        </Button>
        <Button
          variant="secondary"
          onClick={onNext}
          isDisabled={!onNext}
          data-testid="log-detail-next"
        >
          Next line
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default LogLineDetailModal;
