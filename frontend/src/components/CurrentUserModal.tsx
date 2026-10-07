import {
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  LabelGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';

import { useI18n } from '../i18n';
import type { CurrentUser } from '../types';

type CurrentUserModalProps = {
  user?: CurrentUser;
  isOpen: boolean;
  onClose: () => void;
};

const ValueList: React.FC<{ values?: string[]; none: string }> = ({
  values,
  none,
}) =>
  values && values.length > 0 ? (
    <LabelGroup numLabels={10}>
      {values.map((value) => (
        <Label key={value} color="grey" isCompact>
          {value}
        </Label>
      ))}
    </LabelGroup>
  ) : (
    <>{none}</>
  );

// The identity the gateway validated for this session: what `openshell
// whoami` prints. It is where to look when the gateway refuses something: the
// subject is what a workspace membership is granted to, and the roles are
// what make a platform admin.
const CurrentUserModal: React.FC<CurrentUserModalProps> = ({
  user,
  isOpen,
  onClose,
}) => {
  const { t } = useI18n('common');
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onClose}
      aria-label={t('identity.title')}
      data-testid="current-user-modal"
    >
      <ModalHeader title={t('identity.title')} />
      <ModalBody>
        <DescriptionList isHorizontal isCompact>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('identity.subject')}</DescriptionListTerm>
            <DescriptionListDescription data-testid="identity-subject">
              {user?.subject || t('identity.none')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          {user?.displayName && (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('identity.name')}</DescriptionListTerm>
              <DescriptionListDescription data-testid="identity-name">
                {user.displayName}
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}
          <DescriptionListGroup>
            <DescriptionListTerm>{t('identity.provider')}</DescriptionListTerm>
            <DescriptionListDescription data-testid="identity-provider">
              {user?.identityProvider || t('identity.none')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('identity.roles')}</DescriptionListTerm>
            <DescriptionListDescription data-testid="identity-roles">
              <ValueList values={user?.roles} none={t('identity.none')} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('identity.scopes')}</DescriptionListTerm>
            <DescriptionListDescription data-testid="identity-scopes">
              <ValueList values={user?.scopes} none={t('identity.none')} />
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          {t('identity.close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CurrentUserModal;
