import { useQuery } from '@tanstack/react-query';
import type { MeDto, WorldDto, WorldSummaryDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

export const useMe = () => useQuery({ queryKey: queryKeys.me(), queryFn: () => api<MeDto>('GET', '/api/me') });

export const useWorlds = () =>
  useQuery({ queryKey: queryKeys.worlds(), queryFn: () => api<WorldSummaryDto[]>('GET', '/api/worlds') });

export const useWorld = (worldId: string) =>
  useQuery({ queryKey: queryKeys.world(worldId), queryFn: () => api<WorldDto>('GET', `/api/worlds/${encodeURIComponent(worldId)}`) });
