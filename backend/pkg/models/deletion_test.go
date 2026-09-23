package models

import (
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// The SDK contract (openshell/v1/types/mutations.go) is explicit: only
// Completed and AlreadyAbsent establish completion, and unrecognized numeric
// outcomes must not be treated as completion.
func TestFromSDKDeletion(t *testing.T) {
	tests := []struct {
		name        string
		res         *openshell.DeletionResult
		wantDeleted bool
		wantOutcome string
	}{
		{"completed", &openshell.DeletionResult{Outcome: openshell.DeletionCompleted}, true, "completed"},
		{"already absent", &openshell.DeletionResult{Outcome: openshell.DeletionAlreadyAbsent}, true, "already_absent"},
		{"accepted is not completion", &openshell.DeletionResult{Outcome: openshell.DeletionAccepted}, false, "accepted"},
		{"unspecified is not completion", &openshell.DeletionResult{Outcome: openshell.DeletionUnspecified}, false, "unspecified"},
		{"unknown future value is not completion", &openshell.DeletionResult{Outcome: openshell.DeletionOutcome(99)}, false, "unspecified"},
		{"nil result stays backward compatible", nil, true, "completed"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := FromSDKDeletion(tc.res)
			if got.Deleted != tc.wantDeleted {
				t.Errorf("Deleted = %v, want %v", got.Deleted, tc.wantDeleted)
			}
			if got.Outcome != tc.wantOutcome {
				t.Errorf("Outcome = %q, want %q", got.Outcome, tc.wantOutcome)
			}
		})
	}
}
