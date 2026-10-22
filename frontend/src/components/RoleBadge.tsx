import { Content, Flex, FlexItem, Label } from '@patternfly/react-core';
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
    // Same shape as Gateway status: a small name for the value, then the
    // badge. A full-height toolbar stretches its items, so the row is
    // centred the same way that indicator centres itself.
    <Flex
      component="span"
      gap={{ default: 'gapSm' }}
      alignItems={{ default: 'alignItemsCenter' }}
      flexWrap={{ default: 'nowrap' }}
      data-testid="role-badge-region"
    >
      <FlexItem component="span">
        <Content component="small">{t('header.roleLabel')}</Content>
      </FlexItem>
      <FlexItem component="span">
        <Label data-testid="role-badge">
          {isPlatformAdmin ? t('header.roleAdmin') : t('header.roleUser')}
        </Label>
      </FlexItem>
    </Flex>
  );
};

export default RoleBadge;
