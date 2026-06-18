package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
)

// GraphNode 图谱节点
type GraphNode struct {
	ID            string                 `json:"id"`
	Label         string                 `json:"label"`
	Name          string                 `json:"name"`
	IsProtagonist bool                   `json:"isProtagonist"`
	Data          map[string]interface{} `json:"data"`
}

// GraphEdge 图谱边
type GraphEdge struct {
	ID           string                 `json:"id"`
	Source       string                 `json:"source"`
	Target       string                 `json:"target"`
	Label        string                 `json:"label"`
	RelationType string                 `json:"relationType"`
	SourceName   string                 `json:"sourceName"`
	TargetName   string                 `json:"targetName"`
	IsInference  bool                   `json:"isInference"`
	Data         map[string]interface{} `json:"data"`
}

// GraphData 图谱数据
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// GraphService 图谱业务逻辑
type GraphService struct {
	characterRepo *neo4jRepo.CharacterRepo
	relationRepo  *neo4jRepo.RelationRepo
}

// NewGraphService 创建图谱服务实例
func NewGraphService() *GraphService {
	return &GraphService{
		characterRepo: neo4jRepo.NewCharacterRepo(),
		relationRepo:  neo4jRepo.NewRelationRepo(),
	}
}

// GetNodes 获取图谱节点
func (s *GraphService) GetNodes(ctx context.Context, novelId string) ([]GraphNode, error) {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil, fmt.Errorf("获取图谱节点失败: %w", err)
	}

	nodes := make([]GraphNode, 0, len(characters))
	for _, char := range characters {
		nodes = append(nodes, ToGraphNode(char))
	}
	return nodes, nil
}

// GetEdges 获取图谱边
func (s *GraphService) GetEdges(ctx context.Context, novelId string) ([]GraphEdge, error) {
	relations, err := s.relationRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil, fmt.Errorf("获取图谱边失败: %w", err)
	}

	edges := make([]GraphEdge, 0, len(relations))
	for _, rel := range relations {
		edges = append(edges, ToGraphEdge(rel))
	}
	return edges, nil
}

// GetFullGraph 获取完整图谱数据
func (s *GraphService) GetFullGraph(ctx context.Context, novelId string) (*GraphData, error) {
	nodes, err := s.GetNodes(ctx, novelId)
	if err != nil {
		return nil, err
	}

	edges, err := s.GetEdges(ctx, novelId)
	if err != nil {
		return nil, err
	}

	// 构建 ID -> 姓名映射，为边填充 sourceName/targetName
	idToName := make(map[string]string, len(nodes))
	for _, n := range nodes {
		idToName[n.ID] = n.Name
	}
	for i := range edges {
		edges[i].SourceName = idToName[edges[i].Source]
		edges[i].TargetName = idToName[edges[i].Target]
	}

	return &GraphData{
		Nodes: nodes,
		Edges: edges,
	}, nil
}

// ToGraphNode 将角色模型转换为图谱节点
func ToGraphNode(char *model.Character) GraphNode {
	return GraphNode{
		ID:            char.ID,
		Label:         char.Name,
		Name:          char.Name,
		IsProtagonist: char.IsProtagonist,
		Data: map[string]interface{}{
			"novelId":             char.NovelID,
			"aliases":             char.Aliases,
			"gender":              char.Gender,
			"faction":             char.Faction,
			"identity":            char.Identity,
			"personality":         char.Personality,
			"motivation":          char.Motivation,
			"firstAppearChapter":  char.FirstAppearChapter,
			"isProtagonist":       char.IsProtagonist,
			"disambiguationStatus": char.DisambiguationStatus,
		},
	}
}

// ToGraphEdge 将关系模型转换为图谱边
func ToGraphEdge(rel *model.Relation) GraphEdge {
	data := map[string]interface{}{
		"relationType":   rel.RelationType,
		"sinceChapter":   rel.SinceChapter,
		"strength":       rel.Strength,
		"isInference":    rel.IsInference,
		"inferenceBasis": rel.InferenceBasis,
	}
	if rel.UntilChapter != nil {
		data["untilChapter"] = *rel.UntilChapter
	}
	return GraphEdge{
		ID:           rel.ID,
		Source:       rel.SourceID,
		Target:       rel.TargetID,
		Label:        rel.RelationType,
		RelationType: rel.RelationType,
		IsInference:  rel.IsInference,
		Data:         data,
	}
}

// CreateNodes 批量创建图谱节点（角色）
func (s *GraphService) CreateNodes(ctx context.Context, novelId string, nodesData []map[string]interface{}) (int, error) {
	createdCount := 0
	for _, nodeData := range nodesData {
		name, _ := nodeData["name"].(string)
		if name == "" {
			continue
		}

		character := &model.Character{
			ID:       uuid.New().String(),
			NovelID:  novelId,
			Name:     name,
			Gender:   getMapStrFromNode(nodeData, "gender"),
			Faction:  getMapStrFromNode(nodeData, "faction"),
			Identity: getMapStrFromNode(nodeData, "identity"),
		}

		// 处理别名
		if aliases, ok := nodeData["aliases"]; ok {
			if arr, ok := aliases.([]interface{}); ok {
				for _, a := range arr {
					if s, ok := a.(string); ok {
						character.Aliases = append(character.Aliases, s)
					}
				}
			}
		}

		if err := s.characterRepo.Create(ctx, character); err != nil {
			slog.Warn("批量创建节点失败", "name", name, "error", err)
			continue
		}
		createdCount++
	}
	return createdCount, nil
}

// CreateEdges 批量创建图谱边（关系）
func (s *GraphService) CreateEdges(ctx context.Context, novelId string, edgesData []map[string]interface{}) (int, error) {
	createdCount := 0
	for _, edgeData := range edgesData {
		sourceId, _ := edgeData["sourceId"].(string)
		targetId, _ := edgeData["targetId"].(string)
		relationType, _ := edgeData["relationType"].(string)

		if sourceId == "" || targetId == "" || relationType == "" {
			continue
		}

		relation := &model.Relation{
			ID:           uuid.New().String(),
			SourceID:     sourceId,
			TargetID:     targetId,
			RelationType: relationType,
		}

		if strength, ok := edgeData["strength"]; ok {
			if f, ok := strength.(float64); ok {
				relation.Strength = f
			}
		}

		if err := s.relationRepo.Create(ctx, relation); err != nil {
			slog.Warn("批量创建边失败", "source", sourceId, "target", targetId, "error", err)
			continue
		}
		createdCount++
	}
	return createdCount, nil
}

// getMapStrFromNode 从节点数据中获取字符串
func getMapStrFromNode(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
