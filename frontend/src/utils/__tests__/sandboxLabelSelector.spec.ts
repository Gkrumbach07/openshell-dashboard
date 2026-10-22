import { combineSandboxLabelSelector } from '../sandboxLabelSelector';

describe('combineSandboxLabelSelector', () => {
  it('combines a type label and generic selector', () => {
    expect(combineSandboxLabelSelector('team=ml', 'type=tool')).toEqual({
      selector: 'team=ml,type=tool',
    });
  });

  it('rejects invalid type entries and duplicate keys', () => {
    expect(combineSandboxLabelSelector('team=ml', 'type')).toHaveProperty(
      'error',
    );
    expect(
      combineSandboxLabelSelector('type=agent,team=ml', 'type=tool'),
    ).toHaveProperty('error');
  });

  it('leaves the generic selector alone without a type label', () => {
    expect(combineSandboxLabelSelector('team=ml', '')).toEqual({
      selector: 'team=ml',
    });
  });
});
