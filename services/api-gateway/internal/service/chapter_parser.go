package service

import (
	"regexp"
	"strings"

	"github.com/google/uuid"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
)

// ChapterParserService 章节解析服务
type ChapterParserService struct{}

// NewChapterParserService 创建章节解析服务
func NewChapterParserService() *ChapterParserService { return &ChapterParserService{} }

// ParseChapters 解析小说文本中的章节
func (s *ChapterParserService) ParseChapters(text string, novelId string, hasChapter bool) []*neo4jRepo.Chapter {
	if !hasChapter || len(text) == 0 {
		// 无章节标记，创建虚拟章节
		return []*neo4jRepo.Chapter{
			{
				ID:          uuid.New().String(),
				Index:       1,
				Title:       "全文",
				StartOffset: 0,
				CharCount:   len(strings.ReplaceAll(text, " ", "")),
				TokenCount:  len(text) / 2, // 粗略估算
				NovelId:     novelId,
			},
		}
	}

	// 匹配章节标题：第X回/第X章/第X节
	re := regexp.MustCompile(`(?:^|\n)\s*(第[零一二三四五六七八九十百千万\d]+[回章节])\s*(.*)`)
	matches := re.FindAllStringSubmatchIndex(text, -1)

	if len(matches) == 0 {
		// 没有匹配到章节，创建虚拟章节
		return []*neo4jRepo.Chapter{
			{
				ID:          uuid.New().String(),
				Index:       1,
				Title:       "全文",
				StartOffset: 0,
				CharCount:   len(text),
				TokenCount:  len(text) / 2,
				NovelId:     novelId,
			},
		}
	}

	var chapters []*neo4jRepo.Chapter
	for i, loc := range matches {
		titleStart := loc[2]
		titleEnd := loc[3]
		subtitleStart := loc[4]
		subtitleEnd := loc[5]

		title := text[titleStart:titleEnd]
		if subtitleEnd > subtitleStart {
			subtitle := strings.TrimSpace(text[subtitleStart:subtitleEnd])
			if subtitle != "" {
				title = title + " " + subtitle
			}
		}

		startOffset := loc[0]
		// 跳过标题行前面的换行符
		if startOffset > 0 && text[startOffset] == '\n' {
			startOffset++
		}

		var charCount int
		if i+1 < len(matches) {
			charCount = matches[i+1][0] - startOffset
		} else {
			charCount = len(text) - startOffset
		}

		chapters = append(chapters, &neo4jRepo.Chapter{
			ID:          uuid.New().String(),
			Index:       i + 1,
			Title:       title,
			StartOffset: startOffset,
			CharCount:   charCount,
			TokenCount:  charCount / 2,
			NovelId:     novelId,
		})
	}

	return chapters
}
