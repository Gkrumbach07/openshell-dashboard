import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import SandboxServicesTab from '../sandbox/SandboxServicesTab';
import type { ServiceEndpoint } from '../../types';

const mockExpose = jest.fn();
const mockRemove = jest.fn();

jest.mock('../../api/sandboxes', () => ({
  useServices: jest.fn(),
  useExposeService: jest.fn(() => ({
    mutate: mockExpose,
    isPending: false,
    isError: false,
    error: null,
  })),
  useDeleteService: jest.fn(() => ({
    mutate: mockRemove,
    isPending: false,
    isError: false,
    error: null,
  })),
}));

import { useServices } from '../../api/sandboxes';
const mockUseServices = useServices as jest.Mock;

const endpoints: ServiceEndpoint[] = [
  {
    sandboxName: 'agent',
    serviceName: 'web',
    targetPort: 8080,
    domain: true,
    url: 'https://team-a--agent--web.example/',
  },
  // The unnamed endpoint, as `openshell service expose agent 3000` leaves it.
  { sandboxName: 'agent', serviceName: '', targetPort: 3000, domain: true },
];

const renderTab = (data: ServiceEndpoint[] = endpoints) => {
  mockUseServices.mockReturnValue({
    isLoading: false,
    isError: false,
    data,
    refetch: jest.fn(),
  });
  return render(<SandboxServicesTab workspace="team-a" sandboxName="agent" />);
};

const rows = () =>
  within(screen.getByTestId('services-table')).getAllByRole('row').slice(1);

const openForm = () =>
  fireEvent.click(screen.getByTestId('expose-service-button'));

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

// Opens a row's action menu and picks Delete. The menu positions itself after
// it opens, so the test waits for it to settle.
const deleteFromRowMenu = async (row: HTMLElement) => {
  fireEvent.click(within(row).getByRole('button', { name: 'Kebab toggle' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  await act(async () => {});
};

describe('SandboxServicesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the endpoints, the unnamed one as the CLI shows it', () => {
    renderTab();

    const cells = rows().map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 4)
        .map((cell) => cell.textContent?.trim()),
    );
    expect(cells).toEqual([
      ['web', '8080', 'https://team-a--agent--web.example/', 'Enabled'],
      ['-', '3000', '-', 'Enabled'],
    ]);
  });

  // `openshell service expose <sandbox> <port> <service>`.
  it('exposes a named service', () => {
    renderTab();
    openForm();
    type('expose-service-name', 'api');
    type('expose-service-port', '9000');
    fireEvent.click(screen.getByTestId('expose-service-confirm'));

    expect(mockExpose).toHaveBeenCalledTimes(1);
    expect(mockExpose.mock.calls[0][0]).toEqual({
      service: 'api',
      targetPort: 9000,
      domain: true,
    });
  });

  // `openshell service expose <sandbox> <port>`: the name is optional, and
  // leaving it out is how the unnamed endpoint is made.
  it('exposes the unnamed service when the name is left empty', () => {
    renderTab([]);
    openForm();
    type('expose-service-port', '3000');

    const confirm = screen.getByTestId('expose-service-confirm');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(mockExpose.mock.calls[0][0]).toEqual({
      service: '',
      targetPort: 3000,
      domain: true,
    });
  });

  // The gateway routes every endpoint for the browser whatever the request
  // says, and the CLI always asks for it, so the form has nothing to choose.
  it('offers no domain switch and always asks for domain routing', () => {
    renderTab();
    openForm();

    expect(
      screen.queryByTestId('expose-service-domain'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it.each(['', '0', '65536', '80.5', '-1'])(
    'does not expose on %j, which is not a port',
    (port) => {
      renderTab();
      openForm();
      type('expose-service-name', 'api');
      type('expose-service-port', port);

      const confirm = screen.getByTestId('expose-service-confirm');
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(mockExpose).not.toHaveBeenCalled();
    },
  );

  it('says what a service name may be and what leaving it empty does', () => {
    renderTab();
    openForm();

    expect(
      screen.getByText(/lowercase DNS label of at most 19 characters/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Leave it\s+empty for the sandbox's unnamed service/),
    ).toBeInTheDocument();
  });

  it('deletes a named endpoint by its name', async () => {
    renderTab();

    await deleteFromRowMenu(rows()[0]);

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith('web');
  });

  // An empty name: the API then deletes on the route without one.
  it('deletes the unnamed endpoint', async () => {
    renderTab();

    await deleteFromRowMenu(rows()[1]);

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith('');
  });

  it('says so when the sandbox exposes nothing', () => {
    renderTab([]);
    expect(
      screen.getByText('No services exposed on this sandbox'),
    ).toBeInTheDocument();
  });
  // The services are polled. React Query reports a refetch that failed as an
  // error beside the data of the last fetch that worked.
  describe('a refresh of the services that fails', () => {
    const refetch = jest.fn();
    const failRefresh = () =>
      mockUseServices.mockReturnValue({
        isLoading: false,
        isError: true,
        error: new Error('bad gateway'),
        data: endpoints,
        refetch,
      });
    const tab = () => (
      <SandboxServicesTab workspace="team-a" sandboxName="agent" />
    );

    it('leaves the endpoints on screen, with a note that they may be out of date', () => {
      failRefresh();
      render(tab());

      expect(screen.getByTestId('services-refresh-error')).toHaveTextContent(
        'bad gateway',
      );
      expect(rows()).toHaveLength(2);
      expect(
        screen.queryByText('Failed to load services'),
      ).not.toBeInTheDocument();

      fireEvent.click(
        within(screen.getByTestId('services-refresh-error')).getByRole(
          'button',
          { name: 'Retry' },
        ),
      );
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the Expose service form open, with what was typed', () => {
      const view = renderTab();
      openForm();
      type('expose-service-name', 'web2');
      type('expose-service-port', '9090');

      failRefresh();
      view.rerender(tab());

      expect(screen.getByTestId('expose-service-name')).toHaveValue('web2');
      expect(screen.getByTestId('expose-service-port')).toHaveValue(9090);
    });

    it('still shows the error in place of the tab when the list never loaded', () => {
      mockUseServices.mockReturnValue({
        isLoading: false,
        isError: true,
        error: new Error('bad gateway'),
        data: undefined,
        refetch,
      });
      render(tab());
      expect(screen.getByText('Failed to load services')).toBeInTheDocument();
      expect(
        screen.queryByTestId('services-refresh-error'),
      ).not.toBeInTheDocument();
    });
  });
});
