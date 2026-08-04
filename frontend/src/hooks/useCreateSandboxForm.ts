import { useMemo, useState, useCallback } from 'react';

import { COMMUNITY_REGISTRY } from '../constants';
import { useJsonValidation } from './useJsonValidation';
import { policyTemplates } from '../components/policy/policyTemplates';
import type { SandboxPolicy } from '../types';

export const resolveImage = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed && !trimmed.includes('/') && !trimmed.includes(':')) {
    return `${COMMUNITY_REGISTRY}/${trimmed}:latest`;
  }
  return trimmed;
};

export const parseLabels = (raw: string): Record<string, string> | null => {
  const labels: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) {
    return labels;
  }
  for (const pair of trimmed.split(',')) {
    const [key, ...rest] = pair.split('=');
    if (!key?.trim() || rest.length === 0 || !rest.join('=').trim()) {
      return null;
    }
    labels[key.trim()] = rest.join('=').trim();
  }
  return labels;
};

export const useCreateSandboxForm = () => {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [gpuCount, setGpuCount] = useState('');
  const [cpu, setCpu] = useState('');
  const [memory, setMemory] = useState('');
  const [templateId, setTemplateId] = useState(policyTemplates[0].id);
  const [policyText, setPolicyText] = useState(
    JSON.stringify(policyTemplates[0].policy, null, 2),
  );
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [isPolicyExpanded, setPolicyExpanded] = useState(false);

  const { error: policyError, parsed: parsedPolicy } =
    useJsonValidation(policyText);

  const labels = useMemo(() => parseLabels(labelsText), [labelsText]);
  const gpuInvalid = gpuCount !== '' && !/^[0-9]+$/.test(gpuCount);
  const resolvedImage = image ? resolveImage(image) : '';
  const isResolved = image && resolvedImage !== image.trim();

  const activeTemplate = policyTemplates.find(
    (candidate) => candidate.id === templateId,
  );

  const isValid =
    !!image && !policyError && !!parsedPolicy && labels !== null && !gpuInvalid;

  const applyTemplate = useCallback((id: string) => {
    setTemplateId(id);
    const template = policyTemplates.find((candidate) => candidate.id === id);
    if (template) {
      setPolicyText(JSON.stringify(template.policy, null, 2));
    }
  }, []);

  const toggleProvider = useCallback(
    (providerName: string, checked: boolean) => {
      setSelectedProviders((current) =>
        checked
          ? [...current, providerName]
          : current.filter((item) => item !== providerName),
      );
    },
    [],
  );

  const reset = useCallback(() => {
    setName('');
    setImage('');
    setLabelsText('');
    setGpuCount('');
    setCpu('');
    setMemory('');
    setSelectedProviders([]);
    setPolicyExpanded(false);
    applyTemplate(policyTemplates[0].id);
  }, [applyTemplate]);

  const buildPayload = useCallback(() => {
    if (!isValid || !parsedPolicy || labels === null) {
      return null;
    }
    return {
      name: name || undefined,
      image: resolveImage(image),
      policy: parsedPolicy as SandboxPolicy,
      labels: Object.keys(labels).length > 0 ? labels : undefined,
      providers: selectedProviders.length > 0 ? selectedProviders : undefined,
      gpuCount: gpuCount ? Number(gpuCount) : undefined,
      cpu: cpu || undefined,
      memory: memory || undefined,
    };
  }, [
    isValid,
    parsedPolicy,
    labels,
    name,
    image,
    selectedProviders,
    gpuCount,
    cpu,
    memory,
  ]);

  return {
    name,
    setName,
    image,
    setImage,
    labelsText,
    setLabelsText,
    gpuCount,
    setGpuCount,
    cpu,
    setCpu,
    memory,
    setMemory,
    templateId,
    policyText,
    setPolicyText,
    selectedProviders,
    isPolicyExpanded,
    setPolicyExpanded,
    policyError,
    parsedPolicy,
    labels,
    gpuInvalid,
    resolvedImage,
    isResolved,
    activeTemplate,
    isValid,
    applyTemplate,
    toggleProvider,
    reset,
    buildPayload,
  };
};
