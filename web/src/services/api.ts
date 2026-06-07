import axios from 'axios';

const api = axios.create({
  baseURL: '/novelgraph/api',
  timeout: 30000,
});

// 小说
export const uploadNovel = (formData: FormData, hasChapter: boolean) => {
  formData.append('has_chapter', String(hasChapter));
  return api.post('/novels/upload', formData);
};
export const textPaste = (data: { content: string; novelName?: string }) =>
  api.post('/novels/text-paste', data);
export const getNovels = () => api.get('/novels');
export const getNovel = (id: string) => api.get(`/novels/${id}`);
export const deleteNovel = (id: string) => api.delete(`/novels/${id}`);

// 图谱
export const getGraph = (novelId: string, params?: { center?: string; step?: number }) =>
  api.get(`/novels/${novelId}/graph`, { params });

// 角色
export const searchCharacters = (novelId: string, keyword: string) =>
  api.get('/characters/search', { params: { novelId, keyword } });
export const getCharacter = (id: string) => api.get(`/characters/${id}`);
export const getCharacterTimeline = (id: string) => api.get(`/characters/${id}/timeline`);
export const mergeCharacters = (characterIds: string[], primaryId: string) =>
  api.post('/characters/merge', { characterIds, primaryId });
export const getConflicts = (novelId: string) =>
  api.get('/characters/conflicts', { params: { novelId } });

// 快照
export const getSnapshots = (novelId: string) => api.get(`/novels/${novelId}/snapshots`);
export const getSnapshot = (novelId: string, step: number) =>
  api.get(`/novels/${novelId}/snapshots/${step}`);
export const getSnapshotDiff = (novelId: string, step: number) =>
  api.get(`/novels/${novelId}/snapshots/${step}/diff`);

// 任务
export const startBuild = (novelId: string) => api.post(`/novels/${novelId}/build`);
export const cancelBuild = (novelId: string) => api.post(`/novels/${novelId}/cancel`);
export const getTaskStatus = (novelId: string) => api.get(`/novels/${novelId}/task`);
export const rollback = (novelId: string, targetStep: number) =>
  api.post(`/novels/${novelId}/rollback`, { targetStep });
export const getCostEstimate = (novelId: string) =>
  api.get(`/novels/${novelId}/cost-estimate`);

// 续建
export const continueUpload = (novelId: string, formData: FormData) =>
  api.post(`/novels/${novelId}/continue/upload`, formData);
export const continuePaste = (novelId: string, content: string) =>
  api.post(`/novels/${novelId}/continue/paste`, { content });
export const continueCheck = (novelId: string) =>
  api.get(`/novels/${novelId}/continue/check`);

// 设置
export const getAiConfig = () => api.get('/settings/ai');
export const saveAiConfig = (data: any) => api.put('/settings/ai', data);
export const testAiConnection = (apiUrl: string, apiKey: string) =>
  api.post('/settings/ai/test', { apiUrl, apiKey });
export const getModels = (apiUrl: string, apiKey: string) =>
  api.post('/settings/ai/models', { apiUrl, apiKey });
export const getBuildConfig = () => api.get('/settings/build');
export const saveBuildConfig = (data: any) => api.put('/settings/build', data);

// Embedding 配置
export const getEmbeddingConfig = () => api.get('/settings/embedding');
export const saveEmbeddingConfig = (data: any) => api.put('/settings/embedding', data);
export const testEmbeddingConnection = (apiUrl: string, apiKey: string, model: string) =>
  api.post('/settings/embedding/test', { apiUrl, apiKey, model });
export const getEmbeddingModels = (apiUrl: string, apiKey: string) =>
  api.post('/settings/embedding/models', { apiUrl, apiKey });

// Reranker 配置
export const getRerankerConfig = () => api.get('/settings/reranker');
export const saveRerankerConfig = (data: any) => api.put('/settings/reranker', data);
export const testRerankerConnection = (apiUrl: string, apiKey: string, model: string) =>
  api.post('/settings/reranker/test', { apiUrl, apiKey, model });

// 导出
export const exportGraph = (novelId: string, format: string) =>
  api.get(`/novels/${novelId}/export`, { params: { format }, responseType: 'blob' });

export default api;
