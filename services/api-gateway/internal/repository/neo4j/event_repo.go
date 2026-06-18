package neo4j

import (
	"context"
	"log/slog"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// EventRepo 事件数据仓库
type EventRepo struct{}

// NewEventRepo 创建事件仓库实例
func NewEventRepo() *EventRepo {
	return &EventRepo{}
}

// FindByNovelId 根据小说 ID 查找所有事件
func (r *EventRepo) FindByNovelId(ctx context.Context, novelId string) ([]*model.Event, error) {
	// Neo4j 不可用时从文件系统读取
	if !IsAvailable() {
		return fsLoadEvents(novelId), nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_EVENT]->(e:Event)
			RETURN e ORDER BY e.chapter`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId})
		if err != nil {
			return nil, err
		}
		var events []*model.Event
		for records.Next(ctx) {
			event, err := recordToEvent(records.Record())
			if err != nil {
				return nil, err
			}
			events = append(events, event)
		}
		return events, nil
	})
	if err != nil {
		// Neo4j 连接失败时返回空列表
		slog.Warn("查询小说事件失败（Neo4j 可能未启动），返回空列表", "novelId", novelId, "error", err)
		return []*model.Event{}, nil
	}
	if result == nil {
		return []*model.Event{}, nil
	}
	return result.([]*model.Event), nil
}

// FindByChapter 根据小说 ID 和章节查找事件
func (r *EventRepo) FindByChapter(ctx context.Context, novelId string, chapter int) ([]*model.Event, error) {
	// Neo4j 不可用时从文件系统读取并过滤
	if !IsAvailable() {
		allEvents := fsLoadEvents(novelId)
		var filtered []*model.Event
		for _, e := range allEvents {
			if e.Chapter == chapter {
				filtered = append(filtered, e)
			}
		}
		return filtered, nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_EVENT]->(e:Event)
			WHERE e.chapter = $chapter
			RETURN e ORDER BY e.chapter`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{
			"novelId": novelId,
			"chapter": chapter,
		})
		if err != nil {
			return nil, err
		}
		var events []*model.Event
		for records.Next(ctx) {
			event, err := recordToEvent(records.Record())
			if err != nil {
				return nil, err
			}
			events = append(events, event)
		}
		return events, nil
	})
	if err != nil {
		// Neo4j 连接失败时返回空列表
		slog.Warn("查询章节事件失败（Neo4j 可能未启动），返回空列表", "novelId", novelId, "chapter", chapter, "error", err)
		return []*model.Event{}, nil
	}
	if result == nil {
		return []*model.Event{}, nil
	}
	return result.([]*model.Event), nil
}

// Create 创建事件节点
func (r *EventRepo) Create(ctx context.Context, event *model.Event) error {
	// Neo4j 不可用时保存到文件系统
	if !IsAvailable() {
		fsAppendEvent(event)
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})
			CREATE (e:Event {
				id: $id,
				novelId: $novelId,
				name: $name,
				chapter: $chapter,
				summary: $summary,
				eventType: $eventType
			})
			CREATE (n)-[:HAS_EVENT]->(e)
			RETURN e`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{
			"id":        event.ID,
			"novelId":   event.NovelID,
			"name":      event.Name,
			"chapter":   event.Chapter,
			"summary":   event.Summary,
			"eventType": event.EventType,
		})
		return nil, err
	})
	if err != nil {
		slog.Error("创建事件失败", "error", err)
		return err
	}
	slog.Info("事件创建成功", "id", event.ID, "name", event.Name)
	return nil
}

// Delete 删除事件
func (r *EventRepo) Delete(ctx context.Context, id string) error {
	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH (e:Event {id: $id}) DETACH DELETE e`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"id": id})
		return nil, err
	})
	if err != nil {
		slog.Error("删除事件失败", "id", id, "error", err)
		return err
	}
	slog.Info("事件删除成功", "id", id)
	return nil
}

// recordToEvent 将 Neo4j 记录转换为 Event 模型
func recordToEvent(record *neo4j.Record) (*model.Event, error) {
	node, ok := record.Get("e")
	if !ok {
		return nil, nil
	}
	n, ok := node.(neo4j.Node)
	if !ok {
		return nil, nil
	}
	props := n.Props
	event := &model.Event{
		ID:        getStringProp(props, "id"),
		NovelID:   getStringProp(props, "novelId"),
		Name:      getStringProp(props, "name"),
		Chapter:   getIntProp(props, "chapter"),
		Summary:   getStringProp(props, "summary"),
		EventType: getStringProp(props, "eventType"),
	}
	return event, nil
}
