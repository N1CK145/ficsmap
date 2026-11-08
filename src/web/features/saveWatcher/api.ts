import { useQuery } from '@tanstack/react-query';
import type { CreatedUploadTokenDto, UploadTokenDto, UploadTokenInput } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

const path = (worldId: string, id?: number) =>
  `/api/worlds/${encodeURIComponent(worldId)}/upload-tokens${id === undefined ? '' : `/${id}`}`;

/** The world's active upload tokens (owner only). */
export function useUploadTokens(worldId: string) {
  return useQuery({ queryKey: queryKeys.uploadTokens(worldId), queryFn: () => api<UploadTokenDto[]>('GET', path(worldId)) });
}

export function createUploadToken(worldId: string, input: UploadTokenInput): Promise<CreatedUploadTokenDto> {
  return api<CreatedUploadTokenDto>('POST', path(worldId), input);
}

export function revokeUploadToken(worldId: string, id: number): Promise<void> {
  return api<void>('DELETE', path(worldId, id));
}
