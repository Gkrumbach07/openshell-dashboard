import React from 'react';
import { render, screen } from '@testing-library/react';
import ConnectCard from '../ConnectCard';

describe('ConnectCard', () => {
  it('renders the card', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(screen.getByTestId('connect-card')).toBeInTheDocument();
  });

  it('renders the connect via CLI title', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(screen.getByText('Connect via CLI')).toBeInTheDocument();
  });

  it('includes the sandbox connect command in an input', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const connectInput = inputs.find((i) =>
      i.value.includes('openshell sandbox connect my-agent'),
    );
    expect(connectInput).toBeTruthy();
  });

  it('includes the exec command in an input', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const execInput = inputs.find((i) =>
      i.value.includes('openshell sandbox exec -n my-agent'),
    );
    expect(execInput).toBeTruthy();
  });

  it('includes the ssh-config command in an input', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const sshInput = inputs.find((i) =>
      i.value.includes('openshell sandbox ssh-config my-agent'),
    );
    expect(sshInput).toBeTruthy();
  });

  it('renders descriptive text about CLI sessions', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(
      screen.getByText(/Interactive sessions run through the OpenShell CLI/),
    ).toBeInTheDocument();
  });
});
