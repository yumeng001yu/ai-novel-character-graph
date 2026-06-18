package neo4j

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// CharacterRepo 角色数据仓库
type CharacterRepo struct{}

// NewCharacterRepo 创建角色仓库实例
func NewCharacterRepo() *CharacterRepo {
	return &CharacterRepo{}
}

// FindByID 根据 ID 查找角色
func (r *CharacterRepo) FindByID(ctx context.Context, id string) (*model.Character, error) {
	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH (c:Character {id: $id}) RETURN c`
		record, err := tx.Run(ctx, cypher, map[string]interface{}{"id": id})
		if err != nil {
			return nil, err
		}
		if record.Next(ctx) {
			return recordToCharacter(record.Record())
		}
		return nil, nil
	})
	if err != nil {
		slog.Error("查询角色失败", "id", id, "error", err)
		return nil, err
	}
	if result == nil {
		return nil, nil
	}
	return result.(*model.Character), nil
}

// FindByNovelId 根据小说 ID 查找所有角色
func (r *CharacterRepo) FindByNovelId(ctx context.Context, novelId string) ([]*model.Character, error) {
	// Neo4j 不可用时直接从文件系统读取
	if !IsAvailable() {
		return fsLoadCharacters(novelId), nil
	}

	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
			RETURN c ORDER BY c.firstAppearChapter`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId})
		if err != nil {
			return nil, err
		}
		var characters []*model.Character
		for records.Next(ctx) {
			char, err := recordToCharacter(records.Record())
			if err != nil {
				return nil, err
			}
			characters = append(characters, char)
		}
		return characters, nil
	})
	if err != nil {
		// Neo4j 连接失败时返回空列表
		slog.Warn("查询小说角色失败（Neo4j 可能未启动），返回空列表", "novelId", novelId, "error", err)
		return []*model.Character{}, nil
	}
	if result == nil {
		return []*model.Character{}, nil
	}
	return result.([]*model.Character), nil
}

// FindByIds 根据多个 ID 查找角色
func (r *CharacterRepo) FindByIds(ctx context.Context, ids []string) ([]*model.Character, error) {
	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH (c:Character) WHERE c.id IN $ids RETURN c`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"ids": ids})
		if err != nil {
			return nil, err
		}
		var characters []*model.Character
		for records.Next(ctx) {
			char, err := recordToCharacter(records.Record())
			if err != nil {
				return nil, err
			}
			characters = append(characters, char)
		}
		return characters, nil
	})
	if err != nil {
		slog.Error("批量查询角色失败", "ids", ids, "error", err)
		return nil, err
	}
	if result == nil {
		return []*model.Character{}, nil
	}
	return result.([]*model.Character), nil
}

// Search 搜索角色（按名称或别名模糊匹配）
func (r *CharacterRepo) Search(ctx context.Context, novelId string, keyword string) ([]*model.Character, error) {
	session := NewReadSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
			WHERE c.name CONTAINS $keyword OR ANY(alias IN c.aliases WHERE alias CONTAINS $keyword)
			RETURN c`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{
			"novelId": novelId,
			"keyword": keyword,
		})
		if err != nil {
			return nil, err
		}
		var characters []*model.Character
		for records.Next(ctx) {
			char, err := recordToCharacter(records.Record())
			if err != nil {
				return nil, err
			}
			characters = append(characters, char)
		}
		return characters, nil
	})
	if err != nil {
		slog.Error("搜索角色失败", "novelId", novelId, "keyword", keyword, "error", err)
		return nil, err
	}
	if result == nil {
		return []*model.Character{}, nil
	}
	return result.([]*model.Character), nil
}

// Create 创建角色节点
func (r *CharacterRepo) Create(ctx context.Context, character *model.Character) error {
	// Neo4j 不可用时保存到文件系统
	if !IsAvailable() {
		fsAppendCharacter(character)
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})
			CREATE (c:Character {
				id: $id,
				novelId: $novelId,
				name: $name,
				aliases: $aliases,
				gender: $gender,
				faction: $faction,
				identity: $identity,
				personality: $personality,
				motivation: $motivation,
				firstAppearChapter: $firstAppearChapter,
				isProtagonist: $isProtagonist,
				disambiguationStatus: $disambiguationStatus
			})
			CREATE (n)-[:HAS_CHARACTER]->(c)
			RETURN c`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{
			"id":                  character.ID,
			"novelId":             character.NovelID,
			"name":                character.Name,
			"aliases":             character.Aliases,
			"gender":              character.Gender,
			"faction":             character.Faction,
			"identity":            character.Identity,
			"personality":         character.Personality,
			"motivation":          character.Motivation,
			"firstAppearChapter":  character.FirstAppearChapter,
			"isProtagonist":       character.IsProtagonist,
			"disambiguationStatus": character.DisambiguationStatus,
		})
		return nil, err
	})
	if err != nil {
		slog.Error("创建角色失败", "error", err)
		return err
	}
	slog.Info("角色创建成功", "id", character.ID, "name", character.Name)
	return nil
}

// Update 更新角色信息
func (r *CharacterRepo) Update(ctx context.Context, character *model.Character) error {
	// Neo4j 不可用时更新文件系统
	if !IsAvailable() {
		fsAppendCharacter(character) // fsAppendCharacter 会按 ID 更新
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (c:Character {id: $id})
			SET c.name = $name,
			    c.aliases = $aliases,
			    c.gender = $gender,
			    c.faction = $faction,
			    c.identity = $identity,
			    c.personality = $personality,
			    c.motivation = $motivation,
			    c.firstAppearChapter = $firstAppearChapter,
			    c.isProtagonist = $isProtagonist,
			    c.disambiguationStatus = $disambiguationStatus
			RETURN c`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{
			"id":                  character.ID,
			"name":                character.Name,
			"aliases":             character.Aliases,
			"gender":              character.Gender,
			"faction":             character.Faction,
			"identity":            character.Identity,
			"personality":         character.Personality,
			"motivation":          character.Motivation,
			"firstAppearChapter":  character.FirstAppearChapter,
			"isProtagonist":       character.IsProtagonist,
			"disambiguationStatus": character.DisambiguationStatus,
		})
		return nil, err
	})
	if err != nil {
		slog.Error("更新角色失败", "id", character.ID, "error", err)
		return err
	}
	slog.Info("角色更新成功", "id", character.ID)
	return nil
}

// Delete 删除角色
func (r *CharacterRepo) Delete(ctx context.Context, id string) error {
	// Neo4j 不可用时从文件系统删除（需要遍历所有小说目录查找）
	if !IsAvailable() {
		// 简化处理：遍历所有小说目录，删除匹配的角色
		entries, err := os.ReadDir(fsNovelsDir)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				characters := fsLoadCharacters(entry.Name())
				for i, c := range characters {
					if c.ID == id {
						characters = append(characters[:i], characters[i+1:]...)
						fsSaveCharacters(entry.Name(), characters)
						return nil
					}
				}
			}
		}
		return nil
	}

	session := NewSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `MATCH (c:Character {id: $id}) DETACH DELETE c`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"id": id})
		return nil, err
	})
	if err != nil {
		slog.Error("删除角色失败", "id", id, "error", err)
		return err
	}
	slog.Info("角色删除成功", "id", id)
	return nil
}

// EnsureIndexes 确保必要的索引存在
func (r *CharacterRepo) EnsureIndexes(ctx context.Context) error {
	session := NewSession(ctx)
	defer session.Close(ctx)

	indexes := []string{
		"CREATE INDEX IF NOT EXISTS FOR (c:Character) ON (c.id)",
		"CREATE INDEX IF NOT EXISTS FOR (c:Character) ON (c.novelId)",
		"CREATE INDEX IF NOT EXISTS FOR (c:Character) ON (c.name)",
	}

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		for _, indexCypher := range indexes {
			_, err := tx.Run(ctx, indexCypher, nil)
			if err != nil {
				return nil, fmt.Errorf("创建索引失败: %w", err)
			}
		}
		return nil, nil
	})
	if err != nil {
		slog.Error("确保角色索引失败", "error", err)
		return err
	}
	slog.Info("角色索引确保完成")
	return nil
}

// recordToCharacter 将 Neo4j 记录转换为 Character 模型
func recordToCharacter(record *neo4j.Record) (*model.Character, error) {
	node, ok := record.Get("c")
	if !ok {
		return nil, fmt.Errorf("记录中未找到节点 c")
	}
	n, ok := node.(neo4j.Node)
	if !ok {
		return nil, fmt.Errorf("节点类型断言失败")
	}
	props := n.Props

	// 处理 aliases 切片
	var aliases []string
	if v, ok := props["aliases"]; ok && v != nil {
		if arr, ok := v.([]interface{}); ok {
			for _, item := range arr {
				if s, ok := item.(string); ok {
					aliases = append(aliases, s)
				}
			}
		}
	}

	character := &model.Character{
		ID:                  getStringProp(props, "id"),
		NovelID:             getStringProp(props, "novelId"),
		Name:                getStringProp(props, "name"),
		Aliases:             aliases,
		Gender:              getStringProp(props, "gender"),
		Faction:             getStringProp(props, "faction"),
		Identity:            getStringProp(props, "identity"),
		Personality:         getStringProp(props, "personality"),
		Motivation:          getStringProp(props, "motivation"),
		FirstAppearChapter:  getIntProp(props, "firstAppearChapter"),
		IsProtagonist:       getBoolProp(props, "isProtagonist"),
		DisambiguationStatus: getStringProp(props, "disambiguationStatus"),
	}
	return character, nil
}
