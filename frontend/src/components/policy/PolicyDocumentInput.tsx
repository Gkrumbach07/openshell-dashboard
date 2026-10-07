import React, { useMemo, useState } from 'react';
import { Content, Flex, FlexItem } from '@patternfly/react-core';
import { CodeEditor, Language } from '@patternfly/react-code-editor';

import { policyToText } from '../../utils/policyFile';
import type { PolicyFileFormat } from '../../utils/policyFile';
import type { PolicyTextState } from '../../hooks/usePolicyText';
import PolicyFormatToggle, { POLICY_FORMAT_NOTE } from './PolicyFormatToggle';

type PolicyDocumentInputProps = {
  // The document being edited, in whichever of the two formats it is in.
  text: string;
  onChange: (text: string) => void;
  // What reading `text` gives (usePolicyText). The caller needs it to decide
  // whether the document can be sent, and it is read once.
  reading: PolicyTextState;
  height: string;
  // The id of the editor. The format choice is `<id>-format-yaml` and
  // `<id>-format-json`.
  'data-testid': string;
};

const LANGUAGE: Record<PolicyFileFormat, Language> = {
  yaml: Language.yaml,
  json: Language.json,
};

// A policy document to edit: typed, pasted, or loaded from a .yaml, .yml or
// .json file, as a YAML policy file or as the gateway's JSON. Which of the two
// it is follows from the text, so a file that is loaded is read as what it is
// whatever was there before. Choosing the other format rewrites the document
// in it, which it can only do for a document that reads as a policy.
const PolicyDocumentInput: React.FC<PolicyDocumentInputProps> = ({
  text,
  onChange,
  reading,
  height,
  'data-testid': testId,
}) => {
  // The format an empty document is taken to be in.
  const [preferred, setPreferred] = useState<PolicyFileFormat>(reading.format);
  const format = text.trim() ? reading.format : preferred;
  const other: PolicyFileFormat = format === 'yaml' ? 'json' : 'yaml';

  const converted = useMemo(
    () => (reading.parsed ? policyToText(reading.parsed, other) : undefined),
    [reading.parsed, other],
  );
  const cannotConvert = Boolean(text.trim()) && converted?.text === undefined;

  const choose = (next: PolicyFileFormat) => {
    if (converted?.text !== undefined) {
      onChange(converted.text);
    }
    setPreferred(next);
  };

  return (
    <>
      <Flex
        alignItems={{ default: 'alignItemsCenter' }}
        gap={{ default: 'gapMd' }}
        flexWrap={{ default: 'nowrap' }}
        className="pf-v6-u-mb-sm"
      >
        <FlexItem>
          <PolicyFormatToggle
            format={format}
            onChange={choose}
            disabledFormat={cannotConvert ? other : undefined}
            data-testid={`${testId}-format`}
          />
        </FlexItem>
        <FlexItem>
          <Content component="small" data-testid={`${testId}-format-note`}>
            {POLICY_FORMAT_NOTE[format]}
          </Content>
        </FlexItem>
      </Flex>
      <CodeEditor
        isLanguageLabelVisible
        isUploadEnabled
        isCopyEnabled
        uploadButtonToolTipText="Load a .yaml, .yml or .json file"
        emptyStateBody="Drag and drop a .yaml, .yml or .json policy file here, or upload one."
        code={text}
        // Not onChange: that one does not fire for a file that is loaded, and
        // the document that is sent has to be the one on screen.
        onCodeChange={onChange}
        language={LANGUAGE[format]}
        height={height}
        data-testid={testId}
      />
      {converted && converted.text === undefined && (
        <Content
          component="small"
          className="pf-v6-u-mt-sm"
          data-testid={`${testId}-format-blocked`}
        >
          This document cannot be shown as {other.toUpperCase()}:{' '}
          {converted.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join('; ')}
        </Content>
      )}
    </>
  );
};

export default PolicyDocumentInput;
