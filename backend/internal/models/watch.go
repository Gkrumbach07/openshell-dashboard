package models

import (
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// WatchEvent is one JSON text frame on the sandbox watch WebSocket. Type is
// the discriminator: "sandbox", "log", "warning", or "draftPolicyUpdate";
// exactly one payload field is set. Payloads go through the From*()
// converters so secret-field stripping applies — never serialize raw proto.
type WatchEvent struct {
	Sandbox           *Sandbox           `json:"sandbox,omitempty"`
	Log               *LogLine           `json:"log,omitempty"`
	DraftPolicyUpdate *DraftPolicyUpdate `json:"draftPolicyUpdate,omitempty"`
	Type              string             `json:"type"`
	Warning           string             `json:"warning,omitempty"`
}

// DraftPolicyUpdate mirrors openshell.v1.DraftPolicyUpdate. The gateway does
// not emit this payload yet; it is relayed for forward compatibility.
type DraftPolicyUpdate struct {
	DraftVersion uint64 `json:"draftVersion"`
	NewChunks    uint32 `json:"newChunks"`
	TotalPending uint32 `json:"totalPending"`
}

// FromSandboxStreamEvent converts one gateway stream event into the wire DTO.
// ok is false for payloads the dashboard does not relay (platform events) —
// callers skip those frames.
func FromSandboxStreamEvent(evt *openshellv1.SandboxStreamEvent) (WatchEvent, bool) {
	switch p := evt.GetPayload().(type) {
	case *openshellv1.SandboxStreamEvent_Sandbox:
		sandbox := FromSandbox(p.Sandbox)
		return WatchEvent{Type: "sandbox", Sandbox: &sandbox}, true
	case *openshellv1.SandboxStreamEvent_Log:
		log := FromLogLine(p.Log)
		return WatchEvent{Type: "log", Log: &log}, true
	case *openshellv1.SandboxStreamEvent_Warning:
		return WatchEvent{Type: "warning", Warning: p.Warning.GetMessage()}, true
	case *openshellv1.SandboxStreamEvent_DraftPolicyUpdate:
		return WatchEvent{Type: "draftPolicyUpdate", DraftPolicyUpdate: &DraftPolicyUpdate{
			DraftVersion: p.DraftPolicyUpdate.GetDraftVersion(),
			NewChunks:    p.DraftPolicyUpdate.GetNewChunks(),
			TotalPending: p.DraftPolicyUpdate.GetTotalPending(),
		}}, true
	}
	return WatchEvent{}, false
}
