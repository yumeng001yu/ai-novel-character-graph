package model

// Relation 角色关系模型
type Relation struct {
	ID             string  `json:"id"`
	SourceID       string  `json:"sourceId"`
	TargetID       string  `json:"targetId"`
	RelationType   string  `json:"relationType"`
	SinceChapter   int     `json:"sinceChapter"`
	UntilChapter   *int    `json:"untilChapter"`
	Strength       float64 `json:"strength"`
	IsInference    bool    `json:"isInference"`
	InferenceBasis string  `json:"inferenceBasis"`
}
