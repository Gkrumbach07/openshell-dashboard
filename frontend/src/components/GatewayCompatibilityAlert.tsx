import { useState } from 'react';
import {
  Alert,
  AlertActionCloseButton,
  AlertGroup,
} from '@patternfly/react-core';
import type { AlertProps } from '@patternfly/react-core';

import { useGatewayCompatibility } from '../api/gateway';
import { useI18n } from '../i18n';

type GatewayCompatibilityAlertProps = {
  /** Extra classes for the alert, for example PatternFly spacing utilities. */
  className?: string;
  /**
   * The element the alert's title is rendered as. Defaults to PatternFly's
   * `h4`. A heading must fit the heading outline where the alert is placed,
   * so pass a lower level, or a non-heading such as `div` when the alert sits
   * above the page's `h1`.
   */
  component?: AlertProps['component'];
  /**
   * Wraps the alert when one is shown. Use it for the layout the alert needs
   * where it is placed (a PageSection, padding) so that nothing but an empty
   * live region is left behind when there is nothing to say.
   */
  wrapper?: (alert: React.ReactElement) => React.ReactElement;
};

// Says so when the dashboard is pointed at a gateway outside the range of
// gateway releases it supports. Without it, a gateway that is too old shows up
// only as errors that do not name the cause — "workspace '\n\adefault' not
// found" on every page.
//
// The verdict comes from the BFF (GET /gateway/compatibility), which every
// signed-in user can read; this only presents it. Nothing is shown while the
// gateway is supported, while the answer is unknown, and while the request is
// loading or has failed, so it is safe to mount once at the top of an app and
// forget.
//
// It always renders an empty live region, and the alert appears inside it.
// That is what makes a screen reader announce the notice when it arrives after
// the page has loaded: a region only announces what is added to it once it
// exists. Mount the component where it stays mounted across navigation (an app
// shell, not a page) and the notice is announced once, when it appears, and
// not again on every route change.
const GatewayCompatibilityAlert: React.FC<GatewayCompatibilityAlertProps> = ({
  className,
  component,
  wrapper,
}) => {
  const { t } = useI18n('common');
  const gateway = useGatewayCompatibility();
  // The gateway version the "untested" notice was dismissed for. Keyed by
  // version, and kept only in memory, so the notice comes back on reload and
  // whenever the gateway changes to another version nobody has tested.
  const [dismissedVersion, setDismissedVersion] = useState<string>();

  const version = gateway.data?.gatewayVersion ?? '';
  const compatibility = gateway.data?.compatibility;
  const status = compatibility?.status;

  const min = compatibility?.supportedMin ?? '';
  const max = compatibility?.supportedMax ?? '';
  const supported =
    min === max ? min : t('gatewayCompatibility.versionRange', { min, max });

  let alert: React.ReactElement | null = null;
  if (status === 'unsupported') {
    // No close button: a warning stays until what caused it is resolved, and
    // this one explains every other error on the page.
    alert = (
      <Alert
        variant="warning"
        isInline
        className={className}
        component={component}
        title={t('gatewayCompatibility.unsupported.title')}
        data-testid="gateway-compatibility-alert"
        data-status={status}
      >
        {t('gatewayCompatibility.unsupported.body', { version, supported })}
      </Alert>
    );
  } else if (status === 'untested' && dismissedVersion !== version) {
    alert = (
      <Alert
        variant="info"
        isInline
        className={className}
        component={component}
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

  // PatternFly's way to have an alert that appears later announced: an alert
  // group that is a polite live region and is in the DOM from the start.
  // Animations are switched off rather than inherited from the host: the
  // group's slide-in and slide-out are made for a stack of toasts, and with
  // them on the close button waits for a transition before it dismisses.
  return (
    <AlertGroup
      isLiveRegion
      hasAnimations={false}
      data-testid="gateway-compatibility-region"
    >
      {alert && (wrapper ? wrapper(alert) : alert)}
    </AlertGroup>
  );
};

export default GatewayCompatibilityAlert;
