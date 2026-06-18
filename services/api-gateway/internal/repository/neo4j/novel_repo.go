package neo4j

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// NovelRepo 小说数据仓库
type NovelRepo struct{}

// NewNovelRepo 创建小说仓库实例
func NewNovelRepo() *NovelRepo {
	return &NovelRepo{}
}

// FindByID 根据 ID 查找小说
func (r *NovelRepo) FindByID(ctx context.Context, id string) (*model.Novel, error) {
	// Neo4j 不可用时直接从文件系统读取
	if !IsAvailable() {
		return fsLoadNovelMeta(id), nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH (n:Novel {id: $id}) RETURN n`
		record, err := tx.Run(ctx, cypher, map[string]interface{}{"id": id})
		if err != nil {
			return nil, err
		}
		if record.Next(ctx) {
			return recordToNovel(record.Record())
		}
		return nil, nil
	})
	if err != nil {
		// Neo4j 不可用时从文件系统读取
		slog.Warn("查询小说失败（Neo4j 可能未启动），从文件系统读取", "id", id, "error", err)
		return fsLoadNovelMeta(id), nil
	}
	if result == nil {
		return nil, nil
	}
	return result.(*model.Novel), nil
}

// FindAll 查询所有小说
func (r *NovelRepo) FindAll(ctx context.Context) ([]*model.Novel, error) {
	// Neo4j 不可用时直接从文件系统读取
	if !IsAvailable() {
		return fsLoadAllNovels(), nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH (n:Novel) RETURN n ORDER BY n.createdAt DESC`
		records, err := tx.Run(ctx, cypher, nil)
		if err != nil {
			return nil, err
		}
		var novels []*model.Novel
		for records.Next(ctx) {
			novel, err := recordToNovel(records.Record())
			if err != nil {
				return nil, err
			}
			novels = append(novels, novel)
		}
		return novels, nil
	})
	if err != nil {
		// Neo4j 不可用时从文件系统读取
		slog.Warn("查询所有小说失败（Neo4j 可能未启动），从文件系统读取", "error", err)
		return fsLoadAllNovels(), nil
	}
	if result == nil {
		return []*model.Novel{}, nil
	}
	return result.([]*model.Novel), nil
}

// Create 创建小说节点
func (r *NovelRepo) Create(ctx context.Context, novel *model.Novel) error {
	// Neo4j 不可用时直接保存到文件系统
	if !IsAvailable() {
		fsSaveNovelMeta(novel)
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			CREATE (n:Novel {
				id: $id,
				name: $name,
				totalChars: $totalChars,
				totalTokens: $totalTokens,
				totalSteps: $totalSteps,
				inputMode: $inputMode,
				currentStep: $currentStep,
				contextSize: $contextSize,
				createdAt: $createdAt,
				updatedAt: $updatedAt
			})
			RETURN n`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{
			"id":          novel.ID,
			"name":        novel.Name,
			"totalChars":  novel.TotalChars,
			"totalTokens": novel.TotalTokens,
			"totalSteps":  novel.TotalSteps,
			"inputMode":   novel.InputMode,
			"currentStep": novel.CurrentStep,
			"contextSize": novel.ContextSize,
			"createdAt":   novel.CreatedAt,
			"updatedAt":   novel.UpdatedAt,
		})
		return nil, err
	})
	if err != nil {
		// Neo4j 不可用时回退到文件系统存储
		slog.Warn("Neo4j 创建小说失败，回退到文件系统存储", "error", err)
		fsSaveNovelMeta(novel)
		return nil
	}
	slog.Info("小说创建成功", "id", novel.ID, "name", novel.Name)
	return nil
}

// Update 更新小说信息
func (r *NovelRepo) Update(ctx context.Context, novel *model.Novel) error {
	// Neo4j 不可用时直接更新文件系统
	if !IsAvailable() {
		fsUpdateNovelMeta(novel)
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $id})
			SET n.name = $name,
			    n.totalChars = $totalChars,
			    n.totalTokens = $totalTokens,
			    n.totalSteps = $totalSteps,
			    n.inputMode = $inputMode,
			    n.currentStep = $currentStep,
			    n.contextSize = $contextSize,
			    n.updatedAt = $updatedAt
			RETURN n`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{
			"id":          novel.ID,
			"name":        novel.Name,
			"totalChars":  novel.TotalChars,
			"totalTokens": novel.TotalTokens,
			"totalSteps":  novel.TotalSteps,
			"inputMode":   novel.InputMode,
			"currentStep": novel.CurrentStep,
			"contextSize": novel.ContextSize,
			"updatedAt":   novel.UpdatedAt,
		})
		return nil, err
	})
	if err != nil {
		// Neo4j 不可用时更新文件系统
		slog.Warn("Neo4j 更新小说失败，更新文件系统", "id", novel.ID, "error", err)
		fsUpdateNovelMeta(novel)
		return nil
	}
	slog.Info("小说更新成功", "id", novel.ID)
	return nil
}

// Delete 删除小说及其关联数据
func (r *NovelRepo) Delete(ctx context.Context, id string) error {
	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $id})
			OPTIONAL MATCH (n)-[:HAS_CHARACTER]->(c:Character)
			OPTIONAL MATCH (c)-[r:RELATES_TO]->()
			DETACH DELETE c, n
			RETURN count(n) as deleted`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"id": id})
		return nil, err
	})
	if err != nil {
		slog.Error("删除小说失败", "id", id, "error", err)
		return err
	}
	slog.Info("小说删除成功", "id", id)
	return nil
}

// recordToNovel 将 Neo4j 记录转换为 Novel 模型
func recordToNovel(record *neo4j.Record) (*model.Novel, error) {
	node, ok := record.Get("n")
	if !ok {
		return nil, fmt.Errorf("记录中未找到节点 n")
	}
	n, ok := node.(neo4j.Node)
	if !ok {
		return nil, fmt.Errorf("节点类型断言失败")
	}
	props := n.Props
	novel := &model.Novel{
		ID:          getStringProp(props, "id"),
		Name:        getStringProp(props, "name"),
		TotalChars:  getIntProp(props, "totalChars"),
		TotalTokens: getIntProp(props, "totalTokens"),
		TotalSteps:  getIntProp(props, "totalSteps"),
		InputMode:   getStringProp(props, "inputMode"),
		CurrentStep: getIntProp(props, "currentStep"),
		ContextSize: getIntProp(props, "contextSize"),
		CreatedAt:   getStringProp(props, "createdAt"),
		UpdatedAt:   getStringProp(props, "updatedAt"),
	}
	return novel, nil
}

// getStringProp 安全获取字符串属性
func getStringProp(props map[string]interface{}, key string) string {
	if v, ok := props[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// getIntProp 安全获取整数属性
func getIntProp(props map[string]interface{}, key string) int {
	if v, ok := props[key]; ok && v != nil {
		switch val := v.(type) {
		case int64:
			return int(val)
		case int:
			return val
		case float64:
			return int(val)
		}
	}
	return 0
}

// getFloatProp 安全获取浮点数属性
func getFloatProp(props map[string]interface{}, key string) float64 {
	if v, ok := props[key]; ok && v != nil {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

// getBoolProp 安全获取布尔属性
func getBoolProp(props map[string]interface{}, key string) bool {
	if v, ok := props[key]; ok && v != nil {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

// GetIntPropVal 从接口值中获取整数（导出版本）
func GetIntPropVal(v interface{}) int {
	switch val := v.(type) {
	case int64:
		return int(val)
	case int:
		return val
	case float64:
		return int(val)
	}
	return 0
}

// GetStringProp 从属性 map 中获取字符串（导出版本）
func GetStringProp(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
