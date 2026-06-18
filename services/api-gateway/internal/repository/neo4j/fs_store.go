package neo4j

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
)

// 文件系统存储根目录（与 novel_service.go 中的路径一致）
const fsNovelsDir = "/workspace/ai-novel-character-graph/server/output/novels"

// fsSaveNovelMeta 将小说元数据保存到文件系统（Neo4j 不可用时的后备方案）
func fsSaveNovelMeta(novel *model.Novel) {
	dir := filepath.Join(fsNovelsDir, novel.ID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Error("文件系统后备：创建小说目录失败", "error", err)
		return
	}
	metaPath := filepath.Join(dir, "meta.json")
	data, err := json.Marshal(novel)
	if err != nil {
		slog.Error("文件系统后备：序列化小说元数据失败", "error", err)
		return
	}
	if err := os.WriteFile(metaPath, data, 0644); err != nil {
		slog.Error("文件系统后备：保存小说元数据失败", "error", err)
		return
	}
	slog.Info("文件系统后备：小说元数据已保存", "id", novel.ID, "name", novel.Name)
}

// fsLoadNovelMeta 从文件系统读取小说元数据
func fsLoadNovelMeta(novelId string) *model.Novel {
	metaPath := filepath.Join(fsNovelsDir, novelId, "meta.json")
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return nil
	}
	var novel model.Novel
	if err := json.Unmarshal(data, &novel); err != nil {
		slog.Error("文件系统后备：解析小说元数据失败", "novelId", novelId, "error", err)
		return nil
	}
	return &novel
}

// fsLoadAllNovels 从文件系统扫描所有小说
func fsLoadAllNovels() []*model.Novel {
	entries, err := os.ReadDir(fsNovelsDir)
	if err != nil {
		return []*model.Novel{}
	}
	var novels []*model.Novel
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		novel := fsLoadNovelMeta(entry.Name())
		if novel != nil {
			novels = append(novels, novel)
		}
	}
	// 按创建时间降序排序
	sort.Slice(novels, func(i, j int) bool {
		return novels[i].CreatedAt > novels[j].CreatedAt
	})
	return novels
}

// fsUpdateNovelMeta 更新文件系统中的小说元数据
func fsUpdateNovelMeta(novel *model.Novel) {
	fsSaveNovelMeta(novel)
}

// ========== 章节文件系统后备 ==========

// fsSaveChapters 将章节保存到文件系统
func fsSaveChapters(novelId string, chapters []*Chapter) {
	dir := filepath.Join(fsNovelsDir, novelId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Error("文件系统后备：创建章节目录失败", "error", err)
		return
	}
	chPath := filepath.Join(dir, "chapters.json")
	data, err := json.Marshal(chapters)
	if err != nil {
		slog.Error("文件系统后备：序列化章节失败", "error", err)
		return
	}
	if err := os.WriteFile(chPath, data, 0644); err != nil {
		slog.Error("文件系统后备：保存章节失败", "error", err)
		return
	}
	slog.Info("文件系统后备：章节已保存", "novelId", novelId, "count", len(chapters))
}

// fsLoadChapters 从文件系统读取章节
func fsLoadChapters(novelId string) []*Chapter {
	chPath := filepath.Join(fsNovelsDir, novelId, "chapters.json")
	data, err := os.ReadFile(chPath)
	if err != nil {
		return []*Chapter{}
	}
	var chapters []*Chapter
	if err := json.Unmarshal(data, &chapters); err != nil {
		slog.Error("文件系统后备：解析章节失败", "novelId", novelId, "error", err)
		return []*Chapter{}
	}
	return chapters
}

// ========== 角色文件系统后备 ==========

// fsSaveCharacters 将角色保存到文件系统
func fsSaveCharacters(novelId string, characters []*model.Character) {
	dir := filepath.Join(fsNovelsDir, novelId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	chPath := filepath.Join(dir, "characters.json")
	data, err := json.Marshal(characters)
	if err != nil {
		return
	}
	if err := os.WriteFile(chPath, data, 0644); err != nil {
		return
	}
	slog.Info("文件系统后备：角色已保存", "novelId", novelId, "count", len(characters))
}

// fsLoadCharacters 从文件系统读取角色
func fsLoadCharacters(novelId string) []*model.Character {
	chPath := filepath.Join(fsNovelsDir, novelId, "characters.json")
	data, err := os.ReadFile(chPath)
	if err != nil {
		return []*model.Character{}
	}
	var characters []*model.Character
	if err := json.Unmarshal(data, &characters); err != nil {
		return []*model.Character{}
	}
	return characters
}

// fsAppendCharacter 追加单个角色到文件系统
func fsAppendCharacter(character *model.Character) {
	characters := fsLoadCharacters(character.NovelID)
	// 检查是否已存在（按 ID），存在则更新
	found := false
	for i, c := range characters {
		if c.ID == character.ID {
			characters[i] = character
			found = true
			break
		}
	}
	if !found {
		characters = append(characters, character)
	}
	fsSaveCharacters(character.NovelID, characters)
}

// ========== 关系文件系统后备 ==========

// fsSaveRelations 将关系保存到文件系统
func fsSaveRelations(novelId string, relations []*model.Relation) {
	dir := filepath.Join(fsNovelsDir, novelId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	relPath := filepath.Join(dir, "relations.json")
	data, err := json.Marshal(relations)
	if err != nil {
		return
	}
	if err := os.WriteFile(relPath, data, 0644); err != nil {
		return
	}
	slog.Info("文件系统后备：关系已保存", "novelId", novelId, "count", len(relations))
}

// fsLoadRelations 从文件系统读取关系
func fsLoadRelations(novelId string) []*model.Relation {
	relPath := filepath.Join(fsNovelsDir, novelId, "relations.json")
	data, err := os.ReadFile(relPath)
	if err != nil {
		return []*model.Relation{}
	}
	var relations []*model.Relation
	if err := json.Unmarshal(data, &relations); err != nil {
		return []*model.Relation{}
	}
	return relations
}

// fsAppendRelationWithNovelId 追加单个关系到指定小说的文件系统
func fsAppendRelationWithNovelId(novelId string, relation *model.Relation) {
	relations := fsLoadRelations(novelId)
	// 检查是否已存在（按 ID），存在则更新
	found := false
	for i, r := range relations {
		if r.ID == relation.ID {
			relations[i] = relation
			found = true
			break
		}
	}
	if !found {
		relations = append(relations, relation)
	}
	fsSaveRelations(novelId, relations)
}

// ========== 事件文件系统后备 ==========

// fsSaveEvents 将事件保存到文件系统
func fsSaveEvents(novelId string, events []*model.Event) {
	dir := filepath.Join(fsNovelsDir, novelId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	eventPath := filepath.Join(dir, "events.json")
	data, err := json.Marshal(events)
	if err != nil {
		return
	}
	if err := os.WriteFile(eventPath, data, 0644); err != nil {
		return
	}
	slog.Info("文件系统后备：事件已保存", "novelId", novelId, "count", len(events))
}

// fsLoadEvents 从文件系统读取事件
func fsLoadEvents(novelId string) []*model.Event {
	eventPath := filepath.Join(fsNovelsDir, novelId, "events.json")
	data, err := os.ReadFile(eventPath)
	if err != nil {
		return []*model.Event{}
	}
	var events []*model.Event
	if err := json.Unmarshal(data, &events); err != nil {
		return []*model.Event{}
	}
	return events
}

// fsAppendEvent 追加单个事件到文件系统
func fsAppendEvent(event *model.Event) {
	events := fsLoadEvents(event.NovelID)
	// 检查是否已存在（按 ID），存在则更新
	found := false
	for i, e := range events {
		if e.ID == event.ID {
			events[i] = event
			found = true
			break
		}
	}
	if !found {
		events = append(events, event)
	}
	fsSaveEvents(event.NovelID, events)
}

// ========== 快照文件系统后备 ==========

// FSSnapshot 文件系统快照存储结构
type FSSnapshot struct {
	Step           int                      `json:"step"`
	NovelId        string                   `json:"novelId"`
	Characters     []map[string]interface{} `json:"characters"`
	Relations      []map[string]interface{} `json:"relations"`
	Events         []map[string]interface{} `json:"events"`
	CharacterCount int                      `json:"characterCount"`
	RelationCount  int                      `json:"relationCount"`
	CreatedAt      string                   `json:"createdAt"`
}

// fsSnapshotsDir 获取快照目录
func fsSnapshotsDir(novelId string) string {
	return filepath.Join(fsNovelsDir, novelId, "snapshots")
}

// FsSaveSnapshot 保存单个快照到文件系统
func FsSaveSnapshot(snapshot *FSSnapshot) error {
	return fsSaveSnapshot(snapshot)
}

// fsSaveSnapshot 保存单个快照到文件系统
func fsSaveSnapshot(snapshot *FSSnapshot) error {
	dir := fsSnapshotsDir(snapshot.NovelId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建快照目录失败: %w", err)
	}
	filePath := filepath.Join(dir, fmt.Sprintf("step_%d.json", snapshot.Step))
	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("序列化快照失败: %w", err)
	}
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("保存快照失败: %w", err)
	}
	slog.Info("文件系统后备：快照已保存", "novelId", snapshot.NovelId, "step", snapshot.Step)
	return nil
}

// FsLoadSnapshots 从文件系统读取快照列表（摘要信息）
func FsLoadSnapshots(novelId string) []map[string]interface{} {
	return fsLoadSnapshots(novelId)
}

// fsLoadSnapshots 从文件系统读取快照列表（摘要信息）
func fsLoadSnapshots(novelId string) []map[string]interface{} {
	dir := fsSnapshotsDir(novelId)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []map[string]interface{}{}
	}
	var snapshots []map[string]interface{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var snap FSSnapshot
		if err := json.Unmarshal(data, &snap); err != nil {
			continue
		}
		snapshots = append(snapshots, map[string]interface{}{
			"step":           snap.Step,
			"characterCount": snap.CharacterCount,
			"relationCount":  snap.RelationCount,
			"createdAt":      snap.CreatedAt,
		})
	}
	// 按 step 排序
	sort.Slice(snapshots, func(i, j int) bool {
		si, _ := snapshots[i]["step"].(int)
		sj, _ := snapshots[j]["step"].(int)
		// json.Unmarshal 后 int 可能变成 float64
		if f, ok := snapshots[i]["step"].(float64); ok {
			si = int(f)
		}
		if f, ok := snapshots[j]["step"].(float64); ok {
			sj = int(f)
		}
		return si < sj
	})
	return snapshots
}

// FsLoadSnapshot 从文件系统读取单个快照
func FsLoadSnapshot(novelId string, step int) (*FSSnapshot, error) {
	return fsLoadSnapshot(novelId, step)
}

// fsLoadSnapshot 从文件系统读取单个快照
func fsLoadSnapshot(novelId string, step int) (*FSSnapshot, error) {
	filePath := filepath.Join(fsSnapshotsDir(novelId), fmt.Sprintf("step_%d.json", step))
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("快照不存在: 步骤 %d", step)
	}
	var snap FSSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, fmt.Errorf("解析快照失败: %w", err)
	}
	return &snap, nil
}

// fsDeleteSnapshotsAfter 删除指定步骤之后的快照
func fsDeleteSnapshotsAfter(novelId string, step int) {
	dir := fsSnapshotsDir(novelId)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		// 解析 step_N.json 中的 N
		var s int
		if _, err := fmt.Sscanf(entry.Name(), "step_%d.json", &s); err != nil {
			continue
		}
		if s > step {
			os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

// FsCleanBuildData 清除文件系统中的构建数据（角色、关系、事件、快照）
func FsCleanBuildData(novelId string) {
	fsCleanBuildData(novelId)
}

// fsCleanBuildData 清除文件系统中的构建数据（角色、关系、事件、快照）
func fsCleanBuildData(novelId string) {
	dir := filepath.Join(fsNovelsDir, novelId)
	// 删除角色文件
	os.Remove(filepath.Join(dir, "characters.json"))
	// 删除关系文件
	os.Remove(filepath.Join(dir, "relations.json"))
	// 删除事件文件
	os.Remove(filepath.Join(dir, "events.json"))
	// 删除所有快照
	snapDir := fsSnapshotsDir(novelId)
	os.RemoveAll(snapDir)
	slog.Info("文件系统后备：已清除构建数据", "novelId", novelId)
}
