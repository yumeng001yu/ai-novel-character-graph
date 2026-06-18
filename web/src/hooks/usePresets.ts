import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

// 获取提示词预设列表
export const usePresets = () => useQuery({
  queryKey: ['presets'],
  queryFn: async () => (await api.get('/prompt-presets')).data,
});

// 获取单个提示词预设
export const usePreset = (id: string) => useQuery({
  queryKey: ['presets', id],
  queryFn: async () => (await api.get(`/prompt-presets/${id}`)).data,
  enabled: !!id,
});

// 获取宏列表
export const useMacros = () => useQuery({
  queryKey: ['presets', 'macros'],
  queryFn: async () => (await api.get('/prompt-presets/macros/list')).data,
});

// 创建提示词预设
export const useCreatePreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, basedOn }: { name: string; basedOn?: string }) =>
      (await api.post('/prompt-presets', { name, basedOn })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
};

// 更新提示词预设
export const useUpdatePreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.put(`/prompt-presets/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
};

// 删除提示词预设
export const useDeletePreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/prompt-presets/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
};

// 设置默认提示词预设
export const useSetDefaultPreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/prompt-presets/${id}/set-default`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
};
