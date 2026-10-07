import { useMemo, useState, useCallback } from 'react';

import { COMMUNITY_REGISTRY } from '../constants';
import { usePolicyText } from './usePolicyText';
import { useSandboxLaunchOptions } from './useSandboxLaunchOptions';
import { policyTemplates } from '../components/policy/policyTemplates';
import {
  parseDriverConfig,
  rowsToRecord,
  type KeyValueRow,
} from '../utils/sandboxOptions';
import type { CreateSandboxRequest } from '../types';

export const resolveImage = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed && !trimmed.includes('/') && !trimmed.includes(':')) {
    return `${COMMUNITY_REGISTRY}/${trimmed}:latest`;
  }
  return trimmed;
};

// Why a form whose policy was emptied cannot be sent. A policy is the one
// thing a sandbox cannot be created without, and an empty text, or one that
// is only space, is not one.
export const POLICY_REQUIRED =
  'A policy is required. Choose a preset, paste a policy, or load one from a file.';

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

  // Advanced options. All of them are optional, and a form that leaves them
  // alone sends the request it always sent.
  const [envRows, setEnvRows] = useState<KeyValueRow[]>([]);
  const [annotationRows, setAnnotationRows] = useState<KeyValueRow[]>([]);
  const [logLevel, setLogLevel] = useState('');
  const [runtimeClassName, setRuntimeClassName] = useState('');
  const [driverConfigText, setDriverConfigText] = useState('');
  const [isAdvancedExpanded, setAdvancedExpanded] = useState(false);
  const launch = useSandboxLaunchOptions();

  // The policy is read from whatever it was given as: the JSON of a preset,
  // or a policy file, YAML or JSON, pasted or loaded over it.
  const { error: readError, parsed: parsedPolicy } = usePolicyText(policyText);
  const policyError = policyText.trim() ? readError : POLICY_REQUIRED;

  const labels = useMemo(() => parseLabels(labelsText), [labelsText]);
  const gpuInvalid = gpuCount !== '' && !/^[0-9]+$/.test(gpuCount);
  const resolvedImage = image ? resolveImage(image) : '';
  const isResolved = image && resolvedImage !== image.trim();

  const { record: environment, error: envError } = useMemo(
    () => rowsToRecord(envRows),
    [envRows],
  );
  const { record: annotations, error: annotationsError } = useMemo(
    () => rowsToRecord(annotationRows),
    [annotationRows],
  );
  const { value: driverConfig, error: driverConfigError } = useMemo(
    () => parseDriverConfig(driverConfigText),
    [driverConfigText],
  );
  // The section opens by itself around a field that needs correcting.
  const hasAdvancedError =
    Boolean(envError || annotationsError || driverConfigError) ||
    !launch.isValid;

  const activeTemplate = policyTemplates.find(
    (candidate) => candidate.id === templateId,
  );

  // The image is not required: without one the gateway runs its default.
  const isValid =
    !policyError &&
    !!parsedPolicy &&
    labels !== null &&
    !gpuInvalid &&
    !hasAdvancedError;

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

  const resetLaunch = launch.reset;
  const reset = useCallback(() => {
    setName('');
    setImage('');
    setLabelsText('');
    setGpuCount('');
    setCpu('');
    setMemory('');
    setSelectedProviders([]);
    setPolicyExpanded(false);
    setEnvRows([]);
    setAnnotationRows([]);
    setLogLevel('');
    setRuntimeClassName('');
    setDriverConfigText('');
    setAdvancedExpanded(false);
    resetLaunch();
    applyTemplate(policyTemplates[0].id);
  }, [applyTemplate, resetLaunch]);

  const launchPayload = launch.payload;
  const buildPayload = useCallback((): CreateSandboxRequest | null => {
    if (!isValid || !parsedPolicy || labels === null) {
      return null;
    }
    return {
      name: name || undefined,
      image: resolveImage(image) || undefined,
      policy: parsedPolicy,
      labels: Object.keys(labels).length > 0 ? labels : undefined,
      providers: selectedProviders.length > 0 ? selectedProviders : undefined,
      gpuCount: gpuCount ? Number(gpuCount) : undefined,
      cpu: cpu || undefined,
      memory: memory || undefined,
      environment:
        Object.keys(environment).length > 0 ? environment : undefined,
      annotations:
        Object.keys(annotations).length > 0 ? annotations : undefined,
      logLevel: logLevel || undefined,
      runtimeClassName: runtimeClassName.trim() || undefined,
      driverConfig,
      ...launchPayload,
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
    environment,
    annotations,
    logLevel,
    runtimeClassName,
    driverConfig,
    launchPayload,
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
    envRows,
    setEnvRows,
    envError,
    annotationRows,
    setAnnotationRows,
    annotationsError,
    logLevel,
    setLogLevel,
    runtimeClassName,
    setRuntimeClassName,
    driverConfigText,
    setDriverConfigText,
    driverConfigError,
    isAdvancedExpanded,
    setAdvancedExpanded,
    hasAdvancedError,
    launch,
  };
};
