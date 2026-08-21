import { render, screen } from '@testing-library/react';

import { useI18n } from '../useI18n';

const AuthProbe: React.FC = () => {
  const { t } = useI18n('auth');
  return <span>{t('continueAsDeveloper')}</span>;
};

const MissingKeyProbe: React.FC = () => {
  const { t } = useI18n('auth');
  return <span>{t('this.key.does.not.exist')}</span>;
};

const InterpolationProbe: React.FC = () => {
  const { t } = useI18n('workspaces');
  return <span>{t('delete.body', { name: 'ws-1' })}</span>;
};

describe('useI18n', () => {
  it('resolves a known auth key to its English string', () => {
    render(<AuthProbe />);
    expect(screen.getByText('Continue as developer')).toBeInTheDocument();
  });

  it('returns the key string when a catalog entry is missing', () => {
    render(<MissingKeyProbe />);
    expect(screen.getByText('this.key.does.not.exist')).toBeInTheDocument();
  });

  it('interpolates values into a catalog string', () => {
    render(<InterpolationProbe />);
    expect(
      screen.getByText(
        'Workspace "ws-1" and everything in it (sandboxes, providers, members) will be deleted.',
      ),
    ).toBeInTheDocument();
  });
});
