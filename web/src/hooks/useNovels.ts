import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

// 获取小说列表
export const useNovels = () => useQuery({
  queryKey: ['novels'],
  queryFn: async () => (await api.get('/novels')).data,
});

// 获取单个小说详情
export const useNovel = (id: string) => useQuery({
  queryKey: ['novels', id],
  queryFn: async () => (await api.get(`/novels/${id}`)).data,
  enabled: !!id,
});

// 获取小说图谱数据
export const useNovelGraph = (id: string, center?: string, step?: number) => useQuery({
  queryKey: ['novels', id, 'graph', { center, step }],
  queryFn: async () => (await api.get(`/novels/${id}/graph`, { params: { center, step } })).data,
  enabled: !!id,
});

// 获取小说事件列表
export const useNovelEvents = (id: string) => useQuery({
  queryKey: ['novels', id, 'events'],
  queryFn: async () => (await api.get(`/novels/${id}/events`)).data,
  enabled: !!id,
});

// 删除小说
export const useDeleteNovel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/novels/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['novels'] }),
  });
};
