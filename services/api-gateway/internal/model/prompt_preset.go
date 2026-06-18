package model

// PromptPreset 提示词预设模型
type PromptPreset struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	IsDefault            bool   `json:"isDefault"`
	SystemPrompt         string `json:"systemPrompt"`
	CharacterTemplate    string `json:"characterTemplate"`
	BehaviorGuidelines   string `json:"behaviorGuidelines"`
	GroupSystemPrompt    string `json:"groupSystemPrompt"`
	DialogueSystemPrompt string `json:"dialogueSystemPrompt"`
	FirstMessageSuffix   string `json:"firstMessageSuffix"`
	MaxTokens            int    `json:"maxTokens"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
}
