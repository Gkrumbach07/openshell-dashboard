import React, { useRef, useState } from 'react';
import {
  FileUpload,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextArea,
} from '@patternfly/react-core';

type PolicyTextFieldProps = {
  // The id of the text area. The file control around it is `<id>-file`.
  id: string;
  // The test id of the text area. The file control is `<id>-file`.
  'data-testid': string;
  value: string;
  onChange: (text: string) => void;
  // Why the text is not a policy, one reason to a line (usePolicyText).
  error?: string | null;
};

// The files a policy is loaded from. A file is read as what its content is,
// not by its name; the names are what the file chooser offers.
const POLICY_FILE_TYPES = {
  'application/yaml': ['.yaml', '.yml'],
  'application/json': ['.json'],
};

// The policy of a sandbox that is about to be created, as text: typed, pasted
// over the preset, or loaded from a file. It takes a YAML policy file, the
// format `openshell sandbox create --policy` reads, as well as JSON.
const PolicyTextField: React.FC<PolicyTextFieldProps> = ({
  id,
  'data-testid': testId,
  value,
  onChange,
  error,
}) => {
  // The file the text came from. Its name is shown for as long as the text is
  // still that file's: a preset chosen afterwards, or an edit, is not it.
  const [loaded, setLoaded] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReading, setReading] = useState(false);
  // The file being read, between its being chosen and its text arriving.
  const pending = useRef<{ name: string; failed: boolean } | null>(null);

  const reasons = fileError ? [fileError] : (error?.split('\n') ?? []);

  return (
    <FormGroup label="Policy" isRequired fieldId={id}>
      <FileUpload
        id={`${id}-file`}
        type="text"
        hideDefaultPreview
        filename={loaded && loaded.text === value ? loaded.name : ''}
        filenamePlaceholder="Drag a .yaml, .yml or .json policy file here, or load one"
        browseButtonText="Load file"
        isLoading={isReading}
        isClearButtonDisabled={!value}
        // Told of every file that is chosen, one the control then refuses
        // included, so what a refusal said is not cleared from here.
        onFileInputChange={(_event, file) => {
          pending.current = { name: file.name, failed: false };
        }}
        onReadStarted={() => setReading(true)}
        onReadFinished={() => setReading(false)}
        onReadFailed={(_event, failure) => {
          if (pending.current) {
            pending.current.failed = true;
          }
          setFileError(`The file could not be read: ${failure.message}`);
        }}
        onDataChange={(_event, text) => {
          const file = pending.current;
          pending.current = null;
          // A file that could not be read leaves the text as it was.
          if (!file || file.failed) {
            return;
          }
          setLoaded({ name: file.name, text });
          setFileError(null);
          onChange(text);
        }}
        onClearClick={() => {
          setLoaded(null);
          setFileError(null);
          onChange('');
        }}
        dropzoneProps={{
          accept: POLICY_FILE_TYPES,
          onDropRejected: () =>
            setFileError('A policy file is a .yaml, .yml or .json file.'),
        }}
        data-testid={`${testId}-file`}
      >
        <TextArea
          id={id}
          data-testid={testId}
          aria-label="Policy"
          value={value}
          onChange={(_event, text) => {
            setFileError(null);
            onChange(text);
          }}
          rows={14}
          resizeOrientation="vertical"
          className="pf-v6-u-font-family-monospace"
          validated={reasons.length > 0 ? 'error' : 'default'}
        />
      </FileUpload>
      <FormHelperText>
        <HelperText data-testid={`${testId}-help`}>
          {reasons.length > 0 ? (
            reasons.map((reason) => (
              <HelperTextItem key={reason} variant="error">
                {reason}
              </HelperTextItem>
            ))
          ) : (
            <HelperTextItem>
              A policy file in YAML, the format `openshell sandbox create
              --policy` reads and `openshell policy get --full` prints, or the
              policy as JSON. Paste one over the preset, or load a .yaml, .yml
              or .json file. Network rules can be edited after create;
              filesystem, landlock, and process are immutable once created.
            </HelperTextItem>
          )}
        </HelperText>
      </FormHelperText>
    </FormGroup>
  );
};

export default PolicyTextField;
