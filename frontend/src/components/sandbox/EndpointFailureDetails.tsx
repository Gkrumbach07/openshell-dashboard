import {
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
} from '@patternfly/react-core';

import { useI18n } from '../../i18n';
import type { EndpointFailure } from '../../types';

type EndpointFailureDetailsProps = {
  failure: EndpointFailure;
  testId: string;
};

const DOMAINS = ['TOKEN_GRANT', 'UNSPECIFIED'];
const RECOVERY_ACTIONS = [
  'RETRY',
  'REAUTHORIZE',
  'FIX_CONFIGURATION',
  'INVESTIGATE',
];

// The cause the gateway gives for a failed exchange, the fields
// `openshell sandbox get` prints for it. The code, the stage and the request
// ID are the gateway's own and are shown as they are; a domain or a recovery
// action this build has no words for is shown by the gateway's name for it.
const EndpointFailureDetails: React.FC<EndpointFailureDetailsProps> = ({
  failure,
  testId,
}) => {
  const { t } = useI18n('sandboxes');
  const domain = DOMAINS.includes(failure.domain)
    ? t(`failure.domain.${failure.domain}`)
    : failure.domain;
  const action = failure.recoveryAction;
  const recovery = !action
    ? t('failure.recoveryAction.none')
    : RECOVERY_ACTIONS.includes(action)
      ? t(`failure.recoveryAction.${action}`)
      : t('failure.recoveryAction.other', { action });
  const credential = [failure.provider, failure.credentialKey]
    .filter(Boolean)
    .join('/');

  return (
    <DescriptionList
      isCompact
      isHorizontal
      aria-label={t('failure.ariaLabel')}
      data-testid={testId}
    >
      <DescriptionListGroup>
        <DescriptionListTerm>{t('failure.cause')}</DescriptionListTerm>
        <DescriptionListDescription data-testid={`${testId}-cause`}>
          {t('failure.causeValue', { code: failure.code, domain })}
        </DescriptionListDescription>
      </DescriptionListGroup>
      {failure.stage && (
        <DescriptionListGroup>
          <DescriptionListTerm>{t('failure.stage')}</DescriptionListTerm>
          <DescriptionListDescription>
            {failure.stage}
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}
      {failure.upstreamHttpStatus !== undefined && (
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t('failure.upstreamStatus')}
          </DescriptionListTerm>
          <DescriptionListDescription>
            {failure.upstreamHttpStatus}
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}
      {credential && (
        <DescriptionListGroup>
          <DescriptionListTerm>{t('failure.credential')}</DescriptionListTerm>
          <DescriptionListDescription data-testid={`${testId}-credential`}>
            {credential}
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}
      <DescriptionListGroup>
        <DescriptionListTerm>{t('failure.recovery')}</DescriptionListTerm>
        <DescriptionListDescription data-testid={`${testId}-recovery`}>
          {recovery}
        </DescriptionListDescription>
      </DescriptionListGroup>
      {failure.requestId && (
        <DescriptionListGroup>
          <DescriptionListTerm>{t('failure.requestId')}</DescriptionListTerm>
          <DescriptionListDescription className="pf-v6-u-font-family-monospace">
            {failure.requestId}
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}
    </DescriptionList>
  );
};

export default EndpointFailureDetails;
