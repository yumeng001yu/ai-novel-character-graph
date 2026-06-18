package service

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
)

// ExportService 导出服务
type ExportService struct {
	characterRepo *neo4jRepo.CharacterRepo
	relationRepo  *neo4jRepo.RelationRepo
}

// NewExportService 创建导出服务实例
func NewExportService() *ExportService {
	return &ExportService{
		characterRepo: neo4jRepo.NewCharacterRepo(),
		relationRepo:  neo4jRepo.NewRelationRepo(),
	}
}

// ExportJSON 导出为 JSON 格式
func (s *ExportService) ExportJSON(ctx context.Context, novelId string) ([]byte, error) {
	graphSvc := NewGraphService()
	data, err := graphSvc.GetFullGraph(ctx, novelId)
	if err != nil {
		return nil, fmt.Errorf("导出 JSON 失败: %w", err)
	}
	return json.MarshalIndent(data, "", "  ")
}

// ExportGraphML 导出为 GraphML 格式
func (s *ExportService) ExportGraphML(ctx context.Context, novelId string) (string, error) {
	graphSvc := NewGraphService()
	data, err := graphSvc.GetFullGraph(ctx, novelId)
	if err != nil {
		return "", fmt.Errorf("导出 GraphML 失败: %w", err)
	}

	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>`)
	sb.WriteString(`<graphml xmlns="http://graphml.graphstruct.org/graphml">`)
	sb.WriteString(`<graph id="G" edgedefault="undirected">`)

	// 节点
	for _, node := range data.Nodes {
		sb.WriteString(fmt.Sprintf(`<node id="%s"><data key="label">%s</data></node>`, node.ID, node.Label))
	}

	// 边
	for _, edge := range data.Edges {
		sb.WriteString(fmt.Sprintf(`<edge id="%s" source="%s" target="%s"><data key="label">%s</data></edge>`,
			edge.ID, edge.Source, edge.Target, edge.Label))
	}

	sb.WriteString(`</graph></graphml>`)
	return sb.String(), nil
}

// ExportGEXF 导出为 GEXF 格式
func (s *ExportService) ExportGEXF(ctx context.Context, novelId string) (string, error) {
	graphSvc := NewGraphService()
	data, err := graphSvc.GetFullGraph(ctx, novelId)
	if err != nil {
		return "", fmt.Errorf("导出 GEXF 失败: %w", err)
	}

	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>`)
	sb.WriteString(`<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">`)
	sb.WriteString(`<graph mode="static" defaultedgetype="undirected">`)
	sb.WriteString(`<nodes>`)

	for _, node := range data.Nodes {
		sb.WriteString(fmt.Sprintf(`<node id="%s" label="%s" />`, node.ID, node.Label))
	}

	sb.WriteString(`</node><edges>`)

	for _, edge := range data.Edges {
		sb.WriteString(fmt.Sprintf(`<edge id="%s" source="%s" target="%s" label="%s" />`,
			edge.ID, edge.Source, edge.Target, edge.Label))
	}

	sb.WriteString(`</edges></graph></gexf>`)
	return sb.String(), nil
}

// ExportCSV 导出为 CSV 格式（节点和边分别导出）
func (s *ExportService) ExportCSV(ctx context.Context, novelId string) (nodesCSV string, edgesCSV string, err error) {
	graphSvc := NewGraphService()
	data, err := graphSvc.GetFullGraph(ctx, novelId)
	if err != nil {
		return "", "", fmt.Errorf("导出 CSV 失败: %w", err)
	}

	// 节点 CSV
	var nodesBuf strings.Builder
	nodesWriter := csv.NewWriter(&nodesBuf)
	nodesWriter.Write([]string{"id", "label", "gender", "faction", "identity"})
	for _, node := range data.Nodes {
		gender, _ := node.Data["gender"].(string)
		faction, _ := node.Data["faction"].(string)
		identity, _ := node.Data["identity"].(string)
		nodesWriter.Write([]string{node.ID, node.Label, gender, faction, identity})
	}
	nodesWriter.Flush()

	// 边 CSV
	var edgesBuf strings.Builder
	edgesWriter := csv.NewWriter(&edgesBuf)
	edgesWriter.Write([]string{"id", "source", "target", "relationType", "strength"})
	for _, edge := range data.Edges {
		relationType, _ := edge.Data["relationType"].(string)
		strength := fmt.Sprintf("%v", edge.Data["strength"])
		edgesWriter.Write([]string{edge.ID, edge.Source, edge.Target, relationType, strength})
	}
	edgesWriter.Flush()

	return nodesBuf.String(), edgesBuf.String(), nil
}

// ExportCSVToWriter 将 CSV 数据写入 io.Writer
func (s *ExportService) ExportCSVToWriter(ctx context.Context, novelId string, nodesWriter io.Writer, edgesWriter io.Writer) error {
	graphSvc := NewGraphService()
	data, err := graphSvc.GetFullGraph(ctx, novelId)
	if err != nil {
		return fmt.Errorf("导出 CSV 失败: %w", err)
	}

	// 写入节点
	nw := csv.NewWriter(nodesWriter)
	nw.Write([]string{"id", "label", "gender", "faction", "identity"})
	for _, node := range data.Nodes {
		gender, _ := node.Data["gender"].(string)
		faction, _ := node.Data["faction"].(string)
		identity, _ := node.Data["identity"].(string)
		nw.Write([]string{node.ID, node.Label, gender, faction, identity})
	}
	nw.Flush()

	// 写入边
	ew := csv.NewWriter(edgesWriter)
	ew.Write([]string{"id", "source", "target", "relationType", "strength"})
	for _, edge := range data.Edges {
		relationType, _ := edge.Data["relationType"].(string)
		strength := fmt.Sprintf("%v", edge.Data["strength"])
		ew.Write([]string{edge.ID, edge.Source, edge.Target, relationType, strength})
	}
	ew.Flush()

	return nil
}

// 确保 model 包被引用
var _ model.Character
