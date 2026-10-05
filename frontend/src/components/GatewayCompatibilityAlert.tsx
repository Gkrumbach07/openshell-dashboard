import { useState } from 'react';
import { Alert, AlertActionCloseButton } from '@patternfly/react-core';

import { useGatewayInfo } from '../api/gateway';
import { useI18n } from '../i18n';

type GatewayCompatibilityAlertProps = {
  /** Extra classes for the alert, for example PatternFly spacing utilities. */
  className?: string;
  /**
   * Wraps the alert when one is shown. Use it for the layout the alert needs
   * where it is placed (a PageSection, a StackItem) so that no empty container
   * is left behind when there is nothing to say.
   */
  wrapper?: (alert: React.ReactElement) => React.ReactElement;
};

// Says so when the dashboard is pointed at a gateway outside the range of
// gateway releases it supports. Without it, a gateway that is too old shows up
// only as errors that do not name the cause — "workspace '\n\adefault' not
// found" on every page.
//
// The verdict comes from the BFF (GET /gateway, `compatibility`); this only
// presents it. It renders nothing while the gateway is supported, while the
// answer is unknown, and while the request is loading or has failed, so it is
// safe to mount once at the top of an app and forget.
const GatewayCompatibilityAlert: React.FC<GatewayCompatibilityAlertProps> = ({
  className,
  wrapper,
}) => {
  const { t } = useI18n('common');
  const gateway = useGatewayInfo();
  // The gateway version the "untested" notice was dismissed for. Keyed by
  // version, and kept only in memory, so the notice comes back on reload and
  // whenever the gateway changes to another version nobody has tested.
  const [dismissedVersion, setDismissedVersion] = useState<string>();

  const version = gateway.data?.gatewayVersion ?? '';
  const compatibility = gateway.data?.compatibility;
  const status = compatibility?.status;
  if (status !== 'unsupported' && status !== 'untested') {
    return null;
  }

  const min = compatibility?.supportedMin ?? '';
  const max = compatibility?.supportedMax ?? '';
  const supported =
    min === max ? min : t('gatewayCompatibility.versionRange', { min, max });

  let alert: React.ReactElement;
  if (status === 'unsupported') {
    // No close button: a warning stays until what caused it is resolved, and
    // this one explains every other error on the page.
    alert = (
      <Alert
        variant="warning"
        isInline
        className={className}
        title={t('gatewayCompatibility.unsupported.title')}
        data-testid="gateway-compatibility-alert"
        data-status={status}
      >
        {t('gatewayCompatibility.unsupported.body', { version, supported })}
      </Alert>
    );
  } else {
    if (dismissedVersion === version) {
      return null;
    }
    alert = (
      <Alert
        variant="info"
        isInline
        className={className}
        title={t('gatewayCompatibility.untested.title')}
        actionClose={
          <AlertActionCloseButton
            aria-label={t('gatewayCompatibility.untested.dismiss')}
            onClose={() => setDismissedVersion(version)}
            data-testid="gateway-compatibility-alert-dismiss"
          />
        }
        data-testid="gateway-compatibility-alert"
        data-status={status}
      >
        {t('gatewayCompatibility.untested.body', { version, supported })}
      </Alert>
    );
  }

  return wrapper ? wrapper(alert) : alert;
};

export default GatewayCompatibilityAlert;
