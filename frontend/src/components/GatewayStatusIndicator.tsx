import { Content, Flex, FlexItem, Label } from '@patternfly/react-core';
import type { LabelProps } from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  QuestionCircleIcon,
} from '@patternfly/react-icons';

import { useGatewayCompatibility } from '../api/gateway';
import type { ApiError } from '../api/client';
import { useI18n } from '../i18n';

// What the indicator can say about the gateway.
//   healthy     — the gateway answered its health check with "healthy"
//   notHealthy  — it answered with anything else
//   unreachable — the BFF could not reach it
//   unknown     — the answer could not be read: the BFF itself did not answer,
//                 or it reported no health
export type GatewayHealthState =
  'healthy' | 'notHealthy' | 'unreachable' | 'unknown';

// The part of the health query the indicator reads.
type GatewayHealthQuery = {
  data?: { healthy?: boolean };
  isError: boolean;
  error: unknown;
};

// The statuses a BFF answers with when the gateway behind it did not answer.
const UNREACHABLE_STATUSES = [502, 503, 504];

// Reads the gateway's health from the health query, or undefined while there
// is nothing to say yet.
//
// A failed request is judged before the data. React Query keeps the last
// answer when a refresh fails, and that answer is from before the failure: a
// gateway that has stopped answering must not go on being shown as healthy.
export const gatewayHealthStateOf = (
  query: GatewayHealthQuery,
): GatewayHealthState | undefined => {
  if (query.isError) {
    const status = (query.error as Partial<ApiError> | null)?.status;
    return status !== undefined && UNREACHABLE_STATUSES.includes(status)
      ? 'unreachable'
      : 'unknown';
  }
  if (!query.data) {
    return undefined;
  }
  if (query.data.healthy === undefined) {
    return 'unknown';
  }
  return query.data.healthy ? 'healthy' : 'notHealthy';
};

// The colour and the icon the Gateway page gives the same four states, so
// that the masthead and the page say one thing in one way. PatternFly's
// `status` shorthand is a different palette from the page's `color`, which
// is what had the two greens differing.
const STATE_COLOR: Record<GatewayHealthState, LabelProps['color']> = {
  healthy: 'green',
  notHealthy: 'orange',
  unreachable: 'red',
  unknown: 'grey',
};

const STATE_ICON: Record<GatewayHealthState, React.ReactNode> = {
  healthy: <CheckCircleIcon />,
  notHealthy: <ExclamationTriangleIcon />,
  unreachable: <ExclamationCircleIcon />,
  unknown: <QuestionCircleIcon />,
};

const STATE_LABEL_KEY = {
  healthy: 'gatewayHealth.healthy',
  notHealthy: 'gatewayHealth.notHealthy',
  unreachable: 'gatewayHealth.unreachable',
  unknown: 'gatewayHealth.unknown',
} as const;

// Whether the gateway is healthy, for every signed-in user. It is what the
// upstream TUI shows in its title bar.
//
// The health comes from GET /gateway/compatibility, which the BFF answers
// from the gateway's health check for anyone; the Gateway page shows the same
// to platform admins from a call the gateway refuses to everyone else.
//
// The label sits in a status region that is in the page from the start, so a
// change is announced to a screen reader when it happens. AppLayout mounts it
// in the masthead, where it stays mounted across navigation, so that is once
// per change, not once per route.
const GatewayStatusIndicator: React.FC = () => {
  const { t } = useI18n('common');
  const state = gatewayHealthStateOf(useGatewayCompatibility());

  return (
    // The status region is the row itself. A full-height toolbar stretches
    // its items and their children, so a plain wrapper around the row would
    // be masthead-tall with the row sitting at its top — the label and the
    // badge riding above the centreline every other item on the bar keeps.
    // Centred here, there is nothing left to ride high in.
    <Flex
      component="span"
      role="status"
      gap={{ default: 'gapSm' }}
      alignItems={{ default: 'alignItemsCenter' }}
      flexWrap={{ default: 'nowrap' }}
      data-testid="gateway-status-region"
    >
      {state && (
        // What the label is the value of, said once beside it rather than
        // repeated inside every one of the four states.
        <>
          <FlexItem component="span">
            <Content component="small">{t('gatewayHealth.label')}</Content>
          </FlexItem>
          <FlexItem component="span">
            <Label
              color={STATE_COLOR[state]}
              icon={STATE_ICON[state]}
              data-testid="gateway-status-indicator"
              data-state={state}
            >
              {t(STATE_LABEL_KEY[state])}
            </Label>
          </FlexItem>
        </>
      )}
    </Flex>
  );
};

export default GatewayStatusIndicator;
