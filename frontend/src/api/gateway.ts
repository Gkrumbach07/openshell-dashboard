import { useQuery } from '@tanstack/react-query';

import { GATEWAY_POLL_MS } from '../constants';
import { get } from './client';
import { gatewayKeys } from './queryKeys';
import type { GatewayInfo } from '../types';

export const getGatewayInfo = (): Promise<GatewayInfo> =>
  get<GatewayInfo>('/api/v1/gateway');

export const useGatewayInfo = () =>
  useQuery({
    queryKey: gatewayKeys.info,
    queryFn: getGatewayInfo,
    refetchInterval: GATEWAY_POLL_MS,
  });
