import { useMemo } from 'react';

import { policyTextFormat, readPolicyText } from '../utils/policyFile';
import type {
  PolicyFileDiagnostic,
  PolicyFileFormat,
} from '../utils/policyFile';
import type { SandboxPolicy } from '../types';

// What a text that is being typed, pasted or loaded as a policy comes to. It
// has the shape of useJsonValidation, which it stands in for wherever a policy
// used to be JSON only: an empty text is neither a policy nor an error.
export type PolicyTextState = {
  // Why the text is not a policy, one reason to a line.
  error: string | null;
  // The policy to send, in the shape the API takes.
  parsed: SandboxPolicy | null;
  // The syntax the text is in: what an editor highlights it as.
  format: PolicyFileFormat;
  diagnostics: PolicyFileDiagnostic[];
};

// usePolicyText reads a policy from whatever text it was given as: a policy
// file in YAML (what `openshell policy get --full` prints and `--policy`
// reads), the same file in JSON, or the policy as the gateway's API holds it.
export const usePolicyText = (text: string): PolicyTextState =>
  useMemo(() => {
    if (!text.trim()) {
      return {
        error: null,
        parsed: null,
        format: policyTextFormat(text),
        diagnostics: [],
      };
    }
    const { policy, format, diagnostics } = readPolicyText(text);
    return {
      error: policy
        ? null
        : diagnostics.map((diagnostic) => diagnostic.message).join('\n'),
      parsed: policy ?? null,
      format,
      diagnostics,
    };
  }, [text]);
