import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

// 获取 AI 配置
export const useAISettings = () => useQuery({
  queryKey: ['settings', 'ai'],
  queryFn: async () => (await api.get('/settings/ai')).data,
});

// 获取构建配置
export const useBuildSettings = () => useQuery({
  queryKey: ['settings', 'build'],
  queryFn: async () => (await api.get('/settings/build')).data,
});

// 保存 AI 配置
export const useSaveAISettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.put('/settings/ai', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'ai'] }),
  });
};

// 测试 AI 连接
export const useTestAI = () => useMutation({
  mutationFn: async () => (await api.post('/settings/ai/test')).data,
});

// 获取可用模型列表
export const useGetModels = () => useMutation({
  mutationFn: async ({ apiUrl, apiKey }: { apiUrl: string; apiKey: string }) =>
    (await api.post('/settings/ai/models', { apiUrl, apiKey })).data,
});
