import { Label } from '@patternfly/react-core';
import { useI18n } from '../i18n';

type RoleBadgeProps = {
  isPlatformAdmin: boolean;
  isUser: boolean;
  isLoading: boolean;
};

const RoleBadge: React.FC<RoleBadgeProps> = ({
  isPlatformAdmin,
  isUser,
  isLoading,
}) => {
  const { t } = useI18n('common');

  if (isLoading || (!isPlatformAdmin && !isUser)) {
    return null;
  }

  return (
    <Label isCompact data-testid="role-badge">
      {isPlatformAdmin ? t('header.roleAdmin') : t('header.roleUser')}
    </Label>
  );
};

export default RoleBadge;
