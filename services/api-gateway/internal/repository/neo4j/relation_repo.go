package neo4j

import (
	"context"
	"log/slog"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// RelationRepo 角色关系数据仓库
type RelationRepo struct{}

// NewRelationRepo 创建关系仓库实例
func NewRelationRepo() *RelationRepo {
	return &RelationRepo{}
}

// FindByCharacterIds 根据角色 ID 列表查找关系
func (r *RelationRepo) FindByCharacterIds(ctx context.Context, characterIds []string) ([]*model.Relation, error) {
	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (c1:Character)-[r:RELATES_TO]->(c2:Character)
			WHERE c1.id IN $ids AND c2.id IN $ids
			RETURN r, c1.id AS sourceId, c2.id AS targetId
			ORDER BY r.sinceChapter`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"ids": characterIds})
		if err != nil {
			return nil, err
		}
		var relations []*model.Relation
		for records.Next(ctx) {
			rel, err := recordToRelation(records.Record())
			if err != nil {
				return nil, err
			}
			relations = append(relations, rel)
		}
		return relations, nil
	})
	if err != nil {
		slog.Error("查询角色关系失败", "characterIds", characterIds, "error", err)
		return nil, err
	}
	if result == nil {
		return []*model.Relation{}, nil
	}
	return result.([]*model.Relation), nil
}

// FindByNovelId 根据小说 ID 查找所有关系
func (r *RelationRepo) FindByNovelId(ctx context.Context, novelId string) ([]*model.Relation, error) {
	// Neo4j 不可用时从文件系统读取
	if !IsAvailable() {
		return fsLoadRelations(novelId), nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c1:Character)
			MATCH (c1)-[r:RELATES_TO]->(c2:Character)
			WHERE (n)-[:HAS_CHARACTER]->(c2)
			RETURN r, c1.id AS sourceId, c2.id AS targetId
			ORDER BY r.sinceChapter`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId})
		if err != nil {
			return nil, err
		}
		var relations []*model.Relation
		for records.Next(ctx) {
			rel, err := recordToRelation(records.Record())
			if err != nil {
				return nil, err
			}
			relations = append(relations, rel)
		}
		return relations, nil
	})
	if err != nil {
		// Neo4j 连接失败时返回空列表
		slog.Warn("查询小说关系失败（Neo4j 可能未启动），返回空列表", "novelId", novelId, "error", err)
		return []*model.Relation{}, nil
	}
	if result == nil {
		return []*model.Relation{}, nil
	}
	return result.([]*model.Relation), nil
}

// Create 创建角色关系
func (r *RelationRepo) Create(ctx context.Context, relation *model.Relation) error {
	// Neo4j 不可用时返回 nil（无法确定 novelId，使用 CreateWithNovelId）
	if !IsAvailable() {
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (c1:Character {id: $sourceId})
			MATCH (c2:Character {id: $targetId})
			CREATE (c1)-[r:RELATES_TO {
				id: $id,
				relationType: $relationType,
				sinceChapter: $sinceChapter,
				untilChapter: $untilChapter,
				strength: $strength,
				isInference: $isInference,
				inferenceBasis: $inferenceBasis
			}]->(c2)
			RETURN r`
		params := map[string]interface{}{
			"id":             relation.ID,
			"sourceId":       relation.SourceID,
			"targetId":       relation.TargetID,
			"relationType":   relation.RelationType,
			"sinceChapter":   relation.SinceChapter,
			"untilChapter":   relation.UntilChapter,
			"strength":       relation.Strength,
			"isInference":    relation.IsInference,
			"inferenceBasis": relation.InferenceBasis,
		}
		_, err := tx.Run(ctx, cypher, params)
		return nil, err
	})
	if err != nil {
		slog.Error("创建关系失败", "error", err)
		return err
	}
	slog.Info("关系创建成功", "id", relation.ID)
	return nil
}

// CreateWithNovelId 创建角色关系（带 novelId，用于文件系统后备）
func (r *RelationRepo) CreateWithNovelId(ctx context.Context, novelId string, relation *model.Relation) error {
	// Neo4j 不可用时保存到文件系统
	if !IsAvailable() {
		fsAppendRelationWithNovelId(novelId, relation)
		return nil
	}
	return r.Create(ctx, relation)
}

// Delete 删除关系
func (r *RelationRepo) Delete(ctx context.Context, id string) error {
	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH ()-[r:RELATES_TO {id: $id}]->() DELETE r`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"id": id})
		return nil, err
	})
	if err != nil {
		slog.Error("删除关系失败", "id", id, "error", err)
		return err
	}
	slog.Info("关系删除成功", "id", id)
	return nil
}

// recordToRelation 将 Neo4j 记录转换为 Relation 模型
func recordToRelation(record *neo4j.Record) (*model.Relation, error) {
	relNode, ok := record.Get("r")
	if !ok {
		return nil, nil
	}
	rel, ok := relNode.(neo4j.Relationship)
	if !ok {
		return nil, nil
	}

	sourceId, _ := record.Get("sourceId")
	targetId, _ := record.Get("targetId")

	props := rel.Props

	var untilChapter *int
	if v, ok := props["untilChapter"]; ok && v != nil {
		switch val := v.(type) {
		case int64:
			iv := int(val)
			untilChapter = &iv
		case int:
			iv := val
			untilChapter = &iv
		}
	}

	relation := &model.Relation{
		ID:             getStringProp(props, "id"),
		SourceID:       toString(sourceId),
		TargetID:       toString(targetId),
		RelationType:   getStringProp(props, "relationType"),
		SinceChapter:   getIntProp(props, "sinceChapter"),
		UntilChapter:   untilChapter,
		Strength:       getFloatProp(props, "strength"),
		IsInference:    getBoolProp(props, "isInference"),
		InferenceBasis: getStringProp(props, "inferenceBasis"),
	}
	return relation, nil
}

// toString 将 interface{} 转换为字符串
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
