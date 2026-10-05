import { useQuery } from '@tanstack/react-query';

import { GATEWAY_POLL_MS } from '../constants';
import { get } from './client';
import { gatewayKeys } from './queryKeys';
import type { GatewayCompatibilityInfo, GatewayInfo } from '../types';

export const getGatewayInfo = (): Promise<GatewayInfo> =>
  get<GatewayInfo>('/api/v1/gateway');

export const useGatewayInfo = () =>
  useQuery({
    queryKey: gatewayKeys.info,
    queryFn: getGatewayInfo,
    refetchInterval: GATEWAY_POLL_MS,
  });

// The dashboard's verdict on the gateway's version, for every signed-in user.
//
// GET /gateway carries the same verdict, but the gateway refuses that call to
// anyone who is not a platform admin, and a gateway that is too old breaks
// every user's pages. This route is answered from the gateway's health check,
// which needs no role.
export const getGatewayCompatibility = (): Promise<GatewayCompatibilityInfo> =>
  get<GatewayCompatibilityInfo>('/api/v1/gateway/compatibility');

// Polled at the gateway's own pace, so a gateway that was unreachable when the
// page loaded, or that is replaced while the page is open, still gets judged.
export const useGatewayCompatibility = () =>
  useQuery({
    queryKey: gatewayKeys.compatibility,
    queryFn: getGatewayCompatibility,
    refetchInterval: GATEWAY_POLL_MS,
  });
