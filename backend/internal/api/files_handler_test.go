package api

import "testing"

func TestValidateFilePath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "valid absolute path", path: "/sandbox/file.txt", want: true},
		{name: "valid nested path", path: "/home/user/data.json", want: true},
		{name: "empty path", path: "", want: false},
		{name: "relative path", path: "relative/file.txt", want: false},
		{name: "traversal attack", path: "/sandbox/../etc/passwd", want: false},
		{name: "null byte", path: "/sandbox/file\x00.txt", want: false},
		{name: "dot only", path: ".", want: false},
		{name: "double dot", path: "..", want: false},
		{name: "root path", path: "/", want: true},
		{name: "path with spaces", path: "/sandbox/my file.txt", want: true},
		{name: "double slash cleaned", path: "//sandbox//file.txt", want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := validateFilePath(tc.path)
			if got != tc.want {
				t.Errorf("validateFilePath(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}
