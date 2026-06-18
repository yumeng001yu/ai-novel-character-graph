package model

// Novel 小说模型
type Novel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	TotalChars  int    `json:"totalChars"`
	TotalTokens int    `json:"totalTokens"`
	TotalSteps  int    `json:"totalSteps"`
	InputMode   string `json:"inputMode"`
	CurrentStep int    `json:"currentStep"`
	ContextSize int    `json:"contextSize"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}
