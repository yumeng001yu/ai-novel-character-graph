package model

// Character 角色模型
type Character struct {
	ID                  string   `json:"id"`
	NovelID             string   `json:"novelId"`
	Name                string   `json:"name"`
	Aliases             []string `json:"aliases"`
	Gender              string   `json:"gender"`
	Faction             string   `json:"faction"`
	Identity            string   `json:"identity"`
	Personality         string   `json:"personality"`
	Motivation          string   `json:"motivation"`
	FirstAppearChapter  int      `json:"firstAppearChapter"`
	IsProtagonist       bool     `json:"isProtagonist"`
	DisambiguationStatus string  `json:"disambiguationStatus"`
}
