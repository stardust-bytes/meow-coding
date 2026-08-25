package main

import (
	"encoding/json"
	"testing"

	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
)

// The wrapper registers the internal translators via a blank import in
// main.go. Without them the proxy would forward raw chat-completions bodies to
// the Codex backend, which answers HTTP 400 for every model. This test locks
// that behaviour in.
func TestCodexTranslatorRegistered(t *testing.T) {
	payload := []byte(`{"model":"gpt-5.5","messages":[{"role":"system","content":"You are helpful."},{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"read_file","description":"read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],"tool_choice":"auto","stream":true}`)
	body := sdktranslator.TranslateRequest(sdktranslator.FormatOpenAI, sdktranslator.FormatCodex, "gpt-5.5", payload, false)

	if len(body) == 0 {
		t.Fatal("empty translated body")
	}
	// The codex Responses format carries input/instructions instead of the
	// chat-completions messages array.
	if string(body) == string(payload) {
		t.Fatalf("translator not registered; body passed through unchanged: %s", body)
	}
}

func jsonUnmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

// Multi-turn tool calls: an assistant message with tool_calls followed by a
// tool result must translate to function_call + function_call_output items that
// share the SAME call_id. Upstream rejects mismatched ids with
// "No tool call found for function call output with call_id ...".
func TestCodexMultiTurnToolCallIdsMatch(t *testing.T) {
	const callID = "call_00_sxmZtOSIuwYSQ95glTAa2097"
	payload := []byte(`{"model":"gpt-5.5","messages":[
		{"role":"system","content":"You are helpful."},
		{"role":"user","content":"read the file"},
		{"role":"assistant","content":"","tool_calls":[{"id":"` + callID + `","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"x\"}"}}]},
		{"role":"tool","tool_call_id":"` + callID + `","content":"file contents"}
	],"tools":[{"type":"function","function":{"name":"read_file","description":"read","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],"tool_choice":"auto","stream":true}`)
	body := sdktranslator.TranslateRequest(sdktranslator.FormatOpenAI, sdktranslator.FormatCodex, "gpt-5.5", payload, false)

	var input struct {
		Input []struct {
			Type   string `json:"type"`
			CallID string `json:"call_id"`
		} `json:"input"`
	}
	if err := jsonUnmarshal(body, &input); err != nil {
		t.Fatalf("unmarshal translated body: %v\n%s", err, body)
	}
	var call, output bool
	for _, item := range input.Input {
		switch item.Type {
		case "function_call":
			call = true
			if item.CallID != callID {
				t.Fatalf("function_call call_id mismatch: got %q want %q", item.CallID, callID)
			}
		case "function_call_output":
			output = true
			if item.CallID != callID {
				t.Fatalf("function_call_output call_id mismatch: got %q want %q", item.CallID, callID)
			}
		}
	}
	if !call {
		t.Fatalf("no function_call item produced:\n%s", body)
	}
	if !output {
		t.Fatalf("no function_call_output item produced:\n%s", body)
	}
}
