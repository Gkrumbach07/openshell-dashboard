package api

import "testing"

func TestValidDNS1123(t *testing.T) {
	cases := []struct {
		name  string
		valid bool
	}{
		{"team-a", true},
		{"a", true},
		{"my-workspace-1", true},
		{"", false},
		{"-leading", false},
		{"trailing-", false},
		{"UpperCase", false},
		{"under_score", false},
		{"way-too-long-name-way-too-long-name-way-too-long-name-way-too-long", false},
	}
	for _, tc := range cases {
		if got := validDNS1123(tc.name); got != tc.valid {
			t.Errorf("validDNS1123(%q) = %v, want %v", tc.name, got, tc.valid)
		}
	}
}
