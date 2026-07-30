import { useQuery } from '@tanstack/react-query';

import { get } from './client';
import type { GatewayInfo } from '../types';

export const getGatewayInfo = (): Promise<GatewayInfo> => get<GatewayInfo>('/api/v1/gateway');

export const useGatewayInfo = () =>
  useQuery({
    queryKey: ['gateway'],
    queryFn: getGatewayInfo,
    refetchInterval: 30_000,
  });
