import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

// 获取角色详情
export const useCharacter = (id: string) => useQuery({
  queryKey: ['characters', id],
  queryFn: async () => (await api.get(`/characters/${id}`)).data,
  enabled: !!id,
});

// 获取角色时间线
export const useCharacterTimeline = (id: string) => useQuery({
  queryKey: ['characters', id, 'timeline'],
  queryFn: async () => (await api.get(`/characters/${id}/timeline`)).data,
  enabled: !!id,
});

// 搜索角色
export const useCharacterSearch = (keyword: string) => useQuery({
  queryKey: ['characters', 'search', keyword],
  queryFn: async () => (await api.get('/characters/search', { params: { keyword } })).data,
  enabled: keyword.length > 0,
});
