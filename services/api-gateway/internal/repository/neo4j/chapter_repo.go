package neo4j

import (
	"context"
	"log/slog"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// ChapterRepo 章节仓库
type ChapterRepo struct{}

// NewChapterRepo 创建章节仓库实例
func NewChapterRepo() *ChapterRepo { return &ChapterRepo{} }

// Chapter 章节数据
type Chapter struct {
	ID          string `json:"id"`
	Index       int    `json:"index"`
	Title       string `json:"title"`
	StartOffset int    `json:"startOffset"`
	CharCount   int    `json:"charCount"`
	TokenCount  int    `json:"tokenCount"`
	NovelId     string `json:"novelId"`
}

// CreateBatch 批量创建章节
func (r *ChapterRepo) CreateBatch(ctx context.Context, chapters []*Chapter) error {
	// Neo4j 不可用时直接保存到文件系统
	if !IsAvailable() {
		if len(chapters) > 0 {
			fsSaveChapters(chapters[0].NovelId, chapters)
		}
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	neo4jFailed := false
	for _, ch := range chapters {
		_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
			_, err := tx.Run(ctx,
				`MATCH (n:Novel {id: $novelId})
				 CREATE (n)-[:HAS_CHAPTER]->(c:Chapter {
					id: $id, index: $index, title: $title,
					startOffset: $startOffset, charCount: $charCount,
					tokenCount: $tokenCount, novelId: $novelId
				 })
				 RETURN c`,
				map[string]interface{}{
					"id":          ch.ID,
					"index":       ch.Index,
					"title":       ch.Title,
					"startOffset": ch.StartOffset,
					"charCount":   ch.CharCount,
					"tokenCount":  ch.TokenCount,
					"novelId":     ch.NovelId,
				})
			return nil, err
		})
		if err != nil {
			neo4jFailed = true
			break
		}
	}
	if neo4jFailed {
		// Neo4j 不可用时回退到文件系统存储
		slog.Warn("Neo4j 创建章节失败，回退到文件系统存储", "novelId", chapters[0].NovelId)
		fsSaveChapters(chapters[0].NovelId, chapters)
		return nil
	}
	slog.Info("批量创建章节成功", "count", len(chapters))
	return nil
}

// FindByNovelId 根据小说ID查找章节
func (r *ChapterRepo) FindByNovelId(ctx context.Context, novelId string) ([]*Chapter, error) {
	// Neo4j 不可用时直接从文件系统读取
	if !IsAvailable() {
		return fsLoadChapters(novelId), nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		records, err := tx.Run(ctx,
			`MATCH (n:Novel {id: $novelId})-[:HAS_CHAPTER]->(c:Chapter)
			 RETURN c.id, c.index, c.title, c.startOffset, c.charCount, c.tokenCount, c.novelId
			 ORDER BY c.index`,
			map[string]interface{}{"novelId": novelId})
		if err != nil {
			return nil, err
		}
		var chapters []*Chapter
		for records.Next(ctx) {
			record := records.Record()
			ch := &Chapter{}
			if v, ok := record.Get("c.id"); ok && v != nil {
				ch.ID = v.(string)
			}
			if v, ok := record.Get("c.index"); ok && v != nil {
				ch.Index = getIntPropVal(v)
			}
			if v, ok := record.Get("c.title"); ok && v != nil {
				ch.Title = v.(string)
			}
			if v, ok := record.Get("c.startOffset"); ok && v != nil {
				ch.StartOffset = getIntPropVal(v)
			}
			if v, ok := record.Get("c.charCount"); ok && v != nil {
				ch.CharCount = getIntPropVal(v)
			}
			if v, ok := record.Get("c.tokenCount"); ok && v != nil {
				ch.TokenCount = getIntPropVal(v)
			}
			if v, ok := record.Get("c.novelId"); ok && v != nil {
				ch.NovelId = v.(string)
			}
			chapters = append(chapters, ch)
		}
		return chapters, nil
	})
	if err != nil {
		// Neo4j 不可用时从文件系统读取
		slog.Warn("查询章节失败（Neo4j 可能未启动），从文件系统读取", "novelId", novelId, "error", err)
		return fsLoadChapters(novelId), nil
	}
	if result == nil {
		return []*Chapter{}, nil
	}
	return result.([]*Chapter), nil
}

// getIntPropVal 从接口值中获取整数
func getIntPropVal(v interface{}) int {
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
