import { Alert, AlertGroup } from '@patternfly/react-core';
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

// Says so when the dashboard is pointed at a gateway on another release line
// than the one it is built for (a line is every gateway release that shares a
// major.minor, such as 0.1.x). Without it, a mismatched gateway shows up only
// as errors that do not name the cause — "workspace '\n\adefault' not found"
// on every page.
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

  const version = gateway.data?.gatewayVersion ?? '';
  const compatibility = gateway.data?.compatibility;
  const status = compatibility?.status;
  const line = compatibility?.supportedLine ?? '';

  // No close button: a warning stays until what caused it is resolved, and
  // this one explains every other error on the page.
  const alert =
    status === 'unsupported' ? (
      <Alert
        variant="warning"
        isInline
        className={className}
        component={component}
        title={t('gatewayCompatibility.unsupported.title')}
        data-testid="gateway-compatibility-alert"
        data-status={status}
      >
        {t('gatewayCompatibility.unsupported.body', { version, line })}
      </Alert>
    ) : null;

  // PatternFly's way to have an alert that appears later announced: an alert
  // group that is a polite live region and is in the DOM from the start.
  // Animations are switched off rather than inherited from the host: the
  // group's slide-in and slide-out are made for a stack of toasts.
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
