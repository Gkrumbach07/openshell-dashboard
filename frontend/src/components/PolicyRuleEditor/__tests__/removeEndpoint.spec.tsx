import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import NetworkRulesTable from '../NetworkRulesTable';
import { endpointRemovalEffect, removeEndpointOperations } from '../utils';
import type { NetworkEndpoint, NetworkPolicyRule } from '../../../types';

// `policy update --remove-endpoint` names a host and a port. The gateway
// (openshell-policy merge.rs, remove_endpoint, at v0.1.2) takes the port from
// every endpoint of the rule with that host, case aside, that has it;
// removes an endpoint left without a port; and removes a rule left without
// an endpoint. The path of an endpoint plays no part.

const endpoint = (overrides: Partial<NetworkEndpoint>): NetworkEndpoint => ({
  host: 'api.example.com',
  port: 443,
  ...overrides,
});

// What the gateway is left with after the operations the UI sends, worked
// out here from the gateway's rule one port at a time, independently of
// endpointRemovalEffect.
const afterRemoval = (
  rule: NetworkPolicyRule,
  chosen: NetworkEndpoint,
): (NetworkEndpoint & { ports: number[] })[] => {
  let endpoints = (rule.endpoints ?? []).map((item) => ({
    ...item,
    ports: item.ports?.length ? [...item.ports] : item.port ? [item.port] : [],
  }));
  for (const operation of removeEndpointOperations('rule', chosen)) {
    if (!('removeEndpoint' in operation)) {
      continue;
    }
    const { host, port } = operation.removeEndpoint;
    endpoints = endpoints
      .map((item) =>
        (item.host ?? '').toLowerCase() === host.toLowerCase() &&
        item.ports.includes(port)
          ? { ...item, ports: item.ports.filter((p) => p !== port) }
          : item,
      )
      .filter((item) => item.ports.length > 0);
  }
  return endpoints;
};

describe('endpointRemovalEffect', () => {
  it('removes an endpoint that is the only one with its host and port', () => {
    const chosen = endpoint({});
    const other = endpoint({ host: 'other.example.com' });
    const rule = { endpoints: [chosen, other] };

    expect(endpointRemovalEffect(rule, chosen)).toEqual({
      affected: [
        { endpoint: chosen, index: 0, removedPorts: [443], remainingPorts: [] },
      ],
      removesRule: false,
    });
  });

  it('takes an endpoint of the same host and port with it, whatever its path', () => {
    const chosen = endpoint({ path: '/v1/**' });
    const sibling = endpoint({ path: '/v2/**', protocol: 'rest' });
    const rule = { endpoints: [chosen, sibling] };

    const effect = endpointRemovalEffect(rule, chosen);

    expect(effect.affected.map((item) => item.endpoint)).toEqual([
      chosen,
      sibling,
    ]);
    expect(
      effect.affected.every((item) => item.remainingPorts.length === 0),
    ).toBe(true);
    // Nothing is left of the rule.
    expect(effect.removesRule).toBe(true);
  });

  it('takes only the shared port from an endpoint that has others', () => {
    const chosen = endpoint({ path: '/v1/**' });
    const sibling = endpoint({ ports: [8443, 443, 9443] });
    const rule = { endpoints: [chosen, sibling] };

    expect(endpointRemovalEffect(rule, chosen)).toEqual({
      affected: [
        { endpoint: chosen, index: 0, removedPorts: [443], remainingPorts: [] },
        {
          endpoint: sibling,
          index: 1,
          removedPorts: [443],
          remainingPorts: [8443, 9443],
        },
      ],
      removesRule: false,
    });
  });

  it('removes every port of the chosen endpoint, one operation each', () => {
    const chosen = endpoint({ ports: [443, 8443] });
    const sibling = endpoint({ port: 8443, ports: [8443] });
    const rule = { endpoints: [chosen, sibling] };

    const effect = endpointRemovalEffect(rule, chosen);

    expect(effect.affected).toEqual([
      {
        endpoint: chosen,
        index: 0,
        removedPorts: [443, 8443],
        remainingPorts: [],
      },
      { endpoint: sibling, index: 1, removedPorts: [8443], remainingPorts: [] },
    ]);
    expect(effect.removesRule).toBe(true);
  });

  it('matches the host without regard to the case of its letters', () => {
    const chosen = endpoint({ host: 'API.Example.com' });
    const sibling = endpoint({ host: 'api.example.COM', path: '/v2' });
    const effect = endpointRemovalEffect(
      { endpoints: [chosen, sibling] },
      chosen,
    );
    expect(effect.affected).toHaveLength(2);
  });

  it('leaves an endpoint of another host or another port alone', () => {
    const chosen = endpoint({});
    const rule = {
      endpoints: [
        chosen,
        endpoint({ host: 'api.example.org' }),
        endpoint({ port: 8443 }),
      ],
    };
    const effect = endpointRemovalEffect(rule, chosen);
    expect(effect.affected.map((item) => item.index)).toEqual([0]);
    expect(effect.removesRule).toBe(false);
  });

  it('removes the rule with its last endpoint', () => {
    const chosen = endpoint({});
    expect(endpointRemovalEffect({ endpoints: [chosen] }, chosen)).toEqual({
      affected: [
        { endpoint: chosen, index: 0, removedPorts: [443], remainingPorts: [] },
      ],
      removesRule: true,
    });
  });

  it('removes nothing for an endpoint that names no port, as the operations sent for it are none', () => {
    const chosen: NetworkEndpoint = { host: 'api.example.com' };
    const rule = { endpoints: [chosen, endpoint({})] };
    expect(removeEndpointOperations('rule', chosen)).toEqual([]);
    expect(endpointRemovalEffect(rule, chosen)).toEqual({
      affected: [],
      removesRule: false,
    });
  });

  it.each<[string, NetworkEndpoint[], number]>([
    ['a lone endpoint', [endpoint({})], 0],
    [
      'two paths of one host and port',
      [endpoint({ path: '/a' }), endpoint({ path: '/b' })],
      1,
    ],
    [
      'overlapping port lists',
      [endpoint({ ports: [443, 8443] }), endpoint({ ports: [8443, 9000] })],
      0,
    ],
    [
      'unrelated endpoints around it',
      [
        endpoint({ host: 'a.example.com' }),
        endpoint({ ports: [80, 443] }),
        endpoint({ ports: [443], path: '/x' }),
        endpoint({ port: 22 }),
      ],
      2,
    ],
  ])('agrees with the gateway rule for %s', (_name, endpoints, chosenAt) => {
    const rule = { endpoints };
    const chosen = endpoints[chosenAt];

    const effect = endpointRemovalEffect(rule, chosen);
    const left = afterRemoval(rule, chosen);

    // Every endpoint the effect does not name is left exactly as it was,
    // and every one it names keeps exactly the ports it says.
    const expected = endpoints
      .map((item, index) => {
        const hit = effect.affected.find((entry) => entry.index === index);
        const ports = hit
          ? hit.remainingPorts
          : item.ports?.length
            ? item.ports
            : [item.port as number];
        return { host: item.host, path: item.path, ports: [...ports].sort() };
      })
      .filter((item) => item.ports.length > 0);
    expect(
      left.map((item) => ({
        host: item.host,
        path: item.path,
        ports: [...item.ports].sort(),
      })),
    ).toEqual(expected);
    expect(effect.removesRule).toBe(left.length === 0);
  });
});

describe('removing an endpoint in the rules table', () => {
  const onRemoveEndpoint = jest.fn();

  const renderTable = (rule: NetworkPolicyRule) => {
    render(
      <NetworkRulesTable
        networkRules={{ api: rule }}
        isEditable
        isBusy={false}
        onRemoveEndpoint={onRemoveEndpoint}
      />,
    );
    fireEvent.click(
      within(screen.getByTestId('network-rule-api')).getByRole('button', {
        name: 'Details',
      }),
    );
  };

  const askToRemove = (index: number) =>
    fireEvent.click(screen.getByTestId(`endpoint-api-${index}-remove`));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks first, and removes nothing until the answer is yes', () => {
    const chosen = endpoint({});
    renderTable({ endpoints: [chosen, endpoint({ host: 'b.example.com' })] });

    askToRemove(0);

    expect(screen.getByTestId('remove-endpoint-modal')).toBeInTheDocument();
    expect(onRemoveEndpoint).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-remove-endpoint'));

    expect(onRemoveEndpoint).toHaveBeenCalledTimes(1);
    expect(onRemoveEndpoint).toHaveBeenCalledWith('api', chosen);
    expect(
      screen.queryByTestId('remove-endpoint-modal'),
    ).not.toBeInTheDocument();
  });

  it('removes nothing when the answer is no', () => {
    renderTable({ endpoints: [endpoint({}), endpoint({ port: 80 })] });
    askToRemove(0);

    fireEvent.click(
      within(screen.getByTestId('remove-endpoint-modal')).getByRole('button', {
        name: 'Cancel',
      }),
    );

    expect(onRemoveEndpoint).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('remove-endpoint-modal'),
    ).not.toBeInTheDocument();
  });

  it('names only the chosen endpoint when no other shares its host and port', () => {
    renderTable({
      endpoints: [endpoint({}), endpoint({ host: 'b.example.com' })],
    });
    askToRemove(0);

    const effect = within(screen.getByTestId('remove-endpoint-effect'));
    expect(effect.getAllByRole('listitem')).toHaveLength(1);
    expect(effect.getByRole('listitem')).toHaveTextContent(
      'api.example.com:443 is removed',
    );
    expect(
      screen.queryByTestId('remove-endpoint-others'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('remove-endpoint-rule'),
    ).not.toBeInTheDocument();
  });

  it('names every other endpoint the removal takes with it, and what is left of each', () => {
    renderTable({
      endpoints: [
        endpoint({ path: '/v1/**' }),
        endpoint({ path: '/v2/**' }),
        endpoint({ ports: [443, 8443], path: '/v3/**' }),
        endpoint({ host: 'b.example.com' }),
      ],
    });
    askToRemove(0);

    const lines = within(screen.getByTestId('remove-endpoint-effect'))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(lines).toEqual([
      'api.example.com:443 /v1/** is removed',
      'api.example.com:443 /v2/** is removed (another endpoint)',
      'api.example.com:443,8443 /v3/** loses port 443 and keeps 8443 (another endpoint)',
    ]);
    expect(screen.getByTestId('remove-endpoint-others')).toHaveTextContent(
      '2 other endpoints of this rule have the same host and port',
    );
    expect(
      screen.queryByTestId('remove-endpoint-rule'),
    ).not.toBeInTheDocument();
  });

  it('says so when the removal leaves nothing of the rule', () => {
    renderTable({
      endpoints: [endpoint({ path: '/v1/**' }), endpoint({ path: '/v2/**' })],
    });
    askToRemove(1);

    expect(screen.getByTestId('remove-endpoint-others')).toHaveTextContent(
      'Another endpoint of this rule has the same host and port',
    );
    expect(screen.getByTestId('remove-endpoint-rule')).toHaveTextContent(
      'That leaves the rule api without an endpoint, so the rule is removed as well.',
    );
  });

  it('offers no removal of an endpoint that names no port, and says where to remove it', () => {
    renderTable({ endpoints: [{ host: 'api.example.com' }, endpoint({})] });
    askToRemove(0);

    expect(screen.getByTestId('remove-endpoint-unremovable')).toHaveTextContent(
      'names no port',
    );
    expect(
      screen.queryByTestId('confirm-remove-endpoint'),
    ).not.toBeInTheDocument();
    expect(onRemoveEndpoint).not.toHaveBeenCalled();
  });
});
