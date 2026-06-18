package model

// Event 事件模型
type Event struct {
	ID        string `json:"id"`
	NovelID   string `json:"novelId"`
	Name      string `json:"name"`
	Chapter   int    `json:"chapter"`
	Summary   string `json:"summary"`
	EventType string `json:"eventType"`
}
